import {
  createCurrentCapabilities,
  parseLegacyEnvelope,
  isValidElement,
  isNewerLayerRecord,
  isNewerVersion,
  translateOpForPeer,
  type LayerRecord,
  type SyncElement,
  type SyncOp,
  type SyncEnvelope,
  type SyncCapabilities,
  type PluginSnapshot,
  type Tombstone,
} from '@fieldnotes/sync';
import { MemoryHubBackend } from './memory-hub-backend';
import { InMemoryHubFanout, type HubFanout } from './hub-fanout';
import type { ElementWrite, HubBackend, HubRecord, StoredTombstone } from './hub-backend';
import type {
  Authorize,
  AuthorizeLayer,
  CanRead,
  CanReadOwnerId,
  OwnedElement,
  ResolveAudience,
} from './authorize';
import { ServerPluginRegistry } from './sync-plugin';
import type { ApplyResult, ServerOpContext, ServerSyncPlugin } from './sync-plugin';
import { snapshotAuthContext, validateExpiresAt, type AuthContext } from './auth-context';
import { SerialRoomQueue } from './serial-room-queue';
import { AuthorityRuntime } from './authority-runtime';
import {
  authorityConnectionBinding,
  copyAuthorityConnectionBinding,
  unregisterAuthorityConnection,
} from './authority-connection';
import { resolveAuthorityDefinition } from './authority-admission';
import type { AuthorityOptions } from './authority-types';
import {
  DEFAULT_MAX_JSON_DEPTH,
  DEFAULT_MAX_PRESENCE_BYTES,
  DEFAULT_MAX_PRESENCE_LANES,
  DEFAULT_PRESENCE_THROTTLE_MS,
  hasJsonDepthAtMost,
} from './resource-limits';

export interface Connection {
  id: string;
  room: string;
  userId?: string;
  role?: string;
  readonly authContext?: AuthContext;
  readonly expiresAt?: number;
  send(message: string): void;
  /**
   * Optional on guarded connections and custom adapters. Resolves after a local socket-write
   * callback, not peer receipt or durable commit. Callers must await/catch rejection; a failed
   * caller may leave active native work occupying bounded transport capacity until it settles.
   */
  sendAsync?(message: string): Promise<void>;
  /** Factory-owned lifetime and close hooks required for isolated authority connections. */
  readonly signal?: AbortSignal;
  close?(code: 4401 | 4403 | 4406 | 1013): void;
}

export interface SyncHubOptions {
  authority?: AuthorityOptions;
  backend?: HubBackend;
  fanout?: HubFanout;
  instanceId?: string;
  authorize?: Authorize;
  authorizeLayer?: AuthorizeLayer;
  plugins?: readonly ServerSyncPlugin[];
  canRead?: CanRead;
  canReadOwnerId?: CanReadOwnerId;
  resolveAudience?: ResolveAudience;
  maxJsonDepth?: number;
  presenceThrottleMs?: number;
  maxPresenceLanes?: number;
  /** Largest `presence.data` payload relayed, in UTF-8 bytes of its JSON encoding. */
  maxPresenceBytes?: number;
  /** Opt-in: drops hub, backend and plugin per-room memory after a room has had no local connection for this long. */
  roomIdleTimeoutMs?: number;
}

/** Trusted server-side lifecycle for an admitted frame. Direct callers schedule timeout/abort. */
export interface MessageDispatchOptions {
  readonly deadlineAt: number;
  readonly signal: AbortSignal;
  readonly beforeProcess: () => boolean | Promise<boolean>;
}

const HUB_FROM = 'hub';
const utf8 = new TextEncoder();
function utf8ByteLength(text: string): number {
  return utf8.encode(text).byteLength;
}
function generateInstanceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    return crypto.randomUUID();
  return `i-${Math.random().toString(36).slice(2)}`;
}

type ElementOp = Extract<SyncOp, { kind: 'upsert' | 'remove' }>;

function isFanoutOp(op: SyncOp): op is ElementOp {
  return op.kind === 'upsert' || op.kind === 'remove';
}

const MAX_VERSION_JUMP = 1_000_000;
const MAX_WRITE_ATTEMPTS = 3;

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

