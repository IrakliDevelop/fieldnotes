import { randomBytes } from 'node:crypto';
import {
  createAuthorityCapabilities,
  prepareAuthorityCheckpoint,
  parseAuthorityClientFrame,
  parseEnvelope,
  serializeAuthorityFrame,
} from '@fieldnotes/sync';
import type {
  AuthorityCheckpointPayload,
  AuthorityCursor,
  AuthorityServerFrame,
  PreparedAuthorityCheckpoint,
} from '@fieldnotes/sync';
import { authorityConnectionBinding } from './authority-connection';
import {
  authorityCapabilitiesMatch,
  authorityExtensionCapabilityKinds,
  authorityReadContext,
  pinAuthorityDefinition,
  resolveAuthorityIdentity,
} from './authority-admission';
import { prepareAuthorityProposal } from './authority-proposal';
import { prepareAuthorityIntent } from './authority-intent';
import { AuthorityPublisher, parseAuthorityWake } from './authority-publisher';
import { AuthorityScheduler } from './authority-scheduler';
import { projectAuthorityChange, projectAuthorityState } from './authority-projection';
import { SerialRoomQueue } from './serial-room-queue';
import { hasJsonDepthAtMost } from './resource-limits';
import { hashAuthorityJson, measureAuthorityJson } from './authority-json';
import { sendPreparedAuthorityCheckpoint } from './authority-checkpoint-stream';
import {
  assertAuthorityLeaseHeader,
  assertAuthorityReadPage,
  isAuthorityPosition,
} from './authority-driver-results';
import type { AuthorityConnectionBinding } from './authority-connection';
import type {
  AuthorityIdentity,
  AuthorityOptions,
  AuthorityPosition,
  AuthorityReadContext,
  AuthorityReadPage,
  AuthorityRoomDefinition,
  AuthorityState,
} from './authority-types';
import type { HubFanout } from './hub-fanout';
import type { Connection, MessageDispatchOptions } from './sync-hub';

type Phase = 'negotiating' | 'awaiting-request' | 'preparing' | 'streaming' | 'live';
type OperationEligibility = Pick<AuthorityReadContext, 'deadlineAt' | 'signal'>;
interface EffectOwnership {
  readonly phase?: Phase;
  readonly streamToken?: number;
  readonly requestEpisode?: object;
}
interface PreparedNegotiation {
  readonly generation: string;
  readonly capabilities: ReturnType<typeof createAuthorityCapabilities>;
  readonly requestEpisode: object;
}
type PreparedReplay =
  | { readonly status: 'reconcile' }
  | { readonly status: 'silent'; readonly visibleHash: string }
  | {
      readonly status: 'changes';
      readonly encoded: string;
      readonly cursor: AuthorityCursor;
      readonly position: AuthorityPosition;
      readonly visibleHash: string;
    };
interface Peer {
  readonly connection: Connection;
  readonly binding: AuthorityConnectionBinding;
  readonly definition: AuthorityRoomDefinition;
  readonly release: () => void;
  readonly lifetime: AbortSignal;
  readonly onLifetimeAbort: () => void;
  readonly inbound: SerialRoomQueue;
  phase: Phase;
  identity?: AuthorityIdentity;
  position?: AuthorityPosition;
  cursor?: AuthorityCursor;
  visibleHash?: string;
  capabilitiesHash?: string;
  reconciling?: boolean;
  sending?: boolean;
  dirty?: boolean;
  sendToken?: object;
  cancelNegotiation?: () => void;
  negotiationTimer?: ReturnType<typeof setTimeout>;
  negotiationDeadlineAt?: number;
  requestTimer?: ReturnType<typeof setTimeout>;
  requestEpisode?: object;
  requestDeadlineAt?: number;
  cancelPendingCapture?: () => void;
  activated?: boolean;
  generation?: string;
  streamToken: number;
  activeRequestId?: string;
  streamBusy?: boolean;
  lastClientRequestAt?: number;
  recoveryRequest?: boolean;
  resetTimes: number[];
}

function samePosition(a: AuthorityPosition, b: AuthorityPosition): boolean {
  return a.generation === b.generation && a.revision === b.revision;
}
class AuthorityGenerationChanged extends Error {
  constructor(
    readonly generation: string,
    readonly operation: OperationEligibility,
  ) {
    super('Authority generation changed');
  }
}
/** Isolated internal authority lane. */
export class AuthorityRuntime {
  private readonly peers = new Map<string, Peer>();
  private readonly roomPins = new Map<string, { definitionId: string; count: number }>();
  private readonly scheduler = new AuthorityScheduler();
  private readonly publisher: AuthorityPublisher;
  private readonly polling: ReturnType<typeof setInterval>;
  private readonly unsubscribe: () => void;
  private closed = false;

  constructor(
    private readonly options: AuthorityOptions,
    fanout: HubFanout,
    instanceId: string,
  ) {
    this.publisher = new AuthorityPublisher(options.driver, fanout, instanceId, this.scheduler);
    this.unsubscribe = fanout.subscribe((payload) => {
      const wake = parseAuthorityWake(payload);
      if (!wake) return;
      for (const peer of this.peers.values()) {
        if (peer.connection.room === wake.room && peer.definition.id === wake.definitionId)
          this.wake(peer);
      }
    });
    this.polling = setInterval(() => {
      for (const peer of this.peers.values()) {
        if (peer.phase === 'live' && !peer.reconciling && !peer.sending)
          this.scheduler.schedule(peer.connection.id, 'metadata', () => this.pollHead(peer));
      }
    }, 1000);
    this.polling.unref?.();
  }

