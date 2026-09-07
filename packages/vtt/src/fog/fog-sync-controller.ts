import type { FogStateV1 } from './types';
import { FogLedger } from './fog-ledger';
import type {
  FogMetaRecord,
  FogTileRecord,
  FogSnapshot,
  FogSyncManager,
  FogSyncControllerOptions,
  FogSyncControllerEvents,
  FogSyncSessionSnapshot,
  FogSyncOp,
} from './fog-sync-types';
import {
  FOG_PATCH_MAX_TILES,
  isNewerFogRecord,
  isValidFogMetaRecord,
  isValidFogTileRecord,
  isValidFogSnapshot,
  assertValidFogClientId,
} from './fog-sync-types';

const REMOTE_ORIGIN = 'remote';
const HUB_FROM = 'hub';

interface PendingFogEdits {
  meta?: FogMetaRecord;
  readonly tiles: Map<string, FogTileRecord>;
  metaMustReplay: boolean;
  readonly mustReplayTiles: Set<string>;
  state: FogStateV1 | null;
}

export class FogSyncController {
  private readonly clientId: string;
  private readonly manager: FogSyncManager;
  private readonly preserveLocal: boolean;
  private readonly ledger: FogLedger;

  private hubKnown: boolean;
  private pending: PendingFogEdits | null;
  private metaRollback: FogSnapshot | undefined;
  private snapshotPending: boolean;
  private enabled: boolean;
  private disposed: boolean;

  private readonly listeners = new Map<
    keyof FogSyncControllerEvents,
    Set<FogSyncControllerEvents[keyof FogSyncControllerEvents]>
  >();
  private managerUnsub: (() => void) | undefined;

  constructor(options: FogSyncControllerOptions) {
    assertValidFogClientId(options.clientId);
    this.clientId = options.clientId;
    this.manager = options.manager;
    this.preserveLocal = options.preserveLocalWhenRemoteMissing ?? false;
    this.ledger = new FogLedger();

    if (options.sessionSnapshot) {
      const snap = options.sessionSnapshot;
      this.hubKnown = snap.hubKnown;
      this.pending = rebuildPending(snap);
    } else {
      this.hubKnown = false;
      this.pending = null;
    }
    this.metaRollback = undefined;
    this.snapshotPending = true;
    this.enabled = false;
    this.disposed = false;

    this.managerUnsub = this.manager.on('change', (event) => this.onManagerChange(event));
  }

  // ── Event emitter ──

