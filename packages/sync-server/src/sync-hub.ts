import {
  parseEnvelope,
  isValidElement,
  isNewerLayerRecord,
  FogLedger,
  type LayerRecord,
  type SyncOp,
  type SyncEnvelope,
  type FogMetaRecord,
  type FogTileRecord,
  type FogSnapshot,
} from '@fieldnotes/sync';
import { MemoryHubBackend } from './memory-hub-backend';
import { InMemoryHubFanout, type HubFanout } from './hub-fanout';
import type { HubBackend } from './hub-backend';
import type { Authorize, AuthorizeLayer, AuthorizeFog, CanRead, OwnedElement } from './authorize';
import {
  DEFAULT_MAX_JSON_DEPTH,
  DEFAULT_MAX_PRESENCE_LANES,
  DEFAULT_PRESENCE_THROTTLE_MS,
  hasJsonDepthAtMost,
} from './resource-limits';

export interface Connection {
  id: string;
  room: string;
  userId?: string;
  role?: string;
  send(message: string): void;
}

export interface SyncHubOptions {
  backend?: HubBackend;
  fanout?: HubFanout;
  instanceId?: string;
  authorize?: Authorize;
  authorizeLayer?: AuthorizeLayer;
  authorizeFog?: AuthorizeFog;
  canRead?: CanRead;
  maxJsonDepth?: number;
  presenceThrottleMs?: number;
  maxPresenceLanes?: number;
}

const HUB_FROM = 'hub';

function generateInstanceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    return crypto.randomUUID();
  return `i-${Math.random().toString(36).slice(2)}`;
}

function isFanoutOp(op: unknown): op is Extract<SyncOp, { kind: 'upsert' | 'remove' | 'clear' }> {
  if (typeof op !== 'object' || op === null) return false;
  const o = op as { kind?: unknown; element?: unknown; id?: unknown };
  if (o.kind === 'upsert') return isValidElement(o.element);
  if (o.kind === 'remove') return typeof o.id === 'string';
  return o.kind === 'clear';
}

type LayerOp = Extract<SyncOp, { kind: 'layer-upsert' | 'layer-remove' }>;

interface PresenceLane {
  lastSentAt: number | undefined;
  pending: { data: unknown; timer: ReturnType<typeof setTimeout> } | null;
}

const FALLBACK_PRESENCE_LANE = '';
const MAX_PRESENCE_LANE_LENGTH = 64;

function presenceLaneOf(data: unknown): string {
  if (typeof data !== 'object' || data === null) return FALLBACK_PRESENCE_LANE;
  const kind = (data as { kind?: unknown }).kind;
  if (typeof kind !== 'string' || kind.length === 0 || kind.length > MAX_PRESENCE_LANE_LENGTH) {
    return FALLBACK_PRESENCE_LANE;
  }
  return kind;
}

function isLayerOp(op: unknown): op is LayerOp {
  if (typeof op !== 'object' || op === null) return false;
  const k = (op as { kind?: unknown }).kind;
  // Shape is re-validated by parseEnvelope on the serial path; fanout payloads
  // come from a sibling hub that already validated them.
  return k === 'layer-upsert' || k === 'layer-remove';
}

function layerOpToRecord(op: LayerOp): LayerRecord {
  return op.kind === 'layer-upsert'
    ? { id: op.layer.id, version: op.version, editor: op.editor, definition: op.layer }
    : { id: op.id, version: op.version, editor: op.editor };
}

function layerRecordToOp(record: LayerRecord): LayerOp {
  return record.definition
    ? {
        kind: 'layer-upsert',
        layer: record.definition,
        version: record.version,
        editor: record.editor,
      }
    : { kind: 'layer-remove', id: record.id, version: record.version, editor: record.editor };
}

function isPresenceOp(
  op: unknown,
): op is { kind: 'presence'; data: unknown } | { kind: 'presence-leave' } {
  if (typeof op !== 'object' || op === null) return false;
  const k = (op as { kind?: unknown }).kind;
  return k === 'presence' || k === 'presence-leave';
}

