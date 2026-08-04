import {
  parseEnvelope,
  isValidElement,
  isNewerLayerRecord,
  type LayerRecord,
  type SyncOp,
  type SyncEnvelope,
} from '@fieldnotes/sync';
import { MemoryHubBackend } from './memory-hub-backend';
import { InMemoryHubFanout, type HubFanout } from './hub-fanout';
import type { HubBackend } from './hub-backend';
import type { Authorize, AuthorizeLayer, CanRead, OwnedElement } from './authorize';
import {
  DEFAULT_MAX_JSON_DEPTH,
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
  canRead?: CanRead;
  maxJsonDepth?: number;
  presenceThrottleMs?: number;
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
  private readonly canRead?: CanRead;
  /** Fallback layer-record store for backends without layer persistence. */
  private readonly memoryLayers = new Map<string, Map<string, LayerRecord>>();
  private readonly maxJsonDepth: number;
  private readonly presenceThrottleMs: number;
  private readonly lastPresenceAt = new Map<string, number>();
  private readonly pendingPresence = new Map<
    string,
    { data: unknown; timer: ReturnType<typeof setTimeout> }
  >();

  constructor(options: SyncHubOptions = {}) {
    this.backend = options.backend ?? new MemoryHubBackend();
    this.instanceId = options.instanceId ?? generateInstanceId();
    this.fanout = options.fanout ?? new InMemoryHubFanout();
    this.authorize = options.authorize;
    this.authorizeLayer = options.authorizeLayer;
    this.canRead = options.canRead;
    this.maxJsonDepth = options.maxJsonDepth ?? DEFAULT_MAX_JSON_DEPTH;
    this.presenceThrottleMs = options.presenceThrottleMs ?? DEFAULT_PRESENCE_THROTTLE_MS;
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
    this.lastPresenceAt.delete(connId);
    const pendingPresence = this.pendingPresence.get(connId);
    if (pendingPresence) clearTimeout(pendingPresence.timer);
    this.pendingPresence.delete(connId);
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
      conn.send(
        // `to` is a private correlation address for the requesting SyncClient. It is never
        // broadcast; every public sender identity below comes from the server-owned connection.
        JSON.stringify({
          from: HUB_FROM,
          op:
            layers.length > 0
              ? { kind: 'snapshot', to: env.from, elements, layers }
              : { kind: 'snapshot', to: env.from, elements },
        }),
      );
    } else if (op.kind === 'layer-upsert' || op.kind === 'layer-remove') {
      await this.processLayerOp(conn, op);
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

  private schedulePresence(conn: Connection, data: unknown): void {
    if (this.presenceThrottleMs <= 0) {
      this.broadcastClientPresence(conn, data);
      return;
    }
    const now = Date.now();
    const lastSentAt = this.lastPresenceAt.get(conn.id);
    if (lastSentAt === undefined || now - lastSentAt >= this.presenceThrottleMs) {
      this.lastPresenceAt.set(conn.id, now);
      this.broadcastClientPresence(conn, data);
      return;
    }

    const existing = this.pendingPresence.get(conn.id);
    if (existing) {
      existing.data = data;
      return;
    }
    const timer = setTimeout(
      () => {
        const pending = this.pendingPresence.get(conn.id);
        this.pendingPresence.delete(conn.id);
        if (!pending || !this.conns.has(conn.id)) return;
        this.lastPresenceAt.set(conn.id, Date.now());
        this.broadcastClientPresence(conn, pending.data);
      },
      this.presenceThrottleMs - (now - lastSentAt),
    );
    this.pendingPresence.set(conn.id, { data, timer });
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
    for (const pending of this.pendingPresence.values()) clearTimeout(pending.timer);
    this.pendingPresence.clear();
    this.fanoutUnsub();
  }
}
