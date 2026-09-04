import type { CanvasElement, ElementStore, Layer, FogStateV1 } from '@fieldnotes/core';
import type { SyncTransport } from './sync-transport';
import {
  parseEnvelope,
  isValidElement,
  isValidLayerDefinition,
  isValidLayerRecord,
  isNewerLayerRecord,
  isValidFogMetaRecord,
  isValidFogTileRecord,
  isValidFogSnapshot,
  FOG_PATCH_MAX_TILES,
  type LayerRecord,
  type SyncOp,
  type SyncElement,
  type FogMetaRecord,
  type FogTileRecord,
} from './protocol';
import { LayerLedger } from './layer-ledger';
import { FogLedger } from './fog-ledger';

/**
 * Which authoritative-snapshot merge is being applied:
 *
 * - `bootstrap` — the client's first snapshot. Local elements absent from it
 *   are kept (non-destructive merge) unless the host discards them.
 * - `reconcile` — a later resync snapshot. Local elements absent from it are
 *   removed (deleted-while-away) unless the host preserves them.
 */
export type AuthoritativeSnapshotPhase = 'bootstrap' | 'reconcile';

export interface LocalOnlyElement {
  readonly element: CanvasElement;
  /**
   * Whether the hub has known this id during this session: it appeared in a
   * received snapshot or remote upsert, or was sent as a local upsert while
   * this client (or a predecessor sharing `hubKnownIds`) was attached. A
   * hub-known element that is absent from a reconcile snapshot was deleted
   * while this client was away; a hub-unknown one is local-authoritative
   * state the hub has never seen.
   */
  readonly hubKnown: boolean;
}

export interface AuthoritativeSnapshotContext {
  readonly phase: AuthoritativeSnapshotPhase;
  /** The validated elements carried by the authoritative snapshot. */
  readonly snapshot: readonly CanvasElement[];
  /**
   * Local elements the snapshot does not contain, excluding elements touched
   * locally during the resync window (those are already shielded and sent).
   */
  readonly localOnly: readonly LocalOnlyElement[];
}

/**
 * Host decision for `localOnly` elements. Ids outside `localOnly` are
 * ignored; an id listed in both sets is preserved. Unlisted elements keep the
 * phase default: kept on `bootstrap`, removed on `reconcile`.
 */
export interface LocalOnlyResolution {
  /**
   * Kept locally and re-pushed to the hub through the normal local-upsert
   * path, so `resolveAudience` stamping and server-side filtering apply.
   */
  preserve?: readonly string[];
  /** Removed locally without broadcasting a remove. */
  discard?: readonly string[];
}

export type ResolveLocalOnly = (
  context: AuthoritativeSnapshotContext,
) => LocalOnlyResolution | undefined;

/**
 * A winning remote layer record for the host to apply. A `record` without
 * `definition` is a removal tombstone. `source` is `'op'` for a live
 * `layer-upsert`/`layer-remove` and `'snapshot'` for a record carried by an
 * authoritative or peer snapshot.
 */
export interface RemoteLayerUpdate {
  readonly record: LayerRecord;
  readonly source: 'op' | 'snapshot';
}

/**
 * Opt-in versioned layer-definition sync. Presentation only: layer records
 * never carry element bytes, and element-level audience filtering remains the
 * sole privacy boundary.
 */
export interface LayerSyncOptions {
  /**
   * Applies a winning remote record to host layer state. Called only when the
   * record beats the ledger under the deterministic (version, editor)
   * ordering, so hosts never see stale updates. The host owns policy: it may
   * overlay role-local fields (e.g. keep a layer locked for players) and must
   * apply through history-transparent operations — remote layer changes must
   * never enter local undo history. A throwing hook does not disturb sync.
   */
  applyLayer: (update: RemoteLayerUpdate) => void;
  /**
   * Versioned record state shared across successive clients over one store
   * (e.g. managed-connection rebuilds). Defaults to a fresh ledger.
   */
  ledger?: LayerLedger;
}

