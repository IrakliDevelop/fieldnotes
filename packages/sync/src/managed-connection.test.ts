import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ElementStore,
  FogManager,
  createNote,
  fogEncodeBase64,
  type Layer,
} from '@fieldnotes/core';
import { createManagedSyncConnection } from './managed-connection';
import type {
  ManagedSyncConnection,
  ManagedSyncConnectionOptions,
  ManagedSyncStatus,
  ManagedSyncTransport,
} from './managed-connection';
import type { RemoteLayerUpdate } from './sync-client';
import type { SyncOp } from './protocol';

class FakeTransport implements ManagedSyncTransport {
  readonly sent: string[] = [];
  closed = false;
  private readonly messageHandlers = new Set<(message: string) => void>();
  private readonly reconnectHandlers = new Set<() => void>();
  private readonly closeHandlers = new Set<(code: number, reason: string) => void>();

  constructor(readonly url: string) {}

  send(message: string): void {
    this.sent.push(message);
  }

  onMessage(handler: (message: string) => void): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onReconnect(handler: () => void): () => void {
    this.reconnectHandlers.add(handler);
    return () => this.reconnectHandlers.delete(handler);
  }

  onClose(handler: (code: number, reason: string) => void): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  close(): void {
    this.closed = true;
    this.messageHandlers.clear();
    this.reconnectHandlers.clear();
    this.closeHandlers.clear();
  }

  emitMessage(raw: string): void {
    for (const handler of [...this.messageHandlers]) handler(raw);
  }

  emitReconnect(): void {
    for (const handler of [...this.reconnectHandlers]) handler();
  }

  emitClose(code: number, reason = ''): void {
    for (const handler of [...this.closeHandlers]) handler(code, reason);
  }

  /** Snapshot of currently registered close handlers, for stale-event tests. */
  captureCloseHandlers(): ((code: number, reason: string) => void)[] {
    return [...this.closeHandlers];
  }
}

function envelope(from: string, op: SyncOp): string {
  return JSON.stringify({ from, op });
}

function snapshotFor(clientId: string, elements: unknown[] = []): string {
  return envelope('hub', { kind: 'snapshot', to: clientId, elements } as SyncOp);
}

const CLIENT_ID = 'user-1';