export class SyncHub {
  private readonly backend: HubBackend;
  private readonly conns = new Map<string, Connection>();
  private readonly rooms = new Map<string, Set<string>>(); // room → connIds
  private readonly roomQueues = new Map<string, Promise<void>>(); // room → serial tail
  private readonly presenceConnections = new Set<string>();
  private readonly instanceId: string;
  private readonly fanout: HubFanout;
  private readonly fanoutUnsub: () => void;
  private readonly authorize?: Authorize;
  private readonly authorizeLayer?: AuthorizeLayer;
  private readonly authorizeFog?: AuthorizeFog;
  private readonly canRead?: CanRead;
  private readonly memoryLayers = new Map<string, Map<string, LayerRecord>>();
  private readonly memoryFog = new Map<string, FogLedger>();
  private readonly maxJsonDepth: number;
  private readonly presenceThrottleMs: number;
  private readonly maxPresenceLanes: number;
  /**
   * Presence throttle state keyed by connection, then by lane. A lane is the
   * payload's `kind` (a non-empty string of at most 64 chars) or the reserved
   * fallback lane `''`, so a rapid stream of one kind (awareness cursors) can
   * never replace a pending frame of another kind (a ping, a path `cleared`).
   * Within a lane the newest payload wins. The lane count per connection is
   * capped by `maxPresenceLanes`, counting the fallback lane, so a client
   * cannot mint timers by varying `kind`.
   */
  private readonly presenceLanes = new Map<string, Map<string, PresenceLane>>();

  constructor(options: SyncHubOptions = {}) {
    this.backend = options.backend ?? new MemoryHubBackend();
    this.instanceId = options.instanceId ?? generateInstanceId();
    this.fanout = options.fanout ?? new InMemoryHubFanout();
    this.authorize = options.authorize;
    this.authorizeLayer = options.authorizeLayer;
    this.authorizeFog = options.authorizeFog;
    this.canRead = options.canRead;
    this.maxJsonDepth = options.maxJsonDepth ?? DEFAULT_MAX_JSON_DEPTH;
    this.presenceThrottleMs = options.presenceThrottleMs ?? DEFAULT_PRESENCE_THROTTLE_MS;
    const maxPresenceLanes = options.maxPresenceLanes ?? DEFAULT_MAX_PRESENCE_LANES;
    if (!Number.isFinite(maxPresenceLanes) || maxPresenceLanes < 1) {
      throw new RangeError('maxPresenceLanes must be a finite number of at least 1');
    }
    this.maxPresenceLanes = Math.floor(maxPresenceLanes);
    this.fanoutUnsub = this.fanout.subscribe((payload) => this.onFanout(payload));
  }

  addConnection(conn: Connection): void {
    this.conns.set(conn.id, conn);
    let set = this.rooms.get(conn.room);
    if (!set) {
      set = new Set();
      this.rooms.set(conn.room, set);
    }
    set.add(conn.id);
  }

  removeConnection(connId: string): void {
    const conn = this.conns.get(connId);
    if (!conn) return;
    this.conns.delete(connId);
    const room = conn.room;
    const hadPresence = this.presenceConnections.delete(connId);
    this.clearPresenceLanes(connId);
    const members = this.rooms.get(room);
    if (members) {
      members.delete(connId);
      if (members.size === 0) {
        this.rooms.delete(room);
        this.roomQueues.delete(room);
      }
    }
    if (hadPresence) this.broadcastLeave(room, conn.id);
  }

  roomCount(): number {
    return this.rooms.size;
  }

  /**
   * Broadcasts ephemeral server-owned presence data to every connection in a room.
   * The returned count covers successful delivery on this hub instance only; configured fan-out
   * forwards the same event to other instances on a best-effort basis.
   */
  broadcastPresence<T>(room: string, data: T): number {
    const op = { kind: 'presence' as const, data };
    const sent = this.relayToRoom(room, undefined, JSON.stringify({ from: HUB_FROM, op }));
    this.safePublish(JSON.stringify({ o: this.instanceId, room, from: HUB_FROM, op }));
    return sent;
  }

