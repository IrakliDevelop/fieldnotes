import {
  createCurrentCapabilities,
  createLegacyCapabilities,
  parseEnvelope,
  isValidElement,
  isNewerLayerRecord,
  translateOpForPeer,
  type LayerRecord,
  type SyncOp,
  type SyncEnvelope,
  type SyncCapabilities,
  type PluginSnapshot,
} from '@fieldnotes/sync';
import { getDefaultElementRegistry } from '@fieldnotes/core';
import type { CanvasElement, ElementRegistry } from '@fieldnotes/core';
import { MemoryHubBackend } from './memory-hub-backend';
import { InMemoryHubFanout, type HubFanout } from './hub-fanout';
import type { HubBackend } from './hub-backend';
import type { Authorize, AuthorizeLayer, CanRead, OwnedElement } from './authorize';
import { ServerPluginRegistry } from './sync-plugin';
import type { ApplyResult, ServerOpContext, ServerSyncPlugin } from './sync-plugin';
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
  plugins?: readonly ServerSyncPlugin[];
  canRead?: CanRead;
  maxJsonDepth?: number;
  presenceThrottleMs?: number;
  maxPresenceLanes?: number;
  /** Registry used to translate extension elements for legacy peers. */
  elementRegistry?: ElementRegistry;
}