  admit(connection: Connection, originalDefinition: AuthorityRoomDefinition): boolean {
    if (this.closed) {
      connection.close?.(1013);
      return false;
    }
    const binding = authorityConnectionBinding(connection);
    if (!binding || !connection.signal || !connection.close) {
      connection.close?.(1013);
      return false;
    }
    let definition: AuthorityRoomDefinition;
    try {
      definition = pinAuthorityDefinition(originalDefinition);
    } catch {
      connection.close(1013);
      return false;
    }
    const existing = this.roomPins.get(connection.room);
    if (existing && existing.definitionId !== definition.id) {
      connection.close(1013);
      return false;
    }
    const release = this.scheduler.admitPeer(connection.id, connection.room, true, () => {
      const pin = this.roomPins.get(connection.room);
      if (!pin) return;
      if (pin.count === 1) this.roomPins.delete(connection.room);
      else pin.count--;
    });
    if (!release) {
      connection.close(1013);
      return false;
    }
    if (existing) existing.count++;
    else this.roomPins.set(connection.room, { definitionId: definition.id, count: 1 });
    const onLifetimeAbort = (): void => {
      if (this.peers.get(connection.id) === peer) this.remove(connection.id);
    };
    const peer: Peer = {
      connection,
      binding,
      definition,
      release,
      lifetime: connection.signal,
      onLifetimeAbort,
      inbound: new SerialRoomQueue(() => undefined),
      phase: 'negotiating',
      streamToken: 0,
      resetTimes: [],
    };
    this.peers.set(connection.id, peer);
    connection.signal.addEventListener('abort', onLifetimeAbort, { once: true });
    const negotiationDeadlineAt = Math.min(Date.now() + 5000, connection.expiresAt ?? Infinity);
    peer.negotiationDeadlineAt = negotiationDeadlineAt;
    peer.negotiationTimer = setTimeout(
      () => {
        if (this.peers.get(connection.id) !== peer || peer.phase !== 'negotiating') return;
        this.operationCurrent(
          peer,
          { deadlineAt: negotiationDeadlineAt, signal: peer.lifetime },
          4406,
        );
      },
      Math.max(0, negotiationDeadlineAt - Date.now()),
    );
    return true;
  }

  pinnedDefinitionId(room: string): string | undefined {
    return this.roomPins.get(room)?.definitionId;
  }

  remove(connectionId: string): void {
    const peer = this.peers.get(connectionId);
    if (!peer) return;
    this.peers.delete(connectionId);
    peer.lifetime.removeEventListener('abort', peer.onLifetimeAbort);
    if (peer.negotiationTimer) clearTimeout(peer.negotiationTimer);
    peer.negotiationDeadlineAt = undefined;
    this.clearRequestWait(peer);
    peer.cancelNegotiation?.();
    peer.cancelPendingCapture?.();
    peer.streamToken++;
    peer.release();
  }

  private current(peer: Peer): boolean {
    if (this.closed || this.peers.get(peer.connection.id) !== peer || peer.lifetime.aborted)
      return false;
    if (peer.connection.expiresAt !== undefined && Date.now() >= peer.connection.expiresAt) {
      this.fail(peer, 4401);
      return false;
    }
    try {
      const resolved = this.options.resolveRoom(peer.connection.room);
      if (!resolved || resolved.id !== peer.definition.id)
        throw new Error('Authority definition changed');
      if (this.closed || this.peers.get(peer.connection.id) !== peer || peer.lifetime.aborted)
        return false;
      if (peer.connection.expiresAt !== undefined && Date.now() >= peer.connection.expiresAt) {
        this.fail(peer, 4401);
        return false;
      }
      return true;
    } catch {
      this.fail(peer, 1013);
      return false;
    }
  }

  private operationCurrent(
    peer: Peer,
    operation: Pick<AuthorityReadContext, 'deadlineAt' | 'signal'>,
    timeoutCode: 4406 | 1013 = 1013,
  ): boolean {
    if (!this.current(peer)) return false;
    if (!operation.signal.aborted && Date.now() < operation.deadlineAt) return true;
    // resolveRoom can consume the last eligible millisecond; preserve expiry precedence.
    if (!this.current(peer)) return false;
    this.fail(peer, timeoutCode);
    return false;
  }

  /** Configuration may run arbitrary code, so the final admission check is callback-free. */
  private effectEligible(
    peer: Peer,
    operation: OperationEligibility,
    ownership: EffectOwnership = {},
  ): boolean {
    if (!this.current(peer)) return false;
    if (this.closed || this.peers.get(peer.connection.id) !== peer || peer.lifetime.aborted)
      return false;
    const now = Date.now();
    if (peer.connection.expiresAt !== undefined && now >= peer.connection.expiresAt) {
      this.fail(peer, 4401);
      return false;
    }
    if (
      (ownership.phase !== undefined && peer.phase !== ownership.phase) ||
      (ownership.streamToken !== undefined && peer.streamToken !== ownership.streamToken) ||
      (ownership.requestEpisode !== undefined && peer.requestEpisode !== ownership.requestEpisode)
    )
      return false;
    if (operation.signal.aborted || now >= operation.deadlineAt) {
      this.fail(peer, 1013);
      return false;
    }
    return true;
  }

  private negotiationCurrent(peer: Peer): boolean {
    if (peer.phase !== 'negotiating' || peer.negotiationDeadlineAt === undefined) return false;
    return this.operationCurrent(
      peer,
      { deadlineAt: peer.negotiationDeadlineAt, signal: peer.lifetime },
      4406,
    );
  }

  private fail(peer: Peer, code: 4401 | 4403 | 4406 | 1013): void {
    if (this.peers.get(peer.connection.id) !== peer) return;
    this.remove(peer.connection.id);
    peer.connection.close?.(code);
  }

  private clearRequestWait(peer: Peer): void {
    if (peer.requestTimer) clearTimeout(peer.requestTimer);
    peer.requestTimer = undefined;
    peer.requestEpisode = undefined;
    peer.requestDeadlineAt = undefined;
  }

  private enterRequestWait(peer: Peer): object {
    this.clearRequestWait(peer);
    const episode = {};
    peer.requestEpisode = episode;
    peer.phase = 'awaiting-request';
    return episode;
  }