  handleMessage(connId: string, message: string): Promise<void> {
    const conn = this.conns.get(connId);
    if (!conn) return Promise.resolve();
    if (!hasJsonDepthAtMost(message, this.maxJsonDepth)) return Promise.resolve();
    const env = parseEnvelope(message);
    if (!env) return Promise.resolve();
    if (env.op.kind === 'presence') {
      this.schedulePresence(conn, env.op.data); // off-queue, throttled independently
      return Promise.resolve();
    }
    const room = conn.room;
    // The per-room serial queue is the single total-order authority: ops apply in arrival order
    // (arrival-order LWW — no per-element seq; see D3 / TD-12). Different rooms run independently.
    const prev = this.roomQueues.get(room) ?? Promise.resolve();
    const operation = prev.then(() => this.process(conn, env));
    this.roomQueues.set(
      room,
      operation.catch(() => {
        // Recover only the internal tail so one failed message never wedges the room queue.
        // The caller still receives the operation rejection for observability.
      }),
    );
    return operation;
  }

  private async process(conn: Connection, env: SyncEnvelope): Promise<void> {
    const op = env.op;
    if (op.kind === 'request-snapshot') {
      const all = (await this.backend.snapshot(conn.room)) as OwnedElement[];
      const elements = this.canRead ? all.filter((el) => this.mayRead(conn, el.audience)) : all;
      // Layer records are presentation-only and carry no element bytes, so no
      // audience filter applies; the field is omitted while a room has never
      // used layer sync, keeping snapshot frames byte-identical to before.
      const layers = await this.getLayerRecords(conn.room);
      const fog = await this.getFogSnapshot(conn.room);
      const snapshotOp: Record<string, unknown> = {
        kind: 'snapshot',
        to: env.from,
        elements,
      };
      if (layers.length > 0) snapshotOp['layers'] = layers;
      if (fog) snapshotOp['fog'] = fog;
      conn.send(JSON.stringify({ from: HUB_FROM, op: snapshotOp }));
    } else if (op.kind === 'layer-upsert' || op.kind === 'layer-remove') {
      await this.processLayerOp(conn, op);
    } else if (op.kind === 'fog-meta' || op.kind === 'fog-patch') {
      await this.processFogOp(conn, op);
    } else if (op.kind === 'upsert' || op.kind === 'remove' || op.kind === 'clear') {
      const id = op.kind === 'upsert' ? op.element.id : op.kind === 'remove' ? op.id : undefined;
      const needCurrent = (this.authorize || this.canRead) && id !== undefined;
      const current: OwnedElement | undefined = needCurrent
        ? await this.backend.get(conn.room, id)
        : undefined;

      let outboundOp: SyncOp = op;
      if (this.authorize) {
        const allowed = await this.authorize({
          userId: conn.userId,
          role: conn.role,
          room: conn.room,
          op,
          currentElement: current,
        });
        if (!allowed) {
          await this.sendCorrection(conn, env.from, op, current);
          return;
        }
        if (op.kind === 'upsert') {
          const ownerId = current?.ownerId ?? conn.userId;
          const stampedElement: OwnedElement = { ...op.element, ownerId };
          outboundOp = { kind: 'upsert', element: stampedElement };
        }
      }

      await this.backend.apply(conn.room, outboundOp);

      const prevExisted = current !== undefined;
      const prevAudience = current?.audience;

      await this.fanout.publish(
        JSON.stringify({
          o: this.instanceId,
          room: conn.room,
          from: conn.id,
          op: outboundOp,
          prev: prevAudience,
          existed: prevExisted,
        }),
      );

      this.deliverToRoom(conn.room, conn.id, conn.id, outboundOp, prevAudience, prevExisted);
    }
    // 'snapshot' from a client → ignored
  }

