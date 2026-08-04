import type { CanvasElement, ElementStore, Layer } from '@fieldnotes/core';
import { SyncClient, type ResolveLocalOnly, type RemoteLayerUpdate } from './sync-client';
import type { SyncTransport } from './sync-transport';
import { WebSocketTransport } from './websocket-transport';
import { parseEnvelope, isValidLayerDefinition } from './protocol';
import { LayerLedger } from './layer-ledger';

/**
 * Connection health as observed by the managed lifecycle:
 *
 * - `connecting` — resolving credentials, opening a transport, or waiting for
 *   the authoritative snapshot after a socket (re)open.
 * - `live` — an authoritative snapshot addressed to this client has arrived on
 *   the current connection.
 * - `offline` — the connection dropped or credentials could not be resolved;
 *   a reconnect or retry is pending.
 * - `denied` — consecutive authentication failures reached the configured
 *   bound; the manager stays down until it is recreated.
 */
export type ManagedSyncStatus = 'connecting' | 'live' | 'offline' | 'denied';

/**
 * Transport contract the managed lifecycle requires. `WebSocketTransport`
 * satisfies it. A custom factory must produce a transport that reconnects
 * transient closes internally and permanently terminates on any close code
 * for which `isTerminalClose` returns true, otherwise the transport and the
 * manager would compete over the same failure.
 */
export interface ManagedSyncTransport extends SyncTransport {
  onReconnect(handler: () => void): () => void;
  onClose(handler: (code: number, reason: string) => void): () => void;
}

export interface ManagedSyncConnectionOptions {
  store: ElementStore;
  /**
   * Stable client identity. It must not change across reconnects and, for
   * authenticated relays, must equal the server-authenticated user id so
   * ownership authorization and reconnect echo-suppression keep working.
   */
  clientId: string;
  /**
   * Resolves the connection URL, including any embedded credentials. Called
   * once per connect cycle, so an expired token is refreshed by returning a
   * fresh URL. Return `null` (or throw) to signal a mint failure; the manager
   * retries with exponential backoff.
   */
  resolveUrl: () => string | null | Promise<string | null>;
  resolveAudience?: (element: CanvasElement) => string | undefined;
  /**
   * Authoritative bootstrap/reconcile hook, forwarded to every `SyncClient`
   * the manager creates. The manager keeps one hub-knowledge set for its
   * whole lifetime and starts rebuilt clients in reconcile mode, so
   * `hubKnown` classification and deleted-while-away semantics stay correct
   * across credential rebuilds.
   */
  resolveLocalOnly?: ResolveLocalOnly;
  /**
   * Enables versioned layer-definition sync. The manager owns one
   * `LayerLedger` for its whole lifetime and passes it to every client it
   * builds, so version counters and tombstones survive credential rebuilds
   * and locally-newer records are re-pushed after each reconnect snapshot.
   */
  layers?: {
    /** Host application hook; see `LayerSyncOptions.applyLayer`. */
    applyLayer: (update: RemoteLayerUpdate) => void;
  };
  onStatus?: (status: ManagedSyncStatus) => void;
  /**
   * Optional observer for raw transport frames. It is subscribed before the
   * internal `SyncClient` on every transport, so it sees each frame before
   * the client applies it to the store. It must not throw.
   */
  onTransportMessage?: (raw: string) => void;
  /**
   * Close codes the transport will NOT reconnect from itself; the manager
   * rebuilds the transport and client with freshly resolved credentials.
   * Default: application close codes 4000-4999, matching
   * `WebSocketTransport`'s default `shouldReconnect`.
   */
  isTerminalClose?: (code: number) => boolean;
  /**
   * Terminal close codes that count toward the consecutive-authentication
   * failure bound. Default: `4401`.
   */
  isAuthClose?: (code: number) => boolean;
  /** Consecutive auth closes before settling on `denied`. Default: 4. */
  maxAuthFailures?: number;
  /** First retry delay for failed connect cycles. Default: 1000ms. */
  retryInitialDelayMs?: number;
  /** Retry delay cap. Default: 15000ms. */
  retryMaxDelayMs?: number;
  /** DI seam for tests; defaults to `url => new WebSocketTransport(url)`. */
  transportFactory?: (url: string) => ManagedSyncTransport;
}

