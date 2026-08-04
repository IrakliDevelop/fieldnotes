import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ElementStore, createNote } from '@fieldnotes/core';
import { createManagedSyncConnection } from './managed-connection';
import type {
  ManagedSyncConnection,
  ManagedSyncConnectionOptions,
  ManagedSyncStatus,
  ManagedSyncTransport,
} from './managed-connection';
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

  it('ignores a snapshot echoed back with our own clientId as sender', async () => {
    start();
    await flushAsync();
    currentTransport().emitMessage(
      envelope(CLIENT_ID, { kind: 'snapshot', to: CLIENT_ID, elements: [] }),
    );
    expect(connection?.getStatus()).toBe('connecting');
  });
});
