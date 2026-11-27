import {
  createCurrentCapabilities,
  LEGACY_SYNC_PROTOCOL_VERSION,
  supportsLegacyHierarchy,
  parseLegacyEnvelope,
  isAllowedImageSrcScheme,
  isValidElement,
  isValidLayerDefinition,
  sanitizeElementLink,
  isNewerLayerRecord,
  isNewerVersion,
  translateOpForPeer,
  SYNC_LIMITS,
  type LayerRecord,
  type SyncElement,
  type SyncOp,
  type SyncEnvelope,
  type SyncCapabilities,
  type BatchOp,
  type PluginSnapshot,
  type Tombstone,
} from '@fieldnotes/sync';
import type { Layer } from '@fieldnotes/core';
import { hashAuthorityJson } from './authority-json';
import { MemoryHubBackend } from './memory-hub-backend';
import { InMemoryHubFanout, type HubFanout } from './hub-fanout';
import type { ElementWrite, HubBackend, HubRecord, StoredTombstone } from './hub-backend';
import type {
  AllowImageSrc,
  Authorize,
  AuthorizeLayer,
  CanRead,
  CanReadLayer,
  CanReadOwnerId,
  OwnedElement,
  ResolveAudience,
  ResolvePresenceAudience,
} from './authorize';
import { ServerPluginRegistry } from './sync-plugin';
import type { ApplyResult, PluginViewer, ServerOpContext, ServerSyncPlugin } from './sync-plugin';
import { gatesAllow, RoomElementGates } from './element-gates';
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
  DEFAULT_MAX_MESSAGE_BYTES,
  DEFAULT_MAX_PRESENCE_BYTES,
  DEFAULT_MAX_PRESENCE_LANES,
  DEFAULT_OP_BURST,
  DEFAULT_OPS_PER_SECOND,
  DEFAULT_PRESENCE_THROTTLE_MS,
  MessageRateLimiter,
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
  close?(code: 4401 | 4403 | 4406 | 4408 | 1013): void;
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
  canReadLayer?: CanReadLayer;
  canReadOwnerId?: CanReadOwnerId;
  resolveAudience?: ResolveAudience;
  resolvePresenceAudience?: ResolvePresenceAudience;
  allowImageSrc?: AllowImageSrc;
  /** Largest inbound frame the transport accepts; opBatching is advertised only if a full batch fits. */
  maxMessageBytes?: number;
  maxJsonDepth?: number;
  presenceThrottleMs?: number;
  maxPresenceLanes?: number;
  /** Largest `presence.data` payload relayed, in UTF-8 bytes of its JSON encoding. */
  maxPresenceBytes?: number;
  /** Sustained element ops per second per connection, single or batched; over budget closes 4408. */
  opsPerSecond?: number;
  /** Element op spike allowance per connection. */
  opBurst?: number;
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
const LEGACY_ADMISSION_TIMEOUT_MS = 5_000;
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

// Clients apply editor 'hub' ops authoritatively, so no client may claim it (as for layer ops).
function isAdmissibleElementOp(op: ElementOp): boolean {
  if (op.kind === 'remove') return op.editor !== HUB_FROM;
  return isValidElement(op.element) && op.element.editor !== HUB_FROM;
}

function asBatchOp(op: ElementOp): BatchOp | undefined {
  if (op.kind === 'upsert') return op;
  const { id, version, editor } = op;
  return version === undefined || editor === undefined
    ? undefined
    : { kind: 'remove', id, version, editor };
}

/** An accepted element op and the stored audience it replaced, for per-recipient delivery. */
interface Delivery {
  readonly op: ElementOp;
  readonly prevAudience: string | undefined;
  readonly existed: boolean;
  readonly prevElement?: SyncElement;
}

type PriorRecord = Omit<Delivery, 'op'>;

function hubRemoveOf({ id, version }: SyncElement): ElementOp {
  return { kind: 'remove', id, version, editor: HUB_FROM };
}

// An image src may be megabytes, and no gate may depend on it.
function withoutSrc(element: SyncElement): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...element };
  delete copy['src'];
  return copy;
}

function prevElementOf(value: unknown, op: ElementOp): SyncElement | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { id, type } = value as { id?: unknown; type?: unknown };
  const opId = op.kind === 'upsert' ? op.element.id : op.id;
  return id === opId && typeof type === 'string' ? (value as SyncElement) : undefined;
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
  return JSON.stringify([capabilities.extensionKinds, capabilities.opBatching === 1, revealOwner]);
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
  if (op.kind === 'batch') {
    const ops = op.ops.map((inner): BatchOp =>
      inner.kind === 'upsert' ? { ...inner, element: withoutOwnerId(inner.element) } : inner,
    );
    return { ...op, ops };
  }
  return op;
}

function hasRefusedImageSrc(element: SyncElement): boolean {
  return element.type === 'image' && !isAllowedImageSrcScheme(element.src);
}