export interface FogSyncManager {
  getState(): FogStateV1 | null;
  loadState(state: FogStateV1 | null, meta?: { origin?: string }): void;
  applyPatchDirect(
    patch: { tiles: readonly { x: number; y: number; data: string }[] },
    meta?: { origin?: string },
  ): void;
  on(
    event: 'change',
    listener: (event: {
      kind: string;
      tiles?: readonly { x: number; y: number }[];
      origin?: string;
    }) => void,
  ): () => void;
}

export interface FogSyncOptions {
  manager: FogSyncManager;
  ledger?: FogLedger;
  preserveLocalWhenRemoteMissing?: boolean;
}

export interface SyncClientOptions {
  store: ElementStore;
  transport: SyncTransport;
  clientId?: string;
  resolveAudience?: (element: CanvasElement) => string | undefined;
  /**
   * Called synchronously for every authoritative snapshot addressed to this
   * client, before the merge/reconcile mutates the store, so hosts own
   * bootstrap/reconcile semantics without observing raw frames or deferring
   * work to timers. A throwing hook falls back to the phase defaults and
   * never wedges the resync state machine.
   */
  resolveLocalOnly?: ResolveLocalOnly;
  /**
   * Ids the hub is known to have seen. The client mutates the set as it
   * learns; pass one shared set to successive clients over the same store
   * (e.g. across managed-connection rebuilds) to keep `hubKnown`
   * classification accurate.
   */
  hubKnownIds?: Set<string>;
  /**
   * How to treat the first authoritative snapshot. `merge` (default) keeps
   * unknown local elements; `reconcile` applies destructive resync semantics
   * immediately — for successor clients resuming an already-synced store,
   * with local ops made before the snapshot shielded as touched-during-resync.
   */
  firstSnapshot?: 'merge' | 'reconcile';
  /** Enables versioned layer-definition sync for this client. */
  layers?: LayerSyncOptions;
  /** Enables fog-of-war sync for this client. */
  fog?: FogSyncOptions;
}

const REMOTE_ORIGIN = 'remote';
/**
 * Server-owned sender identity. The hub never forwards a client-stamped
 * `from`, so a layer op arriving from `hub` is an authoritative correction
 * and overrides the ledger even against a locally-newer version.
 */
const HUB_FROM = 'hub';

function isExternal(origin: string | undefined): boolean {
  return origin !== undefined && origin !== 'local';
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `c-${Math.random().toString(36).slice(2)}`;
}

export class SyncClient {
  private readonly store: ElementStore;
  private readonly transport: SyncTransport;
  private readonly clientId: string;
  private readonly resolveAudience?: (element: CanvasElement) => string | undefined;
  private readonly resolveLocalOnly?: ResolveLocalOnly;
  private readonly hubKnownIds: Set<string>;
  private readonly applyLayer?: (update: RemoteLayerUpdate) => void;
  private readonly layerLedger?: LayerLedger;
  private readonly fogManager?: FogSyncManager;
  private readonly fogLedger?: FogLedger;
  private readonly fogPreserveLocal: boolean;
  private fogHubKnown = false;
  private unsubscribers: (() => void)[] = [];
  private started = false;
  private joined = false;
  private resyncPending = false;
  private readonly touchedDuringResync = new Set<string>();
  private readonly presenceHandlers = new Set<(from: string, data: unknown) => void>();
  private readonly presenceLeaveHandlers = new Set<(from: string) => void>();