export interface ManagedSyncConnection {
  /**
   * Cancels timers, listeners, the client, and the transport, and invalidates
   * any in-flight `resolveUrl` result. A stopped connection never reconnects.
   */
  stop(): void;
  getStatus(): ManagedSyncStatus;
  /**
   * Sends ephemeral presence data to the room. Presence is fire-and-forget:
   * while the connection is not `live` the data is DROPPED, never queued —
   * stale presence (a laser trail, a cursor) must not replay after a
   * reconnect. Presence never enters the durable operation queue.
   */
  sendPresence(data: unknown): void;
  /**
   * Observes room presence frames. `from` is the relay's server-owned sender
   * id for the originating connection — an opaque per-sender key, not the
   * remote clientId. Handlers survive credential rebuilds: they are attached
   * to every client the manager creates. Returns unsubscribe.
   */
  onPresence(handler: (from: string, data: unknown) => void): () => void;
  /**
   * Observes presence departures (a sender's connection closed). Same `from`
   * key and rebuild semantics as `onPresence`. Returns unsubscribe.
   */
  onPresenceLeave(handler: (from: string) => void): () => void;
  /**
   * Publishes a local layer definition edit. While no client is connected
   * (between rebuilds) the edit is recorded in the manager's ledger and
   * delivered by the re-push that follows the next authoritative snapshot.
   * Throws when the `layers` option was not configured.
   */
  publishLayerUpsert(definition: Layer): void;
  /** Publishes a local layer removal; same offline semantics as upsert. */
  publishLayerRemove(id: string): void;
}

const BACKOFF_EXPONENT_CAP = 10;

/**
 * Owns the resolve-URL → transport → `SyncClient` lifecycle around an
 * authenticated relay.
 *
 * There is exactly one retry owner per failure class: the transport reconnects
 * transient closes with its own backoff and frozen URL, while the manager
 * handles everything the transport cannot survive — credential minting
 * failures and terminal closes — by tearing the connection down and rebuilding
 * it with a freshly resolved URL. The manager never schedules a retry for a
 * close the transport will reconnect itself.
 */