/**
 * Removes a disallowed `link` and drops images with a refused `src` scheme, so stored ones never
 * leave the hub. Null when nothing is left to send.
 */
function sanitizeOutboundElements(op: SyncOp): SyncOp | null {
  if (op.kind === 'upsert') {
    return hasRefusedImageSrc(op.element)
      ? null
      : { ...op, element: sanitizeElementLink(op.element) };
  }
  if (op.kind === 'snapshot') {
    const elements = op.elements.filter((element) => !hasRefusedImageSrc(element));
    return { ...op, elements: elements.map(sanitizeElementLink) };
  }
  if (op.kind === 'batch') {
    const ops: BatchOp[] = [];
    for (const inner of op.ops) {
      if (inner.kind !== 'upsert') ops.push(inner);
      else if (!hasRefusedImageSrc(inner.element)) {
        ops.push({ ...inner, element: sanitizeElementLink(inner.element) });
      }
    }
    // An empty batch is an invalid frame.
    return ops.length > 0 ? { ...op, ops } : null;
  }
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
  private readonly gates: RoomElementGates;
  private readonly reconcileWaiting = new Set<string>();
  private readonly peerCapabilities = new Map<string, SyncCapabilities>();
  private readonly peerCapabilityHashes = new Map<string, string>();
  private readonly legacyAdmissionTimers = new Map<
    string,
    { readonly conn: Connection; readonly timer: ReturnType<typeof setTimeout> }
  >();
  private readonly legacyAdmissionPoisoned = new Set<string>();
  private readonly canRead?: CanRead;
  private readonly canReadLayer?: CanReadLayer;
  private readonly canReadOwnerId?: CanReadOwnerId;
  private readonly resolveAudience?: ResolveAudience;
  private readonly resolvePresenceAudience?: ResolvePresenceAudience;
  private readonly allowImageSrc?: AllowImageSrc;
  private readonly memoryLayers = new Map<string, Map<string, LayerRecord>>();
  private readonly maxJsonDepth: number;
  private readonly presenceThrottleMs: number;
  private readonly maxPresenceLanes: number;
  private readonly maxPresenceBytes: number;
  private readonly opsPerSecond: number;
  private readonly opBurst: number;
  private readonly opLimiters = new Map<string, MessageRateLimiter>();
  private readonly opBatching: boolean;
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
    this.gates = new RoomElementGates(this.pluginRegistry.plugins);
    this.instanceId = options.instanceId ?? generateInstanceId();
    this.fanout = options.fanout ?? new InMemoryHubFanout();
    this.authorize = options.authorize;
    this.authorizeLayer = options.authorizeLayer;
    this.canRead = options.canRead;
    this.canReadLayer = options.canReadLayer;
    this.canReadOwnerId = options.canReadOwnerId;
    this.resolveAudience = options.resolveAudience;
    this.resolvePresenceAudience = options.resolvePresenceAudience;
    this.allowImageSrc = options.allowImageSrc;
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
    const opsPerSecond = options.opsPerSecond ?? DEFAULT_OPS_PER_SECOND;
    if (!Number.isFinite(opsPerSecond) || opsPerSecond <= 0) {
      throw new RangeError('opsPerSecond must be a positive finite number');
    }
    this.opsPerSecond = opsPerSecond;
    const opBurst = options.opBurst ?? DEFAULT_OP_BURST;
    if (!Number.isFinite(opBurst) || opBurst <= 0) {
      throw new RangeError('opBurst must be a positive finite number');
    }
    this.opBurst = opBurst;
    const maxMessageBytes = options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES;
    if (!(maxMessageBytes > 0)) {
      throw new RangeError('maxMessageBytes must be a positive number');
    }
    // Clients size batches to SYNC_LIMITS; a hub tuned lower would reject full batches.
    this.opBatching =
      maxMessageBytes >= SYNC_LIMITS.maxFrameBytes &&
      this.maxJsonDepth >= SYNC_LIMITS.maxFrameJsonDepth &&
      opBurst >= SYNC_LIMITS.maxBatchOps;
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
    if (options.canRead && !options.resolvePresenceAudience) {
      throw new Error(
        'SyncHub: `canRead` requires `resolvePresenceAudience` (pass `() => undefined` to send presence to everyone)',
      );
    }
    if (this.gates.active && !options.resolvePresenceAudience) {
      throw new Error(
        'SyncHub: a plugin with `elementReadGate` requires `resolvePresenceAudience` (pass `() => undefined` to send presence to everyone)',
      );
    }
    if (options.canRead && !options.canReadLayer) {
      throw new Error(
        'SyncHub: `canRead` requires `canReadLayer` (pass `() => true` to send every layer to everyone)',
      );
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
      ...(conn.close
        ? { close: (code: 4401 | 4403 | 4406 | 4408 | 1013) => conn.close?.(code) }
        : {}),
    });
    copyAuthorityConnectionBinding(conn, admitted);
    if (authorityDefinition) {
      const previous = this.conns.get(conn.id);
      if (!this.authority?.admit(admitted, authorityDefinition)) {
        unregisterAuthorityConnection(admitted);
        return;
      }
      if (previous && this.conns.get(conn.id) === previous && !this.authorityPeers.has(conn.id))
        this.removeConnection(conn.id);
      this.conns.set(conn.id, admitted);
      this.authorityPeers.add(conn.id);
      return;
    }
    this.removeConnection(conn.id);
    this.conns.set(conn.id, admitted);
    this.opLimiters.set(conn.id, new MessageRateLimiter(this.opsPerSecond, this.opBurst));
    clearTimeout(this.idleTimers.get(conn.room));
    this.idleTimers.delete(conn.room);
    let set = this.rooms.get(conn.room);
    if (!set) {
      set = new Set();
      this.rooms.set(conn.room, set);
      if (this.gates.active) this.loadGates(conn.room);
    }
    set.add(conn.id);
    const timer = setTimeout(() => {
      if (!this.isCurrent(admitted) || this.peerCapabilities.has(admitted.id)) return;
      void this.refuseProtocol(admitted);
    }, LEGACY_ADMISSION_TIMEOUT_MS);
    this.legacyAdmissionTimers.set(conn.id, { conn: admitted, timer });
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
    this.peerCapabilityHashes.delete(connId);
    this.legacyAdmissionPoisoned.delete(connId);
    const admission = this.legacyAdmissionTimers.get(connId);
    if (admission) clearTimeout(admission.timer);
    this.legacyAdmissionTimers.delete(connId);
    this.opLimiters.delete(connId);
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

  private removeCurrentConnection(conn: Connection): void {
    if (this.isCurrent(conn)) this.removeConnection(conn.id);
  }

  roomCount(): number {
    return this.rooms.size;
  }

  /**
   * Broadcasts ephemeral server-owned presence data to every connection `canRead` admits (all
   * when unset), on every instance; `audience` tags the frame.
   * The returned count covers accepted synchronous send admission on this hub instance,
   * not completed physical delivery. Async frame policy can subsequently deny a frame.
   */
  broadcastPresence<T>(room: string, data: T, options?: { audience?: string }): number {
    if (this.isAuthorityRoom(room)) return 0;
    if (!this.isPresenceWithinLimit(data)) return 0;
    const audience = options?.audience;
    const op = { kind: 'presence' as const, data };
    const message = JSON.stringify({ from: HUB_FROM, op });
    const sent = this.relayPresenceToRoom(room, undefined, message, audience);
    this.safePublish(
      JSON.stringify({
        o: this.instanceId,
        room,
        from: HUB_FROM,
        op,
        ...(audience === undefined ? {} : { audience }),
      }),
    );
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
    if (!options && !this.peerCapabilities.has(conn.id) && env.op.kind !== 'capabilities') {
      this.legacyAdmissionPoisoned.add(conn.id);
      return Promise.resolve();
    }
    const perform = async () => {
      if (!this.isCurrent(conn)) return;
      if (options) {
        if (!this.isCurrent(conn) || options.signal.aborted || Date.now() >= options.deadlineAt)
          return;
        if ((await options.beforeProcess()) !== true) return;
        if (!this.isCurrent(conn) || options.signal.aborted || Date.now() >= options.deadlineAt)
          return;
      }
      if (!this.peerCapabilities.has(conn.id)) {
        if (env.op.kind !== 'capabilities') {
          this.legacyAdmissionPoisoned.add(conn.id);
          return;
        }
        const hash = this.capabilityHash(env.op.capabilities);
        if (
          this.legacyAdmissionPoisoned.has(conn.id) ||
          !supportsLegacyHierarchy(env.op.capabilities) ||
          hash === undefined
        ) {
          await this.refuseProtocol(conn);
          return;
        }
        this.peerCapabilities.set(conn.id, env.op.capabilities);
        this.peerCapabilityHashes.set(conn.id, hash);
        const admission = this.legacyAdmissionTimers.get(conn.id);
        if (admission?.conn === conn) clearTimeout(admission.timer);
        this.legacyAdmissionTimers.delete(conn.id);
        this.sendToConnection(conn, HUB_FROM, {
          kind: 'capabilities',
          capabilities: {
            ...createCurrentCapabilities(this.pluginRegistry.extensionKinds),
            ...(this.opBatching ? { opBatching: 1 } : {}),
          },
        });
        return;
      }
      if (env.op.kind === 'capabilities') {
        if (this.peerCapabilityHashes.get(conn.id) !== this.capabilityHash(env.op.capabilities))
          await this.refuseProtocol(conn);
        return;
      }
      const opCost = env.op.kind === 'batch' ? env.op.ops.length : Number(isFanoutOp(env.op));
      if (opCost > 0 && !this.opLimiters.get(connId)?.take(Date.now(), opCost)) {
        conn.close?.(4408);
        this.removeCurrentConnection(conn);
        return;
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

  /** Explains the refusal before 4406; a guarded send gets up to 1 s to reach the socket. */
  private async refuseProtocol(conn: Connection): Promise<void> {
    const reply: SyncOp = {
      kind: 'unsupported',
      protocolVersion: LEGACY_SYNC_PROTOCOL_VERSION,
      minProtocolVersion: LEGACY_SYNC_PROTOCOL_VERSION,
      reason: `protocol version ${LEGACY_SYNC_PROTOCOL_VERSION} with element hierarchy support required`,
    };
    if (!this.isCurrent(conn)) return;
    if (conn.sendAsync) {
      this.removeCurrentConnection(conn);
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        conn.sendAsync(JSON.stringify({ from: HUB_FROM, op: reply })).catch(() => undefined),
        new Promise<void>((resolve) => (timer = setTimeout(resolve, 1000))),
      ]);
      clearTimeout(timer);
    } else {
      try {
        conn.send(JSON.stringify({ from: HUB_FROM, op: reply }));
      } catch {
        // An unsupported reply is best effort before the protocol close.
      }
      this.removeCurrentConnection(conn);
    }
    conn.close?.(4406);
  }

  private isCurrent(conn: Connection): boolean {
    return this.conns.get(conn.id) === conn;
  }

  private capabilityHash(capabilities: SyncCapabilities): string | undefined {
    try {
      return hashAuthorityJson(capabilities);
    } catch {
      return undefined;
    }
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
    if (isFanoutOp(op) && !isAdmissibleElementOp(op)) return;
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
    } else if (op.kind === 'batch') {
      await this.processBatch(conn, env.from, op.ops, options);
    } else if (op.kind === 'clear') {
      await this.processClear(conn, env.from, options);
    }
    // 'snapshot' from a client → ignored
  }

  /** Each op runs the single-op pipeline; accepted ops reach local peers together, even after a throw. */
  private async processBatch(
    conn: Connection,
    from: string,
    ops: readonly BatchOp[],
    options?: MessageDispatchOptions,
  ): Promise<void> {
    const delivered: Delivery[] = [];
    try {
      for (const op of ops) {
        if (options && (options.signal.aborted || !this.isCurrent(conn))) break;
        if (isAdmissibleElementOp(op))
          await this.processElementOp(conn, from, op, options, delivered);
      }
    } finally {
      this.deliverToRoom(conn.room, conn.id, conn.id, delivered, true);
    }
  }

  // Write-then-publish, so authorization judges the state the compare-and-set write replaces.
  // With `batch`, local delivery is left to the caller, so plugin output reaches peers first.
  private async processElementOp(
    conn: Connection,
    from: string,
    op: ElementOp,
    options?: MessageDispatchOptions,
    batch?: Delivery[],
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
      if (candidate.kind === 'upsert' && candidate.element.type === 'image') {
        const { src } = candidate.element;
        let allowed = isAllowedImageSrcScheme(src);
        if (allowed && this.allowImageSrc) {
          try {
            // `=== true` so a plain-JS async hook (a truthy Promise) fails closed.
            allowed =
              this.allowImageSrc({
                src,
                userId: conn.userId,
                role: conn.role,
                room: conn.room,
              }) === true;
          } catch {
            allowed = false; // a throwing host hook fails closed
          }
        }
        if (!allowed) {
          await this.sendCorrection(conn, from, candidate, record);
          return;
        }
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
      const accepted =
        result.accepted?.kind === 'upsert'
          ? { ...result.accepted, element: sanitizeElementLink(result.accepted.element) }
          : result.accepted;
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
        outcome = await this.backend.applyElement(
          conn.room,
          write,
          stored ? { version: stored.version, editor: stored.editor } : null,
        );
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
              ...(this.gates.active && current ? { prevEl: withoutSrc(current) } : {}),
            }),
          );
        }
      } finally {
        const delivery = { op: accepted, prevAudience, existed, prevElement: current };
        if (batch) batch.push(delivery);
        else this.deliverToRoom(conn.room, conn.id, conn.id, [delivery]);
        // The sender holds its own upsert, so a gate that denies it must take it back.
        if (
          accepted.kind === 'upsert' &&
          this.gates.active &&
          !this.gatesAllowNow(conn, accepted.element)
        )
          this.sendToConnection(conn, HUB_FROM, hubRemoveOf(accepted.element));
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
      const expected = new Map(
        elements.map(({ id, version, editor }) => [id, { version, editor }]),
      );
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
      const visible = stamped && this.opForViewer(conn, stamped);
      if (!visible) continue;
      const hidden = visible.kind === 'upsert' && !this.mayReadElement(conn, visible.element);
      this.sendToConnection(conn, HUB_FROM, hidden ? hubRemoveOf(visible.element) : visible);
    }
    if (result.accepted) await this.publishPluginOp(conn, result.accepted, result.locality);
    for (const broadcast of result.broadcast ?? []) {
      const stamped = await this.stampHubRemove(conn.room, broadcast, fallbackVersion);
      if (stamped) await this.publishPluginOp(conn, stamped, result.locality);
    }
    if (result.accepted) await this.refreshGatesAfter(conn.room, result.accepted);
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

  private ownerOfOp(op: SyncOp): ServerSyncPlugin | undefined {
    return op.kind === 'extension'
      ? this.pluginRegistry.extension(op.extensionKind)?.plugin
      : this.pluginRegistry.ownerOf(op.kind);
  }

  // Fails closed: a throw, a promise, or a result of another kind withholds the op.
  private opForViewer(conn: Connection, op: SyncOp): SyncOp | null {
    const owner = this.ownerOfOp(op);
    if (!owner?.filterOp) return op;
    let result: unknown;
    try {
      result = owner.filterOp(op, { userId: conn.userId, role: conn.role, room: conn.room });
    } catch {
      return null;
    }
    if (result === op) return op;
    if (typeof result !== 'object' || result === null || 'then' in result) return null;
    return 'kind' in result && result.kind === op.kind ? (result as SyncOp) : null;
  }

  private async publishPluginOp(
    conn: Connection,
    op: SyncOp,
    locality: ApplyResult['locality'],
  ): Promise<void> {
    let prior: PriorRecord | undefined;
    let extra = {};
    if (isFanoutOp(op)) {
      const id = op.kind === 'upsert' ? op.element.id : op.id;
      const record = await this.backend.getRecord(conn.room, id);
      const element = record?.kind === 'element' ? record.element : undefined;
      const prevAudience =
        record?.kind === 'tombstone' ? record.tombstone.audience : element?.audience;
      prior = { prevAudience, existed: record !== undefined, prevElement: element };
      extra = {
        pluginOp: true,
        existed: prior.existed,
        prev: prevAudience,
        ...(this.gates.active && element ? { prevEl: withoutSrc(element) } : {}),
      };
    }
    if (locality !== 'local') {
      await this.fanout.publish(
        JSON.stringify({ o: this.instanceId, room: conn.room, from: conn.id, op, ...extra }),
      );
    }
    this.relayOpToRoom(conn.room, conn.id, conn.id, op, prior);
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
    // A sender who may not read the stored record gets the answer an unknown id gets.
    const correction = (): LayerOp =>
      layerRecordToOp(
        this.layerCorrectionFor(
          current?.definition && !this.mayReadLayer(conn, current.definition) ? undefined : current,
          record,
        ),
      );
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
        this.sendToConnection(conn, HUB_FROM, correction());
        return;
      }
    }
    if (current && !isNewerLayerRecord(record, current)) {
      // Stale under (version, editor): converge the sender, do not broadcast.
      this.sendToConnection(conn, HUB_FROM, correction());
      return;
    }
    // Publish-then-apply (S7): nothing is stored until fanout has taken the op, so a failed
    // publication can never leave this instance holding a record its peers lack. The guarantee
    // is one-sided: a publish that succeeded before `applyLayerRecord` failed has already
    // reached the other instances, which keep relaying a record this instance did not store.
    // That divergence converges on the next authoritative read (resync or snapshot request).
    const prev = current?.definition ?? null;
    try {
      await this.fanout.publish(
        JSON.stringify({
          o: this.instanceId,
          room: conn.room,
          from: conn.id,
          op,
          ...(this.canReadLayer ? { prevLayer: prev } : {}),
        }),
      );
      await this.applyLayerRecord(conn.room, record);
    } catch (error) {
      // Same correction the denied path sends: the room's record, or a tombstone when there
      // is none, so the sender's optimistic edit disappears instead of lingering unshared.
      this.sendToConnection(conn, HUB_FROM, correction());
      throw error;
    }
    this.relayLayerOpToRoom(conn.room, conn.id, conn.id, op, prev ?? undefined);
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

  private mayReadLayer(conn: Connection, layer: Layer): boolean {
    if (!this.canReadLayer) return true;
    try {
      // `=== true` so a plain-JS async hook (a truthy Promise) fails closed.
      return (
        this.canReadLayer({ userId: conn.userId, role: conn.role, room: conn.room, layer }) === true
      );
    } catch {
      return false;
    }
  }

  private mayRead(conn: Connection, audience: string | undefined): boolean {
    if (!this.canRead) return true;
    return this.canRead({ userId: conn.userId, role: conn.role, room: conn.room, audience });
  }

  // Unloaded gates deny, so a member who joins mid-load gets no element by off-queue fanout.
  private gatesAllowNow(conn: Connection, element: SyncElement): boolean {
    const gates = this.gates.current(conn.room);
    return gates !== undefined && gatesAllow(gates, element, this.viewerOf(conn));
  }

  private viewerOf(conn: Connection): PluginViewer {
    return { userId: conn.userId, role: conn.role, room: conn.room };
  }

  private mayReadElement(conn: Connection, element: SyncElement): boolean {
    if (!this.mayRead(conn, element.audience)) return false;
    return !this.gates.active || this.gatesAllowNow(conn, element);
  }

  // While a reconcile is pending the viewer may still hold what any gate set since settled allowed.
  private couldReadBefore(conn: Connection, delivery: Delivery): boolean {
    if (!delivery.existed || !this.mayRead(conn, delivery.prevAudience)) return false;
    const prev = delivery.prevElement;
    if (!this.gates.active || !prev) return true;
    if (this.gatesAllowNow(conn, prev)) return true;
    return (
      this.gates.isPending(conn.room) &&
      this.gates.allowedSinceSettled(conn.room, prev, this.viewerOf(conn))
    );
  }

  /** First load for a room's first local member; never awaited, so `addConnection` stays sync. */
  private loadGates(room: string): void {
    this.gates.drop(room);
    void this.roomQueue(room)
      .enqueue(async () => {
        if (this.rooms.has(room)) await this.gates.refresh(room, this.backend);
      })
      .catch(() => {
        /* unloaded gates withhold every element; a later snapshot retries */
      });
  }

  /** Runs on the room queue after an op its owning plugin accepted. */
  private async refreshGatesAfter(room: string, op: SyncOp): Promise<void> {
    if (!this.ownerOfOp(op)?.elementReadGate || !this.rooms.has(room)) return;
    if (await this.gates.refresh(room, this.backend)) this.scheduleReconcile(room);
  }

  /** Never awaited: callers run on the room queue, and at most one run waits per room. */
  private scheduleReconcile(room: string): void {
    if (this.reconcileWaiting.has(room)) return;
    this.reconcileWaiting.add(room);
    void this.roomQueue(room)
      .enqueue(async () => {
        this.reconcileWaiting.delete(room);
        await this.reconcile(room);
      })
      .catch(() => {
        /* settled stays put, so the next gate change reconciles from it */
      });
  }

  // Sends each local viewer what changed between the gate sets since settled and those in force.
  private async reconcile(room: string): Promise<void> {
    const current = this.gates.current(room);
    if (!current) return;
    const settled = this.gates.settled(room);
    if (settled === 'deny' || !this.gates.isPending(room)) return;
    const { elements } = await this.backend.snapshot(room);
    // The room was dropped and reloaded while this read; the new load owns it.
    // Also covers a set appended to since during the read: that run settles nothing, the next one does.
    if (this.gates.current(room) !== current) return;
    for (const cid of this.rooms.get(room) ?? []) {
      const conn = this.conns.get(cid);
      if (!conn || !this.peerCapabilities.has(cid)) continue;
      const viewer = this.viewerOf(conn);
      for (const element of elements) {
        if (!this.mayRead(conn, element.audience)) continue;
        const now = gatesAllow(current, element, viewer);
        if (!now && this.gates.allowedSinceSettled(room, element, viewer)) {
          this.sendToConnection(conn, HUB_FROM, hubRemoveOf(element));
        } else if (now && this.gates.deniedSinceSettled(room, element, viewer)) {
          this.sendToConnection(conn, HUB_FROM, { kind: 'upsert', element });
        }
      }
    }
    this.gates.markSettled(room);
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
      if (!conn || !this.peerCapabilities.has(conn.id)) continue;
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
    const capabilities = this.peerCapabilities.get(conn.id);
    if (!capabilities) return false;
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
      const sanitized = sanitizeOutboundElements(revealOwner ? op : stripOwnerId(op));
      if (!sanitized) return null;
      return JSON.stringify({ from, op: translateOpForPeer(sanitized, capabilities) });
    } catch {
      return null;
    }
  }

  private relayOpToRoom(
    room: string,
    excludeId: string | undefined,
    from: string,
    op: SyncOp,
    prior?: PriorRecord,
  ): number {
    const members = this.rooms.get(room);
    if (!members) return 0;
    let sent = 0;
    const encoded: EncodedFrames = new Map();
    const removals: EncodedFrames = new Map();
    const filtered = this.ownerOfOp(op)?.filterOp !== undefined;
    for (const connectionId of members) {
      if (connectionId === excludeId) continue;
      const conn = this.conns.get(connectionId);
      if (!conn) continue;
      // A plugin's element op: the earlier state is unknown, so an unreadable upsert is a remove.
      if (prior && op.kind === 'upsert' && !this.mayReadElement(conn, op.element)) {
        this.sendToConnection(conn, HUB_FROM, hubRemoveOf(op.element), removals);
        continue;
      }
      if (
        prior &&
        op.kind === 'remove' &&
        (this.canRead || this.gates.active) &&
        !this.couldReadBefore(conn, { op, ...prior })
      )
        continue;
      const visible = filtered ? this.opForViewer(conn, op) : op;
      if (!visible) continue;
      // A rewritten op is per-viewer, so it must not populate the shared frame cache.
      const cache = visible === op ? encoded : undefined;
      // A lossy translation is skipped for this peer without blocking compatible peers.
      if (this.sendToConnection(conn, from, visible, cache)) sent += 1;
    }
    return sent;
  }

  /**
   * Relays a layer op per `canReadLayer`: a reader of the new record gets the op, a reader of
   * only `prev` (undefined when none or unknown) gets a remove, everyone else nothing.
   */
  private relayLayerOpToRoom(
    room: string,
    excludeId: string | undefined,
    from: string,
    op: LayerOp,
    prev: Layer | undefined,
  ): void {
    if (!this.canReadLayer) {
      this.relayOpToRoom(room, excludeId, from, op);
      return;
    }
    const removal: LayerOp =
      op.kind === 'layer-remove'
        ? op
        : { kind: 'layer-remove', id: op.layer.id, version: op.version, editor: op.editor };
    // The synthetic remove has its own cache so no profile ever gets it in place of the op.
    const encoded: EncodedFrames = new Map();
    const removals: EncodedFrames = new Map();
    for (const cid of this.rooms.get(room) ?? []) {
      if (cid === excludeId) continue;
      const conn = this.conns.get(cid);
      if (!conn) continue;
      if (op.kind === 'layer-upsert' && this.mayReadLayer(conn, op.layer)) {
        this.sendToConnection(conn, from, op, encoded);
      } else if (prev && this.mayReadLayer(conn, prev)) {
        this.sendToConnection(conn, from, removal, removals);
      }
    }
  }

  /** Relays presence to members `canRead` admits; a throwing `canRead` skips only that member. */
  private relayPresenceToRoom(
    room: string,
    excludeId: string | undefined,
    message: string,
    audience: string | undefined,
  ): number {
    if (!this.canRead) return this.relayToRoom(room, excludeId, message);
    const members = this.rooms.get(room);
    if (!members) return 0;
    let sent = 0;
    for (const cid of members) {
      if (cid === excludeId) continue;
      const conn = this.conns.get(cid);
      if (!conn || !this.peerCapabilities.has(conn.id)) continue;
      try {
        if (!this.mayRead(conn, audience)) continue;
        conn.send(message);
        sent += 1;
      } catch {
        /* fail closed for this member without breaking the relay loop */
      }
    }
    return sent;
  }

  private broadcastClientPresence(conn: Connection, data: unknown): void {
    let audience: string | undefined;
    if (this.resolvePresenceAudience) {
      try {
        audience = this.resolvePresenceAudience({
          userId: conn.userId,
          role: conn.role,
          room: conn.room,
          lane: presenceLaneOf(data),
          data,
        });
      } catch {
        return; // fail closed; this also runs from the throttle timer, where a throw would crash
      }
      // A JS host can return anything; treat a non-string like a throw.
      if (audience !== undefined && typeof audience !== 'string') return;
    }
    this.presenceConnections.add(conn.id);
    const message = JSON.stringify({ from: conn.id, op: { kind: 'presence', data } });
    this.relayPresenceToRoom(conn.room, conn.id, message, audience);
    this.safePublish(
      JSON.stringify({
        o: this.instanceId,
        room: conn.room,
        from: conn.id,
        op: { kind: 'presence', data },
        ...(audience === undefined ? {} : { audience }),
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

  /**
   * Sends each member the ops it may read, in order. With `batched`, a member that advertised
   * opBatching gets each run of relayed ops as one `batch`; a hide-on-retag remove ends a run.
   */
  private deliverToRoom(
    room: string,
    excludeId: string | undefined,
    from: string,
    deliveries: readonly Delivery[],
    batched = false,
  ): void {
    const members = this.rooms.get(room);
    if (!members) return;
    const relayed = deliveries.map((): EncodedFrames => new Map());
    const hidden = deliveries.map((): EncodedFrames => new Map());
    // Keyed by the selected op indices: equal profiles alone do not mean equal batches.
    const batches = new Map<string, EncodedFrames>();
    for (const cid of members) {
      if (cid === excludeId) continue;
      const conn = this.conns.get(cid);
      if (!conn) continue;
      const grouped = batched && this.peerCapabilities.get(cid)?.opBatching === 1;
      let indices: number[] = [];
      let ops: BatchOp[] = [];
      const sendRun = () => {
        if (ops.length === 0) return;
        const key = indices.join(',');
        let encoded = batches.get(key);
        if (!encoded) {
          encoded = new Map();
          batches.set(key, encoded);
        }
        this.sendToConnection(conn, from, { kind: 'batch', ops }, encoded);
        indices = [];
        ops = [];
      };
      deliveries.forEach((delivery, index) => {
        const { op } = delivery;
        if (op.kind === 'upsert' && !this.mayReadElement(conn, op.element)) {
          if (!this.couldReadBefore(conn, delivery)) return;
          sendRun();
          const { id, version } = op.element;
          this.sendToConnection(
            conn,
            HUB_FROM,
            { kind: 'remove', id, version, editor: HUB_FROM },
            hidden[index],
          );
          return;
        }
        // With canRead, only recipients who could see the removed element get it.
        if (
          op.kind === 'remove' &&
          (this.canRead || this.gates.active) &&
          !this.couldReadBefore(conn, delivery)
        )
          return;
        const batchOp = grouped ? asBatchOp(op) : undefined;
        if (batchOp) {
          indices.push(index);
          ops.push(batchOp);
          return;
        }
        sendRun();
        this.sendToConnection(conn, from, op, relayed[index]);
      });
      sendRun();
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
      // A refused image would be dropped outbound, leaving the sender's copy in place.
      correction =
        this.mayReadElement(conn, current) && !hasRefusedImageSrc(current)
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
    if (this.gates.active && this.rooms.has(conn.room)) {
      const changed = await this.gates.refresh(conn.room, this.backend);
      // A failed reconcile leaves the room pending; this retries it.
      if (changed || this.gates.isPending(conn.room)) this.scheduleReconcile(conn.room);
    }
    const { elements: all, tombstones: stored } = await this.backend.snapshot(conn.room);
    const elements =
      this.canRead || this.gates.active ? all.filter((el) => this.mayReadElement(conn, el)) : all;
    const tombstones = stored
      .filter((tombstone) => this.mayRead(conn, tombstone.audience))
      .map(({ id, version, editor }) => ({ id, version, editor }));
    // Tombstones (id and version only) reach every viewer so one who saw the layer converges.
    const layers = (await this.getLayerRecords(conn.room)).filter(
      (r) => !r.definition || this.mayReadLayer(conn, r.definition),
    );
    const snapshotOp: Record<string, unknown> = { kind: 'snapshot', to, elements };
    if (layers.length > 0) snapshotOp['layers'] = layers;
    if (tombstones.length > 0) snapshotOp['tombstones'] = tombstones;
    const extensions: Record<string, PluginSnapshot> = {};
    for (const plugin of this.pluginRegistry.plugins) {
      let snapshot = await plugin.snapshot?.(conn.room, this.backend);
      if (!snapshot) continue;
      if (plugin.filterSnapshot) {
        snapshot =
          plugin.filterSnapshot(snapshot, {
            userId: conn.userId,
            role: conn.role,
            room: conn.room,
          }) ?? undefined;
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
    // Element ops pass the versioned rules too, so no versionless remove leaves this hub.
    if (!hasJsonDepthAtMost(payload, this.maxJsonDepth)) return;
    const parsed = parseLegacyEnvelope(payload);
    if (!parsed) return;
    const env: SyncEnvelope & {
      o?: unknown;
      room?: unknown;
      prev?: unknown;
      existed?: unknown;
      prevEl?: unknown;
      pluginOp?: unknown;
      audiences?: unknown;
      audience?: unknown;
      prevLayer?: unknown;
    } = parsed;
    if (typeof env.o !== 'string' || typeof env.room !== 'string') return;
    if (this.isAuthorityRoom(env.room)) return;
    if (env.o === this.instanceId) return; // our own publish — already delivered locally
    const op = env.op;
    if (isPresenceOp(op)) {
      if (op.kind === 'presence' && !this.isPresenceWithinLimit(op.data)) return;
      // The origin resolved the audience; presence-leave carries no data and reaches every member.
      const message = JSON.stringify({ from: env.from, op });
      if (op.kind === 'presence-leave') {
        this.relayToRoom(env.room, undefined, message);
        return;
      }
      if (env.audience !== undefined && typeof env.audience !== 'string') return;
      this.relayPresenceToRoom(env.room, undefined, message, env.audience);
      return;
    }
    if (isLayerOp(op)) {
      void this.applyFanoutLayerOp(env.room, op).catch(() => {
        /* a broken backend must not break the fanout relay */
      });
      if (!this.rooms.has(env.room)) this.scheduleIdleEviction(env.room);
      // Absent or null `prevLayer` means no readable previous record; a malformed one drops the frame.
      let prev: Layer | undefined;
      if (this.canReadLayer && env.prevLayer !== undefined && env.prevLayer !== null) {
        if (!isValidLayerDefinition(env.prevLayer)) return;
        prev = env.prevLayer;
      }
      this.relayLayerOpToRoom(env.room, undefined, env.from, op, prev);
      return;
    }
    if (
      op.kind === 'extension' &&
      !this.pluginRegistry.extension(op.extensionKind)?.kind.codec.validate(op.payload)
    )
      return;
    const plugin = this.ownerOfOp(op);
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
            await this.refreshGatesAfter(env.room as string, accepted);
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
    const prior = {
      prevAudience,
      existed: env.existed === true,
      prevElement: prevElementOf(env.prevEl, op),
    };
    if (env.pluginOp === true) this.relayOpToRoom(env.room, undefined, env.from, op, prior);
    else this.deliverToRoom(env.room, undefined, env.from, [{ op, ...prior }]);
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
          this.gates.drop(room);
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
    for (const admission of this.legacyAdmissionTimers.values()) clearTimeout(admission.timer);
    this.legacyAdmissionTimers.clear();
    for (const timer of this.idleTimers.values()) clearTimeout(timer);
    this.idleTimers.clear();
    this.fanoutUnsub();
  }
}