  constructor(options: SyncClientOptions) {
    this.store = options.store;
    this.transport = options.transport;
    this.clientId = options.clientId ?? randomId();
    this.resolveAudience = options.resolveAudience;
    this.resolveLocalOnly = options.resolveLocalOnly;
    this.hubKnownIds = options.hubKnownIds ?? new Set();
    if (options.layers) {
      this.applyLayer = options.layers.applyLayer;
      this.layerLedger = options.layers.ledger ?? new LayerLedger();
    }
    if (options.fog) {
      this.fogManager = options.fog.manager;
      this.fogLedger = options.fog.ledger ?? new FogLedger();
      this.fogPreserveLocal = options.fog.preserveLocalWhenRemoteMissing ?? false;
    } else {
      this.fogPreserveLocal = false;
    }
    this.joined = options.firstSnapshot === 'reconcile';
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    // A reconcile-first client resumes an already-synced store, so its first
    // snapshot IS a resync: shield local ops made before it arrives.
    if (this.joined) this.resyncPending = true;
    this.unsubscribers = [
      this.store.on('add', (el, meta) =>
        this.onLocal({ kind: 'upsert', element: el }, meta.origin),
      ),
      this.store.on('update', ({ current }, meta) =>
        this.onLocal({ kind: 'upsert', element: current }, meta.origin),
      ),
      this.store.on('remove', (el, meta) =>
        this.onLocal({ kind: 'remove', id: el.id }, meta.origin),
      ),
      this.store.on('clear', (_data, meta) => this.onLocal({ kind: 'clear' }, meta.origin)),
      this.transport.onMessage((msg) => this.onRemote(msg)),
    ];
    if (this.transport.onReconnect) {
      this.unsubscribers.push(this.transport.onReconnect(() => this.onReconnect()));
    }
    if (this.fogManager) {
      this.unsubscribers.push(
        this.fogManager.on('change', (event) => this.onLocalFogChange(event)),
      );
    }
    // MUST be last: a synchronous bus delivers the peer's reply reentrantly, so the
    // onMessage receive handler above must already be wired before we request.
    this.sendOp({ kind: 'request-snapshot' });
  }

  private onReconnect(): void {
    this.resyncPending = true;
    this.touchedDuringResync.clear();
    this.sendOp({ kind: 'request-snapshot' });
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.unsubscribers.forEach((u) => u());
    this.unsubscribers = [];
  }

  sendPresence(data: unknown): void {
    if (!this.started) return;
    this.sendOp({ kind: 'presence', data });
  }

  onPresence(handler: (from: string, data: unknown) => void): () => void {
    this.presenceHandlers.add(handler);
    return () => this.presenceHandlers.delete(handler);
  }

  onPresenceLeave(handler: (from: string) => void): () => void {
    this.presenceLeaveHandlers.add(handler);
    return () => this.presenceLeaveHandlers.delete(handler);
  }

  /**
   * Publishes a local layer definition edit: stamps the next version with
   * this client as editor, records it in the ledger, and broadcasts it.
   * Publishing never touches element or undo state; the host decides when a
   * local layer change is worth broadcasting. Throws when layer sync is not
   * enabled or the definition is malformed.
   */
  publishLayerUpsert(definition: Layer): void {
    const ledger = this.requireLayerLedger();
    if (!isValidLayerDefinition(definition)) {
      throw new Error('publishLayerUpsert requires a valid layer definition');
    }
    const copy: Layer = { ...definition };
    const record = ledger.recordUpsert(copy, this.clientId);
    this.sendOp({
      kind: 'layer-upsert',
      layer: copy,
      version: record.version,
      editor: this.clientId,
    });
  }

  /** Publishes a local layer removal as a versioned tombstone. */
  publishLayerRemove(id: string): void {
    const ledger = this.requireLayerLedger();
    const record = ledger.recordRemove(id, this.clientId);
    this.sendOp({ kind: 'layer-remove', id, version: record.version, editor: this.clientId });
  }

  private requireLayerLedger(): LayerLedger {
    if (!this.layerLedger) {
      throw new Error('layer sync is not enabled for this client (pass the `layers` option)');
    }
    return this.layerLedger;
  }