function isLayerOp(op: SyncOp): op is LayerOp {
  return op.kind === 'layer-upsert' || op.kind === 'layer-remove';
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

/**
 * Peers sharing an encoding profile (capabilities plus ownerId privilege)
 * receive byte-identical frames, so a relay encodes each (sender, op) once
 * per profile instead of once per recipient.
 */
type EncodedFrames = Map<string, string | null>;

function encodingProfile(capabilities: SyncCapabilities, revealOwner: boolean): string {
  return JSON.stringify([capabilities.extensionKinds, revealOwner]);
}

function withoutOwnerId(element: SyncElement): SyncElement {
  if (element.ownerId === undefined) return element;
  const rest: SyncElement = { ...element };
  delete rest.ownerId;
  return rest;
}

/** Removes the server-stamped `ownerId` from every element an op carries. */
function stripOwnerId(op: SyncOp): SyncOp {
  if (op.kind === 'upsert') return { ...op, element: withoutOwnerId(op.element) };
  if (op.kind === 'snapshot') return { ...op, elements: op.elements.map(withoutOwnerId) };
  return op;
}

function isPresenceOp(op: SyncOp): op is Extract<SyncOp, { kind: 'presence' | 'presence-leave' }> {
  return op.kind === 'presence' || op.kind === 'presence-leave';
}

export class SyncHub {
  private readonly backend: HubBackend;
  private readonly conns = new Map<string, Connection>();
  private readonly rooms = new Map<string, Set<string>>(); // room → connIds
  private readonly roomQueues = new Map<string, SerialRoomQueue>();
  private readonly presenceConnections = new Set<string>();
  private readonly instanceId: string;
  private readonly fanout: HubFanout;
  private readonly fanoutUnsub: () => void;
  private readonly authorize?: Authorize;
  private readonly authorizeLayer?: AuthorizeLayer;
  private readonly pluginRegistry: ServerPluginRegistry;
  private readonly peerCapabilities = new Map<string, SyncCapabilities>();
  private readonly canRead?: CanRead;
  private readonly canReadOwnerId?: CanReadOwnerId;
  private readonly resolveAudience?: ResolveAudience;
  private readonly memoryLayers = new Map<string, Map<string, LayerRecord>>();
  private readonly maxJsonDepth: number;
  private readonly presenceThrottleMs: number;
  private readonly maxPresenceLanes: number;
  private readonly maxPresenceBytes: number;
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
  private readonly authority?: AuthorityRuntime;
  private readonly authorityOptions?: AuthorityOptions;
  private readonly authorityPeers = new Set<string>();
  private readonly roomIdleTimeoutMs?: number;
  private readonly idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private closed = false;

  constructor(options: SyncHubOptions = {}) {
    this.backend = options.backend ?? new MemoryHubBackend();
    this.pluginRegistry = new ServerPluginRegistry(options.plugins ?? []);
    this.instanceId = options.instanceId ?? generateInstanceId();
    this.fanout = options.fanout ?? new InMemoryHubFanout();
    this.authorize = options.authorize;
    this.authorizeLayer = options.authorizeLayer;
    this.canRead = options.canRead;
    this.canReadOwnerId = options.canReadOwnerId;
    this.resolveAudience = options.resolveAudience;
    this.maxJsonDepth = options.maxJsonDepth ?? DEFAULT_MAX_JSON_DEPTH;
    this.presenceThrottleMs = options.presenceThrottleMs ?? DEFAULT_PRESENCE_THROTTLE_MS;
    const maxPresenceLanes = options.maxPresenceLanes ?? DEFAULT_MAX_PRESENCE_LANES;
    if (!Number.isFinite(maxPresenceLanes) || maxPresenceLanes < 1) {
      throw new RangeError('maxPresenceLanes must be a finite number of at least 1');
    }
    this.maxPresenceLanes = Math.floor(maxPresenceLanes);
    const maxPresenceBytes = options.maxPresenceBytes ?? DEFAULT_MAX_PRESENCE_BYTES;
    if (!Number.isFinite(maxPresenceBytes) || maxPresenceBytes < 0) {
      throw new RangeError('maxPresenceBytes must be a non-negative finite number');
    }
    this.maxPresenceBytes = maxPresenceBytes;
    const roomIdleTimeoutMs = options.roomIdleTimeoutMs;
    if (
      roomIdleTimeoutMs !== undefined &&
      (!Number.isFinite(roomIdleTimeoutMs) ||
        roomIdleTimeoutMs <= 0 ||
        // Node clamps larger setTimeout delays to 1 ms, which would evict every room at once.
        roomIdleTimeoutMs > 2_147_483_647)
    ) {
      throw new RangeError('roomIdleTimeoutMs must be a positive number up to 2147483647');
    }
    this.roomIdleTimeoutMs = roomIdleTimeoutMs;
    this.fanoutUnsub = this.fanout.subscribe((payload) => this.onFanout(payload));
    this.authorityOptions = options.authority;
    if (options.authority)
      this.authority = new AuthorityRuntime(options.authority, this.fanout, this.instanceId);
  }

  addConnection(conn: Connection): void {
    let authorityDefinition;
    try {
      authorityDefinition = this.authorityOptions
        ? resolveAuthorityDefinition(this.authorityOptions, conn.room)
        : null;
      const pinned = this.authority?.pinnedDefinitionId(conn.room);
      if (pinned && authorityDefinition?.id !== pinned)
        throw new Error('Authority definition changed');
    } catch {
      conn.close?.(1013);
      return;
    }
    if (
      authorityDefinition &&
      (!authorityConnectionBinding(conn) ||
        !conn.signal ||
        !conn.close ||
        this.rooms.has(conn.room))
    ) {
      conn.close?.(1013);
      return;
    }
    const sendAsync = conn.sendAsync;
    const admitted: Connection = Object.freeze({
      id: conn.id,
      room: conn.room,
      userId: conn.userId,
      role: conn.role,
      send: (message: string) => conn.send(message),
      ...(sendAsync ? { sendAsync: (message: string) => sendAsync.call(conn, message) } : {}),
      authContext: snapshotAuthContext(conn.authContext),
      expiresAt: validateExpiresAt(conn.expiresAt),
      ...(conn.signal ? { signal: conn.signal } : {}),
      ...(conn.close ? { close: (code: 4401 | 4403 | 4406 | 1013) => conn.close?.(code) } : {}),
    });
    copyAuthorityConnectionBinding(conn, admitted);
    if (authorityDefinition) {
      if (!this.authority?.admit(admitted, authorityDefinition)) {
        unregisterAuthorityConnection(admitted);
        return;
      }
      this.conns.set(conn.id, admitted);
      this.authorityPeers.add(conn.id);
      return;
    }
    this.conns.set(conn.id, admitted);
    clearTimeout(this.idleTimers.get(conn.room));
    this.idleTimers.delete(conn.room);
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
    unregisterAuthorityConnection(conn);
    if (this.authorityPeers.delete(connId)) {
      this.authority?.remove(connId);
      return;
    }
    this.peerCapabilities.delete(connId);
    const room = conn.room;
    const hadPresence = this.presenceConnections.delete(connId);
    this.clearPresenceLanes(connId);
    const members = this.rooms.get(room);
    if (members) {
      members.delete(connId);
      if (members.size === 0) {
        this.rooms.delete(room);
        // An active room operation retains the lane across disconnect/reconnect.
        const queue = this.roomQueues.get(room);
        if (queue?.idle) this.roomQueues.delete(room);
        this.scheduleIdleEviction(room);
      }
    }
    if (hadPresence) this.broadcastLeave(room, conn.id);
  }

  roomCount(): number {
    return this.rooms.size;
  }

  /**
   * Broadcasts ephemeral server-owned presence data to every connection in a room.
   * The returned count covers accepted synchronous send admission on this hub instance,
   * not completed physical delivery. Async frame policy can subsequently deny a frame.
   */
  broadcastPresence<T>(room: string, data: T): number {
    if (this.isAuthorityRoom(room)) return 0;
    if (!this.isPresenceWithinLimit(data)) return 0;
    const op = { kind: 'presence' as const, data };
    const sent = this.relayToRoom(room, undefined, JSON.stringify({ from: HUB_FROM, op }));
    this.safePublish(JSON.stringify({ o: this.instanceId, room, from: HUB_FROM, op }));
    return sent;
  }

  /**
   * Dispatches a frame on its room queue. Existing two-argument callers retain legacy behavior.
   * With options, the caller owns timeout and abort scheduling: an aborted/expired queued frame or
   * a false `beforeProcess` result resolves without processing. Aborting active work is cooperative;
   * its promise settles only when the actual hook or process settles. Active exceptions reject the
   * caller, and the room queue recovers for subsequent frames.
   */
  handleMessage(connId: string, message: string, options?: MessageDispatchOptions): Promise<void> {
    const conn = this.conns.get(connId);
    if (!conn) return Promise.resolve();
    if (this.authorityPeers.has(connId))
      return this.authority?.handleMessage(connId, message, options) ?? Promise.resolve();
    if (this.isAuthorityRoom(conn.room)) {
      conn.close?.(1013);
      this.removeConnection(connId);
      return Promise.resolve();
    }
    if (!hasJsonDepthAtMost(message, this.maxJsonDepth)) return Promise.resolve();
    const env = parseLegacyEnvelope(message);
    if (!env) return Promise.resolve();
    if (env.op.kind === 'capabilities' && env.op.capabilities.protocolVersion < 2) {
      conn.close?.(4406);
      this.removeConnection(connId);
      return Promise.resolve();
    }
    const perform = async () => {
      if (options) {
        if (!this.isCurrent(conn) || options.signal.aborted || Date.now() >= options.deadlineAt)
          return;
        if ((await options.beforeProcess()) !== true) return;
        if (!this.isCurrent(conn) || options.signal.aborted || Date.now() >= options.deadlineAt)
          return;
      }
      if (env.op.kind === 'capabilities') {
        this.peerCapabilities.set(conn.id, env.op.capabilities);
        this.sendToConnection(conn, HUB_FROM, {
          kind: 'capabilities',
          capabilities: createCurrentCapabilities(this.pluginRegistry.extensionKinds),
        });
      } else if (env.op.kind === 'presence') {
        if (this.isPresenceWithinLimit(env.op.data)) this.schedulePresence(conn, env.op.data);
      } else {
        await this.process(conn, env, options);
      }
    };
    // Preserve the fast-path timing of legacy capabilities and presence.
    if (!options && (env.op.kind === 'capabilities' || env.op.kind === 'presence')) {
      return perform();
    }
    return this.roomQueue(conn.room).enqueue(perform, options);
  }

  private isCurrent(conn: Connection): boolean {
    return this.conns.get(conn.id) === conn;
  }

  private isAuthorityRoom(room: string): boolean {
    if (this.authority?.pinnedDefinitionId(room)) return true;
    if (!this.authorityOptions) return false;
    try {
      const definition = resolveAuthorityDefinition(this.authorityOptions, room);
      if (!definition) return false;
      return true;
    } catch {
      // A throwing trusted resolver fails closed, even on cross-instance fanout.
      return true;
    }
  }

  private roomQueue(room: string): SerialRoomQueue {
    let queue = this.roomQueues.get(room);
    if (!queue) {
      queue = new SerialRoomQueue(() => {
        if (this.roomQueues.get(room) === queue) this.roomQueues.delete(room);
      });
      this.roomQueues.set(room, queue);
    }
    return queue;
  }

  private async process(
    conn: Connection,
    env: SyncEnvelope,
    options?: MessageDispatchOptions,
  ): Promise<void> {
    const op = env.op;
    if (op.kind === 'upsert') {
      if (!isValidElement(op.element)) return;
    }
    // Clients apply editor 'hub' ops authoritatively, so no client may claim it (as for layer ops).
    if (op.kind === 'upsert' && op.element.editor === HUB_FROM) return;
    if (op.kind === 'remove' && op.editor === HUB_FROM) return;
    // A clear's tombstones take the sender id as editor, so the same rule applies.
    if (op.kind === 'clear' && env.from === HUB_FROM) return;
    if (op.kind === 'request-snapshot') {
      this.sendToConnection(conn, HUB_FROM, await this.buildSnapshotOp(conn, env.from));
    } else if (op.kind === 'layer-upsert' || op.kind === 'layer-remove') {
      await this.processLayerOp(conn, op);
    } else if (op.kind === 'extension') {
      const entry = this.pluginRegistry.extension(op.extensionKind);
      if (!entry || !entry.kind.codec.validate(op.payload)) return;
      await this.deliverPluginResult(
        conn,
        await entry.handler(op, this.pluginContext(conn, options)),
      );
    } else if (this.pluginRegistry.ownerOf(op.kind)) {
      const owner = this.pluginRegistry.ownerOf(op.kind);
      if (!owner?.process) return;
      const result = await owner.process(op, this.pluginContext(conn, options), async () => ({
        accepted: null,
        corrections: [],
      }));
      await this.deliverPluginResult(conn, result);
    } else if (op.kind === 'upsert' || op.kind === 'remove') {
      await this.processElementOp(conn, env.from, op, options);
    } else if (op.kind === 'clear') {
      await this.processClear(conn, env.from, options);
    }
    // 'snapshot' from a client → ignored
  }

  // Write-then-publish: a failed publish leaves other instances stale only until their next snapshot.
  private async processElementOp(
    conn: Connection,
    from: string,
    op: ElementOp,
    options?: MessageDispatchOptions,
  ): Promise<void> {
    const id = op.kind === 'upsert' ? op.element.id : op.id;
    const opVersion = op.kind === 'upsert' ? op.element.version : op.version;
    for (let attempt = 1; ; attempt++) {
      const record = await this.backend.getRecord(conn.room, id);
      const current = record?.kind === 'element' ? record.element : undefined;
      const tombstone = record?.kind === 'tombstone' ? record.tombstone : undefined;
      if (op.kind === 'remove' && !current) {
        if (tombstone) await this.sendCorrection(conn, from, op, record);
        return;
      }
      let candidate: ElementOp = op;
      if (op.kind === 'upsert' && this.resolveAudience) {
        // The hub, not the client, decides the audience; it runs before authorize so a
        // policy sees the authoritative tag.
        const audience = this.resolveAudience({
          userId: conn.userId,
          role: conn.role,
          room: conn.room,
          element: op.element,
          currentElement: current,
        });
        const element: OwnedElement = { ...op.element };
        if (audience === undefined) delete element.audience;
        else element.audience = audience;
        candidate = { kind: 'upsert', element };
      }
      const userId = conn.userId;
      const mayRecreate =
        !this.authorize ||
        !tombstone?.ownerId ||
        (userId !== undefined && (userId === tombstone.ownerId || userId === tombstone.removedBy));
      if (!mayRecreate) {
        await this.sendCorrection(conn, from, candidate, record);
        return;
      }
      if (
        this.authorize &&
        !(await this.authorize({
          userId,
          role: conn.role,
          room: conn.room,
          op: candidate,
          currentElement: current,
        }))
      ) {
        await this.sendCorrection(conn, from, candidate, record);
        return;
      }
      if (candidate.kind === 'upsert' && this.authorize) {
        const ownerId = current?.ownerId ?? tombstone?.ownerId ?? userId;
        candidate = { kind: 'upsert', element: { ...candidate.element, ownerId } };
      }

      const result = await this.runCorePlugins(conn, candidate, options);
      const pluginOutput = { ...result, accepted: null };
      const accepted = result.accepted;
      if (accepted?.kind !== 'upsert' && accepted?.kind !== 'remove') {
        await this.deliverPluginResult(conn, pluginOutput, opVersion);
        return;
      }
      const version = accepted.kind === 'upsert' ? accepted.element.version : accepted.version;
      const editor = accepted.kind === 'upsert' ? accepted.element.editor : accepted.editor;
      const stored = current ?? tombstone;
      if (
        version === undefined ||
        !isNewerVersion({ version, editor }, stored) ||
        version > (stored?.version ?? 0) + MAX_VERSION_JUMP
      ) {
        await this.sendCorrection(conn, from, candidate, record);
        await this.deliverPluginResult(conn, pluginOutput, opVersion);
        return;
      }
      const write: ElementWrite =
        accepted.kind === 'upsert'
          ? { kind: 'upsert', element: accepted.element }
          : {
              kind: 'remove',
              tombstone: {
                id: accepted.id,
                version,
                editor: editor ?? HUB_FROM,
                removedAt: Date.now(),
                ownerId: current?.ownerId,
                audience: current?.audience,
                removedBy: userId,
              },
            };
      let outcome: Awaited<ReturnType<HubBackend['applyElement']>>;
      try {
        outcome = await this.backend.applyElement(conn.room, write, stored?.version ?? null);
      } catch (error) {
        await this.sendCorrection(conn, from, candidate, record);
        throw error;
      }
      if (!outcome.ok) {
        if (attempt < MAX_WRITE_ATTEMPTS) continue;
        await this.sendCorrection(conn, from, candidate, outcome.current);
        await this.deliverPluginResult(conn, pluginOutput, opVersion);
        return;
      }
      const prevAudience = current?.audience;
      const existed = current !== undefined;
      try {
        if (result.locality !== 'local') {
          await this.fanout.publish(
            JSON.stringify({
              o: this.instanceId,
              room: conn.room,
              from: conn.id,
              op: accepted,
              prev: prevAudience,
              existed,
            }),
          );
        }
      } finally {
        this.deliverToRoom(conn.room, conn.id, conn.id, accepted, prevAudience, existed);
      }
      await this.deliverPluginResult(conn, pluginOutput, opVersion);
      return;
    }
  }

  /** Authorized once; tombstones every element under the sender's own id, as its client does. */
  private async processClear(
    conn: Connection,
    from: string,
    options?: MessageDispatchOptions,
  ): Promise<void> {
    const op: SyncOp = { kind: 'clear' };
    if (
      this.authorize &&
      !(await this.authorize({ userId: conn.userId, role: conn.role, room: conn.room, op }))
    ) {
      await this.sendSnapshotCorrection(conn, from);
      return;
    }
    for (let attempt = 1; ; attempt++) {
      const result = await this.runCorePlugins(conn, op, options);
      const pluginOutput = { ...result, accepted: null };
      if (result.accepted?.kind !== 'clear') {
        await this.deliverPluginResult(conn, pluginOutput);
        return;
      }
      const { elements } = await this.backend.snapshot(conn.room);
      const removedAt = Date.now();
      const stored: StoredTombstone[] = elements.map((element) => ({
        id: element.id,
        version: element.version + 1,
        editor: from,
        removedAt,
        ownerId: element.ownerId,
        audience: element.audience,
        removedBy: conn.userId,
      }));
      const expected = new Map(elements.map((element) => [element.id, element.version]));
      let outcome: Awaited<ReturnType<HubBackend['applyElement']>>;
      try {
        outcome = await this.backend.applyElement(
          conn.room,
          { kind: 'clear', tombstones: stored, expected },
          null,
        );
      } catch (error) {
        await this.sendSnapshotCorrection(conn, from).catch(() => {
          // Best effort: a failing correction read must not replace the original write error.
        });
        throw error;
      }
      if (!outcome.ok) {
        if (attempt < MAX_WRITE_ATTEMPTS) continue;
        await this.sendSnapshotCorrection(conn, from);
        await this.deliverPluginResult(conn, pluginOutput);
        return;
      }
      const tombstones = stored.map(({ id, version, editor }) => ({ id, version, editor }));
      const audiences = stored.map((tombstone) => tombstone.audience);
      try {
        if (result.locality !== 'local') {
          await this.fanout.publish(
            JSON.stringify({
              o: this.instanceId,
              room: conn.room,
              from: conn.id,
              op: { kind: 'clear', tombstones },
              audiences,
            }),
          );
        }
      } finally {
        this.deliverClear(conn.room, conn.id, conn.id, tombstones, audiences);
      }
      await this.deliverPluginResult(conn, pluginOutput);
      return;
    }
  }

  private pluginContext(conn: Connection, options?: MessageDispatchOptions): ServerOpContext {
    return {
      room: conn.room,
      connectionId: conn.id,
      userId: conn.userId,
      role: conn.role,
      authContext: conn.authContext,
      expiresAt: conn.expiresAt,
      ...(options ? { deadlineAt: options.deadlineAt, signal: options.signal } : {}),
      backend: this.backend,
      backendPlugin: (key) => this.backend.getService?.(key),
    };
  }

  private async runCorePlugins(
    conn: Connection,
    op: SyncOp,
    options?: MessageDispatchOptions,
  ): Promise<ApplyResult> {
    const middleware = this.pluginRegistry.plugins.filter((plugin) => plugin.process);
    const context = this.pluginContext(conn, options);
    const dispatch = async (index: number, current: SyncOp): Promise<ApplyResult> => {
      const plugin = middleware[index];
      if (!plugin?.process) {
        // The caller writes, then publishes.
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

  private async deliverPluginResult(
    conn: Connection,
    result: ApplyResult,
    fallbackVersion?: number,
  ): Promise<void> {
    for (const correction of result.corrections) {
      const stamped = await this.stampHubRemove(conn.room, correction, fallbackVersion);
      if (stamped) this.sendToConnection(conn, HUB_FROM, stamped);
    }
    if (result.accepted) await this.publishPluginOp(conn, result.accepted, result.locality);
    for (const broadcast of result.broadcast ?? []) {
      const stamped = await this.stampHubRemove(conn.room, broadcast, fallbackVersion);
      if (stamped) await this.publishPluginOp(conn, stamped, result.locality);
    }
  }

  // Clients drop versionless removes: stamp a plugin's with the stored (else op) version and 'hub'.
  private async stampHubRemove(
    room: string,
    op: SyncOp,
    fallbackVersion: number | undefined,
  ): Promise<SyncOp | undefined> {
    if (op.kind !== 'remove' || (op.version !== undefined && op.editor !== undefined)) return op;
    const record = await this.backend.getRecord(room, op.id);
    const stored = record?.kind === 'element' ? record.element : record?.tombstone;
    const version = op.version ?? stored?.version ?? fallbackVersion;
    return version === undefined
      ? undefined
      : { kind: 'remove', id: op.id, version, editor: HUB_FROM };
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
    // `editor: 'hub'` marks a correction the hub authored: clients apply those
    // authoritatively, skipping the (version, editor) tie-break, so a client claiming it
    // could push a record every peer obeys. Dropped like any invalid frame.
    if (op.editor === HUB_FROM) return;
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
        this.sendToConnection(
          conn,
          HUB_FROM,
          layerRecordToOp(this.layerCorrectionFor(current, record)),
        );
        return;
      }
    }
    if (current && !isNewerLayerRecord(record, current)) {
      // Stale under (version, editor): converge the sender, do not broadcast.
      this.sendToConnection(conn, HUB_FROM, layerRecordToOp(current));
      return;
    }
    // Publish-then-apply (S7): nothing is stored until fanout has taken the op, so a failed
    // publication can never leave this instance holding a record its peers lack. The guarantee
    // is one-sided: a publish that succeeded before `applyLayerRecord` failed has already
    // reached the other instances, which keep relaying a record this instance did not store.
    // That divergence converges on the next authoritative read (resync or snapshot request).
    try {
      await this.fanout.publish(
        JSON.stringify({ o: this.instanceId, room: conn.room, from: conn.id, op }),
      );
      await this.applyLayerRecord(conn.room, record);
    } catch (error) {
      // Same correction the denied path sends: the room's record, or a tombstone when there
      // is none, so the sender's optimistic edit disappears instead of lingering unshared.
      this.sendToConnection(
        conn,
        HUB_FROM,
        layerRecordToOp(this.layerCorrectionFor(current, record)),
      );
      throw error;
    }
    this.relayOpToRoom(conn.room, conn.id, conn.id, op);
  }

  /**
   * The authoritative record to send a sender whose layer edit did not survive: the room's
   * record, or a tombstone when there is none. The tombstone keeps the rejected edit's version:
   * the client applies every `from: 'hub'` layer op authoritatively rather than through the
   * `isNewerLayerRecord` tie-break, so parity replaces the edit, while a higher version would
   * mint a hub record the client re-pushes as a room-wide delete.
   */
  private layerCorrectionFor(current: LayerRecord | undefined, record: LayerRecord): LayerRecord {
    return current ?? { id: record.id, version: record.version, editor: HUB_FROM };
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

  private mayReadOwnerId(conn: Connection): boolean {
    if (!this.canReadOwnerId) return false;
    return this.canReadOwnerId({ userId: conn.userId, role: conn.role, room: conn.room });
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
  private sendToConnection(
    conn: Connection,
    from: string,
    op: SyncOp,
    encoded?: EncodedFrames,
  ): boolean {
    const capabilities =
      this.peerCapabilities.get(conn.id) ??
      createCurrentCapabilities(this.pluginRegistry.extensionKinds);
    const revealOwner = this.mayReadOwnerId(conn);
    const profile = encoded ? encodingProfile(capabilities, revealOwner) : undefined;
    let message = profile === undefined ? undefined : encoded?.get(profile);
    if (message === undefined) {
      message = this.encodeForPeer(from, op, capabilities, revealOwner);
      if (profile !== undefined) encoded?.set(profile, message);
    }
    if (message === null) return false;
    try {
      conn.send(message);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Returns the wire frame for `op` translated for `capabilities`, or null
   * when lossy. The server-stamped `ownerId` is a server-side authorization
   * fact: it leaves the hub only for peers `canReadOwnerId` admits.
   */
  private encodeForPeer(
    from: string,
    op: SyncOp,
    capabilities: SyncCapabilities,
    revealOwner: boolean,
  ): string | null {
    try {
      const translated = translateOpForPeer(revealOwner ? op : stripOwnerId(op), capabilities);
      return JSON.stringify({ from, op: translated });
    } catch {
      return null;
    }
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
    const encoded: EncodedFrames = new Map();
    for (const connectionId of members) {
      if (connectionId === excludeId) continue;
      const conn = this.conns.get(connectionId);
      if (!conn) continue;
      // A lossy translation is skipped for this peer without blocking compatible peers.
      if (this.sendToConnection(conn, from, op, encoded)) sent += 1;
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
    const encoded: EncodedFrames = new Map();
    if (op.kind === 'upsert') {
      const audience = (op.element as OwnedElement).audience;
      const removeOp: SyncOp = {
        kind: 'remove',
        id: op.element.id,
        version: op.element.version,
        editor: HUB_FROM,
      };
      const encodedRemove: EncodedFrames = new Map();
      for (const cid of members) {
        if (cid === excludeId) continue;
        const conn = this.conns.get(cid);
        if (!conn) continue;
        if (this.mayRead(conn, audience)) this.sendToConnection(conn, from, op, encoded);
        else if (prevExisted && this.mayRead(conn, prevAudience)) {
          this.sendToConnection(conn, HUB_FROM, removeOp, encodedRemove);
        }
      }
    } else if (op.kind === 'remove') {
      for (const cid of members) {
        if (cid === excludeId) continue;
        const conn = this.conns.get(cid);
        if (!conn) continue;
        // With canRead, only recipients who could see the removed element get it.
        const wasVisible = !this.canRead || (prevExisted && this.mayRead(conn, prevAudience));
        if (wasVisible) this.sendToConnection(conn, from, op, encoded);
      }
    }
  }

  /** Each member receives only the clear tombstones whose stored audience it may read. */
  private deliverClear(
    room: string,
    excludeId: string | undefined,
    from: string,
    tombstones: readonly Tombstone[],
    audiences: readonly (string | undefined)[],
  ): void {
    for (const cid of this.rooms.get(room) ?? []) {
      if (cid === excludeId) continue;
      const conn = this.conns.get(cid);
      if (!conn) continue;
      const readable = tombstones.filter((_, index) => this.mayRead(conn, audiences[index]));
      this.sendToConnection(conn, from, { kind: 'clear', tombstones: readable });
    }
  }

  private async sendCorrection(
    conn: Connection,
    from: string,
    op: SyncOp,
    record: HubRecord | undefined,
  ): Promise<void> {
    if (op.kind === 'clear') {
      await this.sendSnapshotCorrection(conn, from);
      return;
    }
    let correction: SyncOp | undefined;
    if (record?.kind === 'element') {
      const current = record.element;
      correction = this.mayRead(conn, current.audience)
        ? { kind: 'upsert', element: current }
        : { kind: 'remove', id: current.id, version: current.version, editor: HUB_FROM };
    } else if (record) {
      const { id, version } = record.tombstone;
      correction = { kind: 'remove', id, version, editor: HUB_FROM };
    } else if (op.kind === 'upsert') {
      correction = {
        kind: 'remove',
        id: op.element.id,
        version: op.element.version,
        editor: HUB_FROM,
      };
    }
    if (correction) this.sendToConnection(conn, HUB_FROM, correction);
  }

  /**
   * Resyncs one sender from authoritative state: the whole room as that connection
   * may read it. Used wherever a sender's optimistic op did not survive.
   */
  private async sendSnapshotCorrection(conn: Connection, from: string): Promise<void> {
    this.sendToConnection(conn, HUB_FROM, await this.buildSnapshotOp(conn, from));
  }

  /**
   * The authoritative view of a room for one connection: readable elements, the layer
   * records, and each plugin's filtered snapshot. Requested snapshots and clear corrections
   * share it so a corrected sender is never left with less state than a joiner receives.
   */
  private async buildSnapshotOp(conn: Connection, to: string): Promise<SyncOp> {
    const { elements: all, tombstones: stored } = await this.backend.snapshot(conn.room);
    const elements = this.canRead ? all.filter((el) => this.mayRead(conn, el.audience)) : all;
    const tombstones = stored
      .filter((tombstone) => this.mayRead(conn, tombstone.audience))
      .map(({ id, version, editor }) => ({ id, version, editor }));
    // Layer records are presentation-only and carry no element bytes, so no
    // audience filter applies; the field is omitted while a room has never
    // used layer sync, keeping snapshot frames byte-identical to before.
    const layers = await this.getLayerRecords(conn.room);
    const snapshotOp: Record<string, unknown> = { kind: 'snapshot', to, elements };
    if (layers.length > 0) snapshotOp['layers'] = layers;
    if (tombstones.length > 0) snapshotOp['tombstones'] = tombstones;
    const extensions: Record<string, PluginSnapshot> = {};
    for (const plugin of this.pluginRegistry.plugins) {
      let snapshot = await plugin.snapshot?.(conn.room, this.backend);
      if (!snapshot) continue;
      if (plugin.filterSnapshot) {
        snapshot =
          plugin.filterSnapshot(snapshot, { userId: conn.userId, role: conn.role }) ?? undefined;
      }
      if (!snapshot) continue;
      extensions[plugin.name] = snapshot;
    }
    if (Object.keys(extensions).length > 0) snapshotOp['extensions'] = extensions;
    return snapshotOp as SyncOp;
  }

  private onFanout(payload: string): void {
    // Off the serial queue on purpose: element delivery here is forward-only. The origin writes,
    // then publishes, so a receiver never reads backing state to decide what to send; it relays
    // exactly what it was handed and clients order it by per-element (version, editor).
    // Layer and plugin fanout do still write the backend from here, off the queue, but that
    // write only converges this instance's own copy; the relay never depends on it.
    // Re-filter per local member (canRead runs on EVERY instance).
    // The channel is a trust boundary of its own: anyone who can publish to it reaches every
    // instance, so a fanout op passes the same shape validation as a client frame.
    // Element ops pass the protocol-2 rules too, so no versionless remove leaves this hub.
    if (!hasJsonDepthAtMost(payload, this.maxJsonDepth)) return;
    const parsed = parseLegacyEnvelope(payload);
    if (!parsed) return;
    const env: SyncEnvelope & {
      o?: unknown;
      room?: unknown;
      prev?: unknown;
      existed?: unknown;
      audiences?: unknown;
    } = parsed;
    if (typeof env.o !== 'string' || typeof env.room !== 'string') return;
    if (this.isAuthorityRoom(env.room)) return;
    if (env.o === this.instanceId) return; // our own publish — already delivered locally
    const op = env.op;
    if (isPresenceOp(op)) {
      if (op.kind === 'presence' && !this.isPresenceWithinLimit(op.data)) return;
      // presence/leave: raw forward to all local members (the sender lives on the origin instance),
      // no backend, no canRead filter.
      this.relayToRoom(env.room, undefined, JSON.stringify({ from: env.from, op }));
      return;
    }
    if (isLayerOp(op)) {
      void this.applyFanoutLayerOp(env.room, op).catch(() => {
        /* a broken backend must not break the fanout relay */
      });
      if (!this.rooms.has(env.room)) this.scheduleIdleEviction(env.room);
      this.relayOpToRoom(env.room, undefined, env.from, op);
      return;
    }
    let plugin: ServerSyncPlugin | undefined;
    if (op.kind === 'extension') {
      const entry = this.pluginRegistry.extension(op.extensionKind);
      if (!entry || !entry.kind.codec.validate(op.payload)) return;
      plugin = entry.plugin;
    } else {
      plugin = this.pluginRegistry.ownerOf(op.kind);
    }
    if (plugin) {
      const owner = plugin;
      void this.roomQueue(env.room)
        .enqueue(async () => {
          const context: ServerOpContext = {
            room: env.room as string,
            connectionId: env.from as string,
            backend: this.backend,
            backendPlugin: (key) => this.backend.getService?.(key),
          };
          const accepted = owner.applyFanout ? await owner.applyFanout(op, context) : op;
          if (accepted) {
            this.relayOpToRoom(env.room as string, undefined, env.from as string, accepted);
          }
        })
        .catch(() => {
          /* a broken backend must not wedge the room queue */
        });
      if (!this.rooms.has(env.room)) this.scheduleIdleEviction(env.room);
      return;
    }
    if (op.kind === 'clear') {
      const tombstones = op.tombstones ?? [];
      const audiences: unknown = env.audiences;
      if (
        !Array.isArray(audiences) ||
        audiences.length !== tombstones.length ||
        !audiences.every(
          (audience: unknown): audience is string | null =>
            audience === null || typeof audience === 'string',
        )
      )
        return;
      const readable = audiences.map((audience) => audience ?? undefined);
      this.deliverClear(env.room, undefined, env.from, tombstones, readable);
      return;
    }
    if (!isFanoutOp(op)) return;
    const prevAudience = typeof env.prev === 'string' ? env.prev : undefined;
    const prevExisted = env.existed === true;
    this.deliverToRoom(env.room, undefined, env.from, op, prevAudience, prevExisted);
  }

  private scheduleIdleEviction(room: string): void {
    if (this.roomIdleTimeoutMs === undefined || this.closed) return;
    clearTimeout(this.idleTimers.get(room));
    const timer = setTimeout(() => {
      this.idleTimers.delete(room);
      void this.roomQueue(room)
        .enqueue(async () => {
          // A connection may have joined while the eviction waited behind queued work.
          if (this.rooms.has(room)) return;
          this.memoryLayers.delete(room);
          for (const plugin of this.pluginRegistry.plugins) {
            try {
              plugin.evictRoom?.(room);
            } catch {
              /* one broken evictor must not keep the rest of the room resident */
            }
          }
          await this.backend.evictRoom?.(room);
        })
        .catch(() => {
          /* a broken backend must not wedge the room queue */
        });
    }, this.roomIdleTimeoutMs);
    this.idleTimers.set(room, timer);
  }

  private isPresenceWithinLimit(data: unknown): boolean {
    return utf8ByteLength(JSON.stringify(data) ?? '') <= this.maxPresenceBytes;
  }

  private async applyFanoutLayerOp(room: string, op: LayerOp): Promise<void> {
    const record = layerOpToRecord(op);
    const current = await this.getLayerRecord(room, record.id);
    if (current && !isNewerLayerRecord(record, current)) return;
    await this.applyLayerRecord(room, record);
  }

  close(): void {
    this.closed = true;
    this.authority?.close();
    for (const connId of [...this.presenceLanes.keys()]) this.clearPresenceLanes(connId);
    for (const timer of this.idleTimers.values()) clearTimeout(timer);
    this.idleTimers.clear();
    this.fanoutUnsub();
  }
}