describe('createManagedSyncConnection', () => {
  let store: ElementStore;
  let statuses: ManagedSyncStatus[];
  let transports: FakeTransport[];
  let resolveUrl: ReturnType<typeof vi.fn<() => Promise<string | null>>>;
  let connection: ManagedSyncConnection | null;

  beforeEach(() => {
    vi.useFakeTimers();
    store = new ElementStore();
    statuses = [];
    transports = [];
    resolveUrl = vi.fn<() => Promise<string | null>>(() => Promise.resolve('ws://relay/a'));
    connection = null;
  });

  afterEach(() => {
    connection?.stop();
    connection = null;
    vi.useRealTimers();
  });

  function start(overrides: Partial<ManagedSyncConnectionOptions> = {}): ManagedSyncConnection {
    connection = createManagedSyncConnection({
      store,
      clientId: CLIENT_ID,
      resolveUrl,
      onStatus: (s) => statuses.push(s),
      transportFactory: (url) => {
        const t = new FakeTransport(url);
        transports.push(t);
        return t;
      },
      retryInitialDelayMs: 100,
      retryMaxDelayMs: 400,
      ...overrides,
    });
    return connection;
  }

  async function flushAsync(): Promise<void> {
    await vi.advanceTimersByTimeAsync(0);
  }

  function currentTransport(): FakeTransport {
    const t = transports[transports.length - 1];
    if (!t) throw new Error('no transport created');
    return t;
  }

  it('emits connecting, then live on the first authoritative snapshot', async () => {
    start();
    expect(statuses).toEqual(['connecting']);

    await flushAsync();
    expect(transports).toHaveLength(1);
    expect(currentTransport().url).toBe('ws://relay/a');

    currentTransport().emitMessage(snapshotFor(CLIENT_ID));
    expect(statuses).toEqual(['connecting', 'live']);
    expect(connection?.getStatus()).toBe('live');
  });

  it('starts a SyncClient that requests a snapshot with the stable clientId', async () => {
    start();
    await flushAsync();

    const first = JSON.parse(currentTransport().sent[0] ?? '') as {
      from: string;
      op: { kind: string };
    };
    expect(first.from).toBe(CLIENT_ID);
    expect(first.op.kind).toBe('request-snapshot');
  });

  it('ignores snapshots addressed to other clients', async () => {
    start();
    await flushAsync();

    currentTransport().emitMessage(snapshotFor('someone-else'));
    expect(statuses).toEqual(['connecting']);

    currentTransport().emitMessage(snapshotFor(CLIENT_ID));
    expect(statuses).toEqual(['connecting', 'live']);
  });

  it('reports offline on a transient close and recovers via transport reconnect', async () => {
    start();
    await flushAsync();
    currentTransport().emitMessage(snapshotFor(CLIENT_ID));

    currentTransport().emitClose(1006);
    expect(statuses).toEqual(['connecting', 'live', 'offline']);
    // Transient closes belong to the transport: no rebuild, no re-mint.
    expect(transports).toHaveLength(1);
    expect(resolveUrl).toHaveBeenCalledTimes(1);
    expect(currentTransport().closed).toBe(false);

    currentTransport().emitReconnect();
    expect(statuses).toEqual(['connecting', 'live', 'offline', 'connecting']);

    currentTransport().emitMessage(snapshotFor(CLIENT_ID));
    expect(connection?.getStatus()).toBe('live');
  });

  it('keeps the SyncClient wired across a transient close', async () => {
    start();
    await flushAsync();
    const transport = currentTransport();
    transport.emitMessage(snapshotFor(CLIENT_ID));

    transport.emitClose(1006);
    transport.emitReconnect();
    transport.emitMessage(snapshotFor(CLIENT_ID));

    const before = transport.sent.length;
    store.add(createNote({ position: { x: 1, y: 2 } }));
    expect(transport.sent.length).toBe(before + 1);
    const upsert = JSON.parse(transport.sent[before] ?? '') as { op: { kind: string } };
    expect(upsert.op.kind).toBe('upsert');
  });

  it('rebuilds transport and client with fresh credentials after a terminal auth close', async () => {
    resolveUrl
      .mockResolvedValueOnce('ws://relay/token-1')
      .mockResolvedValueOnce('ws://relay/token-2');
    start();
    await flushAsync();
    const first = currentTransport();
    first.emitMessage(snapshotFor(CLIENT_ID));

    first.emitClose(4401);
    expect(statuses).toEqual(['connecting', 'live', 'offline']);
    expect(first.closed).toBe(true);

    await vi.advanceTimersByTimeAsync(100);
    expect(resolveUrl).toHaveBeenCalledTimes(2);
    expect(transports).toHaveLength(2);
    expect(currentTransport().url).toBe('ws://relay/token-2');

    // The stopped client must not push local ops through the dead transport.
    const deadSends = first.sent.length;
    store.add(createNote({ position: { x: 0, y: 0 } }));
    expect(first.sent.length).toBe(deadSends);

    currentTransport().emitMessage(snapshotFor(CLIENT_ID));
    expect(connection?.getStatus()).toBe('live');
  });

  it('settles on denied after bounded consecutive auth failures and stops retrying', async () => {
    start({ maxAuthFailures: 2 });
    await flushAsync();

    currentTransport().emitClose(4401);
    await vi.advanceTimersByTimeAsync(100);
    expect(transports).toHaveLength(2);

    currentTransport().emitClose(4401);
    expect(connection?.getStatus()).toBe('denied');
    expect(statuses[statuses.length - 1]).toBe('denied');

    await vi.advanceTimersByTimeAsync(60_000);
    expect(resolveUrl).toHaveBeenCalledTimes(2);
    expect(transports).toHaveLength(2);
  });

  it('resets the auth-failure budget after a successful authoritative snapshot', async () => {
    start({ maxAuthFailures: 2 });
    await flushAsync();

    currentTransport().emitClose(4401); // failure 1 of 2
    await vi.advanceTimersByTimeAsync(100);
    currentTransport().emitMessage(snapshotFor(CLIENT_ID)); // resets the budget

    currentTransport().emitClose(4401); // failure 1 of 2 again — not denied
    expect(connection?.getStatus()).toBe('offline');
    await vi.advanceTimersByTimeAsync(100);
    expect(transports).toHaveLength(3);

    currentTransport().emitClose(4401); // failure 2 of 2
    expect(connection?.getStatus()).toBe('denied');
  });

  it('backs off exponentially on mint failure and caps the delay', async () => {
    resolveUrl.mockResolvedValue(null);
    start(); // retryInitialDelayMs 100, retryMaxDelayMs 400
    await flushAsync();
    expect(resolveUrl).toHaveBeenCalledTimes(1);
    expect(connection?.getStatus()).toBe('offline');

    await vi.advanceTimersByTimeAsync(99);
    expect(resolveUrl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); // 100ms
    expect(resolveUrl).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(200); // 200ms
    expect(resolveUrl).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(400); // 400ms
    expect(resolveUrl).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(400); // capped at 400ms
    expect(resolveUrl).toHaveBeenCalledTimes(5);

    expect(transports).toHaveLength(0);
  });

  it('treats a rejected resolveUrl as a mint failure', async () => {
    resolveUrl.mockRejectedValueOnce(new Error('mint down')).mockResolvedValueOnce('ws://relay/b');
    start();
    await flushAsync();
    expect(connection?.getStatus()).toBe('offline');
    expect(transports).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(100);
    expect(transports).toHaveLength(1);
    currentTransport().emitMessage(snapshotFor(CLIENT_ID));
    expect(connection?.getStatus()).toBe('live');
  });

  it('resets the retry backoff after a successful authoritative snapshot', async () => {
    resolveUrl
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue('ws://relay/c');
    start();
    await flushAsync();
    await vi.advanceTimersByTimeAsync(100); // attempt 1 retry
    await vi.advanceTimersByTimeAsync(200); // attempt 2 retry → connects
    expect(transports).toHaveLength(1);
    currentTransport().emitMessage(snapshotFor(CLIENT_ID)); // resets attempt

    currentTransport().emitClose(4402); // terminal, non-auth
    await vi.advanceTimersByTimeAsync(99);
    expect(transports).toHaveLength(1); // still waiting: delay is back to 100ms…
    await vi.advanceTimersByTimeAsync(1);
    expect(transports).toHaveLength(2); // …not 400ms
  });

  it('stop during async URL resolution invalidates the in-flight result', async () => {
    let resolvePending: ((url: string) => void) | null = null;
    resolveUrl.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolvePending = resolve;
        }),
    );
    const managed = start();
    managed.stop();

    resolvePending?.('ws://relay/late');
    await flushAsync();
    expect(transports).toHaveLength(0);
    expect(statuses).toEqual(['connecting']);
  });

  it('stop cancels a scheduled retry', async () => {
    resolveUrl.mockResolvedValue(null);
    const managed = start();
    await flushAsync();
    expect(connection?.getStatus()).toBe('offline');

    managed.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(resolveUrl).toHaveBeenCalledTimes(1);
    expect(transports).toHaveLength(0);
  });

  it('stop tears down the client, transport, and store subscriptions', async () => {
    const managed = start();
    await flushAsync();
    const transport = currentTransport();
    transport.emitMessage(snapshotFor(CLIENT_ID));

    managed.stop();
    expect(transport.closed).toBe(true);

    const sends = transport.sent.length;
    store.add(createNote({ position: { x: 3, y: 4 } }));
    expect(transport.sent.length).toBe(sends);
  });

  it('ignores close events from a stale transport generation', async () => {
    start();
    await flushAsync();
    const first = currentTransport();
    // Capture the manager's close handler before teardown unsubscribes it.
    const staleHandlers = first.captureCloseHandlers();

    first.emitClose(4401);
    await vi.advanceTimersByTimeAsync(100);
    expect(transports).toHaveLength(2);
    const callsAfterRebuild = resolveUrl.mock.calls.length;

    // A late event replayed into the old generation's handler must not
    // schedule anything or count as another auth failure.
    for (const handler of staleHandlers) handler(4401, '');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(resolveUrl.mock.calls.length).toBe(callsAfterRebuild);
    expect(transports).toHaveLength(2);
    expect(connection?.getStatus()).not.toBe('denied');
  });

  it('delivers raw frames to onTransportMessage before the SyncClient applies them', async () => {
    const note = createNote({ position: { x: 9, y: 9 } });
    let sizeWhenObserved = -1;
    start({
      onTransportMessage: () => {
        sizeWhenObserved = store.snapshot().length;
      },
    });
    await flushAsync();

    currentTransport().emitMessage(snapshotFor(CLIENT_ID, [note]));
    expect(store.getById(note.id)).toBeDefined(); // client applied it…
    expect(sizeWhenObserved).toBe(0); // …after the host observer ran
    expect(connection?.getStatus()).toBe('live');
  });

  it('re-subscribes onTransportMessage on every rebuilt transport', async () => {
    const seen: string[] = [];
    start({ onTransportMessage: (raw) => seen.push(raw) });
    await flushAsync();

    currentTransport().emitClose(4401);
    await vi.advanceTimersByTimeAsync(100);
    expect(transports).toHaveLength(2);

    currentTransport().emitMessage(envelope('hub', { kind: 'presence', data: { kind: 'poke' } }));
    expect(seen).toHaveLength(1);
  });

  it('does not re-emit duplicate consecutive statuses', async () => {
    start();
    await flushAsync();
    currentTransport().emitMessage(snapshotFor(CLIENT_ID));
    currentTransport().emitMessage(snapshotFor(CLIENT_ID));
    expect(statuses).toEqual(['connecting', 'live']);
  });

  it('passes resolveLocalOnly through to the SyncClient (bootstrap preserve re-pushes)', async () => {
    const seed = createNote({ position: { x: 1, y: 1 } });
    store.add(seed);
    const phases: string[] = [];
    start({
      resolveLocalOnly: (context) => {
        phases.push(context.phase);
        return { preserve: context.localOnly.map((entry) => entry.element.id) };
      },
    });
    await flushAsync();

    currentTransport().emitMessage(snapshotFor(CLIENT_ID));

    expect(phases).toEqual(['bootstrap']);
    expect(store.getById(seed.id)).toBeDefined();
    const upserts = currentTransport()
      .sent.map((m) => JSON.parse(m) as { op: { kind: string; element?: { id: string } } })
      .filter((e) => e.op.kind === 'upsert');
    expect(upserts.map((e) => e.op.element?.id)).toEqual([seed.id]);
  });

  it('rebuilt clients reconcile their first snapshot with hub knowledge persisted across cycles', async () => {
    const known = createNote({ position: { x: 0, y: 0 } });
    const contexts: { phase: string; localOnly: { id: string; hubKnown: boolean }[] }[] = [];
    start({
      resolveLocalOnly: (context) => {
        contexts.push({
          phase: context.phase,
          localOnly: context.localOnly.map((entry) => ({
            id: entry.element.id,
            hubKnown: entry.hubKnown,
          })),
        });
        return {
          preserve: context.localOnly
            .filter((entry) => !entry.hubKnown)
            .map((entry) => entry.element.id),
        };
      },
    });
    await flushAsync();
    // Cycle 1: the hub knows `known`.
    currentTransport().emitMessage(snapshotFor(CLIENT_ID, [known]));
    expect(store.getById(known.id)).toBeDefined();

    // Terminal close; while the manager is down, the host adds a local element
    // no client is attached to (never sent).
    currentTransport().emitClose(4401);
    const offline = createNote({ position: { x: 5, y: 5 } });
    store.add(offline);

    await vi.advanceTimersByTimeAsync(100);
    expect(transports).toHaveLength(2);
    // The hub deleted `known` while we were away.
    currentTransport().emitMessage(snapshotFor(CLIENT_ID));

    expect(contexts[1]?.phase).toBe('reconcile');
    expect(contexts[1]?.localOnly).toEqual(
      expect.arrayContaining([
        { id: known.id, hubKnown: true },
        { id: offline.id, hubKnown: false },
      ]),
    );
    expect(store.getById(known.id)).toBeUndefined(); // deleted-while-away, even across a rebuild
    expect(store.getById(offline.id)).toBeDefined(); // preserved and re-pushed
    const upserts = currentTransport()
      .sent.map((m) => JSON.parse(m) as { op: { kind: string; element?: { id: string } } })
      .filter((e) => e.op.kind === 'upsert');
    expect(upserts.map((e) => e.op.element?.id)).toEqual([offline.id]);
  });

  it('without a hook, a rebuilt client still removes hub-deleted elements on its first snapshot', async () => {
    const stale = createNote({ position: { x: 2, y: 2 } });
    start();
    await flushAsync();
    currentTransport().emitMessage(snapshotFor(CLIENT_ID, [stale]));
    expect(store.getById(stale.id)).toBeDefined();

    currentTransport().emitClose(4401);
    await vi.advanceTimersByTimeAsync(100);
    expect(transports).toHaveLength(2);

    currentTransport().emitMessage(snapshotFor(CLIENT_ID));
    expect(store.getById(stale.id)).toBeUndefined();
  });

  it('ignores a snapshot echoed back with our own clientId as sender', async () => {
    start();
    await flushAsync();
    currentTransport().emitMessage(
      envelope(CLIENT_ID, { kind: 'snapshot', to: CLIENT_ID, elements: [] }),
    );
    expect(connection?.getStatus()).toBe('connecting');
  });
});