  private onRemoteLayerOp(
    from: string,
    op: Extract<SyncOp, { kind: 'layer-upsert' | 'layer-remove' }>,
  ): void {
    if (!this.layerLedger) return; // not opted in — new traffic is ignored entirely
    const record: LayerRecord =
      op.kind === 'layer-upsert'
        ? { id: op.layer.id, version: op.version, editor: op.editor, definition: op.layer }
        : { id: op.id, version: op.version, editor: op.editor };
    if (from === HUB_FROM) {
      // Hub correction (stale or denied edit): authoritative, beats the ledger.
      this.layerLedger.applyAuthoritative(record);
    } else if (!this.layerLedger.applyRemote(record)) {
      return; // stale under (version, editor) — already superseded locally
    }
    this.safeApplyLayer({ record, source: 'op' });
  }

  private mergeSnapshotLayers(layers: readonly LayerRecord[] | undefined): void {
    if (!this.layerLedger || !layers) return;
    for (const raw of layers as readonly unknown[]) {
      // isValidEnvelope checks the array shape only; validate per record here.
      if (!isValidLayerRecord(raw)) continue;
      if (this.layerLedger.applyRemote(raw))
        this.safeApplyLayer({ record: raw, source: 'snapshot' });
    }
  }

  private pushNewerLayerRecords(layers: readonly LayerRecord[] | undefined): void {
    if (!this.layerLedger) return;
    const snapshotRecords = new Map<string, LayerRecord>();
    for (const raw of (layers ?? []) as readonly unknown[]) {
      if (isValidLayerRecord(raw)) snapshotRecords.set(raw.id, raw);
    }
    for (const record of this.layerLedger.records()) {
      const known = snapshotRecords.get(record.id);
      if (known && !isNewerLayerRecord(record, known)) continue;
      this.sendOp(
        record.definition
          ? {
              kind: 'layer-upsert',
              layer: record.definition,
              version: record.version,
              editor: record.editor,
            }
          : { kind: 'layer-remove', id: record.id, version: record.version, editor: record.editor },
      );
    }
  }

  private safeApplyLayer(update: RemoteLayerUpdate): void {
    if (!this.applyLayer) return;
    try {
      this.applyLayer(update);
    } catch {
      // A throwing host hook must not disturb the sync state machine.
    }
  }

  private sendOp(op: SyncOp): void {
    this.transport.send(JSON.stringify({ from: this.clientId, op }));
  }

  private stampAudience(op: SyncOp): SyncOp {
    if (op.kind !== 'upsert' || !this.resolveAudience) return op;
    const audience = this.resolveAudience(op.element);
    if (audience === undefined) return op;
    const element: SyncElement = { ...op.element, audience };
    return { kind: 'upsert', element };
  }

  private onLocal(op: SyncOp, origin: string | undefined): void {
    if (isExternal(origin)) return; // applied remote ops must not re-broadcast
    const outgoing = this.stampAudience(op);
    if (this.resyncPending) {
      if (outgoing.kind === 'upsert') this.touchedDuringResync.add(outgoing.element.id);
      else if (outgoing.kind === 'remove') this.touchedDuringResync.add(outgoing.id);
      // 'clear' during a resync window is not shielded (whole-store, rare) — acceptable
    }
    // Fire-and-forget delivery: a sent upsert is assumed to reach the hub, the
    // same assumption the resync shield already makes.
    if (outgoing.kind === 'upsert') this.hubKnownIds.add(outgoing.element.id);
    this.sendOp(outgoing);
  }