  private ownsRequestWait(peer: Peer, episode: object): boolean {
    return (
      this.current(peer) && peer.phase === 'awaiting-request' && peer.requestEpisode === episode
    );
  }

  private armRequestWait(peer: Peer, episode: object): void {
    if (!this.ownsRequestWait(peer, episode) || peer.requestDeadlineAt !== undefined) return;
    const deadlineAt = Math.min(Date.now() + 10_000, peer.connection.expiresAt ?? Infinity);
    peer.requestDeadlineAt = deadlineAt;
    peer.requestTimer = setTimeout(
      () => {
        if (!this.ownsRequestWait(peer, episode) || peer.requestDeadlineAt !== deadlineAt) return;
        if (Date.now() >= deadlineAt) this.fail(peer, 1013);
      },
      Math.max(0, deadlineAt - Date.now()),
    );
  }

  private send(
    peer: Peer,
    frame: AuthorityServerFrame,
    operation?: OperationEligibility,
  ): Promise<void> {
    const encoded = serializeAuthorityFrame(frame);
    if (operation ? !this.effectEligible(peer, operation) : !this.current(peer))
      return Promise.reject(new Error('Authority peer unavailable'));
    const releasePeer = this.scheduler.retainPeer(peer.connection.id);
    if (!releasePeer) return Promise.reject(new Error('Authority peer unavailable'));
    let tracked: ReturnType<AuthorityConnectionBinding['sendTracked']>;
    try {
      tracked = peer.binding.sendTracked(encoded);
    } catch (error) {
      releasePeer();
      return Promise.reject(error);
    }
    // FrameTransport retains physical budget until settled; observe its nonrejecting outcome.
    void tracked.settled.then(releasePeer);
    return tracked.completion;
  }

  private async upgrade(peer: Peer): Promise<void> {
    const timer = setTimeout(() => this.fail(peer, 4406), 5000);
    try {
      await this.send(peer, {
        protocol: 'authority:1',
        kind: 'upgrade-required',
        required: 'authority:1',
      });
    } catch {
      /* closure is the security boundary */
    } finally {
      clearTimeout(timer);
      this.fail(peer, 4406);
    }
  }

  async handleMessage(
    connectionId: string,
    message: string,
    dispatch?: MessageDispatchOptions,
  ): Promise<void> {
    const peer = this.peers.get(connectionId);
    if (!peer || !this.current(peer)) return;
    return peer.inbound.enqueue(() => this.processMessage(peer, message, dispatch), dispatch);
  }

  private async processMessage(
    peer: Peer,
    message: string,
    dispatch?: MessageDispatchOptions,
  ): Promise<void> {
    if (!this.current(peer)) return;
    if (Buffer.byteLength(message, 'utf8') > 1_048_576 || !hasJsonDepthAtMost(message, 64)) {
      this.fail(peer, 1013);
      return;
    }
    if (dispatch) {
      if (
        dispatch.signal.aborted ||
        Date.now() >= dispatch.deadlineAt ||
        (await dispatch.beforeProcess()) !== true ||
        !this.current(peer)
      )
        return;
    }
    if (peer.phase === 'negotiating') {
      if (!this.negotiationCurrent(peer)) return;
      const envelope = parseEnvelope(message);
      if (
        envelope?.op.kind !== 'capabilities' ||
        !authorityCapabilitiesMatch(envelope.op.capabilities, peer.definition)
      )
        return this.upgrade(peer);
      peer.capabilitiesHash = hashAuthorityJson(envelope.op.capabilities);
      await new Promise<void>((resolve) => {
        let completed = false;
        const complete = (): void => {
          if (completed) return;
          completed = true;
          if (peer.cancelNegotiation === complete) peer.cancelNegotiation = undefined;
          resolve();
        };
        peer.cancelNegotiation = complete;
        let prepared: PreparedNegotiation | undefined;
        this.scheduler.schedule(
          peer.connection.id,
          'metadata',
          async () => {
            try {
              if (this.negotiationCurrent(peer)) prepared = await this.prepareNegotiation(peer);
            } catch {
              this.fail(peer, 1013);
            }
          },
          () => {
            if (!prepared || !this.current(peer)) {
              complete();
              return;
            }
            void this.deliverNegotiation(peer, prepared)
              .catch(() => this.fail(peer, 1013))
              .finally(complete);
          },
        );
      });
      return;
    }
    const repeatedCapabilities = parseEnvelope(message);
    if (repeatedCapabilities?.op.kind === 'capabilities') {
      if (
        !authorityCapabilitiesMatch(repeatedCapabilities.op.capabilities, peer.definition) ||
        hashAuthorityJson(repeatedCapabilities.op.capabilities) !== peer.capabilitiesHash
      )
        this.fail(peer, 4406);
      return;
    }
    const frame = parseAuthorityClientFrame(message);
    if (frame?.kind === 'checkpoint-request') {
      this.requestCheckpoint(peer, frame);
      return;
    }
    if (
      frame?.kind !== 'propose' ||
      (peer.phase !== 'live' &&
        !(peer.activated && (peer.phase === 'preparing' || peer.phase === 'streaming')))
    ) {
      await this.upgrade(peer);
      return;
    }
    await this.commit(peer, message, dispatch);
  }

  private async prepareNegotiation(peer: Peer): Promise<PreparedNegotiation | undefined> {
    if (!this.negotiationCurrent(peer)) return;
    peer.identity = resolveAuthorityIdentity(this.options, peer.connection);
    if (!this.negotiationCurrent(peer)) return;
    const context = this.readContext(peer, peer.negotiationDeadlineAt);
    if (!this.negotiationCurrent(peer)) return;
    const head = await this.options.driver.head(context, {
      deadlineAt: context.deadlineAt,
      signal: context.signal,
    });
    if (!this.negotiationCurrent(peer)) return;
    if (!isAuthorityPosition(head)) throw new Error('Invalid authority head');
    if (!this.negotiationCurrent(peer)) return;
    this.scheduler.promotePeer(peer.connection.id);
    if (peer.negotiationTimer) clearTimeout(peer.negotiationTimer);
    peer.negotiationDeadlineAt = undefined;
    const requestEpisode = this.enterRequestWait(peer);
    peer.generation = head.generation;
    return {
      generation: head.generation,
      requestEpisode,
      capabilities: createAuthorityCapabilities(
        authorityExtensionCapabilityKinds(peer.definition.extensions),
        peer.definition.extensions.map((extension) => extension.requirement),
      ),
    };
  }

