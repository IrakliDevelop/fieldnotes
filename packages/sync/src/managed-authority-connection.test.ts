import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAuthorityCapabilities } from './capabilities';
import {
  createAuthorityClientExtension,
  createAuthorityExtensionReducer,
} from './authority-client-extension';
import { createManagedAuthorityConnection } from './managed-authority-connection';
import { prepareAuthorityCheckpoint } from './authority-checkpoint';
import {
  MAX_AUTHORITY_FRAME_BYTES,
  parseAuthorityClientFrame,
  serializeAuthorityFrame,
} from './authority-protocol';
import { createExtensionKind } from './sync-plugin';
import type {
  AuthorityClientTransport,
  AuthorityClientTransportHandlers,
} from './authority-client-types';

class FakeTransport implements AuthorityClientTransport {
  handlers: AuthorityClientTransportHandlers | null = null;
  readonly sent: string[] = [];
  open = false;
  closeOnCheckpointSend = false;
  onManagerClose: (() => void) | null = null;
  start(handlers: AuthorityClientTransportHandlers): void {
    this.handlers = handlers;
  }
  trySend(raw: string): boolean {
    if (!this.open) return false;
    this.sent.push(raw);
    if (
      this.closeOnCheckpointSend &&
      parseAuthorityClientFrame(raw)?.kind === 'checkpoint-request'
    ) {
      this.disconnect();
    }
    return true;
  }
  close(): void {
    this.open = false;
    const callback = this.onManagerClose;
    this.onManagerClose = null;
    callback?.();
  }
  triggerOpen(): void {
    this.open = true;
    this.handlers?.onOpen();
  }
  message(raw: string): void {
    this.handlers?.onMessage(raw);
  }
  disconnect(code = 1006): void {
    this.open = false;
    this.handlers?.onClose(code, 'private');
  }
}

type HostileSignalMode =
  | 'sync-abort-store'
  | 'sync-abort-store-throw'
  | 'registration-throw'
  | 'remove-throw'
  | 'ordinary';

class HostileAbortSignal {
  aborted = false;
  readonly listeners = new Set<() => void>();

  constructor(readonly mode: HostileSignalMode) {}

  addEventListener(_type: string, listener: () => void): void {
    if (this.mode === 'registration-throw') {
      this.listeners.add(listener);
      throw new Error('registration');
    }
    if (this.mode === 'sync-abort-store' || this.mode === 'sync-abort-store-throw') {
      this.aborted = true;
      listener();
      this.listeners.add(listener);
      if (this.mode === 'sync-abort-store-throw') throw new Error('registration');
      return;
    }
    this.listeners.add(listener);
  }

  removeEventListener(_type: string, listener: () => void): void {
    this.listeners.delete(listener);
    if (this.mode === 'remove-throw') throw new Error('removal');
  }

  abort(): void {
    this.aborted = true;
    for (const listener of [...this.listeners]) listener();
  }

  asAbortSignal(): AbortSignal {
    return this as unknown as AbortSignal;
  }
}

const turn = async (): Promise<void> => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};
const frameAt = <T>(values: readonly T[], index: number): T => {
  const value = values[index];
  if (value === undefined) throw new Error('missing frame');
  return value;
};

const capabilityExtensions = () =>
  [
    ['z-state', 'z-plugin', 'z-kind'],
    ['a-state', 'a-plugin', 'a-kind'],
  ].map(([key, pluginName, extensionKind]) => {
    if (key === undefined || pluginName === undefined || extensionKind === undefined) {
      throw new Error('fixture');
    }
    return createAuthorityClientExtension({
      key,
      pluginName,
      version: 1,
      validate: (value): value is number => typeof value === 'number',
      reducers: [
        createAuthorityExtensionReducer({
          kind: createExtensionKind<null>({
            extensionKind,
            codec: { validate: (value): value is null => value === null },
          }),
          reduce: (state: number) => state,
        }),
      ],
    });
  });