  private onRemote(message: string): void {
    const env = parseEnvelope(message);
    // clientId is STABLE across transport reconnects, so this guard also drops our own ops that the
    // relay echoes back after a reconnect (the reconnected socket is a NEW hub connection, so the hub's
    // connId echo-suppression does not cover them). Do NOT key this guard off the connection.
    if (!env || env.from === this.clientId) return; // malformed/invalid + own echo
    const op = env.op;
    if (op.kind === 'request-snapshot') {
      const elements = this.store.snapshot();
      const snapshotOp: Record<string, unknown> = { kind: 'snapshot', to: env.from, elements };
      if (this.layerLedger) snapshotOp['layers'] = this.layerLedger.records();
      if (this.fogLedger) {
        const fogSnap = this.fogLedger.snapshot();
        if (fogSnap) snapshotOp['fog'] = fogSnap;
      }
      this.sendOp(snapshotOp as SyncOp);
    } else if (op.kind === 'snapshot') {
      if (op.to !== this.clientId) return; // not addressed to us
      // Layers merge BEFORE elements so an element referencing a just-synced
      // layer arrives after the host has created that layer.
      this.mergeSnapshotLayers(op.layers);
      this.mergeSnapshotFog((op as Record<string, unknown>)['fog']);
      const phase: AuthoritativeSnapshotPhase = this.joined ? 'reconcile' : 'bootstrap';
      const preserved = this.applyAuthoritativeSnapshot(phase, op.elements.filter(isValidElement));
      this.joined = true;
      this.resyncPending = false; // TD-1: finalize after ANY snapshot (merge OR reconcile)
      this.touchedDuringResync.clear();
      // Re-push AFTER the resync finalizes, through the normal local-upsert
      // path (audience stamping, hub-knowledge marking) — synchronously, so
      // hosts never need deferred-macrotask timing around snapshots.
      for (const id of preserved) {
        const element = this.store.getById(id);
        if (element) this.onLocal({ kind: 'upsert', element }, 'local');
      }
      // Snapshot merge is non-destructive for layers: records the snapshot
      // lacks (or carries only older versions of) are re-pushed so the sender
      // learns them — the layer analogue of preserved-element re-push.
      this.pushNewerLayerRecords(op.layers);
    } else if (op.kind === 'layer-upsert' || op.kind === 'layer-remove') {
      this.onRemoteLayerOp(env.from, op);
    } else if (op.kind === 'fog-meta' || op.kind === 'fog-patch') {
      this.onRemoteFogOp(env.from, op);
    } else if (op.kind === 'presence') {
      for (const h of this.presenceHandlers) h(env.from, op.data);
    } else if (op.kind === 'presence-leave') {
      for (const h of this.presenceLeaveHandlers) h(env.from);
    } else {
      this.applyOp(op); // narrows to upsert | remove | clear
    }
  }

  private applyOp(op: SyncOp): void {
    if (op.kind === 'upsert') {
      const el = op.element;
      this.hubKnownIds.add(el.id); // remote/snapshot upserts are hub evidence
      if (this.store.getById(el.id)) {
        this.store.update(el.id, el, { origin: REMOTE_ORIGIN });
      } else {
        this.store.add(el, { origin: REMOTE_ORIGIN });
      }
    } else if (op.kind === 'remove') {
      this.store.remove(op.id, { origin: REMOTE_ORIGIN });
    } else if (op.kind === 'clear') {
      this.store.clear({ origin: REMOTE_ORIGIN });
    }
    // applyOp handles the data ops only (upsert/remove/clear). The control ops
    // (request-snapshot/snapshot) are dispatched in onRemote; unknown kinds are filtered by
    // isValidEnvelope — so no destructive default here.
  }

  /**
   * Applies an authoritative snapshot under explicit bootstrap/reconcile
   * semantics and returns the ids the host chose to preserve and re-push.
   */
  private applyAuthoritativeSnapshot(
    phase: AuthoritativeSnapshotPhase,
    snapshot: CanvasElement[],
  ): string[] {
    const snapshotIds = new Set(snapshot.map((e) => e.id));
    const localOnly: LocalOnlyElement[] = [];
    for (const local of this.store.snapshot()) {
      if (snapshotIds.has(local.id) || this.touchedDuringResync.has(local.id)) continue;
      localOnly.push({ element: local, hubKnown: this.hubKnownIds.has(local.id) });
    }
    const { preserve, discard } = this.resolveLocalOnlyDecision(phase, snapshot, localOnly);
    for (const entry of localOnly) {
      const id = entry.element.id;
      if (preserve.has(id)) continue;
      if (phase === 'reconcile' || discard.has(id)) {
        // deleted-while-away (reconcile default) or host-discarded — no re-broadcast
        this.store.remove(id, { origin: REMOTE_ORIGIN });
      }
    }
    for (const el of snapshot) {
      // On reconcile a touched local edit is newer + already sent to the hub.
      if (phase === 'reconcile' && this.touchedDuringResync.has(el.id)) continue;
      this.applyOp({ kind: 'upsert', element: el });
    }
    return [...preserve];
  }

