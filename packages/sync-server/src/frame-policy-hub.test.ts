import { describe, expect, it, vi } from 'vitest';
import { createCurrentCapabilities, createExtensionKind } from '@fieldnotes/sync';
import { SyncHub, type MessageDispatchOptions } from './sync-hub';
import { InMemoryHubFanout } from './hub-fanout';
import type { ServerOpContext } from './sync-plugin';

const clear = JSON.stringify({ from: 'untrusted', op: { kind: 'clear' } });

describe('guarded hub dispatch', () => {
  it.each([false, true])(
    'shares local and plugin fanout order; queued abort=%s',
    async (abortQueued) => {
      const bus = new InMemoryHubFanout();
      const seen: string[] = [];
      const kind = createExtensionKind<{ value: string }>({
        extensionKind: 'test:ordering',
        codec: {
          validate: (payload): payload is { value: string } =>
            typeof payload === 'object' &&
            payload !== null &&
            'value' in payload &&
            typeof payload.value === 'string',
        },
      });
      let release: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const contexts: ServerOpContext[] = [];
      const hub = new SyncHub({
        fanout: bus,
        instanceId: 'local',
        plugins: [
          {
            name: 'ordering',
            registerExtensionKinds(registry) {
              registry.register(kind, async () => ({ accepted: null, corrections: [] }));
            },
            async process(op, context, next) {
              seen.push(context.connectionId);
              contexts.push(context);
              if (context.connectionId === 'A') await gate;
              return next(op, context);
            },
            async applyFanout(op, context) {
              seen.push('F');
              expect(context.signal).toBeUndefined();
              expect(context.deadlineAt).toBeUndefined();
              return op;
            },
          },
        ],
      });
      hub.addConnection({ id: 'A', room: 'R', send: () => undefined });
      hub.addConnection({ id: 'B', room: 'R', send: () => undefined });
      const first = hub.handleMessage('A', clear);
      await vi.waitFor(() => expect(seen).toEqual(['A']));
      const controller = new AbortController();
      const beforeProcess = vi.fn(() => true);
      const options: MessageDispatchOptions = {
        signal: controller.signal,
        deadlineAt: Date.now() + 1000,
        beforeProcess,
      };
      const second = hub.handleMessage('B', clear, options);
      bus.publish(
        JSON.stringify({
          o: 'other',
          room: 'R',
          from: 'remote',
          op: { kind: 'extension', extensionKind: 'test:ordering', payload: { value: 'x' } },
        }),
      );
      if (abortQueued) {
        controller.abort();
        await second;
      }
      expect(seen).toEqual(['A']);
      release?.();
      await first;
      if (!abortQueued) await second;
      await vi.waitFor(() => expect(seen).toEqual(abortQueued ? ['A', 'F'] : ['A', 'B', 'F']));
      expect(beforeProcess).toHaveBeenCalledTimes(abortQueued ? 0 : 1);
      if (!abortQueued) {
        expect(contexts[1]?.signal).toBe(controller.signal);
        expect(contexts[1]?.deadlineAt).toBe(options.deadlineAt);
      }
      hub.close();
    },
  );

  it('resolves an expired queued dispatch without invoking its hook or backend', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const called: string[] = [];
    const hub = new SyncHub({
      plugins: [
        {
          name: 'block',
          async process(op, context, next) {
            called.push(context.connectionId);
            if (context.connectionId === 'A') await gate;
            return next(op, context);
          },
        },
      ],
    });
    hub.addConnection({ id: 'A', room: 'R', send: () => undefined });
    hub.addConnection({ id: 'B', room: 'R', send: () => undefined });
    const first = hub.handleMessage('A', clear);
    await vi.waitFor(() => expect(called).toEqual(['A']));
    const beforeProcess = vi.fn(() => true);
    const second = hub.handleMessage('B', clear, {
      signal: new AbortController().signal,
      deadlineAt: Date.now() - 1,
      beforeProcess,
    });
    release?.();
    await Promise.all([first, second]);
    expect(beforeProcess).not.toHaveBeenCalled();
    expect(called).toEqual(['A']);
    hub.close();
  });

  it('does not retain an idle room queue for an already-aborted or expired dispatch', async () => {
    const hub = new SyncHub();
    hub.addConnection({ id: 'A', room: 'R', send: () => undefined });
    const queues = Reflect.get(hub, 'roomQueues') as Map<string, unknown>;
    const beforeProcess = vi.fn(() => true);
    const controller = new AbortController();
    controller.abort();
    await hub.handleMessage('A', clear, {
      signal: controller.signal,
      deadlineAt: Date.now() + 1000,
      beforeProcess,
    });
    expect(queues.has('R')).toBe(false);
    await hub.handleMessage('A', clear, {
      signal: new AbortController().signal,
      deadlineAt: Date.now() - 1,
      beforeProcess,
    });
    expect(queues.has('R')).toBe(false);
    expect(hub.roomCount()).toBe(1); // membership stays; no last-disconnect cleanup masks a leak
    expect(beforeProcess).not.toHaveBeenCalled();
    hub.close();
  });

  it('keeps an active dispatch promise pending after abort until its hook settles', async () => {
    const process = vi.fn(async (op, context, next) => next(op, context));
    const hub = new SyncHub({ plugins: [{ name: 'watch', process }] });
    hub.addConnection({ id: 'A', room: 'R', send: () => undefined });
    const controller = new AbortController();
    let settleHook: ((allowed: boolean) => void) | undefined;
    const beforeProcess = vi.fn(() => new Promise<boolean>((resolve) => (settleHook = resolve)));
    let settled = false;
    const active = hub
      .handleMessage('A', clear, {
        signal: controller.signal,
        deadlineAt: Date.now() + 1000,
        beforeProcess,
      })
      .then(() => {
        settled = true;
      });
    await vi.waitFor(() => expect(beforeProcess).toHaveBeenCalledOnce());
    controller.abort();
    await new Promise((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    settleHook?.(true);
    await active;
    expect(settled).toBe(true);
    expect(process).not.toHaveBeenCalled();
    await hub.handleMessage('A', clear);
    expect(process).toHaveBeenCalledOnce();
    hub.close();
  });

  it('keeps guarded capabilities and presence behind the room backlog and drops them on abort', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const hub = new SyncHub({
      presenceThrottleMs: 0,
      plugins: [
        {
          name: 'block',
          async process(op, context, next) {
            if (context.connectionId === 'A') await gate;
            return next(op, context);
          },
        },
      ],
    });
    const sentB: string[] = [];
    const sentC: string[] = [];
    hub.addConnection({ id: 'A', room: 'R', send: () => undefined });
    hub.addConnection({ id: 'B', room: 'R', send: (message) => sentB.push(message) });
    hub.addConnection({ id: 'C', room: 'R', send: (message) => sentC.push(message) });
    const first = hub.handleMessage('A', clear);
    await new Promise((resolve) => setImmediate(resolve));
    const controller = new AbortController();
    const beforeProcess = vi.fn(() => true);
    const options: MessageDispatchOptions = {
      signal: controller.signal,
      deadlineAt: Date.now() + 1000,
      beforeProcess,
    };
    const capabilities = hub.handleMessage(
      'B',
      JSON.stringify({
        from: 'forged',
        op: { kind: 'capabilities', capabilities: createCurrentCapabilities([]) },
      }),
      options,
    );
    const presence = hub.handleMessage(
      'B',
      JSON.stringify({ from: 'forged', op: { kind: 'presence', data: { label: 'hidden' } } }),
      options,
    );
    expect(beforeProcess).not.toHaveBeenCalled();
    controller.abort();
    await Promise.all([capabilities, presence]);
    expect(beforeProcess).not.toHaveBeenCalled();
    release?.();
    await first;
    expect(
      sentB.every((message) => !message.includes('capabilities') && !message.includes('hidden')),
    ).toBe(true);
    expect(sentC.every((message) => !message.includes('hidden'))).toBe(true);
    hub.close();
  });
});