describe('createManagedSyncConnection presence passthrough', () => {
  let store: ElementStore;
  let transports: FakeTransport[];
  let connection: ManagedSyncConnection | null;

  beforeEach(() => {
    vi.useFakeTimers();
    store = new ElementStore();
    transports = [];
    connection = null;
  });

  afterEach(() => {
    connection?.stop();
    connection = null;
    vi.useRealTimers();
  });

  function start(overrides: Partial<ManagedSyncConnectionOptions> = {}): ManagedSyncConnection {
    connection = createManagedSyncConnection({
      store,
      clientId: CLIENT_ID,
      resolveUrl: () => Promise.resolve('ws://relay/a'),
      transportFactory: (url) => {
        const t = new FakeTransport(url);
        transports.push(t);
        return t;
      },
      retryInitialDelayMs: 100,
      retryMaxDelayMs: 400,
      ...overrides,
    });
    return connection;
  }

  async function flushAsync(): Promise<void> {
    await vi.advanceTimersByTimeAsync(0);
  }

  function currentTransport(): FakeTransport {
    const t = transports[transports.length - 1];
    if (!t) throw new Error('no transport created');
    return t;
  }

  function sentPresence(t: FakeTransport): unknown[] {
    return t.sent
      .map((m) => JSON.parse(m) as { op: { kind: string; data?: unknown } })
      .filter((e) => e.op.kind === 'presence')
      .map((e) => e.op.data);
  }

  it('sendPresence delivers only while live and DROPS (not queues) otherwise', async () => {
    const managed = start();
    managed.sendPresence({ kind: 'laser', points: [] }); // connecting: no transport yet
    await flushAsync();
    managed.sendPresence({ kind: 'laser', points: [{ x: 1, y: 1 }] }); // connecting: no snapshot yet
    expect(sentPresence(currentTransport())).toEqual([]);

    currentTransport().emitMessage(snapshotFor(CLIENT_ID));
    managed.sendPresence({ kind: 'laser', points: [{ x: 2, y: 2 }] });
    expect(sentPresence(currentTransport())).toEqual([{ kind: 'laser', points: [{ x: 2, y: 2 }] }]);

    // Transient drop: offline until the resync snapshot lands.
    currentTransport().emitClose(1006);
    managed.sendPresence({ kind: 'laser', points: [{ x: 3, y: 3 }] });
    currentTransport().emitReconnect();
    managed.sendPresence({ kind: 'laser', points: [{ x: 4, y: 4 }] });
    currentTransport().emitMessage(snapshotFor(CLIENT_ID));
    // Nothing dropped while offline/connecting ever reaches the wire.
    expect(sentPresence(currentTransport())).toEqual([{ kind: 'laser', points: [{ x: 2, y: 2 }] }]);
  });

  it('forwards presence and presence-leave frames with the envelope sender key', async () => {
    const presence: [string, unknown][] = [];
    const leaves: string[] = [];
    const managed = start();
    managed.onPresence((from, data) => presence.push([from, data]));
    managed.onPresenceLeave((from) => leaves.push(from));
    await flushAsync();
    currentTransport().emitMessage(snapshotFor(CLIENT_ID));

    currentTransport().emitMessage(
      envelope('conn-7', { kind: 'presence', data: { kind: 'laser', points: [] } } as SyncOp),
    );
    currentTransport().emitMessage(envelope('conn-7', { kind: 'presence-leave' } as SyncOp));

    expect(presence).toEqual([['conn-7', { kind: 'laser', points: [] }]]);
    expect(leaves).toEqual(['conn-7']);
  });

  it('handlers survive a credential rebuild and unsubscribe stops delivery', async () => {
    const seen: unknown[] = [];
    const managed = start();
    const unsubscribe = managed.onPresence((_from, data) => seen.push(data));
    await flushAsync();
    currentTransport().emitMessage(snapshotFor(CLIENT_ID));

    currentTransport().emitClose(4401); // terminal auth close → rebuild
    await vi.advanceTimersByTimeAsync(100);
    expect(transports).toHaveLength(2);
    currentTransport().emitMessage(snapshotFor(CLIENT_ID));

    currentTransport().emitMessage(
      envelope('conn-9', { kind: 'presence', data: { n: 1 } } as SyncOp),
    );
    expect(seen).toEqual([{ n: 1 }]); // still attached after the rebuild

    unsubscribe();
    currentTransport().emitMessage(
      envelope('conn-9', { kind: 'presence', data: { n: 2 } } as SyncOp),
    );
    expect(seen).toEqual([{ n: 1 }]);
  });

  it("a dead cycle's transport cannot deliver presence after a rebuild (no leaks)", async () => {
    const seen: unknown[] = [];
    const managed = start();
    managed.onPresence((_from, data) => seen.push(data));
    await flushAsync();
    const first = currentTransport();
    first.emitMessage(snapshotFor(CLIENT_ID));

    first.emitClose(4401);
    await vi.advanceTimersByTimeAsync(100);
    expect(transports).toHaveLength(2);

    // The torn-down transport clears its handlers on close(); even a raw
    // late frame through it must not reach the manager's handlers.
    first.emitMessage(envelope('conn-1', { kind: 'presence', data: { stale: true } } as SyncOp));
    expect(seen).toEqual([]);
  });

  it('subscribing before any client exists still delivers once connected', async () => {
    const seen: unknown[] = [];
    const managed = start();
    managed.onPresence((_from, data) => seen.push(data)); // no transport yet
    await flushAsync();
    currentTransport().emitMessage(snapshotFor(CLIENT_ID));
    currentTransport().emitMessage(
      envelope('conn-2', { kind: 'presence', data: { hello: 1 } } as SyncOp),
    );
    expect(seen).toEqual([{ hello: 1 }]);
  });
});