  private async deliverNegotiation(peer: Peer, prepared: PreparedNegotiation): Promise<void> {
    if (!this.ownsRequestWait(peer, prepared.requestEpisode)) return;
    await this.sendLegacyCapabilities(peer, prepared.capabilities);
    if (!this.ownsRequestWait(peer, prepared.requestEpisode)) return;
    await this.send(peer, {
      protocol: 'authority:1',
      kind: 'resync-required',
      generation: prepared.generation,
      reason: 'checkpoint-required',
    });
    this.armRequestWait(peer, prepared.requestEpisode);
  }

  private async sendLegacyCapabilities(
    peer: Peer,
    capabilities: ReturnType<typeof createAuthorityCapabilities>,
  ): Promise<void> {
    if (!this.current(peer)) return;
    const releasePeer = this.scheduler.retainPeer(peer.connection.id);
    if (!releasePeer) return;
    let tracked: ReturnType<AuthorityConnectionBinding['sendTracked']>;
    try {
      tracked = peer.binding.sendTracked(
        JSON.stringify({ from: 'hub', op: { kind: 'capabilities', capabilities } }),
      );
    } catch (error) {
      releasePeer();
      throw error;
    }
    void tracked.settled.then(releasePeer);
    await tracked.completion;
  }

  private requestCheckpoint(
    peer: Peer,
    request: Extract<ReturnType<typeof parseAuthorityClientFrame>, { kind: 'checkpoint-request' }>,
  ): void {
    if (!request || !this.current(peer)) return;
    if (peer.phase === 'preparing' || peer.phase === 'streaming') {
      if (request.requestId !== peer.activeRequestId) this.fail(peer, 1013);
      return;
    }
    if (peer.phase !== 'awaiting-request' && peer.phase !== 'live') return this.fail(peer, 4406);
    if (peer.phase === 'awaiting-request' && peer.requestDeadlineAt !== undefined) {
      if (Date.now() >= peer.requestDeadlineAt) return this.fail(peer, 1013);
    }
    if (peer.streamBusy) return this.fail(peer, 1013);
    if (request.generation !== peer.generation) return this.fail(peer, 1013);
    const now = Date.now();
    if (
      !peer.recoveryRequest &&
      peer.lastClientRequestAt !== undefined &&
      now - peer.lastClientRequestAt < 10_000
    )
      return this.fail(peer, 1013);
    peer.recoveryRequest = false;
    peer.lastClientRequestAt = now;
    this.clearRequestWait(peer);
    peer.phase = 'preparing';
    peer.reconciling = false;
    peer.sendToken = undefined;
    peer.sending = false;
    peer.activeRequestId = request.requestId;
    const token = ++peer.streamToken;
    const releaseReservedStream = this.scheduler.reserve('stream', peer.connection.id);
    if (!releaseReservedStream) return this.fail(peer, 1013);
    peer.streamBusy = true;
    const releaseStream = (): void => {
      if (!peer.streamBusy) return;
      peer.streamBusy = false;
      releaseReservedStream();
    };
    const preparationDeadlineAt = Math.min(now + 5000, peer.connection.expiresAt ?? Infinity);
    const cancelPreparationDeadline = this.armDeadline(peer, preparationDeadlineAt);
    const preparationCurrent = (): boolean => {
      if (!this.currentStream(peer, token, 'preparing')) return false;
      if (Date.now() < preparationDeadlineAt) return true;
      this.fail(peer, 1013);
      return false;
    };
    const cancelPendingCapture = (): void => {
      if (peer.cancelPendingCapture !== cancelPendingCapture) return;
      peer.cancelPendingCapture = undefined;
      cancelPreparationDeadline();
      releaseStream();
    };
    peer.cancelPendingCapture = cancelPendingCapture;
    let prepared: PreparedAuthorityCheckpoint | undefined;
    let cut: AuthorityPosition | undefined;
    let visibleHash: string | undefined;
    let error = false;
    this.scheduler.schedule(
      peer.connection.id,
      'heavy',
      async () => {
        // The scheduler has actually started work: its settlement callback now owns the stream.
        if (peer.cancelPendingCapture === cancelPendingCapture)
          peer.cancelPendingCapture = undefined;
        try {
          if (!preparationCurrent()) return;
          const context = this.readContext(peer, preparationDeadlineAt);
          const capture = await this.options.driver.checkpoint(context, {
            deadlineAt: context.deadlineAt,
            signal: context.signal,
          });
          try {
            assertAuthorityLeaseHeader(capture, Date.now());
            if (!preparationCurrent()) return;
            if (!isAuthorityPosition(capture.position))
              throw new Error('Invalid authority capture');
            if (
              capture.casToken !== undefined &&
              (typeof capture.casToken !== 'string' || !/^[0-9a-fA-F]{64}$/.test(capture.casToken))
            )
              throw new Error('Invalid authority capture');
            if (capture.position.generation !== request.generation) {
              this.dispatchRecovery(
                peer,
                capture.position.generation,
                { deadlineAt: preparationDeadlineAt, signal: peer.lifetime },
                { phase: 'preparing', streamToken: token },
              );
              return;
            }
            const visible = projectAuthorityState(peer.definition, context, capture.state);
            const cursor: AuthorityCursor = {
              generation: capture.position.generation,
              streamId: randomBytes(16).toString('hex'),
              revision: 0,
            };
            const payload: AuthorityCheckpointPayload = {
              ...visible.state,
              cursor,
              ...(capture.casToken === undefined ? {} : { casToken: capture.casToken }),
            };
            measureAuthorityJson(payload);
            if (!preparationCurrent()) return;
            prepared = await prepareAuthorityCheckpoint(payload, {
              requestId: request.requestId,
              checkpointId: randomBytes(16).toString('hex'),
              requiredExtensions: peer.definition.extensions.map(
                (extension) => extension.requirement,
              ),
              signal: peer.lifetime,
            });
            if (!preparationCurrent()) return;
            cut = capture.position;
            visibleHash = visible.hash;
          } finally {
            if (capture && typeof capture.release === 'function') await capture.release();
          }
          if (!preparationCurrent()) return;
        } catch {
          error = true;
        } finally {
          cancelPreparationDeadline();
        }
      },
      () => {
        if (error) this.fail(peer, 1013);
        if (!prepared || !cut || !visibleHash || !preparationCurrent()) {
          prepared?.dispose();
          releaseStream();
          return;
        }
        peer.phase = 'streaming';
        void this.deliverCheckpoint(peer, token, prepared, cut, visibleHash, releaseStream);
      },
    );
  }

