import { randomBytes } from 'node:crypto';
import {
  createAuthorityCapabilities,
  parseAuthorityClientFrame,
  parseEnvelope,
  serializeAuthorityFrame,
} from '@fieldnotes/sync';
import type { AuthorityCursor, AuthorityServerFrame } from '@fieldnotes/sync';
import { authorityConnectionBinding } from './authority-connection';
import {
  authorityCapabilitiesMatch,
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
import { hashAuthorityJson } from './authority-json';
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

type Phase = 'negotiating' | 'awaiting-request' | 'live';
interface PreparedNegotiation {
  readonly generation: string;
  readonly capabilities: ReturnType<typeof createAuthorityCapabilities>;
}
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
  requestTimer?: ReturnType<typeof setTimeout>;
}

function samePosition(a: AuthorityPosition, b: AuthorityPosition): boolean {
  return a.generation === b.generation && a.revision === b.revision;
}
/** Isolated internal authority lane. Task 3 installs complete checkpoint streaming. */
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
    };
    this.peers.set(connection.id, peer);
    connection.signal.addEventListener('abort', onLifetimeAbort, { once: true });
    peer.negotiationTimer = setTimeout(
      () => this.fail(peer, 4406),
      Math.max(0, Math.min(5000, (connection.expiresAt ?? Infinity) - Date.now())),
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
    if (peer.requestTimer) clearTimeout(peer.requestTimer);
    peer.cancelNegotiation?.();
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
      return true;
    } catch {
      this.fail(peer, 1013);
      return false;
    }
  }

  private fail(peer: Peer, code: 4401 | 4403 | 4406 | 1013): void {
    if (this.peers.get(peer.connection.id) !== peer) return;
    this.remove(peer.connection.id);
    peer.connection.close?.(code);
  }

  private send(peer: Peer, frame: AuthorityServerFrame): Promise<void> {
    if (!this.current(peer)) return Promise.reject(new Error('Authority peer unavailable'));
    const releasePeer = this.scheduler.retainPeer(peer.connection.id);
    if (!releasePeer) return Promise.reject(new Error('Authority peer unavailable'));
    let tracked: ReturnType<AuthorityConnectionBinding['sendTracked']>;
    try {
      tracked = peer.binding.sendTracked(serializeAuthorityFrame(frame));
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
              if (this.current(peer)) prepared = await this.prepareNegotiation(peer);
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
      // Task 3 owns paced coherent capture and activation; no proposal bypasses this phase.
      return;
    }
    if (frame?.kind !== 'propose' || peer.phase !== 'live') {
      await this.upgrade(peer);
      return;
    }
    await this.commit(peer, message, dispatch);
  }

  private async prepareNegotiation(peer: Peer): Promise<PreparedNegotiation | undefined> {
    peer.identity = resolveAuthorityIdentity(this.options, peer.connection);
    const context = this.readContext(peer);
    const head = await this.options.driver.head(context, {
      deadlineAt: context.deadlineAt,
      signal: context.signal,
    });
    if (!this.current(peer)) return;
    if (!isAuthorityPosition(head)) throw new Error('Invalid authority head');
    this.scheduler.promotePeer(peer.connection.id);
    if (peer.negotiationTimer) clearTimeout(peer.negotiationTimer);
    peer.phase = 'awaiting-request';
    return {
      generation: head.generation,
      capabilities: createAuthorityCapabilities(
        peer.definition.extensions.flatMap((extension) => extension.extensionKinds),
        peer.definition.extensions.map((extension) => extension.requirement),
      ),
    };
  }

  private async deliverNegotiation(peer: Peer, prepared: PreparedNegotiation): Promise<void> {
    if (!this.current(peer)) return;
    await this.sendLegacyCapabilities(peer, prepared.capabilities);
    if (!this.current(peer)) return;
    await this.send(peer, {
      protocol: 'authority:1',
      kind: 'resync-required',
      generation: prepared.generation,
      reason: 'checkpoint-required',
    });
    if (!this.current(peer)) return;
    peer.requestTimer = setTimeout(
      () => this.fail(peer, 1013),
      Math.max(0, Math.min(10_000, (peer.connection.expiresAt ?? Infinity) - Date.now())),
    );
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

  /** Installed by Task 3 only after checkpoint-end local completion. */
  activate(connectionId: string, position: AuthorityPosition, state: AuthorityState): void {
    const peer = this.peers.get(connectionId);
    if (!peer || !peer.identity || !this.current(peer) || !isAuthorityPosition(position))
      throw new Error('Authority activation unavailable');
    const visible = projectAuthorityState(peer.definition, this.readContext(peer), state);
    if (peer.requestTimer) clearTimeout(peer.requestTimer);
    peer.position = position;
    peer.visibleHash = visible.hash;
    peer.reconciling = false;
    peer.cursor = {
      generation: position.generation,
      streamId: randomBytes(16).toString('hex'),
      revision: 0,
    };
    peer.phase = 'live';
    this.wake(peer);
  }

  private readContext(peer: Peer): AuthorityReadContext {
    if (!peer.identity) throw new Error('Authority identity unavailable');
    return authorityReadContext(peer.connection, peer.identity, peer.definition.id, peer.lifetime);
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
    if (!this.current(peer)) return;
    const commitRelease = this.scheduler.reserve('commit', peer.connection.id);
    if (!commitRelease) return this.fail(peer, 1013);
    const cancelDeadline = this.armDeadline(peer, prepared.context.deadlineAt);
    let committedWorkSettled = false;
    try {
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
        if (this.current(peer)) {
          await this.send(peer, {
            protocol: 'authority:1',
            kind: 'receipt',
            receipt: result.receipt,
          });
          this.wake(peer);
        }
      } else if (result.status === 'rejected' && this.current(peer)) {
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
        await this.send(peer, {
          protocol: 'authority:1',
          kind: 'rejected',
          generation: prepared.proposal.generation,
          clientOperationId: prepared.proposal.clientOperationId,
          reason: result.reason,
        });
      } else if (result.status !== 'rejected') {
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

  private wake(peer: Peer): void {
    if (peer.phase !== 'live' || !this.current(peer)) return;
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
      const head = await this.options.driver.head(context, {
        deadlineAt: context.deadlineAt,
        signal: context.signal,
      });
      if (!this.current(peer) || peer.phase !== 'live') return;
      if (!isAuthorityPosition(head)) throw new Error('Invalid authority head');
      if (head.generation !== peer.position.generation) this.queueReconcile(peer);
      else if (!samePosition(head, peer.position)) this.wake(peer);
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
      const page = await this.options.driver.readAfter(
        context,
        cut,
        { entries: 8, bytes: 64 * 1024 },
        { deadlineAt: context.deadlineAt, signal: context.signal },
      );
      if (!this.current(peer) || peer.phase !== 'live') return;
      assertAuthorityReadPage(cut, page);
      if (page.status === 'gap') return this.queueReconcile(peer);
      if (page.head.generation !== cut.generation) return this.queueReconcile(peer);
      await this.processPage(peer, cut, page);
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
  ): Promise<void> {
    if (
      page.status !== 'ok' ||
      !this.current(peer) ||
      peer.phase !== 'live' ||
      !peer.position ||
      !peer.cursor
    )
      return;
    if (!samePosition(peer.position, cut)) {
      this.wake(peer);
      return;
    }
    let cancelDeadline: (() => void) | undefined;
    try {
      const context = this.readContext(peer);
      cancelDeadline = this.armDeadline(peer, context.deadlineAt);
      let previous = cut;
      for (const record of page.records) {
        const heavyRelease = hasHeavyReservation
          ? () => undefined
          : this.scheduler.reserve('heavy', peer.connection.id);
        if (!heavyRelease) {
          this.scheduler.schedule(peer.connection.id, 'heavy', () =>
            this.processPage(peer, cut, page, true),
          );
          return;
        }
        let staged:
          | {
              frame: AuthorityServerFrame;
              cursor: AuthorityCursor;
              position: AuthorityPosition;
              visibleHash: string;
            }
          | undefined;
        try {
          const result = await this.options.driver.readEvidence(context, record, {
            deadlineAt: context.deadlineAt,
            signal: context.signal,
          });
          if (result.status === 'available') {
            try {
              assertAuthorityLeaseHeader(result.lease, Date.now());
              if (!this.current(peer) || peer.phase !== 'live') return;
              const nextCursor: AuthorityCursor = {
                ...peer.cursor,
                revision: peer.cursor.revision + 1,
              };
              const projected = projectAuthorityChange(
                peer.definition,
                context,
                result.lease.before,
                result.lease.after,
                nextCursor,
              );
              if (projected.before.hash !== peer.visibleHash) return this.queueReconcile(peer);
              if (projected.status === 'checkpoint') return this.queueReconcile(peer);
              if (projected.status === 'changes') {
                staged = {
                  frame: {
                    protocol: 'authority:1',
                    kind: 'changes',
                    cursor: nextCursor,
                    mutations: projected.mutations,
                  },
                  cursor: nextCursor,
                  position: record.position,
                  visibleHash: projected.after.hash,
                };
              } else {
                peer.visibleHash = projected.after.hash;
                peer.position = record.position;
                previous = record.position;
              }
            } finally {
              if (typeof result.lease?.release === 'function') await result.lease.release();
            }
          } else {
            if (!this.current(peer) || peer.phase !== 'live') return;
            if (result.status === 'history-unavailable') return this.queueReconcile(peer);
            if (result.status === 'forbidden') return this.fail(peer, 4403);
            if (result.status === 'generation-changed') {
              if (!isAuthorityPosition(result.head))
                throw new Error('Invalid authority evidence head');
              return this.queueReconcile(peer);
            }
            throw new Error('Invalid authority evidence result');
          }
        } finally {
          heavyRelease();
        }
        if (staged) {
          this.dispatchChanges(peer, staged);
          return;
        }
      }
      if (page.records.length && !samePosition(previous, page.head)) this.wake(peer);
    } catch {
      this.fail(peer, 1013);
    } finally {
      cancelDeadline?.();
    }
  }

  private dispatchChanges(
    peer: Peer,
    staged: {
      readonly frame: AuthorityServerFrame;
      readonly cursor: AuthorityCursor;
      readonly position: AuthorityPosition;
      readonly visibleHash: string;
    },
  ): void {
    if (!this.current(peer)) return;
    const releasePeer = this.scheduler.retainPeer(peer.connection.id);
    if (!releasePeer) return;
    const token = {};
    peer.sendToken = token;
    peer.sending = true;
    let tracked: ReturnType<AuthorityConnectionBinding['sendTracked']>;
    try {
      tracked = peer.binding.sendTracked(serializeAuthorityFrame(staged.frame));
    } catch {
      releasePeer();
      this.fail(peer, 1013);
      return;
    }
    const cancelDeadline = this.armDeadline(peer, Date.now() + 5000);
    const completion = tracked.completion.then(
      () => {
        cancelDeadline();
        if (!this.current(peer)) return false;
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

  private queueReconcile(peer: Peer): void {
    if (!this.current(peer) || peer.phase !== 'live' || peer.reconciling) return;
    peer.reconciling = true;
    this.scheduler.schedule(peer.connection.id, 'heavy', () => this.reconcile(peer));
  }

  private async reconcile(peer: Peer): Promise<void> {
    if (!this.current(peer) || peer.phase !== 'live') return;
    let cancelDeadline: (() => void) | undefined;
    try {
      const context = this.readContext(peer);
      cancelDeadline = this.armDeadline(peer, context.deadlineAt);
      const capture = await this.options.driver.checkpoint(context, {
        deadlineAt: context.deadlineAt,
        signal: context.signal,
      });
      let recoveryGeneration: string | undefined;
      try {
        assertAuthorityLeaseHeader(capture, Date.now());
        if (!this.current(peer) || peer.phase !== 'live') return;
        if (!isAuthorityPosition(capture.position)) throw new Error('Invalid authority capture');
        const visible = projectAuthorityState(peer.definition, context, capture.state);
        if (
          visible.hash === peer.visibleHash &&
          capture.position.generation === peer.position?.generation
        ) {
          peer.position = capture.position;
          peer.reconciling = false;
          this.wake(peer);
          return;
        }
        peer.phase = 'awaiting-request';
        recoveryGeneration = capture.position.generation;
      } finally {
        if (capture && typeof capture.release === 'function') await capture.release();
      }
      if (recoveryGeneration) this.dispatchRecovery(peer, recoveryGeneration);
    } catch {
      this.fail(peer, 1013);
    } finally {
      cancelDeadline?.();
    }
  }

  private dispatchRecovery(peer: Peer, generation: string): void {
    if (!this.current(peer)) return;
    const frame: AuthorityServerFrame = {
      protocol: 'authority:1',
      kind: 'resync-required',
      generation,
      reason: 'gap',
    };
    const releasePeer = this.scheduler.retainPeer(peer.connection.id);
    if (!releasePeer) return;
    const token = {};
    peer.sendToken = token;
    peer.sending = true;
    let tracked: ReturnType<AuthorityConnectionBinding['sendTracked']>;
    try {
      tracked = peer.binding.sendTracked(serializeAuthorityFrame(frame));
    } catch {
      releasePeer();
      this.fail(peer, 1013);
      return;
    }
    const cancelDeadline = this.armDeadline(peer, Date.now() + 5000);
    const completion = tracked.completion.then(
      () => {
        cancelDeadline();
        if (!this.current(peer)) return;
        peer.requestTimer = setTimeout(
          () => this.fail(peer, 1013),
          Math.max(0, Math.min(10_000, (peer.connection.expiresAt ?? Infinity) - Date.now())),
        );
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