  on<K extends keyof FogSyncControllerEvents>(
    event: K,
    listener: FogSyncControllerEvents[K],
  ): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    const target = set;
    target.add(listener as FogSyncControllerEvents[keyof FogSyncControllerEvents]);
    return () => target.delete(listener as FogSyncControllerEvents[keyof FogSyncControllerEvents]);
  }

  private emit<K extends keyof FogSyncControllerEvents>(
    event: K,
    ...args: Parameters<FogSyncControllerEvents[K]>
  ): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of set) {
      (listener as (...a: unknown[]) => void)(...args);
    }
  }

  private sendOp(op: FogSyncOp): void {
    this.emit('sendOp', op);
  }

  private applyToManager(): void {
    const snapshot = this.ledger.snapshot();
    if (!snapshot?.meta.definition) {
      this.manager.loadState(null, { origin: REMOTE_ORIGIN });
    } else {
      const tiles = snapshot.tiles
        .filter((tile): tile is FogTileRecord & { data: string } => tile.data !== undefined)
        .map((tile) => ({ x: tile.x, y: tile.y, data: tile.data }));
      this.manager.loadState(
        { definition: snapshot.meta.definition, tiles },
        { origin: REMOTE_ORIGIN },
      );
    }
    this.emit('stateChange');
  }

  // ── Lifecycle ──

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  dispose(): void {
    this.disposed = true;
    this.enabled = false;
    this.managerUnsub?.();
    this.managerUnsub = undefined;
    this.listeners.clear();
  }

  // ── Public API ──

  isEnabled(): boolean {
    return this.enabled;
  }

  getLedger(): FogLedger {
    return this.ledger;
  }

  /** Include fog data in an outgoing snapshot op. Returns fog snapshot or undefined. */
  produceSnapshotFog(): FogSnapshot | undefined {
    return this.ledger.snapshot();
  }

  /** Reset state for a reconnect: mark snapshot pending, clear resync state. */
  resetForReconnect(): void {
    this.snapshotPending = true;
  }

  /** Process an incoming fog-meta or fog-patch op from a remote peer or the hub. */
  handleRemoteOp(
    from: string,
    op:
      | { kind: 'fog-meta'; record: FogMetaRecord }
      | { kind: 'fog-patch'; generation: string; tiles: FogTileRecord[] },
  ): void {
    if (op.kind === 'fog-meta') {
      this.handleRemoteMeta(from, op.record);
    } else {
      this.handleRemotePatch(from, op.tiles);
    }
  }

  /**
   * Merge fog data from an authoritative snapshot. Handles pending edits,
   * rollback, and replay of unresolved local edits.
   */
  mergeSnapshot(raw: unknown): void {
    const pending = this.pending;
    this.snapshotPending = false;

    if (raw === undefined || raw === null) {
      this.metaRollback = undefined;
      this.pending = null;
      const wasHubKnown = this.hubKnown;
      this.hubKnown = true;
      if (pending) {
        this.ledger.clear();
        this.publishState(pending.state);
      } else if (!this.preserveLocal || wasHubKnown) {
        this.manager.loadState(null, { origin: REMOTE_ORIGIN });
        this.ledger.clear();
      } else if (this.preserveLocal && this.manager.getState()) {
        this.publishState(this.manager.getState());
      }
      return;
    }

    if (!isValidFogSnapshot(raw)) {
      this.pending = null;
      if (pending) this.replayPending(pending);
      return;
    }

    const unresolved = pending ? this.unresolvedPending(pending, raw) : null;
    this.pending = null;
    this.metaRollback = undefined;
    this.hubKnown = true;
    this.ledger.loadSnapshot(raw);

    if (unresolved) {
      this.replayPending(unresolved);
      return;
    }

    this.applyToManager();
  }

  /**
   * Capture a fog edit made while no SyncClient is active (managed-connection
   * offline window). Records the edit in the ledger and pending state so it
   * can be replayed when a client reconnects.
   */
  captureOfflineChange(event: {
    kind: string;
    tiles?: readonly { x: number; y: number }[];
    origin?: string;
  }): void {
    if (isExternal(event.origin)) return;
    const state = this.manager.getState();
    if (event.kind === 'definition' || event.kind === 'reset' || event.kind === 'disable') {
      const previousGeneration = this.ledger.getMeta()?.definition?.generation;
      const meta: FogMetaRecord = {
        version: (this.ledger.getMeta()?.version ?? 0) + 1,
        editor: this.clientId,
        definition: state?.definition,
      };
      this.ledger.applyMeta(meta);
      const pend = this.pending ?? {
        tiles: new Map<string, FogTileRecord>(),
        metaMustReplay: false,
        mustReplayTiles: new Set<string>(),
        state,
      };
      if (!meta.definition || pend.state?.definition.generation !== meta.definition.generation) {
        pend.tiles.clear();
        pend.mustReplayTiles.clear();
      }
      pend.meta = meta;
      pend.metaMustReplay = true;
      pend.state = state;
      this.pending = pend;
      if (state && previousGeneration !== state.definition.generation) {
        for (const tile of state.tiles) {
          const record: FogTileRecord = {
            generation: state.definition.generation,
            x: tile.x,
            y: tile.y,
            version: 1,
            editor: this.clientId,
            data: tile.data,
          };
          this.ledger.applyTile(record);
          const key = `${tile.x},${tile.y}`;
          pend.tiles.set(key, record);
          pend.mustReplayTiles.add(key);
        }
      }
      return;
    }
    if (event.kind !== 'tiles' || !event.tiles || !state) return;
    const dataByKey = new Map(state.tiles.map((tile) => [`${tile.x},${tile.y}`, tile.data]));
    const pend = this.pending ?? {
      tiles: new Map<string, FogTileRecord>(),
      metaMustReplay: false,
      mustReplayTiles: new Set<string>(),
      state,
    };
    for (const coord of event.tiles) {
      const previous = this.ledger.getRecord(coord.x, coord.y);
      const data = dataByKey.get(`${coord.x},${coord.y}`);
      const record: FogTileRecord = {
        generation: state.definition.generation,
        x: coord.x,
        y: coord.y,
        version: (previous?.version ?? 0) + 1,
        editor: this.clientId,
        ...(data === undefined ? {} : { data }),
      };
      this.ledger.applyTile(record);
      const key = `${coord.x},${coord.y}`;
      pend.tiles.set(key, record);
      pend.mustReplayTiles.add(key);
    }
    pend.state = state;
    this.pending = pend;
  }

  /** Serialize session state for cross-reconnect persistence. */
  snapshotSession(): FogSyncSessionSnapshot {
    const pendingTiles: FogTileRecord[] = [];
    const mustReplayKeys: string[] = [];
    if (this.pending) {
      for (const [key, tile] of this.pending.tiles) {
        pendingTiles.push(tile);
        if (this.pending.mustReplayTiles.has(key)) mustReplayKeys.push(key);
      }
    }
    return {
      hubKnown: this.hubKnown,
      ...(this.pending?.meta ? { pendingMeta: this.pending.meta } : {}),
      pendingTiles,
      metaMustReplay: this.pending?.metaMustReplay ?? false,
      mustReplayTileKeys: mustReplayKeys,
      pendingState: this.pending?.state ?? null,
    };
  }

  // ── Local fog change handler ──

  private onManagerChange(event: {
    kind: string;
    tiles?: readonly { x: number; y: number }[];
    origin?: string;
  }): void {
    if (!this.enabled || this.disposed) return;
    if (isExternal(event.origin)) return;

    const state = this.manager.getState();

    if (event.kind === 'definition' || event.kind === 'reset') {
      if (!state) return;
      const previousGeneration = this.ledger.getMeta()?.definition?.generation;
      this.metaRollback ??= this.ledger.snapshot();
      const meta: FogMetaRecord = {
        version: (this.ledger.getMeta()?.version ?? 0) + 1,
        editor: this.clientId,
        definition: state.definition,
      };
      this.ledger.applyMeta(meta);
      this.rememberMeta(meta, state);
      this.sendOp({ kind: 'fog-meta', record: meta });
      if (previousGeneration !== state.definition.generation && state.tiles.length > 0) {
        const tiles = state.tiles.map((tile) => ({
          generation: state.definition.generation,
          x: tile.x,
          y: tile.y,
          version: 1,
          editor: this.clientId,
          data: tile.data,
        }));
        for (const tile of tiles) this.ledger.applyTile(tile);
        this.rememberTiles(tiles, state);
        this.sendTileBatches(tiles);
      }
    } else if (event.kind === 'disable') {
      this.metaRollback ??= this.ledger.snapshot();
      const meta: FogMetaRecord = {
        version: (this.ledger.getMeta()?.version ?? 0) + 1,
        editor: this.clientId,
      };
      this.ledger.applyMeta(meta);
      this.rememberMeta(meta, null);
      this.sendOp({ kind: 'fog-meta', record: meta });
    } else if (event.kind === 'tiles' && event.tiles && state) {
      const generation = state.definition.generation;
      const tiles: FogTileRecord[] = [];
      for (const coord of event.tiles) {
        const tile = state.tiles.find((t) => t.x === coord.x && t.y === coord.y);
        const existing = this.ledger.getRecord(coord.x, coord.y);
        const version = (existing?.version ?? 0) + 1;
        const record: FogTileRecord = {
          generation,
          x: coord.x,
          y: coord.y,
          version,
          editor: this.clientId,
          data: tile?.data,
        };
        this.ledger.applyTile(record);
        tiles.push(record);
      }
      this.rememberTiles(tiles, state);
      this.sendTileBatches(tiles);
    }
  }

  // ── Remote fog op handlers ──

  private handleRemoteMeta(from: string, record: FogMetaRecord): void {
    if (!isValidFogMetaRecord(record)) return;

    if (from === HUB_FROM) {
      const wasSnapshotPending = this.snapshotPending;
      const rollback = this.metaRollback;
      const tiles =
        rollback && rollback.meta.definition?.generation === record.definition?.generation
          ? rollback.tiles
          : [];
      this.ledger.loadSnapshot({ meta: record, tiles });
      this.metaRollback = undefined;
      this.applyToManager();
      if (wasSnapshotPending) this.protectAfterMeta(record);
      else this.pending = null;
      this.sendOp({ kind: 'request-snapshot' });
      return;
    }

    if (!this.ledger.applyMeta(record).accepted) return;

    if (this.snapshotPending) this.protectAfterMeta(record);
    else this.retireAfterMeta(record);
    this.metaRollback = undefined;
    this.applyToManager();
  }

  private handleRemotePatch(from: string, tiles: readonly FogTileRecord[]): void {
    let changed = false;
    for (const tile of tiles) {
      if (!isValidFogTileRecord(tile)) continue;
      if (from === HUB_FROM) {
        const accepted = this.ledger.applyAuthoritative(tile);
        if (accepted) {
          if (this.snapshotPending) this.protectTile(tile);
          else this.retireTile(tile, true);
        }
        changed = accepted || changed;
      } else {
        const accepted = this.ledger.applyTile(tile).accepted;
        if (accepted) {
          if (this.snapshotPending) this.protectTile(tile);
          else this.retireTile(tile, false);
        }
        changed = accepted || changed;
      }
    }
    if (changed) this.applyToManager();
  }

  // ── Pending edits management ──

  private rememberMeta(meta: FogMetaRecord, state: FogStateV1 | null): void {
    const pend: PendingFogEdits = this.pending ?? {
      tiles: new Map<string, FogTileRecord>(),
      metaMustReplay: false,
      mustReplayTiles: new Set<string>(),
      state,
    };
    const previousGeneration = pend.state?.definition.generation;
    if (
      !meta.definition ||
      (previousGeneration && previousGeneration !== meta.definition.generation)
    ) {
      pend.tiles.clear();
      pend.mustReplayTiles.clear();
    }
    pend.meta = meta;
    if (this.snapshotPending) pend.metaMustReplay = true;
    pend.state = state;
    this.pending = pend;
  }

  private rememberTiles(tiles: readonly FogTileRecord[], state: FogStateV1): void {
    const pend: PendingFogEdits = this.pending ?? {
      tiles: new Map<string, FogTileRecord>(),
      metaMustReplay: false,
      mustReplayTiles: new Set<string>(),
      state,
    };
    for (const tile of tiles) {
      const key = `${tile.x},${tile.y}`;
      pend.tiles.set(key, tile);
      if (this.snapshotPending) pend.mustReplayTiles.add(key);
    }
    pend.state = state;
    this.pending = pend;
  }

  private retireAfterMeta(record: FogMetaRecord): void {
    const pending = this.pending;
    if (!pending) return;
    delete pending.meta;
    pending.metaMustReplay = false;
    const generation = record.definition?.generation;
    for (const [key, tile] of pending.tiles) {
      if (!generation || tile.generation !== generation) {
        pending.tiles.delete(key);
        pending.mustReplayTiles.delete(key);
      }
    }
    if (pending.tiles.size === 0) this.pending = null;
  }

  private retireTile(record: FogTileRecord, authoritative: boolean): void {
    const pending = this.pending;
    if (!pending) return;
    const key = `${record.x},${record.y}`;
    const local = pending.tiles.get(key);
    if (!local) return;
    const sameOrdering = record.version === local.version && record.editor === local.editor;
    if (
      authoritative ||
      isNewerFogRecord(record, local) ||
      (sameOrdering && record.generation === local.generation && record.data === local.data)
    ) {
      pending.tiles.delete(key);
      pending.mustReplayTiles.delete(key);
      if (!pending.meta && pending.tiles.size === 0) this.pending = null;
    }
  }

  private protectAfterMeta(record: FogMetaRecord): void {
    const pending = this.pending;
    if (!pending) return;
    if (pending.meta) pending.metaMustReplay = true;
    const pendingGeneration = pending.meta?.definition?.generation;
    const activeGeneration = record.definition?.generation;
    for (const [key, tile] of pending.tiles) {
      if (tile.generation === pendingGeneration || tile.generation === activeGeneration) {
        pending.mustReplayTiles.add(key);
      }
    }
  }

  private protectTile(record: FogTileRecord): void {
    const pending = this.pending;
    if (!pending) return;
    const key = `${record.x},${record.y}`;
    if (pending.tiles.has(key)) pending.mustReplayTiles.add(key);
  }

  private unresolvedPending(
    pending: PendingFogEdits,
    snapshot: FogSnapshot,
  ): PendingFogEdits | null {
    const retainedMeta =
      pending.meta && (pending.metaMustReplay || isNewerFogRecord(pending.meta, snapshot.meta))
        ? pending.meta
        : undefined;
    const snapshotGeneration = snapshot.meta.definition?.generation;
    const retainedGeneration = retainedMeta?.definition?.generation;
    const snapshotTiles = new Map(snapshot.tiles.map((tile) => [`${tile.x},${tile.y}`, tile]));
    const tiles = new Map<string, FogTileRecord>();
    const mustReplayTiles = new Set<string>();

    for (const [key, tile] of pending.tiles) {
      if (tile.generation !== snapshotGeneration && tile.generation !== retainedGeneration)
        continue;
      const authoritative = snapshotTiles.get(key);
      const mustReplay = pending.mustReplayTiles.has(key);
      if (!mustReplay && authoritative && !isNewerFogRecord(tile, authoritative)) continue;
      tiles.set(key, tile);
      if (mustReplay) mustReplayTiles.add(key);
    }

    if (!retainedMeta && tiles.size === 0) return null;
    return {
      ...(retainedMeta ? { meta: retainedMeta } : {}),
      tiles,
      metaMustReplay: pending.metaMustReplay && retainedMeta !== undefined,
      mustReplayTiles,
      state: pending.state,
    };
  }

  private replayPending(pending: PendingFogEdits): void {
    const pendingMeta = pending.meta;

    let acceptedMeta: FogMetaRecord | undefined;
    if (pendingMeta) {
      const currentVersion = this.ledger.getMeta()?.version ?? 0;
      const rebased = {
        ...pendingMeta,
        version: Math.max(pendingMeta.version, currentVersion + 1),
        editor: this.clientId,
      };
      if (this.ledger.applyMeta(rebased).accepted) acceptedMeta = rebased;
    }

    const acceptedTiles: FogTileRecord[] = [];
    const activeGeneration = this.ledger.getMeta()?.definition?.generation;
    for (const tile of pending.tiles.values()) {
      if (!activeGeneration || tile.generation !== activeGeneration) continue;
      const currentVersion = this.ledger.getRecord(tile.x, tile.y)?.version ?? 0;
      const rebased = {
        ...tile,
        version: Math.max(tile.version, currentVersion + 1),
        editor: this.clientId,
      };
      if (this.ledger.applyTile(rebased).accepted) acceptedTiles.push(rebased);
    }
    this.applyToManager();
    if (acceptedMeta) this.sendOp({ kind: 'fog-meta', record: acceptedMeta });
    this.sendTileBatches(acceptedTiles);
  }

  // ── Helpers ──

  private publishState(state: FogStateV1 | null): void {
    const meta: FogMetaRecord = {
      version: (this.ledger.getMeta()?.version ?? 0) + 1,
      editor: this.clientId,
      definition: state?.definition,
    };
    this.ledger.applyMeta(meta);
    this.sendOp({ kind: 'fog-meta', record: meta });
    if (state && state.tiles.length > 0) {
      const tiles: FogTileRecord[] = state.tiles.map((t) => ({
        generation: state.definition.generation,
        x: t.x,
        y: t.y,
        version: (this.ledger.getRecord(t.x, t.y)?.version ?? 0) + 1,
        editor: this.clientId,
        data: t.data,
      }));
      for (const tile of tiles) this.ledger.applyTile(tile);
      this.sendTileBatches(tiles);
    }
  }

  private sendTileBatches(tiles: readonly FogTileRecord[]): void {
    for (let i = 0; i < tiles.length; i += FOG_PATCH_MAX_TILES) {
      const batch = tiles.slice(i, i + FOG_PATCH_MAX_TILES);
      const generation = batch[0]?.generation;
      if (!generation) continue;
      this.sendOp({ kind: 'fog-patch', generation, tiles: [...batch] });
    }
  }
}

function isExternal(origin: string | undefined): boolean {
  return origin !== undefined && origin !== 'local';
}

function rebuildPending(snap: FogSyncSessionSnapshot): PendingFogEdits | null {
  if (!snap.pendingMeta && snap.pendingTiles.length === 0) return null;
  const tiles = new Map<string, FogTileRecord>();
  for (const tile of snap.pendingTiles) {
    tiles.set(`${tile.x},${tile.y}`, tile);
  }
  const mustReplayTiles = new Set(snap.mustReplayTileKeys);
  return {
    ...(snap.pendingMeta ? { meta: snap.pendingMeta } : {}),
    tiles,
    metaMustReplay: snap.metaMustReplay,
    mustReplayTiles,
    state: snap.pendingState,
  };
}