  private currentStream(peer: Peer, token: number, phase: Phase): boolean {
    return this.current(peer) && peer.streamToken === token && peer.phase === phase;
  }

  private async deliverCheckpoint(
    peer: Peer,
    token: number,
    prepared: PreparedAuthorityCheckpoint,
    cut: AuthorityPosition,
    visibleHash: string,
    releaseStream: () => void,
  ): Promise<void> {
    let lastSettled: Promise<void> = Promise.resolve();
    try {
      const result = await sendPreparedAuthorityCheckpoint(
        prepared,
        (message, _kind, streamDeadlineAt) => {
          if (!this.currentStream(peer, token, 'streaming'))
            throw new Error('Authority stream unavailable');
          if (Date.now() >= streamDeadlineAt) throw new Error('Authority stream unavailable');
          const releasePeer = this.scheduler.retainPeer(peer.connection.id);
          if (!releasePeer) throw new Error('Authority peer unavailable');
          let tracked: ReturnType<AuthorityConnectionBinding['sendTracked']>;
          try {
            if (!this.currentStream(peer, token, 'streaming') || Date.now() >= streamDeadlineAt)
              throw new Error('Authority stream unavailable');
            tracked = peer.binding.sendTracked(message, {
              validate: async (job) => {
                const releaseMetadata = this.scheduler.reserve('metadata', peer.connection.id);
                if (!releaseMetadata) throw new Error('Authority metadata saturated');
                try {
                  if (!this.currentStream(peer, token, 'streaming')) return false;
                  if (!peer.identity) return false;
                  const deadlineAt = Math.min(
                    job.deadlineAt,
                    streamDeadlineAt,
                    peer.connection.expiresAt ?? Infinity,
                  );
                  if (Date.now() >= deadlineAt) return false;
                  const context = authorityReadContext(
                    peer.connection,
                    peer.identity,
                    peer.definition.id,
                    job.signal,
                    deadlineAt,
                  );
                  const head = await this.options.driver.head(context, {
                    deadlineAt,
                    signal: context.signal,
                  });
                  if (!this.currentStream(peer, token, 'streaming') || Date.now() >= deadlineAt)
                    return false;
                  if (!isAuthorityPosition(head)) throw new Error('Invalid authority head');
                  if (head.generation !== cut.generation)
                    throw new AuthorityGenerationChanged(head.generation, context);
                  return this.currentStream(peer, token, 'streaming') && Date.now() < deadlineAt;
                } finally {
                  releaseMetadata();
                }
              },
              current: () =>
                this.currentStream(peer, token, 'streaming') && Date.now() < streamDeadlineAt,
            });
          } catch (error) {
            releasePeer();
            throw error;
          }
          void tracked.settled.then(releasePeer);
          return tracked;
        },
        peer.lifetime,
        (tracked) => {
          lastSettled = tracked.settled;
        },
        async (_kind, streamDeadline) => {
          const releaseMetadata = this.scheduler.reserve('metadata', peer.connection.id);
          if (!releaseMetadata) throw new Error('Authority metadata saturated');
          const deadlineAt = Math.min(
            Date.now() + 5000,
            peer.connection.expiresAt ?? Infinity,
            streamDeadline ?? Infinity,
          );
          // Closing the caller is prompt; the owning await and reservations persist until head settles.
          const timer = setTimeout(
            () =>
              this.fail(peer, Date.now() >= (peer.connection.expiresAt ?? Infinity) ? 4401 : 1013),
            Math.max(0, deadlineAt - Date.now()),
          );
          try {
            if (!this.currentStream(peer, token, 'streaming') || Date.now() >= deadlineAt)
              throw new Error('Authority stream unavailable');
            const context = this.readContext(peer, deadlineAt);
            const head = await this.options.driver.head(context, {
              deadlineAt,
              signal: context.signal,
            });
            if (!this.currentStream(peer, token, 'streaming') || Date.now() >= deadlineAt)
              throw new Error('Authority stream unavailable');
            if (!isAuthorityPosition(head)) throw new Error('Invalid authority head');
            if (head.generation !== cut.generation)
              throw new AuthorityGenerationChanged(head.generation, context);
          } finally {
            clearTimeout(timer);
            releaseMetadata();
          }
        },
      );
      if (!this.currentStream(peer, token, 'streaming')) return;
      if (Date.now() >= result.deadlineAt) throw new Error('Authority checkpoint timed out');
      peer.position = cut;
      peer.cursor = result.manifest.cursor;
      peer.visibleHash = visibleHash;
      peer.phase = 'live';
      peer.activated = true;
      peer.activeRequestId = undefined;
      peer.reconciling = false;
      this.wake(peer);
      await result.settled;
    } catch (error) {
      if (error instanceof AuthorityGenerationChanged)
        this.dispatchRecovery(peer, error.generation, error.operation, {
          phase: 'streaming',
          streamToken: token,
        });
      else this.fail(peer, 1013);
      await lastSettled;
    } finally {
      releaseStream();
    }
  }