  /**
   * Applies a layer-definition edit on the room's serial queue. Convergence is
   * last-writer-wins under the deterministic (version, editor) ordering — the
   * same rule every client applies — so arrival order never decides a race. A
   * stale or denied edit is answered with an authoritative correction to the
   * sender only.
   */
  private async processLayerOp(conn: Connection, op: LayerOp): Promise<void> {
    const record = layerOpToRecord(op);
    const current = await this.getLayerRecord(conn.room, record.id);
    if (this.authorizeLayer) {
      const allowed = await this.authorizeLayer({
        userId: conn.userId,
        role: conn.role,
        room: conn.room,
        op,
        currentRecord: current,
      });
      if (!allowed) {
        // Revert the sender to the room's record; a tombstone when there is
        // none, so the denied local edit disappears everywhere consistently.
        const correction = current ?? { id: record.id, version: record.version, editor: HUB_FROM };
        conn.send(JSON.stringify({ from: HUB_FROM, op: layerRecordToOp(correction) }));
        return;
      }
    }
    if (current && !isNewerLayerRecord(record, current)) {
      // Stale under (version, editor): converge the sender, do not broadcast.
      conn.send(JSON.stringify({ from: HUB_FROM, op: layerRecordToOp(current) }));
      return;
    }
    await this.applyLayerRecord(conn.room, record);
    await this.fanout.publish(
      JSON.stringify({ o: this.instanceId, room: conn.room, from: conn.id, op }),
    );
    this.relayToRoom(conn.room, conn.id, JSON.stringify({ from: conn.id, op }));
  }

  private layerBackend(): Required<
    Pick<HubBackend, 'layerRecords' | 'getLayerRecord' | 'applyLayerRecord'>
  > | null {
    const { layerRecords, getLayerRecord, applyLayerRecord } = this.backend;
    if (!layerRecords || !getLayerRecord || !applyLayerRecord) return null;
    return {
      layerRecords: layerRecords.bind(this.backend),
      getLayerRecord: getLayerRecord.bind(this.backend),
      applyLayerRecord: applyLayerRecord.bind(this.backend),
    };
  }

  private async getLayerRecords(room: string): Promise<LayerRecord[]> {
    const backend = this.layerBackend();
    if (backend) return backend.layerRecords(room);
    return [...(this.memoryLayers.get(room)?.values() ?? [])];
  }

  private async getLayerRecord(room: string, id: string): Promise<LayerRecord | undefined> {
    const backend = this.layerBackend();
    if (backend) return backend.getLayerRecord(room, id);
    return this.memoryLayers.get(room)?.get(id);
  }

  private async applyLayerRecord(room: string, record: LayerRecord): Promise<void> {
    const backend = this.layerBackend();
    if (backend) {
      await backend.applyLayerRecord(room, record);
      return;
    }
    let map = this.memoryLayers.get(room);
    if (!map) {
      map = new Map();
      this.memoryLayers.set(room, map);
    }
    map.set(record.id, record);
  }

  // ── Fog processing ──

  private fogBackend(): Required<
    Pick<HubBackend, 'fogSnapshot' | 'applyFogMeta' | 'applyFogTile'>
  > | null {
    const { fogSnapshot, applyFogMeta, applyFogTile } = this.backend;
    if (!fogSnapshot || !applyFogMeta || !applyFogTile) return null;
    return {
      fogSnapshot: fogSnapshot.bind(this.backend),
      applyFogMeta: applyFogMeta.bind(this.backend),
      applyFogTile: applyFogTile.bind(this.backend),
    };
  }

  private getFogLedger(room: string): FogLedger {
    let ledger = this.memoryFog.get(room);
    if (!ledger) {
      ledger = new FogLedger();
      this.memoryFog.set(room, ledger);
    }
    return ledger;
  }

  private async getFogSnapshot(room: string): Promise<FogSnapshot | undefined> {
    const backend = this.fogBackend();
    if (backend) return backend.fogSnapshot(room);
    return this.getFogLedger(room).snapshot();
  }

