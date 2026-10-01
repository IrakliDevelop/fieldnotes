import { describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { prepareAuthorityCheckpoint, serializeAuthorityFrame } from '@fieldnotes/sync';
import { FrameBudget } from './bounded-frame-queue';
import { FrameTransport } from './frame-transport';
import { SyncHub } from './sync-hub';

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('outbound send callback lifecycle', () => {
  it('tracks actual native settlement after caller failure and disposal', async () => {
    let callback: ((error?: Error) => void) | undefined;
    const ws = {
      readyState: WebSocket.OPEN,
      send: (_message: string, done: (error?: Error) => void) => {
        callback = done;
      },
    } as unknown as WebSocket;
    const budget = new FrameBudget(1, 1024, 1, 1024);
    const hub = new SyncHub();
    const transport = new FrameTransport(
      ws,
      hub,
      { connectionId: 'A', room: 'R' },
      {},
      budget,
      vi.fn(),
    );
    const tracked = transport.sendTracked('one');
    const actuallySettled = vi.fn();
    void tracked.settled.then(actuallySettled);
    await vi.waitFor(() => expect(callback).toBeDefined());
    transport.dispose();
    await expect(tracked.completion).rejects.toThrow('frame delivery failed');
    expect(actuallySettled).not.toHaveBeenCalled();
    expect(budget.reserve('B', 'R', 'two')).toBeNull();
    callback?.();
    await tracked.settled;
    expect(actuallySettled).toHaveBeenCalledTimes(1);
    expect(budget.reserve('B', 'R', 'two')).toBeTypeOf('function');
    hub.close();
  });

  it('keeps tracked native callback work charged after timeout until the late callback', async () => {
    let callback: ((error?: Error) => void) | undefined;
    const ws = {
      readyState: WebSocket.OPEN,
      send: (_message: string, done: (error?: Error) => void) => {
        callback = done;
      },
    } as unknown as WebSocket;
    const budget = new FrameBudget(1, 1024, 1, 1024);
    const hub = new SyncHub();
    const transport = new FrameTransport(
      ws,
      hub,
      { connectionId: 'A', room: 'R' },
      {},
      budget,
      vi.fn(),
    );
    const timer = vi.spyOn(globalThis, 'setTimeout');
    try {
      const tracked = transport.sendTracked('one');
      const settled = vi.fn();
      void tracked.settled.then(settled);
      await vi.waitFor(() => expect(callback).toBeDefined());
      const expiry = timer.mock.calls.find(
        (call) => typeof call[1] === 'number' && call[1] > 4900 && call[1] <= 5000,
      );
      expect(expiry).toBeDefined();
      const deadline = Date.now() + 5000;
      const clock = vi.spyOn(Date, 'now').mockReturnValue(deadline);
      try {
        expiry?.[0]();
      } finally {
        clock.mockRestore();
      }
      await expect(tracked.completion).rejects.toThrow('frame delivery failed');
      expect(settled).not.toHaveBeenCalled();
      expect(budget.reserve('B', 'R', 'two')).toBeNull();
      callback?.();
      await tracked.settled;
      expect(settled).toHaveBeenCalledTimes(1);
      expect(budget.reserve('B', 'R', 'two')).toBeTypeOf('function');
    } finally {
      timer.mockRestore();
      transport.dispose();
      hub.close();
    }
  });

  it('settles rejected admission and canceled queued work without a native callback', async () => {
    let callback: ((error?: Error) => void) | undefined;
    const ws = {
      readyState: WebSocket.OPEN,
      send: (_message: string, done: (error?: Error) => void) => {
        callback = done;
      },
    } as unknown as WebSocket;
    const hub = new SyncHub();
    const budget = new FrameBudget(2, 1024, 2, 1024);
    const transport = new FrameTransport(
      ws,
      hub,
      { connectionId: 'A', room: 'R' },
      {},
      budget,
      vi.fn(),
    );
    const active = transport.sendTracked('one');
    await vi.waitFor(() => expect(callback).toBeDefined());
    const queued = transport.sendTracked('two');
    const denied = transport.sendTracked('three');
    await expect(denied.completion).rejects.toThrow('frame delivery failed');
    await denied.settled;
    transport.dispose();
    await expect(queued.completion).rejects.toThrow('frame delivery failed');
    await queued.settled;
    await expect(active.completion).rejects.toThrow('frame delivery failed');
    expect(budget.reserve('B', 'R', 'two')).toBeTypeOf('function');
    callback?.();
    await active.settled;
    hub.close();
  });
  it('waits for the native callback after admission and authorization', async () => {
    const callbacks: ((error?: Error) => void)[] = [];
    const ws = {
      readyState: WebSocket.OPEN,
      send: (_message: string, done: (error?: Error) => void) => {
        callbacks.push(done);
      },
    } as unknown as WebSocket;
    const budget = new FrameBudget(1, 1024, 1, 1024);
    const hub = new SyncHub();
    const transport = new FrameTransport(
      ws,
      hub,
      { connectionId: 'A', room: 'R' },
      {},
      budget,
      vi.fn(),
    );
    const settled = vi.fn();
    const sending = transport.sendAsync('one').then(settled);
    await vi.waitFor(() => expect(callbacks).toHaveLength(1));
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    callbacks[0]?.();
    await sending;
    const next = transport.sendAsync('next');
    await vi.waitFor(() => expect(callbacks).toHaveLength(2));
    callbacks[1]?.();
    await next;
    const release = budget.reserve('A', 'R', 'third');
    expect(release).toBeTypeOf('function');
    release?.();
    transport.dispose();
    hub.close();
  });

  it('keeps mixed void and async sends FIFO and writes each frame once', async () => {
    const callbacks: ((error?: Error) => void)[] = [];
    const writes: string[] = [];
    const ws = {
      readyState: WebSocket.OPEN,
      send: (message: string, done: (error?: Error) => void) => {
        writes.push(message);
        callbacks.push(done);
      },
    } as unknown as WebSocket;
    const hub = new SyncHub();
    const transport = new FrameTransport(
      ws,
      hub,
      { connectionId: 'A', room: 'R' },
      {},
      new FrameBudget(3, 1024, 3, 1024),
      vi.fn(),
    );
    transport.send('first');
    const second = transport.sendAsync('second');
    transport.send('third');
    await vi.waitFor(() => expect(writes).toEqual(['first']));
    callbacks[0]?.();
    await vi.waitFor(() => expect(writes).toEqual(['first', 'second']));
    callbacks[1]?.();
    await second;
    await vi.waitFor(() => expect(writes).toEqual(['first', 'second', 'third']));
    callbacks[2]?.();
    await tick();
    expect(writes).toEqual(['first', 'second', 'third']);
    transport.dispose();
    hub.close();
  });

  it.each(['error', 'throw', 'duplicate'])(
    'settles callback %s exactly once with generic failure or success',
    async (mode) => {
      let callback: ((error?: Error) => void) | undefined;
      const ws = {
        readyState: WebSocket.OPEN,
        send: (_message: string, done: (error?: Error) => void) => {
          if (mode === 'throw') throw new Error('private-sentinel');
          callback = done;
        },
      } as unknown as WebSocket;
      const close = vi.fn();
      const budget = new FrameBudget(1, 1024, 1, 1024);
      const hub = new SyncHub();
      const transport = new FrameTransport(
        ws,
        hub,
        { connectionId: 'A', room: 'R' },
        {},
        budget,
        close,
      );
      const sending = transport.sendAsync('private-sentinel');
      const outcome = sending.then(
        () => 'success',
        (error: Error) => error.message,
      );
      if (mode !== 'throw') await vi.waitFor(() => expect(callback).toBeDefined());
      if (mode === 'error') callback?.(new Error('private-sentinel'));
      if (mode === 'duplicate') callback?.();
      expect(await outcome).toBe(mode === 'duplicate' ? 'success' : 'frame delivery failed');
      callback?.(new Error('late private-sentinel'));
      await tick();
      expect(close).toHaveBeenCalledTimes(mode === 'duplicate' ? 0 : 1);
      expect(budget.reserve('A', 'R', 'next')).toBeTypeOf('function');
      transport.dispose();
      hub.close();
    },
  );

  it.each([
    { result: false, code: 4403 },
    { result: 'yes', code: 1013 },
    { result: 'throw', code: 1013 },
    { result: 'reject', code: 1013 },
  ])('fails denied policy $result before requesting close', async ({ result, code }) => {
    const ws = { readyState: WebSocket.OPEN, send: vi.fn() } as unknown as WebSocket;
    const close = vi.fn();
    const hub = new SyncHub();
    const transport = new FrameTransport(
      ws,
      hub,
      { connectionId: 'A', room: 'R' },
      {
        authorize: () => {
          if (result === 'throw') throw new Error('private-sentinel');
          if (result === 'reject') return Promise.reject(new Error('private-sentinel'));
          return result as boolean;
        },
      },
      new FrameBudget(),
      () => {
        expect(ws.send).not.toHaveBeenCalled();
        close(code);
      },
    );
    const outcome = transport.sendAsync('private-sentinel').then(
      () => 'success',
      (error: Error) => error.message,
    );
    expect(await outcome).toBe('frame delivery failed');
    expect(close).toHaveBeenCalledWith(code);
    transport.dispose();
    hub.close();
  });

  it('rejects active and queued callers on dispose while retaining only active capacity', async () => {
    let finish: ((error?: Error) => void) | undefined;
    const writes = vi.fn((_message: string, done: (error?: Error) => void) => {
      finish = done;
    });
    const ws = { readyState: WebSocket.OPEN, send: writes } as unknown as WebSocket;
    const budget = new FrameBudget(2, 1024, 2, 1024);
    const hub = new SyncHub();
    const transport = new FrameTransport(
      ws,
      hub,
      { connectionId: 'A', room: 'R' },
      {},
      budget,
      vi.fn(),
    );
    const first = transport.sendAsync('first').catch((error: Error) => error.message);
    const second = transport.sendAsync('second').catch((error: Error) => error.message);
    await vi.waitFor(() => expect(finish).toBeDefined());
    transport.dispose();
    expect(await first).toBe('frame delivery failed');
    expect(await second).toBe('frame delivery failed');
    expect(budget.reserve('B', 'R', 'two')).toBeTypeOf('function');
    expect(budget.reserve('C', 'R', 'three')).toBeNull();
    finish?.();
    await tick();
    expect(writes).toHaveBeenCalledTimes(1);
    expect(budget.reserve('C', 'R', 'three')).toBeTypeOf('function');
    await expect(transport.sendAsync('late')).rejects.toThrow('frame delivery failed');
    hub.close();
  });

  it('times out a never-settling authorizer without releasing active capacity early', async () => {
    let allow: ((value: boolean) => void) | undefined;
    let deadline = 0;
    const send = vi.fn();
    const ws = { readyState: WebSocket.OPEN, send } as unknown as WebSocket;
    const close = vi.fn();
    const budget = new FrameBudget(1, 1024, 1, 1024);
    const hub = new SyncHub();
    const transport = new FrameTransport(
      ws,
      hub,
      { connectionId: 'A', room: 'R' },
      {
        authorize: (context) => {
          deadline = context.deadlineAt;
          return new Promise<boolean>((resolve) => (allow = resolve));
        },
      },
      budget,
      close,
    );
    const timer = vi.spyOn(globalThis, 'setTimeout');
    try {
      const tracked = transport.sendTracked('first');
      const settled = vi.fn();
      void tracked.settled.then(settled);
      const outcome = tracked.completion.catch((error: Error) => error.message);
      await vi.waitFor(() => expect(allow).toBeDefined());
      const deadlineTimer = timer.mock.calls.find(
        (call) => typeof call[1] === 'number' && call[1] > 4900 && call[1] <= 5000,
      );
      expect(deadlineTimer).toBeDefined();
      const clock = vi.spyOn(Date, 'now').mockReturnValue(deadline);
      try {
        deadlineTimer?.[0]();
      } finally {
        clock.mockRestore();
      }
      expect(await outcome).toBe('frame delivery failed');
      expect(close).toHaveBeenCalledWith(1013);
      expect(settled).not.toHaveBeenCalled();
      expect(budget.reserve('B', 'R', 'next')).toBeNull();
      allow?.(true);
      await tracked.settled;
      expect(settled).toHaveBeenCalledTimes(1);
      expect(send).not.toHaveBeenCalled();
      expect(budget.reserve('B', 'R', 'next')).toBeTypeOf('function');
    } finally {
      timer.mockRestore();
      transport.dispose();
      hub.close();
    }
  });

  it('unlinks a queued timed-out send while a native callback holds the active slot', async () => {
    let callback: ((error?: Error) => void) | undefined;
    const send = vi.fn((_message: string, done: (error?: Error) => void) => {
      callback = done;
    });
    const ws = { readyState: WebSocket.OPEN, send } as unknown as WebSocket;
    const budget = new FrameBudget(2, 1024, 2, 1024);
    const hub = new SyncHub();
    const transport = new FrameTransport(
      ws,
      hub,
      { connectionId: 'A', room: 'R' },
      {},
      budget,
      vi.fn(),
    );
    const timer = vi.spyOn(globalThis, 'setTimeout');
    try {
      const first = transport.sendAsync('first').catch((error: Error) => error.message);
      await vi.waitFor(() => expect(callback).toBeDefined());
      const beforeSecond = timer.mock.calls.length;
      const second = transport.sendAsync('second').catch((error: Error) => error.message);
      const secondTimer = timer.mock.calls
        .slice(beforeSecond)
        .find((call) => typeof call[1] === 'number' && call[1] > 4900 && call[1] <= 5000);
      expect(secondTimer).toBeDefined();
      secondTimer?.[0]();
      expect(await second).toBe('frame delivery failed');
      expect(budget.reserve('B', 'R', 'third')).toBeTypeOf('function');
      expect(send).toHaveBeenCalledTimes(1);
      callback?.();
      expect(await first).toBeUndefined();
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      timer.mockRestore();
      transport.dispose();
      hub.close();
    }
  });

  it('does not accumulate reservations across repeated denied async admissions', async () => {
    let callback: ((error?: Error) => void) | undefined;
    const ws = {
      readyState: WebSocket.OPEN,
      send: (_message: string, done: (error?: Error) => void) => {
        callback = done;
      },
    } as unknown as WebSocket;
    const close = vi.fn();
    const budget = new FrameBudget(1, 1024, 1, 1024);
    const hub = new SyncHub();
    const transport = new FrameTransport(
      ws,
      hub,
      { connectionId: 'A', room: 'R' },
      {},
      budget,
      close,
    );
    const first = transport.sendAsync('first');
    await vi.waitFor(() => expect(callback).toBeDefined());
    for (let index = 0; index < 100; index++) {
      await expect(transport.sendAsync('denied')).rejects.toThrow('frame delivery failed');
    }
    expect(budget.reserve('B', 'R', 'next')).toBeNull();
    callback?.();
    await first;
    expect(budget.reserve('B', 'R', 'next')).toBeTypeOf('function');
    transport.dispose();
    hub.close();
  });

  it('rejects a callback at the exact expiry boundary even before a delayed timer runs', async () => {
    let callback: ((error?: Error) => void) | undefined;
    const ws = {
      readyState: WebSocket.OPEN,
      send: (_message: string, done: (error?: Error) => void) => {
        callback = done;
      },
    } as unknown as WebSocket;
    const expiresAt = Date.now() + 60_000;
    const close = vi.fn();
    const hub = new SyncHub();
    const transport = new FrameTransport(
      ws,
      hub,
      { connectionId: 'A', room: 'R', expiresAt },
      {},
      new FrameBudget(),
      close,
    );
    const outcome = transport.sendAsync('first').catch((error: Error) => error.message);
    await vi.waitFor(() => expect(callback).toBeDefined());
    const clock = vi.spyOn(Date, 'now').mockReturnValue(expiresAt);
    try {
      callback?.();
    } finally {
      clock.mockRestore();
    }
    expect(await outcome).toBe('frame delivery failed');
    expect(close).toHaveBeenCalledWith(4401);
    transport.dispose();
    hub.close();
  });

  it('paces a long prepared checkpoint by awaited callbacks and stops pulling after failure', async () => {
    const prepared = await prepareAuthorityCheckpoint(
      {
        cursor: { generation: 'g', streamId: 's', revision: 0 },
        elements: [],
        layers: [],
        extensions: {
          large: { pluginName: 'large', version: 1, data: { text: 'x'.repeat(18 * 1024 * 1024) } },
        },
      },
      {
        requestId: 'r',
        checkpointId: 'c',
        requiredExtensions: [
          { key: 'large', pluginName: 'large', version: 1, validate: () => true },
        ],
      },
    );
    expect(prepared.manifest.chunkCount).toBeGreaterThan(30);
    const pulled = vi.spyOn(prepared.frames, 'next');
    const callbacks: ((error?: Error) => void)[] = [];
    const send = vi.fn((_message: string, done: (error?: Error) => void) => callbacks.push(done));
    const ws = { readyState: WebSocket.OPEN, send } as unknown as WebSocket;
    const hub = new SyncHub();
    const transport = new FrameTransport(
      ws,
      hub,
      { connectionId: 'A', room: 'R' },
      {},
      new FrameBudget(1, 2 * 1024 * 1024, 1, 2 * 1024 * 1024),
      vi.fn(),
    );
    const consume = async () => {
      for (const frame of prepared.frames)
        await transport.sendAsync(serializeAuthorityFrame(frame));
    };
    const outcome = consume().then(
      () => 'success',
      (error: Error) => error.message,
    );
    await vi.waitFor(() => expect(callbacks).toHaveLength(1));
    expect(pulled).toHaveBeenCalledTimes(1);
    callbacks[0]?.();
    await vi.waitFor(() => expect(callbacks).toHaveLength(2));
    expect(pulled).toHaveBeenCalledTimes(2);
    callbacks[1]?.(new Error('private-sentinel'));
    expect(await outcome).toBe('frame delivery failed');
    expect(send).toHaveBeenCalledTimes(2);
    expect(pulled).toHaveBeenCalledTimes(2);
    prepared.dispose();
    transport.dispose();
    hub.close();
  }, 30_000);

  it('completes a prepared multi-chunk stream one local write at a time', async () => {
    const prepared = await prepareAuthorityCheckpoint(
      {
        cursor: { generation: 'g', streamId: 's', revision: 0 },
        elements: [],
        layers: [],
        extensions: {
          large: { pluginName: 'large', version: 1, data: { text: 'x'.repeat(2 * 1024 * 1024) } },
        },
      },
      {
        requestId: 'r',
        checkpointId: 'c',
        requiredExtensions: [
          { key: 'large', pluginName: 'large', version: 1, validate: () => true },
        ],
      },
    );
    let active = 0;
    let peak = 0;
    const messages: string[] = [];
    const ws = {
      readyState: WebSocket.OPEN,
      send: (message: string, done: (error?: Error) => void) => {
        active++;
        peak = Math.max(peak, active);
        messages.push(message);
        setImmediate(() => {
          active--;
          done();
        });
      },
    } as unknown as WebSocket;
    const hub = new SyncHub();
    const transport = new FrameTransport(
      ws,
      hub,
      { connectionId: 'A', room: 'R' },
      {},
      new FrameBudget(1, 2 * 1024 * 1024, 1, 2 * 1024 * 1024),
      vi.fn(),
    );
    for (const frame of prepared.frames) await transport.sendAsync(serializeAuthorityFrame(frame));
    expect(messages).toHaveLength(prepared.manifest.chunkCount + 2);
    expect(peak).toBe(1);
    expect(JSON.parse(messages[0] ?? '').kind).toBe('checkpoint-begin');
    expect(JSON.parse(messages.at(-1) ?? '').kind).toBe('checkpoint-end');
    transport.dispose();
    hub.close();
  }, 30_000);
  it('retains an active reservation across close, then releases exactly once on a late error', async () => {
    let callback: ((error?: Error) => void) | undefined;
    const ws = {
      readyState: WebSocket.OPEN,
      send: (_message: string, done: (error?: Error) => void) => {
        callback = done;
      },
    } as unknown as WebSocket;
    const budget = new FrameBudget(1, 1024, 1, 1024);
    const close = vi.fn();
    const hub = new SyncHub();
    const transport = new FrameTransport(
      ws,
      hub,
      { connectionId: 'A', room: 'R' },
      {},
      budget,
      close,
    );
    transport.send('one');
    await vi.waitFor(() => expect(callback).toBeDefined());
    transport.dispose();
    expect(budget.reserve('B', 'R', 'two')).toBeNull();
    callback?.(new Error('late private error'));
    await new Promise((resolve) => setImmediate(resolve));
    const release = budget.reserve('B', 'R', 'two');
    expect(release).toBeTypeOf('function');
    callback?.(new Error('duplicate callback'));
    await new Promise((resolve) => setImmediate(resolve));
    expect(budget.reserve('C', 'R', 'three')).toBeNull();
    expect(close).not.toHaveBeenCalled();
    release?.();
    expect(budget.reserve('C', 'R', 'three')).toBeTypeOf('function');
    hub.close();
  });
});