const HUB_FROM = 'hub';
const CORE_ELEMENT_TYPES = new Set(['stroke', 'note', 'arrow', 'image', 'html', 'text', 'shape']);

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
  private readonly pluginRegistry: ServerPluginRegistry;
  private readonly elementRegistry: ElementRegistry;
  private readonly peerCapabilities = new Map<string, SyncCapabilities>();
  private readonly canRead?: CanRead;
  private readonly memoryLayers = new Map<string, Map<string, LayerRecord>>();
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
    this.pluginRegistry = new ServerPluginRegistry(options.plugins ?? []);
    this.elementRegistry = options.elementRegistry ?? getDefaultElementRegistry();
    this.instanceId = options.instanceId ?? generateInstanceId();
    this.fanout = options.fanout ?? new InMemoryHubFanout();
    this.authorize = options.authorize;
    this.authorizeLayer = options.authorizeLayer;
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
    this.peerCapabilities.delete(connId);
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
    if (env.op.kind === 'capabilities') {
      this.peerCapabilities.set(conn.id, env.op.capabilities);
      this.sendToConnection(conn, HUB_FROM, {
        kind: 'capabilities',
        capabilities: createCurrentCapabilities(this.pluginRegistry.extensionKinds),
      });
      return Promise.resolve();
    }
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
    let op = env.op;
    if (op.kind === 'upsert') {
      const element = this.toRuntimeElement(op.element);
      if (!element) return;
      op = { ...op, element };
    }
    if (op.kind === 'request-snapshot') {
      const all = this.toRuntimeElements(await this.backend.snapshot(conn.room));
      const elements = this.canRead ? all.filter((el) => this.mayRead(conn, el.audience)) : all;
      // Layer records are presentation-only and carry no element bytes, so no
      // audience filter applies; the field is omitted while a room has never
      // used layer sync, keeping snapshot frames byte-identical to before.
      const layers = await this.getLayerRecords(conn.room);
      const snapshotOp: Record<string, unknown> = {
        kind: 'snapshot',
        to: env.from,
        elements,
      };
      if (layers.length > 0) snapshotOp['layers'] = layers;
      const extensions: Record<string, PluginSnapshot> = {};
      for (const plugin of this.pluginRegistry.plugins) {
        let snapshot = await plugin.snapshot?.(conn.room, this.backend);
        if (!snapshot) continue;
        if (plugin.filterSnapshot) {
          snapshot =
            plugin.filterSnapshot(snapshot, { userId: conn.userId, role: conn.role }) ?? undefined;
        }
        if (!snapshot) continue;
        if (plugin.legacySnapshotKey) snapshotOp[plugin.legacySnapshotKey] = snapshot.data;
        else extensions[plugin.name] = snapshot;
      }
      if (Object.keys(extensions).length > 0) snapshotOp['extensions'] = extensions;
      this.sendToConnection(conn, HUB_FROM, snapshotOp as SyncOp);
    } else if (op.kind === 'layer-upsert' || op.kind === 'layer-remove') {
      await this.processLayerOp(conn, op);
    } else if (op.kind === 'extension') {
      const entry = this.pluginRegistry.extension(op.extensionKind);
      if (!entry || !entry.kind.codec.validate(op.payload)) return;
      await this.deliverPluginResult(conn, await entry.handler(op, this.pluginContext(conn)));
    } else if (this.pluginRegistry.ownerOf(op.kind)) {
      const owner = this.pluginRegistry.ownerOf(op.kind);
      if (!owner?.process) return;
      const result = await owner.process(op, this.pluginContext(conn), async () => ({
        accepted: null,
        corrections: [],
      }));
      await this.deliverPluginResult(conn, result);
    } else if (op.kind === 'upsert' || op.kind === 'remove' || op.kind === 'clear') {
      const id = op.kind === 'upsert' ? op.element.id : op.kind === 'remove' ? op.id : undefined;
      const needCurrent = (this.authorize || this.canRead) && id !== undefined;
      const storedCurrent = needCurrent ? await this.backend.get(conn.room, id) : undefined;
      const current = storedCurrent
        ? (this.toRuntimeElement(storedCurrent) ?? undefined)
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

      const prevExisted = current !== undefined;
      const prevAudience = current?.audience;
      const result = await this.runCorePlugins(conn, outboundOp);
      for (const correction of result.corrections) {
        this.sendToConnection(conn, HUB_FROM, correction);
      }
      const accepted = result.accepted;
      if (
        accepted &&
        (accepted.kind === 'upsert' || accepted.kind === 'remove' || accepted.kind === 'clear')
      ) {
        if (result.locality !== 'local') {
          await this.fanout.publish(
            JSON.stringify({
              o: this.instanceId,
              room: conn.room,
              from: conn.id,
              op: accepted,
              prev: prevAudience,
              existed: prevExisted,
            }),
          );
        }
        this.deliverToRoom(conn.room, conn.id, conn.id, accepted, prevAudience, prevExisted);
      }
      for (const broadcast of result.broadcast ?? []) {
        await this.publishPluginOp(conn, broadcast, result.locality);
      }
    }
    // 'snapshot' from a client → ignored
  }

  private pluginContext(conn: Connection): ServerOpContext {
    return {
      room: conn.room,
      connectionId: conn.id,
      userId: conn.userId,
      role: conn.role,
      backend: this.backend,
      backendPlugin: (key) => this.backend.getService?.(key),
    };
  }

  private async runCorePlugins(conn: Connection, op: SyncOp): Promise<ApplyResult> {
    const middleware = this.pluginRegistry.plugins.filter((plugin) => plugin.process);
    const context = this.pluginContext(conn);
    const dispatch = async (index: number, current: SyncOp): Promise<ApplyResult> => {
      const plugin = middleware[index];
      if (!plugin?.process) {
        await this.backend.apply(conn.room, current);
        return { accepted: current, corrections: [] };
      }
      let called = false;
      return plugin.process(current, context, async (nextOp, nextContext) => {
        if (called) throw new Error(`Server plugin "${plugin.name}" called next() more than once`);
        if (nextContext !== context) {
          throw new Error(`Server plugin "${plugin.name}" replaced the operation context`);
        }
        called = true;
        return dispatch(index + 1, nextOp);
      });
    };
    return dispatch(0, op);
  }

  private async deliverPluginResult(conn: Connection, result: ApplyResult): Promise<void> {
    for (const correction of result.corrections) {
      this.sendToConnection(conn, HUB_FROM, correction);
    }
    if (result.accepted) await this.publishPluginOp(conn, result.accepted, result.locality);
    for (const broadcast of result.broadcast ?? []) {
      await this.publishPluginOp(conn, broadcast, result.locality);
    }
  }

  private async publishPluginOp(
    conn: Connection,
    op: SyncOp,
    locality: ApplyResult['locality'],
  ): Promise<void> {
    if (locality !== 'local') {
      await this.fanout.publish(
        JSON.stringify({ o: this.instanceId, room: conn.room, from: conn.id, op }),
      );
    }
    this.relayOpToRoom(conn.room, conn.id, conn.id, op);
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
        this.sendToConnection(conn, HUB_FROM, layerRecordToOp(correction));
        return;
      }
    }
    if (current && !isNewerLayerRecord(record, current)) {
      // Stale under (version, editor): converge the sender, do not broadcast.
      this.sendToConnection(conn, HUB_FROM, layerRecordToOp(current));
      return;
    }
    await this.applyLayerRecord(conn.room, record);
    await this.fanout.publish(
      JSON.stringify({ o: this.instanceId, room: conn.room, from: conn.id, op }),
    );
    this.relayOpToRoom(conn.room, conn.id, conn.id, op);
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

  /**
   * Translates `op` for the peer and sends it. Returns false when the op is
   * lossy for this peer (no legacy encoding) or the socket throws; neither
   * may reject the room operation that produced it.
   */
  private sendToConnection(conn: Connection, from: string, op: SyncOp): boolean {
    const capabilities = this.peerCapabilities.get(conn.id) ?? createLegacyCapabilities();
    try {
      const translated = translateOpForPeer(
        op,
        capabilities,
        this.elementRegistry,
        this.pluginRegistry.extensionDefinitions,
      );
      conn.send(JSON.stringify({ from, op: translated }));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Normalize registered legacy wire elements before authorization, storage,
   * and relay. A legacy type this hub has no adapter for is forwarded and
   * stored verbatim — the hub is a relay, and the peers decide whether they
   * understand it — so a hub deployed without domain adapters never erases
   * the room's existing elements. Only a malformed registered element is dropped.
   */
  private toRuntimeElement(
    element: Extract<SyncOp, { kind: 'upsert' }>['element'],
  ): OwnedElement | null {
    if (element.type === 'extension' || CORE_ELEMENT_TYPES.has(element.type)) return element;
    const adapter = this.elementRegistry.getAdapterByLegacyType(element.type);
    if (!adapter) return element;
    try {
      const raw = Object.fromEntries(Object.entries(element));
      const envelope = adapter.decodeLegacy(raw);
      if (!adapter.validateEnvelope(envelope)) return null;
      return {
        ...envelope,
        ...(typeof raw['audience'] === 'string' ? { audience: raw['audience'] } : {}),
        ...(typeof raw['ownerId'] === 'string' ? { ownerId: raw['ownerId'] } : {}),
      };
    } catch {
      return null;
    }
  }

  private toRuntimeElements(elements: readonly CanvasElement[]): OwnedElement[] {
    const normalized: OwnedElement[] = [];
    for (const element of elements) {
      const runtime = this.toRuntimeElement(element);
      if (runtime) normalized.push(runtime);
    }
    return normalized;
  }

  private relayOpToRoom(
    room: string,
    excludeId: string | undefined,
    from: string,
    op: SyncOp,
  ): number {
    const members = this.rooms.get(room);
    if (!members) return 0;
    let sent = 0;
    for (const connectionId of members) {
      if (connectionId === excludeId) continue;
      const conn = this.conns.get(connectionId);
      if (!conn) continue;
      // A lossy translation is skipped for this peer without blocking compatible peers.
      if (this.sendToConnection(conn, from, op)) sent += 1;
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
    const send = (conn: Connection, sender: string, outbound: SyncOp): void => {
      this.sendToConnection(conn, sender, outbound);
    };
    if (op.kind === 'upsert') {
      const audience = (op.element as OwnedElement).audience;
      const removeOp: SyncOp = { kind: 'remove', id: op.element.id };
      for (const cid of members) {
        if (cid === excludeId) continue;
        const conn = this.conns.get(cid);
        if (!conn) continue;
        if (this.mayRead(conn, audience)) send(conn, from, op);
        else if (prevExisted && this.mayRead(conn, prevAudience)) send(conn, HUB_FROM, removeOp);
      }
    } else if (op.kind === 'remove') {
      for (const cid of members) {
        if (cid === excludeId) continue;
        const conn = this.conns.get(cid);
        if (!conn) continue;
        // No read filter → forward to all (today's behavior; current/prevExisted aren't fetched without
        // a hook). With canRead, only recipients who could see the removed element get it.
        const wasVisible = !this.canRead || (prevExisted && this.mayRead(conn, prevAudience));
        if (wasVisible) send(conn, from, op);
      }
    } else if (op.kind === 'clear') {
      for (const cid of members) {
        if (cid === excludeId) continue;
        const conn = this.conns.get(cid);
        if (conn) send(conn, from, op);
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
      const all = this.toRuntimeElements(await this.backend.snapshot(conn.room));
      const elements = this.canRead ? all.filter((el) => this.mayRead(conn, el.audience)) : all;
      correction = { kind: 'snapshot', to: from, elements };
    }
    if (correction) this.sendToConnection(conn, HUB_FROM, correction);
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
      void this.applyFanoutLayerOp(env.room, op).catch(() => {
        /* a broken backend must not break the fanout relay */
      });
      this.relayOpToRoom(env.room, undefined, env.from, op);
      return;
    }
    const plugin =
      typeof op === 'object' && op !== null && (op as { kind?: unknown }).kind === 'extension'
        ? this.pluginRegistry.extension((op as { extensionKind?: string }).extensionKind ?? '')
            ?.plugin
        : typeof op === 'object' &&
            op !== null &&
            typeof (op as { kind?: unknown }).kind === 'string'
          ? this.pluginRegistry.ownerOf((op as { kind: string }).kind)
          : undefined;
    if (plugin && typeof op === 'object' && op !== null) {
      const previous = this.roomQueues.get(env.room) ?? Promise.resolve();
      const operation = previous.then(async () => {
        const context: ServerOpContext = {
          room: env.room as string,
          connectionId: env.from as string,
          backend: this.backend,
          backendPlugin: (key) => this.backend.getService?.(key),
        };
        const accepted = plugin.applyFanout
          ? await plugin.applyFanout(op as SyncOp, context)
          : (op as SyncOp);
        if (accepted) {
          this.relayOpToRoom(env.room as string, undefined, env.from as string, accepted);
        }
      });
      this.roomQueues.set(
        env.room,
        operation.catch(() => {
          /* a broken backend must not wedge the room queue */
        }),
      );
      return;
    }
    if (!isFanoutOp(op)) return;
    const runtimeOp =
      op.kind === 'upsert'
        ? (() => {
            const element = this.toRuntimeElement(op.element);
            return element ? ({ ...op, element } satisfies SyncOp) : null;
          })()
        : op;
    if (!runtimeOp) return;
    const prevAudience = typeof env.prev === 'string' ? env.prev : undefined;
    const prevExisted = env.existed === true;
    this.deliverToRoom(env.room, undefined, env.from, runtimeOp, prevAudience, prevExisted);
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