  private resolveLocalOnlyDecision(
    phase: AuthoritativeSnapshotPhase,
    snapshot: readonly CanvasElement[],
    localOnly: readonly LocalOnlyElement[],
  ): { preserve: Set<string>; discard: Set<string> } {
    const preserve = new Set<string>();
    const discard = new Set<string>();
    if (!this.resolveLocalOnly) return { preserve, discard };
    let resolution: LocalOnlyResolution | undefined;
    try {
      resolution = this.resolveLocalOnly({ phase, snapshot, localOnly });
    } catch {
      return { preserve, discard }; // host hook failure → phase defaults; the resync still finalizes
    }
    if (!resolution) return { preserve, discard };
    const localIds = new Set(localOnly.map((entry) => entry.element.id));
    for (const id of resolution.discard ?? []) {
      if (localIds.has(id)) discard.add(id);
    }
    for (const id of resolution.preserve ?? []) {
      if (!localIds.has(id)) continue;
      preserve.add(id); // preserve wins over discard for the same id
      discard.delete(id);
    }
    return { preserve, discard };
  }

  // ── Fog sync ──

  private onLocalFogChange(event: {
    kind: string;
    tiles?: readonly { x: number; y: number }[];
    origin?: string;
  }): void {
    if (isExternal(event.origin)) return;
    if (!this.fogManager || !this.fogLedger) return;

    const state = this.fogManager.getState();

    if (event.kind === 'definition' || event.kind === 'reset') {
      if (!state) return;
      const meta: FogMetaRecord = {
        version: (this.fogLedger.getMeta()?.version ?? 0) + 1,
        editor: this.clientId,
        definition: state.definition,
      };
      this.fogLedger.applyMeta(meta);
      this.sendOp({ kind: 'fog-meta', record: meta });
    } else if (event.kind === 'disable') {
      const meta: FogMetaRecord = {
        version: (this.fogLedger.getMeta()?.version ?? 0) + 1,
        editor: this.clientId,
      };
      this.fogLedger.applyMeta(meta);
      this.sendOp({ kind: 'fog-meta', record: meta });
    } else if (event.kind === 'tiles' && event.tiles && state) {
      const generation = state.definition.generation;
      const tiles: FogTileRecord[] = [];
      for (const coord of event.tiles) {
        const tile = state.tiles.find((t) => t.x === coord.x && t.y === coord.y);
        const existing = this.fogLedger.getRecord(coord.x, coord.y);
        const version = (existing?.version ?? 0) + 1;
        const record: FogTileRecord = {
          generation,
          x: coord.x,
          y: coord.y,
          version,
          editor: this.clientId,
          data: tile?.data,
        };
        this.fogLedger.applyTile(record);
        tiles.push(record);
      }
      // Split into batches of FOG_PATCH_MAX_TILES
      for (let i = 0; i < tiles.length; i += FOG_PATCH_MAX_TILES) {
        const batch = tiles.slice(i, i + FOG_PATCH_MAX_TILES);
        this.sendOp({ kind: 'fog-patch', generation, tiles: batch });
      }
    }
  }