async function bootstrap(
  target: ReturnType<typeof createManagedAuthorityConnection>,
  transport: FakeTransport,
) {
  transport.triggerOpen();
  expect(JSON.parse(transport.sent[0] ?? '{}')).toEqual({
    from: 'client',
    op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
  });
  transport.message(
    JSON.stringify({
      from: 'hub',
      op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
    }),
  );
  transport.message(
    serializeAuthorityFrame({
      protocol: 'authority:1',
      kind: 'resync-required',
      generation: 'g',
      reason: 'checkpoint-required',
    }),
  );
  await turn();
  const request = transport.sent
    .map(parseAuthorityClientFrame)
    .find((frame) => frame?.kind === 'checkpoint-request');
  if (request?.kind !== 'checkpoint-request') throw new Error('missing request');
  const prepared = await prepareAuthorityCheckpoint(
    {
      cursor: { generation: 'g', streamId: 's', revision: 0 },
      elements: [],
      layers: [],
      extensions: {},
    },
    { requestId: request.requestId, checkpointId: 'checkpoint', requiredExtensions: [] },
  );
  for (const frame of prepared.frames) {
    transport.message(serializeAuthorityFrame(frame));
    await turn();
  }
  for (let attempt = 0; attempt < 3 && target.getState().status !== 'live'; attempt += 1) {
    await turn();
  }
  expect(target.getState().status).toBe('live');
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('createManagedAuthorityConnection', () => {
  it('accepts semantically equal capabilities independent of property order', async () => {
    const transport = new FakeTransport();
    const target = createManagedAuthorityConnection({
      scopeId: 'scope',
      clientId: 'client',
      resolveUrl: () => ({ url: 'ws://x' }),
      transportFactory: () => transport,
    });
    await turn();
    transport.triggerOpen();
    transport.message(
      JSON.stringify({
        from: 'hub',
        op: {
          kind: 'capabilities',
          capabilities: {
            elementEnvelope: true,
            authority: 1,
            extensionKinds: [],
            protocolVersion: 1,
          },
        },
      }),
    );
    transport.message(
      serializeAuthorityFrame({
        protocol: 'authority:1',
        kind: 'resync-required',
        generation: 'g',
        reason: 'checkpoint-required',
      }),
    );
    await turn();
    expect(target.getState().status).toBe('recovering');
    expect(
      transport.sent
        .map(parseAuthorityClientFrame)
        .some((frame) => frame?.kind === 'checkpoint-request'),
    ).toBe(true);
    target.stop();
  });

  it('compares exact capability kind and inventory sets and treats semantic duplicates as inert', async () => {
    const transport = new FakeTransport();
    const target = createManagedAuthorityConnection({
      scopeId: 'scope',
      clientId: 'client',
      resolveUrl: () => ({ url: 'ws://x' }),
      transportFactory: () => transport,
      extensions: capabilityExtensions(),
    });
    await turn();
    transport.triggerOpen();
    const first = {
      elementEnvelope: true as const,
      authority: 1 as const,
      extensionKinds: ['z-kind', 'a-kind'],
      protocolVersion: 1,
      authorityExtensions: [
        { version: 1, pluginName: 'z-plugin', key: 'z-state' },
        { key: 'a-state', version: 1, pluginName: 'a-plugin' },
      ],
    };
    transport.message(
      JSON.stringify({ from: 'hub', op: { kind: 'capabilities', capabilities: first } }),
    );
    transport.message(
      JSON.stringify({
        op: {
          capabilities: {
            protocolVersion: 1,
            extensionKinds: ['a-kind', 'z-kind'],
            elementEnvelope: true,
            authorityExtensions: [...first.authorityExtensions].reverse(),
            authority: 1,
          },
          kind: 'capabilities',
        },
        from: 'hub',
      }),
    );
    expect(target.getState().status).toBe('connecting');
    transport.message(
      JSON.stringify({
        from: 'hub',
        op: {
          kind: 'capabilities',
          capabilities: { ...first, extensionKinds: ['a-kind', 'a-kind'] },
        },
      }),
    );
    expect(target.getState()).toMatchObject({ status: 'upgrade-required', error: 'capabilities' });
    target.stop();
  });

  it.each([
    {
      name: 'missing authority',
      capabilities: { protocolVersion: 1, extensionKinds: [], elementEnvelope: true },
    },
    { name: 'extra kind', capabilities: createAuthorityCapabilities(['extra']) },
    {
      name: 'duplicate kinds',
      capabilities: { ...createAuthorityCapabilities([]), extensionKinds: ['same', 'same'] },
    },
    {
      name: 'extra inventory',
      capabilities: createAuthorityCapabilities(
        [],
        [{ key: 'extra', pluginName: 'extra', version: 1 }],
      ),
    },
  ])('rejects $name during exact capability negotiation', async ({ capabilities }) => {
    const transport = new FakeTransport();
    const target = createManagedAuthorityConnection({
      scopeId: 'scope',
      clientId: 'client',
      resolveUrl: () => ({ url: 'ws://x' }),
      transportFactory: () => transport,
    });
    await turn();
    transport.triggerOpen();
    transport.message(JSON.stringify({ from: 'hub', op: { kind: 'capabilities', capabilities } }));
    expect(target.getState().status).toBe('upgrade-required');
    target.stop();
  });

  it('snapshots identity, resolver, and transport factory before the first microtask', async () => {
    const first = new FakeTransport();
    const second = new FakeTransport();
    let firstResolves = 0;
    let secondResolves = 0;
    const options = {
      scopeId: 'scope-a',
      clientId: 'client-a',
      resolveUrl: () => {
        firstResolves += 1;
        return { url: 'ws://a' };
      },
      transportFactory: () => first,
    };
    const target = createManagedAuthorityConnection(options);
    options.scopeId = 'scope-b';
    options.clientId = 'client-b';
    options.resolveUrl = () => {
      secondResolves += 1;
      return { url: 'ws://b' };
    };
    options.transportFactory = () => second;
    await turn();
    first.triggerOpen();
    expect(firstResolves).toBe(1);
    expect(secondResolves).toBe(0);
    expect(second.handlers).toBeNull();
    expect(target.getState().scopeId).toBe('scope-a');
    expect(JSON.parse(first.sent[0] ?? '{}')).toMatchObject({ from: 'client-a' });
    target.stop();
  });

  it('reads option getters once and fails synchronously before lifecycle start on a hostile getter', () => {
    const reads = { scope: 0, client: 0, resolver: 0, extensions: 0, factory: 0 };
    const transport = new FakeTransport();
    const target = createManagedAuthorityConnection({
      get scopeId() {
        reads.scope += 1;
        return 'scope';
      },
      get clientId() {
        reads.client += 1;
        return 'client';
      },
      get resolveUrl() {
        reads.resolver += 1;
        return () => ({ url: 'ws://x' });
      },
      get extensions() {
        reads.extensions += 1;
        return [];
      },
      get transportFactory() {
        reads.factory += 1;
        return () => transport;
      },
    });
    expect(reads).toEqual({ scope: 1, client: 1, resolver: 1, extensions: 1, factory: 1 });
    target.stop();
    let resolved = 0;
    expect(() =>
      createManagedAuthorityConnection({
        get scopeId(): string {
          throw new Error('hostile');
        },
        clientId: 'client',
        resolveUrl: () => {
          resolved += 1;
          return { url: 'ws://x' };
        },
      }),
    ).toThrow(TypeError);
    expect(resolved).toBe(0);
  });

  it('does not invoke a resolver after a subscriber stops during reconnecting', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const transports: FakeTransport[] = [];
    let resolves = 0;
    const target = createManagedAuthorityConnection({
      scopeId: 'scope',
      clientId: 'client',
      resolveUrl: () => {
        resolves += 1;
        return { url: 'ws://x' };
      },
      transportFactory: () => {
        const value = new FakeTransport();
        transports.push(value);
        return value;
      },
    });
    await turn();
    const first = transports[0];
    if (!first) throw new Error('fixture');
    const unsubscribe = target.subscribe(() => {
      if (target.getState().status === 'connecting' && resolves === 1) target.stop();
    });
    first.disconnect();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(target.getState().status).toBe('stopped');
    expect(resolves).toBe(1);
    unsubscribe();
  });

  it('does not request a checkpoint after a subscriber stops during recovering', async () => {
    const transport = new FakeTransport();
    const target = createManagedAuthorityConnection({
      scopeId: 'scope',
      clientId: 'client',
      resolveUrl: () => ({ url: 'ws://x' }),
      transportFactory: () => transport,
    });
    target.subscribe(() => {
      if (target.getState().status === 'recovering') target.stop();
    });
    await turn();
    transport.triggerOpen();
    transport.message(
      JSON.stringify({
        from: 'hub',
        op: { kind: 'capabilities', capabilities: createAuthorityCapabilities([]) },
      }),
    );
    transport.message(
      serializeAuthorityFrame({
        protocol: 'authority:1',
        kind: 'resync-required',
        generation: 'g',
        reason: 'checkpoint-required',
      }),
    );
    await turn();
    expect(target.getState().status).toBe('stopped');
    expect(
      transport.sent
        .map(parseAuthorityClientFrame)
        .filter((frame) => frame?.kind === 'checkpoint-request'),
    ).toEqual([]);
  });

  it('does not retain work when a subscriber stops during live or offline publication', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const first = new FakeTransport();
    const live = createManagedAuthorityConnection({
      scopeId: 'scope',
      clientId: 'client',
      resolveUrl: () => ({ url: 'ws://x' }),
      transportFactory: () => first,
    });
    await turn();
    await bootstrap(live, first);
    live.subscribe(() => {
      if (live.getState().status === 'live') live.stop();
    });
    first.message(
      serializeAuthorityFrame({
        protocol: 'authority:1',
        kind: 'changes',
        cursor: { generation: 'g', streamId: 's', revision: 1 },
        mutations: [{ kind: 'remove', id: 'live-stop' }],
      }),
    );
    await turn();
    expect(live.getState().status).toBe('stopped');

    let resolves = 0;
    const second = new FakeTransport();
    const offline = createManagedAuthorityConnection({
      scopeId: 'scope',
      clientId: 'client',
      resolveUrl: () => {
        resolves += 1;
        return { url: 'ws://x' };
      },
      transportFactory: () => second,
    });
    await turn();
    offline.subscribe(() => {
      if (offline.getState().status === 'offline') offline.stop();
    });
    second.disconnect();
    expect(offline.getState().status).toBe('stopped');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(resolves).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    {
      name: 'terminal application close',
      fail: (transport: FakeTransport) => transport.disconnect(4403),
    },
    {
      name: 'capability protocol failure',
      fail: (transport: FakeTransport) =>
        transport.message(
          JSON.stringify({
            from: 'hub',
            op: {
              kind: 'capabilities',
              capabilities: createAuthorityCapabilities(['unexpected']),
            },
          }),
        ),
    },
  ])('keeps stop terminal when uncertainty publication reenters during $name', async ({ fail }) => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const transport = new FakeTransport();
    let resolves = 0;
    const target = createManagedAuthorityConnection({
      scopeId: 'scope',
      clientId: 'client',
      resolveUrl: () => {
        resolves += 1;
        return { url: 'ws://x' };
      },
      transportFactory: () => transport,
    });
    await turn();
    await bootstrap(target, transport);
    expect(target.submit({ kind: 'remove', id: 'pending' }).status).toBe('admitted');
    let publications = 0;
    target.subscribe(() => {
      publications += 1;
      if (target.getState().operations[0]?.status === 'uncertain') target.stop();
    });
    fail(transport);
    const settledPublications = publications;
    expect(target.getState().status).toBe('stopped');
    const stoppedState = target.getState();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(target.getState()).toBe(stoppedState);
    expect(publications).toBe(settledPublications);
    expect(resolves).toBe(1);
    await expect(target.requestCheckpoint()).resolves.toEqual({
      status: 'failed',
      reason: 'stopped',
    });
  });

  it('keeps reentrant stop terminal during fourth 4401 cleanup', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const transports: FakeTransport[] = [];
    let resolves = 0;
    const target = createManagedAuthorityConnection({
      scopeId: 'scope',
      clientId: 'client',
      resolveUrl: () => {
        resolves += 1;
        return { url: 'ws://x' };
      },
      transportFactory: () => {
        const value = new FakeTransport();
        transports.push(value);
        return value;
      },
    });
    await turn();
    for (const delay of [1_000, 2_000, 4_000]) {
      const active = transports.at(-1);
      if (!active) throw new Error('fixture');
      active.disconnect(4401);
      await vi.advanceTimersByTimeAsync(delay);
    }
    const fourth = transports.at(-1);
    if (!fourth) throw new Error('fixture');
    fourth.onManagerClose = () => target.stop();
    fourth.disconnect(4401);
    expect(target.getState().status).toBe('stopped');
    const stoppedState = target.getState();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(target.getState()).toBe(stoppedState);
    expect(resolves).toBe(4);
    await expect(target.requestCheckpoint()).resolves.toEqual({
      status: 'failed',
      reason: 'stopped',
    });
  });

  it('isolates hostile listeners while preserving reentrant traversal', async () => {
    const transport = new FakeTransport();
    const target = createManagedAuthorityConnection({
      scopeId: 'scope',
      clientId: 'client',
      resolveUrl: () => ({ url: 'ws://x' }),
      transportFactory: () => transport,
    });
    let observed = 0;
    target.subscribe(() => {
      throw new Error('listener');
    });
    target.subscribe(() => {
      observed += 1;
    });
    await turn();
    transport.triggerOpen();
    transport.disconnect();
    expect(observed).toBeGreaterThan(0);
    target.stop();
  });

  it('bounds unresolved credential work and starts no replacement until physical settlement', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let settleFirst!: (value: { url: string } | null) => void;
    let calls = 0;
    const unresolved = new Promise<{ url: string } | null>((resolve) => {
      settleFirst = resolve;
    });
    const target = createManagedAuthorityConnection({
      scopeId: 'scope',
      clientId: 'client',
      resolveUrl: () => {
        calls += 1;
        return calls === 1 ? unresolved : null;
      },
      transportFactory: () => new FakeTransport(),
    });
    await vi.runAllTicks();
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(target.getState().status).toBe('offline');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toBe(1);
    settleFirst(null);
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toBe(2);
    target.stop();
  });

  it('denies after four 4401 closes and maps another application close without retry', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const transports: FakeTransport[] = [];
    const target = createManagedAuthorityConnection({
      scopeId: 'scope',
      clientId: 'client',
      resolveUrl: () => ({ url: 'ws://x' }),
      transportFactory: () => {
        const value = new FakeTransport();
        transports.push(value);
        return value;
      },
    });
    await turn();
    for (const delay of [1_000, 2_000, 4_000]) {
      const active = transports[transports.length - 1];
      if (!active) throw new Error('fixture');
      active.disconnect(4401);
      await vi.advanceTimersByTimeAsync(delay);
    }
    const fourth = transports[transports.length - 1];
    if (!fourth) throw new Error('fixture');
    fourth.disconnect(4401);
    expect(target.getState().status).toBe('denied');
    const count = transports.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(transports).toHaveLength(count);
    target.stop();

    const deniedTransport = new FakeTransport();
    const denied = createManagedAuthorityConnection({
      scopeId: 'scope',
      clientId: 'client',
      resolveUrl: () => ({ url: 'ws://x' }),
      transportFactory: () => deniedTransport,
    });
    await turn();
    deniedTransport.disconnect(4403);
    expect(denied.getState().status).toBe('denied');
    expect(vi.getTimerCount()).toBe(0);
    denied.stop();
  });

  it('installs capability, generation, and a fresh checkpoint before any operation send', async () => {
    const transport = new FakeTransport();
    const target = createManagedAuthorityConnection({
      scopeId: 'scope',
      clientId: 'client',
      resolveUrl: () => ({ url: 'ws://x' }),
      transportFactory: () => transport,
    });
    await turn();
    expect(target.submit({ kind: 'remove', id: 'too-early' })).toEqual({
      status: 'refused',
      reason: 'not-ready',
    });
    await bootstrap(target, transport);
    const admitted = target.submit({ kind: 'remove', id: 'ready' });
    expect(admitted.status).toBe('admitted');
    expect(
      transport.sent.map(parseAuthorityClientFrame).filter((frame) => frame?.kind === 'propose'),
    ).toHaveLength(1);
    target.stop();
  });

  it('does not replay a retained pending operation during reconnect bootstrap', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const transports: FakeTransport[] = [];
    const target = createManagedAuthorityConnection({
      scopeId: 'scope',
      clientId: 'client',
      resolveUrl: () => ({ url: 'ws://x' }),
      transportFactory: () => {
        const value = new FakeTransport();
        transports.push(value);
        return value;
      },
    });
    await vi.runAllTicks();
    await turn();
    const first = transports[0];
    if (!first) throw new Error('fixture');
    await bootstrap(target, first);
    expect(target.submit({ kind: 'remove', id: 'pending' }).status).toBe('admitted');
    first.disconnect();
    await vi.advanceTimersByTimeAsync(1_000);
    const second = transports[1];
    if (!second) throw new Error('missing reconnect');
    second.triggerOpen();
    expect(
      second.sent.map(parseAuthorityClientFrame).filter((frame) => frame?.kind === 'propose'),
    ).toEqual([]);
    expect(target.getState().operations[0]?.status).toBe('uncertain');
    target.stop();
  });

  it('rejects authority state before capabilities without mutating a retained document', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const transports: FakeTransport[] = [];
    const target = createManagedAuthorityConnection({
      scopeId: 'scope',
      clientId: 'client',
      resolveUrl: () => ({ url: 'ws://x' }),
      transportFactory: () => {
        const value = new FakeTransport();
        transports.push(value);
        return value;
      },
    });
    await turn();
    const first = transports[0];
    if (!first) throw new Error('fixture');
    await bootstrap(target, first);
    const before = target.getState().document;
    first.disconnect();
    await vi.advanceTimersByTimeAsync(1_000);
    const second = transports[1];
    if (!second) throw new Error('fixture');
    second.triggerOpen();
    second.message(
      serializeAuthorityFrame({
        protocol: 'authority:1',
        kind: 'changes',
        cursor: { generation: 'g', streamId: 's', revision: 1 },
        mutations: [{ kind: 'remove', id: 'early' }],
      }),
    );
    await turn();
    expect(target.getState().document).toBe(before);
    expect(target.getState().document?.cursor.revision).toBe(0);
    target.stop();
  });

  it.each([
    serializeAuthorityFrame({
      protocol: 'authority:1',
      kind: 'receipt',
      receipt: { generation: 'g', clientOperationId: 'operation', receiptId: 'receipt' },
    }),
    serializeAuthorityFrame({
      protocol: 'authority:1',
      kind: 'rejected',
      generation: 'g',
      clientOperationId: 'operation',
      reason: 'invalid',
    }),
    serializeAuthorityFrame({
      protocol: 'authority:1',
      kind: 'resync-required',
      generation: 'g',
      reason: 'gap',
    }),
    serializeAuthorityFrame({
      protocol: 'authority:1',
      kind: 'checkpoint-begin',
      manifest: {
        requestId: 'request',
        checkpointId: 'checkpoint',
        cursor: { generation: 'g', streamId: 's', revision: 0 },
        encoding: 'base64',
        compression: 'none',
        byteLength: 1,
        chunkBytes: 524288,
        chunkCount: 1,
        sha256: '0'.repeat(64),
        extensions: [],
      },
    }),
    serializeAuthorityFrame({
      protocol: 'authority:1',
      kind: 'checkpoint-chunk',
      checkpointId: 'checkpoint',
      index: 0,
      data: 'eA==',
    }),
    serializeAuthorityFrame({
      protocol: 'authority:1',
      kind: 'checkpoint-end',
      checkpointId: 'checkpoint',
    }),
  ])(
    'rejects pre-negotiation authority frame %# without journal or document mutation',
    async (raw) => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const transports: FakeTransport[] = [];
      const target = createManagedAuthorityConnection({
        scopeId: 'scope',
        clientId: 'client',
        resolveUrl: () => ({ url: 'ws://x' }),
        transportFactory: () => {
          const value = new FakeTransport();
          transports.push(value);
          return value;
        },
      });
      await turn();
      const first = transports[0];
      if (!first) throw new Error('fixture');
      await bootstrap(target, first);
      const admitted = target.submit({ kind: 'remove', id: 'pending' });
      if (admitted.status !== 'admitted') throw new Error('fixture');
      first.disconnect();
      await vi.advanceTimersByTimeAsync(1_000);
      const second = transports[1];
      if (!second) throw new Error('fixture');
      second.triggerOpen();
      const beforeDocument = target.getState().document;
      const beforeOperation = target.getState().operations[0];
      second.message(raw);
      await turn();
      expect(target.getState().document).toBe(beforeDocument);
      expect(target.getState().operations[0]).toBe(beforeOperation);
      target.stop();
    },
  );

  it('queues changes in arrival order during delayed SHA while routing receipts independently', async () => {
    const transport = new FakeTransport();
    const target = createManagedAuthorityConnection({
      scopeId: 'scope',
      clientId: 'client',
      resolveUrl: () => ({ url: 'ws://x' }),
      transportFactory: () => transport,
    });
    await turn();
    await bootstrap(target, transport);
    const admitted = target.submit({ kind: 'remove', id: 'pending' });
    if (admitted.status !== 'admitted') throw new Error('fixture');

    transport.message(
      serializeAuthorityFrame({
        protocol: 'authority:1',
        kind: 'resync-required',
        generation: 'g',
        reason: 'gap',
      }),
    );
    await turn();
    const requests = transport.sent
      .map(parseAuthorityClientFrame)
      .filter((frame) => frame?.kind === 'checkpoint-request');
    const request = requests[requests.length - 1];
    if (request?.kind !== 'checkpoint-request') throw new Error('missing request');
    const prepared = await prepareAuthorityCheckpoint(
      {
        cursor: { generation: 'g', streamId: 's', revision: 0 },
        elements: [],
        layers: [],
        extensions: {},
      },
      { requestId: request.requestId, checkpointId: 'delayed', requiredExtensions: [] },
    );
    const frames = [...prepared.frames];
    const chunk = frames.find((frame) => frame.kind === 'checkpoint-chunk');
    if (chunk?.kind !== 'checkpoint-chunk') throw new Error('missing chunk');
    const bytes = Uint8Array.from(atob(chunk.data), (value) => value.charCodeAt(0));
    const realCrypto = globalThis.crypto;
    const hash = await realCrypto.subtle.digest('SHA-256', bytes);
    let resolveDigest!: (value: ArrayBuffer) => void;
    const digest = new Promise<ArrayBuffer>((resolve) => {
      resolveDigest = resolve;
    });
    vi.stubGlobal('crypto', { subtle: { digest: () => digest } });
    transport.message(serializeAuthorityFrame(frameAt(frames, 0)));
    await turn();
    transport.message(serializeAuthorityFrame(frameAt(frames, 1)));
    await turn();
    transport.message(serializeAuthorityFrame(frameAt(frames, 2)));
    transport.message(
      serializeAuthorityFrame({
        protocol: 'authority:1',
        kind: 'changes',
        cursor: { generation: 'g', streamId: 's', revision: 1 },
        mutations: [{ kind: 'remove', id: 'after-cut' }],
      }),
    );
    transport.message(
      serializeAuthorityFrame({
        protocol: 'authority:1',
        kind: 'receipt',
        receipt: {
          generation: 'g',
          clientOperationId: admitted.clientOperationId,
          receiptId: 'receipt',
        },
      }),
    );
    await turn();
    expect(target.getState().operations[0]?.status).toBe('accepted');
    expect(target.getState().document?.cursor.revision).toBe(0);
    resolveDigest(hash);
    vi.stubGlobal('crypto', realCrypto);
    await turn();
    await turn();
    expect(target.getState().status).toBe('live');
    expect(target.getState().document?.cursor.revision).toBe(1);
    target.stop();
  });

  it.each(['resolve', 'reject'] as const)(
    'retains the sole verifier through abandoned digest %s and never installs the stale cut',
    async (outcome) => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const transports: FakeTransport[] = [];
      const target = createManagedAuthorityConnection({
        scopeId: 'scope',
        clientId: 'client',
        resolveUrl: () => ({ url: 'ws://x' }),
        transportFactory: () => {
          const value = new FakeTransport();
          transports.push(value);
          return value;
        },
      });
      await turn();
      const first = transports[0];
      if (!first) throw new Error('fixture');
      await bootstrap(target, first);
      first.message(
        serializeAuthorityFrame({
          protocol: 'authority:1',
          kind: 'resync-required',
          generation: 'g',
          reason: 'gap',
        }),
      );
      await turn();
      const requests = first.sent
        .map(parseAuthorityClientFrame)
        .filter((frame) => frame?.kind === 'checkpoint-request');
      const request = requests[requests.length - 1];
      if (request?.kind !== 'checkpoint-request') throw new Error('fixture');
      const prepared = await prepareAuthorityCheckpoint(
        {
          cursor: { generation: 'g', streamId: 's', revision: 7 },
          elements: [],
          layers: [],
          extensions: {},
        },
        { requestId: request.requestId, checkpointId: 'abandoned', requiredExtensions: [] },
      );
      const frames = [...prepared.frames];
      const chunk = frames.find((frame) => frame.kind === 'checkpoint-chunk');
      if (chunk?.kind !== 'checkpoint-chunk') throw new Error('fixture');
      const realCrypto = globalThis.crypto;
      const bytes = Uint8Array.from(atob(chunk.data), (value) => value.charCodeAt(0));
      const hash = await realCrypto.subtle.digest('SHA-256', bytes);
      let resolveDigest!: (value: ArrayBuffer) => void;
      let rejectDigest!: (reason: unknown) => void;
      const digest = new Promise<ArrayBuffer>((resolve, reject) => {
        resolveDigest = resolve;
        rejectDigest = reject;
      });
      vi.stubGlobal('crypto', { subtle: { digest: () => digest } });
      for (const frame of frames) {
        first.message(serializeAuthorityFrame(frame));
        await turn();
      }
      first.disconnect();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(transports).toHaveLength(1);
      if (outcome === 'resolve') resolveDigest(hash);
      else rejectDigest(new Error('late digest'));
      vi.stubGlobal('crypto', realCrypto);
      await vi.runAllTicks();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(transports).toHaveLength(2);
      expect(target.getState().document?.cursor.revision).toBe(0);
      target.stop();
    },
  );

  it('counts the in-flight checkpoint end at the exact 64-frame inbox boundary', async () => {
    const transport = new FakeTransport();
    const target = createManagedAuthorityConnection({
      scopeId: 'scope',
      clientId: 'client',
      resolveUrl: () => ({ url: 'ws://x' }),
      transportFactory: () => transport,
    });
    await turn();
    await bootstrap(target, transport);
    transport.message(
      serializeAuthorityFrame({
        protocol: 'authority:1',
        kind: 'resync-required',
        generation: 'g',
        reason: 'gap',
      }),
    );
    await turn();
    const requests = transport.sent
      .map(parseAuthorityClientFrame)
      .filter((frame) => frame?.kind === 'checkpoint-request');
    const request = requests[requests.length - 1];
    if (request?.kind !== 'checkpoint-request') throw new Error('fixture');
    const prepared = await prepareAuthorityCheckpoint(
      {
        cursor: { generation: 'g', streamId: 's', revision: 0 },
        elements: [],
        layers: [],
        extensions: {},
      },
      { requestId: request.requestId, checkpointId: 'inbox', requiredExtensions: [] },
    );
    const frames = [...prepared.frames];
    let resolveDigest!: (value: ArrayBuffer) => void;
    const digest = new Promise<ArrayBuffer>((resolve) => {
      resolveDigest = resolve;
    });
    const realCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', { ...realCrypto, subtle: { digest: () => digest } });
    transport.message(serializeAuthorityFrame(frameAt(frames, 0)));
    await turn();
    transport.message(serializeAuthorityFrame(frameAt(frames, 1)));
    await turn();
    transport.message(serializeAuthorityFrame(frameAt(frames, 2)));
    await turn();
    const queued = serializeAuthorityFrame({
      protocol: 'authority:1',
      kind: 'changes',
      cursor: { generation: 'g', streamId: 's', revision: 1 },
      mutations: [{ kind: 'remove', id: 'queued' }],
    });
    for (let index = 0; index < 63; index += 1) transport.message(queued);
    expect(target.getState().status).toBe('recovering');
    transport.message(queued);
    expect(target.getState().status).toBe('offline');
    resolveDigest(new ArrayBuffer(32));
    vi.stubGlobal('crypto', realCrypto);
    await turn();
    target.stop();
  });

  it('accepts exactly 4 MiB of queued raw UTF-8 including in-flight and rejects one byte over', async () => {
    const transport = new FakeTransport();
    const target = createManagedAuthorityConnection({
      scopeId: 'scope',
      clientId: 'client',
      resolveUrl: () => ({ url: 'ws://x' }),
      transportFactory: () => transport,
    });
    await turn();
    await bootstrap(target, transport);
    transport.message(
      serializeAuthorityFrame({
        protocol: 'authority:1',
        kind: 'resync-required',
        generation: 'g',
        reason: 'gap',
      }),
    );
    await turn();
    const request = transport.sent
      .map(parseAuthorityClientFrame)
      .filter((frame) => frame?.kind === 'checkpoint-request')
      .at(-1);
    if (request?.kind !== 'checkpoint-request') throw new Error('fixture');
    const prepared = await prepareAuthorityCheckpoint(
      {
        cursor: { generation: 'g', streamId: 's', revision: 0 },
        elements: [],
        layers: [],
        extensions: {},
      },
      { requestId: request.requestId, checkpointId: 'bytes', requiredExtensions: [] },
    );
    const frames = [...prepared.frames];
    const endWire = serializeAuthorityFrame(frameAt(frames, 2));
    let resolveDigest!: (value: ArrayBuffer) => void;
    const digest = new Promise<ArrayBuffer>((resolve) => {
      resolveDigest = resolve;
    });
    const realCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', { ...realCrypto, subtle: { digest: () => digest } });
    transport.message(serializeAuthorityFrame(frameAt(frames, 0)));
    await turn();
    transport.message(serializeAuthorityFrame(frameAt(frames, 1)));
    await turn();
    transport.message(endWire);
    await turn();
    const encoder = new TextEncoder();
    const changeAtBytes = (targetBytes: number): string => {
      const base = serializeAuthorityFrame({
        protocol: 'authority:1',
        kind: 'changes',
        cursor: { generation: 'g', streamId: 's', revision: 1 },
        mutations: [{ kind: 'extension', extensionKind: 'queued', payload: '' }],
      });
      return serializeAuthorityFrame({
        protocol: 'authority:1',
        kind: 'changes',
        cursor: { generation: 'g', streamId: 's', revision: 1 },
        mutations: [
          {
            kind: 'extension',
            extensionKind: 'queued',
            payload: 'x'.repeat(targetBytes - encoder.encode(base).length),
          },
        ],
      });
    };
    const endBytes = encoder.encode(endWire).length;
    for (let index = 0; index < 3; index += 1)
      transport.message(changeAtBytes(MAX_AUTHORITY_FRAME_BYTES));
    transport.message(changeAtBytes(4 * 1024 * 1024 - endBytes - 3 * MAX_AUTHORITY_FRAME_BYTES));
    expect(target.getState().status).toBe('recovering');
    transport.message(
      serializeAuthorityFrame({
        protocol: 'authority:1',
        kind: 'changes',
        cursor: { generation: 'g', streamId: 's', revision: 1 },
        mutations: [{ kind: 'remove', id: 'overflow' }],
      }),
    );
    expect(target.getState().status).toBe('offline');
    resolveDigest(new ArrayBuffer(32));
    vi.stubGlobal('crypto', realCrypto);
    await turn();
    target.stop();
  });

  it('coalesces an explicit checkpoint transaction and lets server recovery bypass its rate gate', async () => {
    const transport = new FakeTransport();
    const target = createManagedAuthorityConnection({
      scopeId: 'scope',
      clientId: 'client',
      resolveUrl: () => ({ url: 'ws://x' }),
      transportFactory: () => transport,
    });
    await turn();
    await bootstrap(target, transport);
    const first = target.requestCheckpoint();
    const second = target.requestCheckpoint();
    await turn();
    expect(
      transport.sent
        .map(parseAuthorityClientFrame)
        .filter((frame) => frame?.kind === 'checkpoint-request'),
    ).toHaveLength(1);

    transport.message(
      serializeAuthorityFrame({
        protocol: 'authority:1',
        kind: 'resync-required',
        generation: 'g',
        reason: 'gap',
      }),
    );
    await turn();
    const requests = transport.sent
      .map(parseAuthorityClientFrame)
      .filter((frame) => frame?.kind === 'checkpoint-request');
    const request = requests[requests.length - 1];
    expect(requests).toHaveLength(2);
    if (request?.kind !== 'checkpoint-request') throw new Error('fixture');
    const prepared = await prepareAuthorityCheckpoint(
      {
        cursor: { generation: 'g', streamId: 's', revision: 0 },
        elements: [],
        layers: [],
        extensions: {},
      },
      { requestId: request.requestId, checkpointId: 'explicit', requiredExtensions: [] },
    );
    for (const frame of prepared.frames) {
      transport.message(serializeAuthorityFrame(frame));
      await turn();
    }
    await expect(first).resolves.toMatchObject({ status: 'complete' });
    await expect(second).resolves.toMatchObject({ status: 'complete' });
    target.stop();
  });

  it('refuses a later explicit checkpoint caller after the request wire was sent', async () => {
    const transport = new FakeTransport();
    const target = createManagedAuthorityConnection({
      scopeId: 'scope',
      clientId: 'client',
      resolveUrl: () => ({ url: 'ws://x' }),
      transportFactory: () => transport,
    });
    await turn();
    await bootstrap(target, transport);
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 10_001);
    const first = target.requestCheckpoint();
    expect(
      transport.sent
        .map(parseAuthorityClientFrame)
        .filter((frame) => frame?.kind === 'checkpoint-request'),
    ).toHaveLength(2);
    await expect(target.requestCheckpoint()).resolves.toEqual({
      status: 'failed',
      reason: 'capacity',
    });
    target.stop();
    await expect(first).resolves.toEqual({ status: 'failed', reason: 'stopped' });
  });

  it('coalesces only matching unsent callers and cleans independent cancellation ownership', async () => {
    const transport = new FakeTransport();
    const target = createManagedAuthorityConnection({
      scopeId: 'scope',
      clientId: 'client',
      resolveUrl: () => ({ url: 'ws://x' }),
      transportFactory: () => transport,
    });
    await turn();
    await bootstrap(target, transport);
    const firstBarrier = target.captureBarrier();
    const secondBarrier = target.captureBarrier();
    if (firstBarrier === null || secondBarrier === null) throw new Error('fixture');
    const firstController = new AbortController();
    const first = target.requestCheckpoint({
      barrier: firstBarrier,
      signal: firstController.signal,
    });
    await turn();
    await expect(target.requestCheckpoint({ barrier: secondBarrier })).resolves.toEqual({
      status: 'failed',
      reason: 'capacity',
    });
    const secondController = new AbortController();
    const matching = target.requestCheckpoint({
      barrier: firstBarrier,
      signal: secondController.signal,
    });
    firstController.abort();
    await expect(first).resolves.toEqual({ status: 'failed', reason: 'aborted' });
    let matchingSettled = false;
    void matching.then(() => {
      matchingSettled = true;
    });
    await turn();
    expect(matchingSettled).toBe(false);
    secondController.abort();
    await expect(matching).resolves.toEqual({ status: 'failed', reason: 'aborted' });
    await turn();
    const replacement = target.requestCheckpoint();
    await turn();
    target.stop();
    await expect(replacement).resolves.toEqual({ status: 'failed', reason: 'stopped' });
  });

  it.each(['sync-abort-store', 'sync-abort-store-throw'] as const)(
    'physically detaches after hostile %s registration completes',
    async (mode) => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const transport = new FakeTransport();
      const target = createManagedAuthorityConnection({
        scopeId: 'scope',
        clientId: 'client',
        resolveUrl: () => ({ url: 'ws://x' }),
        transportFactory: () => transport,
      });
      await turn();
      await bootstrap(target, transport);
      for (let index = 0; index < 40; index += 1) {
        const signal = new HostileAbortSignal(mode);
        await expect(
          target.requestCheckpoint({ signal: signal.asAbortSignal(), timeoutMs: 1_000 }),
        ).resolves.toEqual({ status: 'failed', reason: 'aborted' });
        expect(signal.listeners.size).toBe(0);
      }
      expect(vi.getTimerCount()).toBe(0);
      target.stop();
    },
  );

  it.each([
    { mode: 'registration-throw' as const, expected: 'invalid' as const },
    { mode: 'remove-throw' as const, expected: 'aborted' as const },
  ])('cleans repeated hostile $mode checkpoint signals', async ({ mode, expected }) => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const transport = new FakeTransport();
    const target = createManagedAuthorityConnection({
      scopeId: 'scope',
      clientId: 'client',
      resolveUrl: () => ({ url: 'ws://x' }),
      transportFactory: () => transport,
    });
    await turn();
    await bootstrap(target, transport);
    for (let index = 0; index < 40; index += 1) {
      const signal = new HostileAbortSignal(mode);
      const pending = target.requestCheckpoint({
        signal: signal.asAbortSignal(),
        timeoutMs: 1_000,
      });
      if (mode === 'remove-throw') signal.abort();
      await expect(pending).resolves.toEqual({ status: 'failed', reason: expected });
      expect(signal.listeners.size).toBe(0);
    }
    expect(vi.getTimerCount()).toBe(0);
    target.stop();
  });

  it('detaches checkpoint signals on stop and timeout without resource drift', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    for (let index = 0; index < 4; index += 1) {
      const transport = new FakeTransport();
      const target = createManagedAuthorityConnection({
        scopeId: 'scope',
        clientId: 'client',
        resolveUrl: () => ({ url: 'ws://x' }),
        transportFactory: () => transport,
      });
      await turn();
      await bootstrap(target, transport);
      const signal = new HostileAbortSignal('ordinary');
      const pending = target.requestCheckpoint({
        signal: signal.asAbortSignal(),
        timeoutMs: 1_000,
      });
      target.stop();
      await expect(pending).resolves.toEqual({ status: 'failed', reason: 'stopped' });
      expect(signal.listeners.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    }

    const transport = new FakeTransport();
    const target = createManagedAuthorityConnection({
      scopeId: 'scope',
      clientId: 'client',
      resolveUrl: () => ({ url: 'ws://x' }),
      transportFactory: () => transport,
    });
    await turn();
    await bootstrap(target, transport);
    for (let index = 0; index < 40; index += 1) {
      const signal = new HostileAbortSignal('ordinary');
      const pending = target.requestCheckpoint({
        signal: signal.asAbortSignal(),
        timeoutMs: 1,
      });
      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toEqual({ status: 'failed', reason: 'timeout' });
      expect(signal.listeners.size).toBe(0);
    }
    expect(vi.getTimerCount()).toBe(0);
    target.stop();
  });

  it('keeps a sent checkpoint for canonical recovery after its only caller aborts', async () => {
    const transport = new FakeTransport();
    const target = createManagedAuthorityConnection({
      scopeId: 'scope',
      clientId: 'client',
      resolveUrl: () => ({ url: 'ws://x' }),
      transportFactory: () => transport,
    });
    await turn();
    await bootstrap(target, transport);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10_001);
    const controller = new AbortController();
    const requested = target.requestCheckpoint({ signal: controller.signal });
    const requests = transport.sent
      .map(parseAuthorityClientFrame)
      .filter((frame) => frame?.kind === 'checkpoint-request');
    const request = requests[requests.length - 1];
    if (request?.kind !== 'checkpoint-request') throw new Error('fixture');
    controller.abort();
    await expect(requested).resolves.toEqual({ status: 'failed', reason: 'aborted' });
    const prepared = await prepareAuthorityCheckpoint(
      {
        cursor: { generation: 'g', streamId: 's', revision: 2 },
        elements: [],
        layers: [],
        extensions: {},
      },
      { requestId: request.requestId, checkpointId: 'after-abort', requiredExtensions: [] },
    );
    for (const frame of prepared.frames) {
      transport.message(serializeAuthorityFrame(frame));
      await turn();
    }
    expect(target.getState().document?.cursor.revision).toBe(2);
    target.stop();
  });

  it('does not retain a checkpoint deadline after synchronous close during send', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const transport = new FakeTransport();
    const target = createManagedAuthorityConnection({
      scopeId: 'scope',
      clientId: 'client',
      resolveUrl: () => ({ url: 'ws://x' }),
      transportFactory: () => transport,
    });
    await turn();
    await bootstrap(target, transport);
    vi.setSystemTime(Date.now() + 10_001);
    transport.closeOnCheckpointSend = true;
    const pending = target.requestCheckpoint();
    await turn();
    expect(vi.getTimerCount()).toBe(1);
    target.stop();
    await expect(pending).resolves.toEqual({ status: 'failed', reason: 'recovery' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears a rate gate and caller deadline when stopped before send', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const transport = new FakeTransport();
    const target = createManagedAuthorityConnection({
      scopeId: 'scope',
      clientId: 'client',
      resolveUrl: () => ({ url: 'ws://x' }),
      transportFactory: () => transport,
    });
    await turn();
    await bootstrap(target, transport);
    const pending = target.requestCheckpoint();
    await turn();
    expect(vi.getTimerCount()).toBe(2);
    target.stop();
    await expect(pending).resolves.toEqual({ status: 'failed', reason: 'stopped' });
    await vi.runAllTicks();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the exact gate across repeated closes and resets backoff only after live checkpoint', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const transports: FakeTransport[] = [];
    const target = createManagedAuthorityConnection({
      scopeId: 'scope',
      clientId: 'client',
      resolveUrl: () => ({ url: 'ws://x' }),
      transportFactory: () => {
        const value = new FakeTransport();
        transports.push(value);
        return value;
      },
    });
    await turn();
    const first = transports[0];
    if (!first) throw new Error('fixture');
    await bootstrap(target, first);
    const firstRequest = target.requestCheckpoint();
    await turn();
    first.disconnect();
    await expect(firstRequest).resolves.toEqual({ status: 'failed', reason: 'recovery' });
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    const second = transports[1];
    if (!second) throw new Error('fixture');
    await bootstrap(target, second);
    const secondRequest = target.requestCheckpoint();
    await turn();
    second.disconnect();
    await expect(secondRequest).resolves.toEqual({ status: 'failed', reason: 'recovery' });
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(transports).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(transports).toHaveLength(3);
    target.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