  private async applyFogMeta(room: string, record: FogMetaRecord): Promise<void> {
    const backend = this.fogBackend();
    if (backend) {
      await backend.applyFogMeta(room, record);
      return;
    }
    this.getFogLedger(room).applyMeta(record);
  }

  private async applyFogTile(room: string, record: FogTileRecord): Promise<void> {
    const backend = this.fogBackend();
    if (backend) {
      await backend.applyFogTile(room, record);
      return;
    }
    this.getFogLedger(room).applyTile(record);
  }

  private async processFogOp(
    conn: Connection,
    op: Extract<SyncOp, { kind: 'fog-meta' | 'fog-patch' }>,
  ): Promise<void> {
    const current = await this.getFogSnapshot(conn.room);

    if (this.authorizeFog) {
      const allowed = await this.authorizeFog({
        userId: conn.userId,
        role: conn.role,
        room: conn.room,
        op,
        current,
      });
      if (!allowed) {
        if (op.kind === 'fog-meta' && current?.meta) {
          conn.send(
            JSON.stringify({ from: HUB_FROM, op: { kind: 'fog-meta', record: current.meta } }),
          );
        } else if (op.kind === 'fog-patch' && current) {
          const corrections = op.tiles.map((t) => {
            const existing = current.tiles.find((ct) => ct.x === t.x && ct.y === t.y);
            return (
              existing ?? { generation: op.generation, x: t.x, y: t.y, version: 0, editor: '' }
            );
          });
          conn.send(
            JSON.stringify({
              from: HUB_FROM,
              op: { kind: 'fog-patch', generation: op.generation, tiles: corrections },
            }),
          );
        }
        return;
      }
    }

    if (op.kind === 'fog-meta') {
      const ledger = this.getFogLedger(conn.room);
      const result = ledger.applyMeta(op.record);
      if (!result.accepted) {
        if (result.correction) {
          conn.send(
            JSON.stringify({ from: HUB_FROM, op: { kind: 'fog-meta', record: result.correction } }),
          );
        }
        return;
      }
      await this.applyFogMeta(conn.room, op.record);
    } else {
      const ledger = this.getFogLedger(conn.room);
      const corrections: FogTileRecord[] = [];
      let anyAccepted = false;
      for (const tile of op.tiles) {
        const result = ledger.applyTile(tile);
        if (result.accepted) {
          anyAccepted = true;
          await this.applyFogTile(conn.room, tile);
        } else if (result.correction) {
          corrections.push(result.correction);
        }
      }
      if (corrections.length > 0) {
        conn.send(
          JSON.stringify({
            from: HUB_FROM,
            op: { kind: 'fog-patch', generation: op.generation, tiles: corrections },
          }),
        );
      }
      if (!anyAccepted) return;
    }

    await this.fanout.publish(
      JSON.stringify({ o: this.instanceId, room: conn.room, from: conn.id, op }),
    );
    this.relayToRoom(conn.room, conn.id, JSON.stringify({ from: conn.id, op }));
  }

  private mayRead(conn: Connection, audience: string | undefined): boolean {
    if (!this.canRead) return true;
    return this.canRead({ userId: conn.userId, role: conn.role, room: conn.room, audience });
  }

  private safePublish(payload: string): void {
    try {
      void Promise.resolve(this.fanout.publish(payload)).catch(() => {
        /* presence is ephemeral; a broken publisher must not create an unhandled rejection */
      });
    } catch {
      /* a broken fanout publisher must not break the un-queued presence relay */
    }
  }

  private relayToRoom(room: string, excludeId: string | undefined, message: string): number {
    const members = this.rooms.get(room);
    if (!members) return 0;
    let sent = 0;
    for (const cid of members) {
      if (cid === excludeId) continue;
      const conn = this.conns.get(cid);
      if (!conn) continue;
      try {
        conn.send(message);
        sent += 1;
      } catch {
        /* a throwing socket must not break the relay loop */
      }
    }
    return sent;
  }