export function createManagedSyncConnection(
  options: ManagedSyncConnectionOptions,
): ManagedSyncConnection {
  const {
    store,
    clientId,
    resolveUrl,
    resolveAudience,
    resolveLocalOnly,
    onStatus,
    onTransportMessage,
  } = options;
  const isTerminalClose =
    options.isTerminalClose ?? ((code: number) => code >= 4000 && code <= 4999);
  const isAuthClose = options.isAuthClose ?? ((code: number) => code === 4401);
  const maxAuthFailures = options.maxAuthFailures ?? 4;
  const retryInitialDelayMs = options.retryInitialDelayMs ?? 1000;
  const retryMaxDelayMs = options.retryMaxDelayMs ?? 15_000;
  const transportFactory =
    options.transportFactory ?? ((url: string) => new WebSocketTransport(url));

  let stopped = false;
  let denied = false;
  // Hub knowledge and joined-ness outlive individual connect cycles: a rebuilt
  // client resumes the same store, so its first snapshot is a reconcile (with
  // deleted-while-away semantics), not a fresh non-destructive bootstrap.
  const hubKnownIds = new Set<string>();
  const layerLedger = options.layers ? new LayerLedger() : null;
  // Presence handlers live on the manager so they outlive credential
  // rebuilds; each client gets one forwarder that iterates the live sets.
  const presenceHandlers = new Set<(from: string, data: unknown) => void>();
  const presenceLeaveHandlers = new Set<(from: string) => void>();
  let everJoined = false;
  // Incremented on stop() and each connect cycle so late async results
  // (resolveUrl, stale transport events) from an older cycle are discarded.
  let generation = 0;
  let attempt = 0; // consecutive failed connect cycles, reset by an authoritative snapshot
  let authFailures = 0; // consecutive auth closes, reset by an authoritative snapshot
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let client: SyncClient | null = null;
  let transport: ManagedSyncTransport | null = null;
  let subscriptions: (() => void)[] = [];
  let currentStatus: ManagedSyncStatus | null = null;

  const setStatus = (next: ManagedSyncStatus): void => {
    if (next === currentStatus) return;
    currentStatus = next;
    onStatus?.(next);
  };

  const teardownConnection = (): void => {
    const active = subscriptions;
    subscriptions = [];
    for (const unsubscribe of active) unsubscribe();
    client?.stop();
    client = null;
    transport?.close();
    transport = null;
  };

  const scheduleRetry = (): void => {
    if (stopped || denied) return;
    setStatus('offline');
    const delay = Math.min(
      retryMaxDelayMs,
      retryInitialDelayMs * 2 ** Math.min(attempt, BACKOFF_EXPONENT_CAP),
    );
    attempt += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      beginCycle();
    }, delay);
  };

  const handleFrame = (cycleGeneration: number, raw: string): void => {
    if (stopped || cycleGeneration !== generation) return;
    const envelope = parseEnvelope(raw);
    if (!envelope || envelope.from === clientId) return;
    if (envelope.op.kind !== 'snapshot' || envelope.op.to !== clientId) return;
    // Authoritative snapshot addressed to us: auth and transport are proven
    // healthy, so both retry budgets reset.
    attempt = 0;
    authFailures = 0;
    everJoined = true;
    setStatus('live');
  };

  const handleClose = (cycleGeneration: number, code: number): void => {
    if (stopped || cycleGeneration !== generation) return;
    if (!isTerminalClose(code)) {
      // Transient drop: the transport owns this reconnect. Report offline and
      // wait for onReconnect; scheduling here would create a second retry owner.
      setStatus('offline');
      return;
    }
    // Terminal close: the transport has permanently stopped. Rebuild with
    // freshly resolved credentials, unless auth failures exhaust the bound.
    teardownConnection();
    if (isAuthClose(code)) {
      authFailures += 1;
      if (authFailures >= maxAuthFailures) {
        denied = true;
        setStatus('denied');
        return;
      }
    }
    scheduleRetry();
  };

  const connect = async (cycleGeneration: number): Promise<void> => {
    let url: string | null;
    try {
      url = await resolveUrl();
    } catch {
      url = null;
    }
    // stop() or a newer cycle invalidates this in-flight resolution.
    if (stopped || cycleGeneration !== generation) return;
    if (url === null) {
      scheduleRetry();
      return;
    }
    const activeTransport = transportFactory(url);
    transport = activeTransport;
    if (onTransportMessage) {
      subscriptions.push(activeTransport.onMessage(onTransportMessage));
    }
    subscriptions.push(activeTransport.onMessage((raw) => handleFrame(cycleGeneration, raw)));
    subscriptions.push(
      activeTransport.onReconnect(() => {
        if (stopped || cycleGeneration !== generation) return;
        // Socket reopened; the SyncClient re-requests a snapshot, and `live`
        // is emitted when that authoritative snapshot arrives.
        setStatus('connecting');
      }),
    );
    subscriptions.push(activeTransport.onClose((code) => handleClose(cycleGeneration, code)));
    // Subscribed last so host observers and the snapshot watcher above see
    // every frame before the client applies it to the store.
    client = new SyncClient({
      store,
      transport: activeTransport,
      clientId,
      resolveAudience,
      resolveLocalOnly,
      hubKnownIds,
      firstSnapshot: everJoined ? 'reconcile' : 'merge',
      ...(options.layers && layerLedger
        ? { layers: { applyLayer: options.layers.applyLayer, ledger: layerLedger } }
        : {}),
    });
    client.start();
    subscriptions.push(
      client.onPresence((from, data) => {
        for (const handler of presenceHandlers) handler(from, data);
      }),
      client.onPresenceLeave((from) => {
        for (const handler of presenceLeaveHandlers) handler(from);
      }),
    );
  };

  const beginCycle = (): void => {
    if (stopped || denied) return;
    const cycleGeneration = ++generation;
    setStatus('connecting');
    void connect(cycleGeneration);
  };

  beginCycle();

  return {
    stop(): void {
      if (stopped) return;
      stopped = true;
      generation += 1; // invalidate any in-flight resolveUrl result
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      teardownConnection();
    },
    getStatus(): ManagedSyncStatus {
      return currentStatus ?? 'connecting';
    },
    sendPresence(data: unknown): void {
      // Gate on `live`, not merely on having a client: the transport buffers
      // durable sends while (re)connecting, and stale presence must never
      // replay from that buffer.
      if (currentStatus === 'live' && client) client.sendPresence(data);
    },
    onPresence(handler: (from: string, data: unknown) => void): () => void {
      presenceHandlers.add(handler);
      return () => presenceHandlers.delete(handler);
    },
    onPresenceLeave(handler: (from: string) => void): () => void {
      presenceLeaveHandlers.add(handler);
      return () => presenceLeaveHandlers.delete(handler);
    },
    publishLayerUpsert(definition: Layer): void {
      if (!layerLedger) {
        throw new Error('layer sync is not enabled for this connection (pass the `layers` option)');
      }
      if (client) {
        client.publishLayerUpsert(definition);
        return;
      }
      if (!isValidLayerDefinition(definition)) {
        throw new Error('publishLayerUpsert requires a valid layer definition');
      }
      // No active client: record in the shared ledger; the re-push after the
      // next authoritative snapshot broadcasts it.
      layerLedger.recordUpsert({ ...definition }, clientId);
    },
    publishLayerRemove(id: string): void {
      if (!layerLedger) {
        throw new Error('layer sync is not enabled for this connection (pass the `layers` option)');
      }
      if (client) {
        client.publishLayerRemove(id);
        return;
      }
      layerLedger.recordRemove(id, clientId);
    },
  };
}