  private onRemoteFogOp(
    from: string,
    op: Extract<SyncOp, { kind: 'fog-meta' | 'fog-patch' }>,
  ): void {
    if (!this.fogManager || !this.fogLedger) return;

    if (op.kind === 'fog-meta') {
      if (!isValidFogMetaRecord(op.record)) return;
      if (from === HUB_FROM) {
        this.fogLedger.applyMeta(op.record);
      } else if (!this.fogLedger.applyMeta(op.record).accepted) {
        return;
      }
      if (op.record.definition) {
        const currentState = this.fogManager.getState();
        const generationChanged =
          !currentState || currentState.definition.generation !== op.record.definition.generation;
        const fogState: FogStateV1 = {
          definition: op.record.definition,
          tiles: generationChanged ? [] : (currentState?.tiles ?? []),
        };
        this.fogManager.loadState(fogState, { origin: REMOTE_ORIGIN });
      } else {
        this.fogManager.loadState(null, { origin: REMOTE_ORIGIN });
      }
    } else {
      const acceptedDataTiles: { x: number; y: number; data: string }[] = [];
      const removedCoords: { x: number; y: number }[] = [];
      for (const tile of op.tiles) {
        if (!isValidFogTileRecord(tile)) continue;
        const result = this.fogLedger.applyTile(tile);
        if (result.accepted) {
          if (tile.data) {
            acceptedDataTiles.push({ x: tile.x, y: tile.y, data: tile.data });
          } else {
            removedCoords.push({ x: tile.x, y: tile.y });
          }
        }
      }
      if (acceptedDataTiles.length > 0) {
        this.fogManager.applyPatchDirect({ tiles: acceptedDataTiles }, { origin: REMOTE_ORIGIN });
      }
      if (removedCoords.length > 0) {
        const currentState = this.fogManager.getState();
        if (currentState) {
          const removedKeys = new Set(removedCoords.map((c) => `${c.x},${c.y}`));
          const remainingTiles = currentState.tiles.filter(
            (t) => !removedKeys.has(`${t.x},${t.y}`),
          );
          if (remainingTiles.length !== currentState.tiles.length) {
            const updatedState: FogStateV1 = {
              definition: currentState.definition,
              tiles: remainingTiles,
            };
            this.fogManager.loadState(updatedState, { origin: REMOTE_ORIGIN });
          }
        }
      }
    }
  }

  private mergeSnapshotFog(raw: unknown): void {
    if (!this.fogManager || !this.fogLedger) return;
    if (raw === undefined || raw === null) {
      const wasHubKnown = this.fogHubKnown;
      this.fogHubKnown = true;
      if (!this.fogPreserveLocal || wasHubKnown) {
        this.fogManager.loadState(null, { origin: REMOTE_ORIGIN });
        this.fogLedger.clear();
      } else if (this.fogPreserveLocal && this.fogManager.getState()) {
        this.publishLocalFog();
      }
      return;
    }
    if (!isValidFogSnapshot(raw)) return;
    this.fogHubKnown = true;
    this.fogLedger.loadSnapshot(raw);
    if (raw.meta.definition) {
      const tiles = raw.tiles
        .filter((t): t is FogTileRecord & { data: string } => t.data !== undefined)
        .map((t) => ({ x: t.x, y: t.y, data: t.data }));
      const fogState: FogStateV1 = {
        definition: raw.meta.definition,
        tiles,
      };
      this.fogManager.loadState(fogState, { origin: REMOTE_ORIGIN });
    } else {
      this.fogManager.loadState(null, { origin: REMOTE_ORIGIN });
    }
  }

  private publishLocalFog(): void {
    if (!this.fogManager || !this.fogLedger) return;
    const state = this.fogManager.getState();
    if (!state) return;
    const meta: FogMetaRecord = {
      version: (this.fogLedger.getMeta()?.version ?? 0) + 1,
      editor: this.clientId,
      definition: state.definition,
    };
    this.fogLedger.applyMeta(meta);
    this.sendOp({ kind: 'fog-meta', record: meta });
    if (state.tiles.length > 0) {
      const generation = state.definition.generation;
      const tiles: FogTileRecord[] = state.tiles.map((t, i) => ({
        generation,
        x: t.x,
        y: t.y,
        version: i + 1,
        editor: this.clientId,
        data: t.data,
      }));
      for (const tile of tiles) this.fogLedger.applyTile(tile);
      for (let i = 0; i < tiles.length; i += FOG_PATCH_MAX_TILES) {
        this.sendOp({
          kind: 'fog-patch',
          generation,
          tiles: tiles.slice(i, i + FOG_PATCH_MAX_TILES),
        });
      }
    }
  }
}