  private broadcastClientPresence(conn: Connection, data: unknown): void {
    this.presenceConnections.add(conn.id);
    const message = JSON.stringify({ from: conn.id, op: { kind: 'presence', data } });
    this.relayToRoom(conn.room, conn.id, message);
    this.safePublish(
      JSON.stringify({
        o: this.instanceId,
        room: conn.room,
        from: conn.id,
        op: { kind: 'presence', data },
      }),
    );
  }

  private clearPresenceLanes(connId: string): void {
    const lanes = this.presenceLanes.get(connId);
    if (!lanes) return;
    for (const lane of lanes.values()) {
      if (lane.pending) clearTimeout(lane.pending.timer);
    }
    this.presenceLanes.delete(connId);
  }

  private schedulePresence(conn: Connection, data: unknown): void {
    if (this.presenceThrottleMs <= 0) {
      this.broadcastClientPresence(conn, data);
      return;
    }
    const lane = this.presenceLaneFor(conn.id, presenceLaneOf(data));
    const now = Date.now();
    if (lane.lastSentAt === undefined || now - lane.lastSentAt >= this.presenceThrottleMs) {
      if (lane.pending) {
        clearTimeout(lane.pending.timer);
        lane.pending = null;
      }
      lane.lastSentAt = now;
      this.broadcastClientPresence(conn, data);
      return;
    }
    if (lane.pending) {
      lane.pending.data = data;
      return;
    }
    const timer = setTimeout(
      () => {
        const pending = lane.pending;
        lane.pending = null;
        if (!pending || !this.conns.has(conn.id)) return;
        lane.lastSentAt = Date.now();
        this.broadcastClientPresence(conn, pending.data);
      },
      this.presenceThrottleMs - (now - lane.lastSentAt),
    );
    lane.pending = { data, timer };
  }

  private presenceLaneFor(connId: string, requested: string): PresenceLane {
    let lanes = this.presenceLanes.get(connId);
    if (!lanes) {
      lanes = new Map();
      this.presenceLanes.set(connId, lanes);
    }
    let key = requested;
    if (key !== FALLBACK_PRESENCE_LANE && !lanes.has(key)) {
      const named = lanes.size - (lanes.has(FALLBACK_PRESENCE_LANE) ? 1 : 0);
      if (named >= this.maxPresenceLanes - 1) key = FALLBACK_PRESENCE_LANE;
    }
    let lane = lanes.get(key);
    if (!lane) {
      lane = { lastSentAt: undefined, pending: null };
      lanes.set(key, lane);
    }
    return lane;
  }

  private broadcastLeave(room: string, from: string): void {
    const message = JSON.stringify({ from, op: { kind: 'presence-leave' } });
    this.relayToRoom(room, undefined, message);
    this.safePublish(
      JSON.stringify({ o: this.instanceId, room, from, op: { kind: 'presence-leave' } }),
    );
  }

  private deliverToRoom(
    room: string,
    excludeId: string | undefined,
    from: string,
    op: SyncOp,
    prevAudience: string | undefined,
    prevExisted: boolean,
  ): void {
    const members = this.rooms.get(room);
    if (!members) return;
    const send = (conn: Connection, msg: string): void => {
      try {
        conn.send(msg);
      } catch {
        /* a throwing socket must not break the delivery loop */
      }
    };
    if (op.kind === 'upsert') {
      const audience = (op.element as OwnedElement).audience;
      const upsertMsg = JSON.stringify({ from, op });
      const removeMsg = JSON.stringify({
        from: HUB_FROM,
        op: { kind: 'remove', id: op.element.id },
      });
      for (const cid of members) {
        if (cid === excludeId) continue;
        const conn = this.conns.get(cid);
        if (!conn) continue;
        if (this.mayRead(conn, audience)) send(conn, upsertMsg);
        else if (prevExisted && this.mayRead(conn, prevAudience)) send(conn, removeMsg);
      }
    } else if (op.kind === 'remove') {
      const removeMsg = JSON.stringify({ from, op });
      for (const cid of members) {
        if (cid === excludeId) continue;
        const conn = this.conns.get(cid);
        if (!conn) continue;
        // No read filter → forward to all (today's behavior; current/prevExisted aren't fetched without
        // a hook). With canRead, only recipients who could see the removed element get it.
        const wasVisible = !this.canRead || (prevExisted && this.mayRead(conn, prevAudience));
        if (wasVisible) send(conn, removeMsg);
      }
    } else if (op.kind === 'clear') {
      const clearMsg = JSON.stringify({ from, op });
      for (const cid of members) {
        if (cid === excludeId) continue;
        const conn = this.conns.get(cid);
        if (conn) send(conn, clearMsg);
      }
    }
  }