describe('createManagedSyncConnection layer sync', () => {
  let store: ElementStore;
  let transports: FakeTransport[];
  let connection: ManagedSyncConnection | null;

  beforeEach(() => {
    vi.useFakeTimers();
    store = new ElementStore();
    transports = [];
    connection = null;
  });

  afterEach(() => {
    connection?.stop();
    connection = null;
    vi.useRealTimers();
  });

  function layerDef(overrides: Partial<Layer> = {}): Layer {
    return {
      id: 'layer-x',
      name: 'Layer X',
      visible: true,
      locked: false,
      order: 100,
      opacity: 1,
      ...overrides,
    };
  }

  function start(
    updates: RemoteLayerUpdate[],
    overrides: Partial<ManagedSyncConnectionOptions> = {},
  ): ManagedSyncConnection {
    connection = createManagedSyncConnection({
      store,
      clientId: CLIENT_ID,
      resolveUrl: () => Promise.resolve('ws://relay/a'),
      layers: { applyLayer: (u) => updates.push(u) },
      transportFactory: (url) => {
        const t = new FakeTransport(url);
        transports.push(t);
        return t;
      },
      retryInitialDelayMs: 100,
      retryMaxDelayMs: 400,
      ...overrides,
    });
    return connection;
  }

  async function flushAsync(): Promise<void> {
    await vi.advanceTimersByTimeAsync(0);
  }

  function currentTransport(): FakeTransport {
    const t = transports[transports.length - 1];
    if (!t) throw new Error('no transport created');
    return t;
  }

  function sentLayerOps(t: FakeTransport): { kind: string; version?: number; layer?: Layer }[] {
    return t.sent
      .map((m) => JSON.parse(m) as { op: { kind: string; version?: number; layer?: Layer } })
      .map((e) => e.op)
      .filter((op) => op.kind === 'layer-upsert' || op.kind === 'layer-remove');
  }

  it('forwards layer options to the client and publishes through it', async () => {
    const updates: RemoteLayerUpdate[] = [];
    const managed = start(updates);
    await flushAsync();
    currentTransport().emitMessage(snapshotFor(CLIENT_ID));

    managed.publishLayerUpsert(layerDef());
    expect(sentLayerOps(currentTransport())).toEqual([
      { kind: 'layer-upsert', layer: layerDef(), version: 1, editor: CLIENT_ID },
    ]);

    currentTransport().emitMessage(
      envelope('hub', {
        kind: 'layer-upsert',
        layer: layerDef({ id: 'layer-remote' }),
        version: 3,
        editor: 'other',
      } as SyncOp),
    );
    expect(updates).toHaveLength(1);
    expect(updates[0]?.record.id).toBe('layer-remote');
  });

  it('keeps the ledger across credential rebuilds and re-pushes newer local records', async () => {
    const updates: RemoteLayerUpdate[] = [];
    const managed = start(updates);
    await flushAsync();
    currentTransport().emitMessage(snapshotFor(CLIENT_ID));
    managed.publishLayerUpsert(layerDef({ name: 'v1' }));
    managed.publishLayerUpsert(layerDef({ name: 'v2' }));

    // Terminal close forces a rebuild with a new transport and client.
    currentTransport().emitClose(4000);
    await vi.advanceTimersByTimeAsync(100);
    await flushAsync();
    expect(transports).toHaveLength(2);

    // The rebuilt client's reconcile snapshot carries a stale layer record;
    // the shared ledger keeps v2 and re-pushes it.
    currentTransport().emitMessage(
      envelope('hub', {
        kind: 'snapshot',
        to: CLIENT_ID,
        elements: [],
        layers: [
          { id: 'layer-x', version: 1, editor: CLIENT_ID, definition: layerDef({ name: 'v1' }) },
        ],
      } as SyncOp),
    );

    const repushed = sentLayerOps(currentTransport());
    expect(repushed).toEqual([
      { kind: 'layer-upsert', layer: layerDef({ name: 'v2' }), version: 2, editor: CLIENT_ID },
    ]);
    // The stale record must not fire the host hook.
    expect(updates).toHaveLength(0);
  });

  it('records an offline publish in the ledger and delivers it after the next snapshot', async () => {
    const updates: RemoteLayerUpdate[] = [];
    const managed = start(updates);
    await flushAsync();
    currentTransport().emitMessage(snapshotFor(CLIENT_ID));

    // Terminal close: the client is torn down while the retry timer runs.
    currentTransport().emitClose(4000);
    managed.publishLayerUpsert(layerDef({ name: 'edited offline' }));

    await vi.advanceTimersByTimeAsync(100);
    await flushAsync();
    expect(transports).toHaveLength(2);
    currentTransport().emitMessage(snapshotFor(CLIENT_ID));

    expect(sentLayerOps(currentTransport())).toEqual([
      {
        kind: 'layer-upsert',
        layer: layerDef({ name: 'edited offline' }),
        version: 1,
        editor: CLIENT_ID,
      },
    ]);
  });

  it('publish methods throw when the layers option is absent', async () => {
    const managed = createManagedSyncConnection({
      store,
      clientId: CLIENT_ID,
      resolveUrl: () => Promise.resolve('ws://relay/a'),
      transportFactory: (url) => {
        const t = new FakeTransport(url);
        transports.push(t);
        return t;
      },
    });
    connection = managed;
    await flushAsync();
    expect(() => managed.publishLayerUpsert(layerDef())).toThrow(/not enabled/);
    expect(() => managed.publishLayerRemove('layer-x')).toThrow(/not enabled/);
  });
});