  /** Internal test seam for already validated cuts. Production uses complete streaming. */
  activate(connectionId: string, position: AuthorityPosition, state: AuthorityState): void {
    const peer = this.peers.get(connectionId);
    if (!peer || !peer.identity || !this.current(peer) || !isAuthorityPosition(position))
      throw new Error('Authority activation unavailable');
    const visible = projectAuthorityState(peer.definition, this.readContext(peer), state);
    this.clearRequestWait(peer);
    peer.position = position;
    peer.generation = position.generation;
    peer.visibleHash = visible.hash;
    peer.reconciling = false;
    peer.cursor = {
      generation: position.generation,
      streamId: randomBytes(16).toString('hex'),
      revision: 0,
    };
    peer.phase = 'live';
    peer.activated = true;
    this.wake(peer);
  }

  private readContext(peer: Peer, deadlineAt?: number): AuthorityReadContext {
    if (!peer.identity) throw new Error('Authority identity unavailable');
    return authorityReadContext(
      peer.connection,
      peer.identity,
      peer.definition.id,
      peer.lifetime,
      deadlineAt,
    );
  }

  private armDeadline(peer: Peer, deadlineAt: number): () => void {
    const timer = setTimeout(() => this.fail(peer, 1013), Math.max(0, deadlineAt - Date.now()));
    return () => clearTimeout(timer);
  }

  private async commit(
    peer: Peer,
    message: string,
    dispatch?: MessageDispatchOptions,
  ): Promise<void> {
    if (!peer.identity || !peer.position || !this.current(peer)) return;
    const heavyRelease = this.scheduler.reserve('heavy', peer.connection.id);
    if (!heavyRelease) return this.fail(peer, 1013);
    let prepared: ReturnType<typeof prepareAuthorityProposal>;
    let intent: ReturnType<typeof prepareAuthorityIntent>;
    try {
      prepared = prepareAuthorityProposal(
        {
          ...this.readContext(peer),
          deadlineAt: Math.min(Date.now() + 5000, dispatch?.deadlineAt ?? Infinity),
          signal: dispatch?.signal ?? peer.lifetime,
        },
        message,
      );
      intent = prepareAuthorityIntent(prepared.proposal, peer.definition.extensions);
    } catch {
      heavyRelease();
      this.fail(peer, 1013);
      return;
    }
    heavyRelease();
    if (!this.operationCurrent(peer, prepared.context)) return;
    const commitRelease = this.scheduler.reserve('commit', peer.connection.id);
    if (!commitRelease) return this.fail(peer, 1013);
    const cancelDeadline = this.armDeadline(peer, prepared.context.deadlineAt);
    let committedWorkSettled = false;
    try {
      if (!this.operationCurrent(peer, prepared.context)) return;
      const result = await this.options.driver.commit(
        Object.freeze({
          ...prepared.context,
          ownershipId: peer.identity.ownershipId,
          definitionId: peer.definition.id,
        }),
        { proposal: prepared.proposal, intent },
      );
      cancelDeadline();
      commitRelease();
      committedWorkSettled = true;
      if (result.status === 'committed') {
        if (
          !isAuthorityPosition(result.position) ||
          result.position.generation !== prepared.proposal.generation ||
          result.receipt.generation !== prepared.proposal.generation ||
          result.receipt.clientOperationId !== prepared.proposal.clientOperationId ||
          typeof result.replayed !== 'boolean'
        )
          throw new Error('Invalid authority commit result');
        this.publisher.wake();
        if (this.operationCurrent(peer, prepared.context)) {
          await this.send(
            peer,
            {
              protocol: 'authority:1',
              kind: 'receipt',
              receipt: result.receipt,
            },
            prepared.context,
          );
          if (this.operationCurrent(peer, prepared.context)) this.wake(peer, prepared.context);
        }
      } else if (result.status === 'rejected') {
        if (
          ![
            'forbidden',
            'invalid',
            'generation-mismatch',
            'conflict',
            'expired',
            'overloaded',
            'unsupported-extension',
            'operation-id-reused',
            'retry-window-expired',
          ].includes(result.reason)
        )
          throw new Error('Invalid authority rejection');
        if (this.operationCurrent(peer, prepared.context))
          await this.send(
            peer,
            {
              protocol: 'authority:1',
              kind: 'rejected',
              generation: prepared.proposal.generation,
              clientOperationId: prepared.proposal.clientOperationId,
              reason: result.reason,
            },
            prepared.context,
          );
      } else {
        throw new Error('Invalid authority commit result');
      }
    } catch {
      // Once commit was invoked, a timeout or throw is UNKNOWN, never a rejection.
      this.fail(peer, 1013);
    } finally {
      cancelDeadline();
      if (!committedWorkSettled) commitRelease();
    }
  }

  private wake(peer: Peer, context?: OperationEligibility, streamToken?: number): void {
    if (context) {
      if (!this.effectEligible(peer, context, { phase: 'live', streamToken })) return;
    } else if (peer.phase !== 'live' || !this.current(peer)) return;
    if (peer.sending) {
      peer.dirty = true;
      return;
    }
    if (peer.reconciling) return;
    peer.dirty = false;
    this.scheduler.schedule(peer.connection.id, 'metadata', () => this.read(peer));
  }

  private async pollHead(peer: Peer): Promise<void> {
    if (!this.current(peer) || peer.phase !== 'live' || !peer.position) return;
    let cancelDeadline: (() => void) | undefined;
    try {
      const context = this.readContext(peer);
      cancelDeadline = this.armDeadline(peer, context.deadlineAt);
      if (!this.operationCurrent(peer, context)) return;
      const head = await this.options.driver.head(context, {
        deadlineAt: context.deadlineAt,
        signal: context.signal,
      });
      if (!this.operationCurrent(peer, context) || peer.phase !== 'live') return;
      if (!isAuthorityPosition(head)) throw new Error('Invalid authority head');
      if (!this.operationCurrent(peer, context)) return;
      if (head.generation !== peer.position.generation) this.queueReconcile(peer, context);
      else if (!samePosition(head, peer.position)) this.wake(peer, context);
    } catch {
      this.fail(peer, 1013);
    } finally {
      cancelDeadline?.();
    }
  }