  private async sendCorrection(
    conn: Connection,
    from: string,
    op: SyncOp,
    current: OwnedElement | undefined,
  ): Promise<void> {
    let correction: SyncOp | undefined;
    if (op.kind === 'upsert') {
      correction = current
        ? this.mayRead(conn, current.audience)
          ? { kind: 'upsert', element: current }
          : { kind: 'remove', id: current.id }
        : { kind: 'remove', id: op.element.id };
    } else if (op.kind === 'remove') {
      correction = current
        ? this.mayRead(conn, current.audience)
          ? { kind: 'upsert', element: current }
          : { kind: 'remove', id: current.id }
        : undefined;
    } else if (op.kind === 'clear') {
      const all = (await this.backend.snapshot(conn.room)) as OwnedElement[];
      const elements = this.canRead ? all.filter((el) => this.mayRead(conn, el.audience)) : all;
      correction = { kind: 'snapshot', to: from, elements };
    }
    if (correction) conn.send(JSON.stringify({ from: HUB_FROM, op: correction }));
  }

  private onFanout(payload: string): void {
    // Off the serial queue on purpose: forward-only (the origin already applied to the SHARED backend),
    // and delivery is already ordered. Re-filter per local member (canRead runs on EVERY instance).
    let env: {
      o?: unknown;
      room?: unknown;
      from?: unknown;
      op?: unknown;
      prev?: unknown;
      existed?: unknown;
    };
    try {
      env = JSON.parse(payload);
    } catch {
      return;
    }
    if (typeof env.o !== 'string' || typeof env.room !== 'string' || typeof env.from !== 'string')
      return;
    if (env.o === this.instanceId) return; // our own publish — already delivered locally
    const op = env.op;
    if (isPresenceOp(op)) {
      // presence/leave: raw forward to all local members (the sender lives on the origin instance),
      // no backend, no canRead filter.
      this.relayToRoom(env.room, undefined, JSON.stringify({ from: env.from, op }));
      return;
    }
    if (isLayerOp(op)) {
      // LWW-guarded local apply keeps memory-fallback instances converged; a
      // shared backend already holds the record (the guarded re-apply is a
      // no-op). Relay is unconditional — receiving clients LWW-drop stale ops.
      void this.applyFanoutLayerOp(env.room, op).catch(() => {
        /* a broken backend must not break the fanout relay */
      });
      this.relayToRoom(env.room, undefined, JSON.stringify({ from: env.from, op }));
      return;
    }
    if (!isFanoutOp(op)) return;
    const prevAudience = typeof env.prev === 'string' ? env.prev : undefined;
    const prevExisted = env.existed === true;
    this.deliverToRoom(env.room, undefined, env.from, op, prevAudience, prevExisted);
  }

  private async applyFanoutLayerOp(room: string, op: LayerOp): Promise<void> {
    const record = layerOpToRecord(op);
    const current = await this.getLayerRecord(room, record.id);
    if (current && !isNewerLayerRecord(record, current)) return;
    await this.applyLayerRecord(room, record);
  }

  close(): void {
    for (const connId of [...this.presenceLanes.keys()]) this.clearPresenceLanes(connId);
    this.fanoutUnsub();
  }
}