describe('createManagedSyncConnection fog lifecycle', () => {
  const definition = {
    version: 1 as const,
    generation: 'gen-1',
    bounds: { x: 0, y: 0, w: 128, h: 128 },
    cellSize: 1,
    tileCells: 128 as const,
    base: 'covered' as const,
  };
  const data = fogEncodeBase64(new Uint8Array(2048).fill(0xff));

  it('rejects an invalid fog ordering identity before starting the async lifecycle', () => {
    const resolveUrl = vi.fn(() => Promise.resolve('ws://relay/a'));
    const transportFactory = vi.fn((url: string) => new FakeTransport(url));

    expect(() =>
      createManagedSyncConnection({
        store: new ElementStore(),
        clientId: '😀',
        resolveUrl,
        fog: { manager: new FogManager() },
        transportFactory,
      }),
    ).toThrow(/printable ASCII/);
    expect(resolveUrl).not.toHaveBeenCalled();
    expect(transportFactory).not.toHaveBeenCalled();
  });

  it('keeps hub knowledge and shields a fog edit made during a credential rebuild gap', async () => {
    vi.useFakeTimers();
    const store = new ElementStore();
    const manager = new FogManager({ idFactory: () => 'gen-local' });
    manager.loadState({ definition, tiles: [] });
    const transports: FakeTransport[] = [];
    const connection = createManagedSyncConnection({
      store,
      clientId: CLIENT_ID,
      resolveUrl: () => Promise.resolve('ws://relay/a'),
      fog: { manager, preserveLocalWhenRemoteMissing: true },
      transportFactory: (url) => {
        const transport = new FakeTransport(url);
        transports.push(transport);
        return transport;
      },
      retryInitialDelayMs: 10,
    });
    await vi.advanceTimersByTimeAsync(0);
    transports[0]?.emitMessage(
      envelope('hub', {
        kind: 'snapshot',
        to: CLIENT_ID,
        elements: [],
        fog: { meta: { version: 1, editor: 'hub', definition }, tiles: [] },
      } as SyncOp),
    );

    transports[0]?.emitClose(4401);
    manager.applyPatchDirect({ tiles: [{ x: 0, y: 0, data }] });
    await vi.advanceTimersByTimeAsync(10);
    const rebuilt = transports[1];
    expect(rebuilt).toBeDefined();
    rebuilt?.emitMessage(
      envelope('hub', {
        kind: 'snapshot',
        to: CLIENT_ID,
        elements: [],
        fog: {
          meta: { version: 1, editor: 'hub', definition },
          tiles: [{ generation: 'gen-1', x: 0, y: 0, version: 10, editor: 'hub', data }],
        },
      } as SyncOp),
    );
    const patch = rebuilt?.sent
      .map((raw) => JSON.parse(raw).op as SyncOp)
      .find((op) => op.kind === 'fog-patch');
    expect(patch).toMatchObject({
      kind: 'fog-patch',
      tiles: [{ x: 0, y: 0, version: 11, editor: CLIENT_ID }],
    });

    rebuilt?.emitClose(4401);
    await vi.advanceTimersByTimeAsync(10);
    const third = transports[2];
    third?.emitMessage(snapshotFor(CLIENT_ID));
    expect(manager.getState()).toBeNull();
    expect(third?.sent.some((raw) => (JSON.parse(raw).op as SyncOp).kind === 'fog-meta')).toBe(
      false,
    );
    connection.stop();
    vi.useRealTimers();
  });
});