  private async read(peer: Peer): Promise<void> {
    if (!this.current(peer) || peer.phase !== 'live' || !peer.position || !peer.cursor) return;
    if (peer.sending) {
      peer.dirty = true;
      return;
    }
    const cut = peer.position;
    let cancelDeadline: (() => void) | undefined;
    try {
      const context = this.readContext(peer);
      cancelDeadline = this.armDeadline(peer, context.deadlineAt);
      if (!this.operationCurrent(peer, context)) return;
      const page = await this.options.driver.readAfter(
        context,
        cut,
        { entries: 8, bytes: 64 * 1024 },
        { deadlineAt: context.deadlineAt, signal: context.signal },
      );
      if (!this.operationCurrent(peer, context) || peer.phase !== 'live') return;
      assertAuthorityReadPage(cut, page);
      if (!this.operationCurrent(peer, context)) return;
      if (page.status === 'gap') return this.queueReconcile(peer, context);
      if (page.head.generation !== cut.generation) return this.queueReconcile(peer, context);
      await this.processPage(peer, cut, page, false, context);
    } catch {
      this.fail(peer, 1013);
    } finally {
      cancelDeadline?.();
    }
  }

  private async processPage(
    peer: Peer,
    cut: AuthorityPosition,
    page: AuthorityReadPage,
    hasHeavyReservation = false,
    inheritedContext?: AuthorityReadContext,
  ): Promise<void> {
    if (
      page.status !== 'ok' ||
      !this.current(peer) ||
      peer.phase !== 'live' ||
      !peer.position ||
      !peer.cursor
    )
      return;
    const replayStreamToken = peer.streamToken;
    let cancelDeadline: (() => void) | undefined;
    try {
      const context = inheritedContext ?? this.readContext(peer);
      cancelDeadline = this.armDeadline(peer, context.deadlineAt);
      if (!this.operationCurrent(peer, context)) return;
      if (!samePosition(peer.position, cut)) {
        this.wake(peer, context);
        return;
      }
      let previous = cut;
      for (const record of page.records) {
        if (!this.operationCurrent(peer, context)) return;
        const heavyRelease = hasHeavyReservation
          ? () => undefined
          : this.scheduler.reserve('heavy', peer.connection.id);
        if (!heavyRelease) {
          if (!this.operationCurrent(peer, context)) return;
          this.scheduler.schedule(peer.connection.id, 'heavy', () =>
            this.processPage(peer, cut, page, true),
          );
          return;
        }
        let staged: PreparedReplay | { status: 'forbidden' } | undefined;
        try {
          if (!this.operationCurrent(peer, context)) return;
          const result = await this.options.driver.readEvidence(context, record, {
            deadlineAt: context.deadlineAt,
            signal: context.signal,
          });
          if (result.status === 'available') {
            try {
              if (!this.operationCurrent(peer, context) || peer.phase !== 'live') return;
              assertAuthorityLeaseHeader(result.lease, Date.now());
              const nextCursor: AuthorityCursor = {
                ...peer.cursor,
                revision: peer.cursor.revision + 1,
              };
              const projected = this.prepareReplay(
                peer.definition,
                context,
                result.lease.before,
                result.lease.after,
                nextCursor,
                record.position,
                peer.visibleHash,
              );
              if (!this.operationCurrent(peer, context)) return;
              staged = projected;
            } finally {
              if (typeof result.lease?.release === 'function') await result.lease.release();
            }
          } else {
            if (!this.operationCurrent(peer, context) || peer.phase !== 'live') return;
            if (result.status === 'history-unavailable') staged = { status: 'reconcile' };
            else if (result.status === 'forbidden') staged = { status: 'forbidden' };
            if (result.status === 'generation-changed') {
              if (!isAuthorityPosition(result.head))
                throw new Error('Invalid authority evidence head');
              if (!this.operationCurrent(peer, context)) return;
              staged = { status: 'reconcile' };
            }
            if (!staged) throw new Error('Invalid authority evidence result');
          }
        } finally {
          heavyRelease();
        }
        if (staged?.status === 'forbidden') {
          if (this.effectEligible(peer, context, { phase: 'live', streamToken: replayStreamToken }))
            this.fail(peer, 4403);
          return;
        }
        if (staged?.status === 'reconcile')
          return this.queueReconcile(peer, context, replayStreamToken);
        if (staged?.status === 'changes')
          return this.dispatchChanges(peer, replayStreamToken, staged, context);
        if (staged?.status === 'silent') {
          if (
            !this.effectEligible(peer, context, { phase: 'live', streamToken: replayStreamToken })
          )
            return;
          peer.visibleHash = staged.visibleHash;
          peer.position = record.position;
          previous = record.position;
        }
      }
      if (!this.operationCurrent(peer, context)) return;
      if (page.records.length && !samePosition(previous, page.head))
        this.wake(peer, context, replayStreamToken);
    } catch {
      this.fail(peer, 1013);
    } finally {
      cancelDeadline?.();
    }
  }

  /** All image/projection references leave this frame before the lease-release await. */
  private prepareReplay(
    definition: AuthorityRoomDefinition,
    context: AuthorityReadContext,
    before: AuthorityState,
    after: AuthorityState,
    cursor: AuthorityCursor,
    position: AuthorityPosition,
    priorVisibleHash: string | undefined,
  ): PreparedReplay {
    const projected = projectAuthorityChange(definition, context, before, after, cursor);
    if (projected.before.hash !== priorVisibleHash || projected.status === 'checkpoint')
      return { status: 'reconcile' };
    if (projected.status === 'silent')
      return { status: 'silent', visibleHash: projected.after.hash };
    const encoded = serializeAuthorityFrame({
      protocol: 'authority:1',
      kind: 'changes',
      cursor,
      mutations: projected.mutations,
    });
    return { status: 'changes', encoded, cursor, position, visibleHash: projected.after.hash };
  }

  private dispatchChanges(
    peer: Peer,
    streamToken: number,
    staged: Extract<PreparedReplay, { status: 'changes' }>,
    operation: OperationEligibility,
  ): void {
    if (!this.effectEligible(peer, operation, { phase: 'live', streamToken })) return;
    const releasePeer = this.scheduler.retainPeer(peer.connection.id);
    if (!releasePeer) return;
    const token = {};
    peer.sendToken = token;
    peer.sending = true;
    let tracked: ReturnType<AuthorityConnectionBinding['sendTracked']>;
    try {
      tracked = peer.binding.sendTracked(staged.encoded);
    } catch {
      releasePeer();
      this.fail(peer, 1013);
      return;
    }
    const cancelDeadline = this.armDeadline(peer, Date.now() + 5000);
    const completion = tracked.completion.then(
      () => {
        cancelDeadline();
        if (!this.current(peer) || peer.phase !== 'live' || peer.sendToken !== token) return false;
        peer.cursor = staged.cursor;
        peer.position = staged.position;
        peer.visibleHash = staged.visibleHash;
        return true;
      },
      () => {
        cancelDeadline();
        this.fail(peer, 1013);
        return false;
      },
    );
    void tracked.settled.then(async () => {
      const successful = await completion;
      releasePeer();
      if (peer.sendToken !== token) return;
      peer.sendToken = undefined;
      peer.sending = false;
      if (successful || peer.dirty) this.wake(peer);
    });
  }

  private queueReconcile(peer: Peer, context?: OperationEligibility, streamToken?: number): void {
    if (peer.reconciling) return;
    if (context) {
      if (!this.effectEligible(peer, context, { phase: 'live', streamToken })) return;
    } else if (!this.current(peer) || peer.phase !== 'live') return;
    peer.reconciling = true;
    this.scheduler.schedule(peer.connection.id, 'heavy', () => this.reconcile(peer));
  }

  private async reconcile(peer: Peer): Promise<void> {
    if (!this.current(peer) || peer.phase !== 'live') return;
    const streamToken = peer.streamToken;
    let cancelDeadline: (() => void) | undefined;
    try {
      const context = this.readContext(peer);
      cancelDeadline = this.armDeadline(peer, context.deadlineAt);
      if (!this.operationCurrent(peer, context)) return;
      const capture = await this.options.driver.checkpoint(context, {
        deadlineAt: context.deadlineAt,
        signal: context.signal,
      });
      let recoveryGeneration: string | undefined;
      let silentPosition: AuthorityPosition | undefined;
      try {
        if (!this.effectEligible(peer, context, { phase: 'live', streamToken })) return;
        assertAuthorityLeaseHeader(capture, Date.now());
        if (!isAuthorityPosition(capture.position)) throw new Error('Invalid authority capture');
        const visible = projectAuthorityState(peer.definition, context, capture.state);
        if (!this.operationCurrent(peer, context)) return;
        if (
          visible.hash === peer.visibleHash &&
          capture.position.generation === peer.position?.generation
        ) {
          silentPosition = capture.position;
        } else {
          recoveryGeneration = capture.position.generation;
        }
      } finally {
        if (capture && typeof capture.release === 'function') await capture.release();
      }
      if (silentPosition) {
        if (!this.effectEligible(peer, context, { phase: 'live', streamToken })) return;
        peer.position = silentPosition;
        peer.reconciling = false;
        this.wake(peer, context, streamToken);
      } else if (recoveryGeneration) {
        this.dispatchRecovery(peer, recoveryGeneration, context, { phase: 'live', streamToken });
      }
    } catch {
      this.fail(peer, 1013);
    } finally {
      cancelDeadline?.();
    }
  }

  private dispatchRecovery(
    peer: Peer,
    generation: string,
    operation: OperationEligibility,
    source: EffectOwnership,
  ): void {
    const encoded = serializeAuthorityFrame({
      protocol: 'authority:1',
      kind: 'resync-required',
      generation,
      reason: 'gap',
    });
    if (!this.effectEligible(peer, operation, source)) return;
    const now = Date.now();
    const recentResets: number[] = [];
    for (const time of peer.resetTimes) if (now - time < 60_000) recentResets.push(time);
    peer.resetTimes = recentResets;
    if (peer.resetTimes.length >= 2) return this.fail(peer, 1013);
    peer.resetTimes.push(now);
    const episode = this.enterRequestWait(peer);
    peer.generation = generation;
    peer.recoveryRequest = true;
    const releasePeer = this.scheduler.retainPeer(peer.connection.id);
    if (!releasePeer) return;
    const token = {};
    peer.sendToken = token;
    peer.sending = true;
    let tracked: ReturnType<AuthorityConnectionBinding['sendTracked']>;
    try {
      tracked = peer.binding.sendTracked(encoded);
    } catch {
      releasePeer();
      this.fail(peer, 1013);
      return;
    }
    const cancelDeadline = this.armDeadline(peer, Date.now() + 5000);
    const completion = tracked.completion.then(
      () => {
        cancelDeadline();
        this.armRequestWait(peer, episode);
      },
      () => {
        cancelDeadline();
        this.fail(peer, 1013);
      },
    );
    void tracked.settled.then(async () => {
      await completion;
      releasePeer();
      if (peer.sendToken !== token) return;
      peer.sendToken = undefined;
      peer.sending = false;
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.polling);
    this.unsubscribe();
    this.publisher.close();
    for (const peer of [...this.peers.values()]) this.fail(peer, 1013);
    this.scheduler.close();
  }
}
