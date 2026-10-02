import { createAuthorityOperationId } from './authority-operation-id';
import {
  parseAuthorityClientFrame,
  parseAuthorityServerFrame,
  serializeAuthorityFrame,
} from './authority-protocol';
import type {
  AuthorityClientFrame,
  AuthorityMutation,
  AuthorityReceipt,
  AuthorityRejectionReason,
} from './authority-protocol';
import type {
  AuthorityBarrier,
  AuthorityBarrierResult,
  AuthorityClientOperation,
  AuthorityRetryResult,
  AuthoritySubmitResult,
} from './authority-client-types';

export const MAX_AUTHORITY_JOURNAL_OPERATIONS = 64;
export const MAX_AUTHORITY_JOURNAL_BYTES = 4 * 1024 * 1024;
export const MAX_AUTHORITY_BARRIERS = 16;
export const MAX_AUTHORITY_BARRIER_REFERENCES = 1_024;
export const MAX_AUTHORITY_WAITERS = 32;
export const DEFAULT_AUTHORITY_WAIT_TIMEOUT_MS = 30_000;
export const MAX_AUTHORITY_WAIT_TIMEOUT_MS = 60_000;

const encoder = new TextEncoder();
const idPattern = /^[\x21-\x7e]{1,128}$/;

export interface AuthorityClientJournalOptions {
  readonly scopeId: string;
  readonly createOperationId?: () => string;
  readonly createBarrierId?: () => string;
  readonly waiterBudget?: AuthorityWaiterBudget;
}

export type AuthorityJournalRetryAdmission =
  | {
      readonly status: 'ready';
      readonly clientOperationId: string;
      readonly generation: string;
      readonly originalWire: string;
      readonly proposal: AuthorityClientOperation['proposal'];
    }
  | Exclude<AuthorityRetryResult, { readonly status: 'sent' }>;

export type AuthorityJournalAttemptResult =
  | 'draft'
  | 'pending'
  | 'rejected'
  | 'uncertain'
  | 'invalid';

export type AuthorityJournalReceiptResult = 'accepted' | 'duplicate' | 'conflict' | 'ignored';

export type AuthorityJournalRejectionResult =
  | 'rejected'
  | 'uncertain'
  | 'duplicate'
  | 'conflict'
  | 'ignored'
  | 'invalid';

export interface AuthorityJournalStats {
  readonly operationCount: number;
  readonly originalWireBytes: number;
  readonly barrierCount: number;
  readonly barrierReferences: number;
  readonly waiterCount: number;
  readonly localSequence: number;
  readonly localEditGeneration: number;
  readonly stopped: boolean;
}

interface OperationRecord {
  snapshot: AuthorityClientOperation;
  readonly wireBytes: number;
  pins: number;
  transitionRevision: number;
  activeAttempt?: AttemptTransaction;
}

interface AttemptTransaction {
  readonly token: number;
  readonly record: OperationRecord;
  readonly startingGeneration: string;
  readonly startingGenerationRevision: number;
  readonly startingStatus: 'draft' | 'uncertain';
  readonly startingWasUncertain: boolean;
  readonly startingTransitionRevision: number;
  transitionRevision: number;
  lostEpisode: boolean;
  outcome?: 'accepted' | 'rejected' | 'uncertain';
  rejection?: AuthorityRejectionReason;
}

type AttemptTransition =
  | { readonly kind: 'accepted' }
  | {
      readonly kind: 'rejected';
      readonly outcome: 'rejected' | 'uncertain';
      readonly rejection: AuthorityRejectionReason;
    }
  | { readonly kind: 'lost-episode' };

interface BarrierRecord {
  readonly barrier: AuthorityBarrier;
  readonly operations: readonly OperationRecord[];
  waiters: number;
}

interface Partition {
  readonly accepted: readonly AuthorityReceipt[];
  readonly rejectedIds: readonly string[];
  readonly uncertainIds: readonly string[];
  readonly outstandingIds: readonly string[];
}

interface WaitTransaction {
  readonly barrier: BarrierRecord;
  readonly resolve: (result: AuthorityBarrierResult) => void;
  readonly signal?: SignalSnapshot;
  onAbort?: () => void;
  timer?: ReturnType<typeof setTimeout>;
  registration: 'none' | 'registering' | 'complete';
  detachAttempted: boolean;
  settled: boolean;
}

interface SignalSnapshot {
  readonly aborted: boolean;
  readonly add: (listener: () => void) => void;
  readonly remove: (listener: () => void) => void;
  readonly check: () => boolean | null;
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && idPattern.test(value);
}

function frozen<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

function retryRefused(
  reason: Exclude<AuthorityRetryResult, { status: 'sent' }>['reason'],
): AuthorityJournalRetryAdmission {
  return frozen({ status: 'refused' as const, reason });
}

/** Shared bounded reservation used by journal and later checkpoint waiters. */
export class AuthorityWaiterBudget {
  readonly #limit: number;
  #active = 0;

  constructor(limit = MAX_AUTHORITY_WAITERS) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_AUTHORITY_WAITERS) {
      throw new RangeError('Invalid authority waiter limit');
    }
    this.#limit = limit;
  }

  reserve(): boolean {
    if (this.#active >= this.#limit) return false;
    this.#active += 1;
    return true;
  }

  hasCapacity(): boolean {
    return this.#active < this.#limit;
  }

  release(): void {
    if (this.#active <= 0) throw new Error('Authority waiter reservation underflow');
    this.#active -= 1;
  }

  get active(): number {
    return this.#active;
  }
}

export class AuthorityClientJournal {
  readonly #scopeId: string;
  readonly #createOperationId: () => string;
  readonly #createBarrierId: () => string;
  readonly #waiterBudget: AuthorityWaiterBudget;
  readonly #invalidBarrier: AuthorityBarrier;
  readonly #operations = new Map<string, OperationRecord>();
  readonly #barriers = new Map<AuthorityBarrier, BarrierRecord>();
  readonly #waiters = new Set<WaitTransaction>();
  #generation: string | null = null;
  #generationRevision = 0;
  #wireBytes = 0;
  #barrierReferences = 0;
  #localSequence = 0;
  #localEditGeneration = 0;
  #nextAttemptToken = 0;
  #stopped = false;

  constructor(options: AuthorityClientJournalOptions) {
    if (!validId(options.scopeId)) throw new TypeError('Invalid authority scope ID');
    if (
      options.createOperationId !== undefined &&
      typeof options.createOperationId !== 'function'
    ) {
      throw new TypeError('Invalid authority operation ID factory');
    }
    if (options.createBarrierId !== undefined && typeof options.createBarrierId !== 'function') {
      throw new TypeError('Invalid authority barrier ID factory');
    }
    this.#scopeId = options.scopeId;
    this.#createOperationId = options.createOperationId ?? createAuthorityOperationId;
    this.#createBarrierId = options.createBarrierId ?? createAuthorityOperationId;
    this.#waiterBudget = options.waiterBudget ?? new AuthorityWaiterBudget();
    this.#invalidBarrier = frozen({
      barrierId: 'invalid',
      scopeId: this.#scopeId,
      generation: null,
      throughLocalSequence: 0,
      localEditGeneration: 0,
      operationIds: Object.freeze([]),
    });
  }

  setGeneration(generation: string | null): boolean {
    if (this.#stopped || (generation !== null && !validId(generation))) return false;
    if (generation === this.#generation) return true;
    if (this.#generationRevision >= Number.MAX_SAFE_INTEGER) return false;
    this.markAttemptedUncertain();
    this.#generation = generation;
    this.#generationRevision += 1;
    return true;
  }

  get generation(): string | null {
    return this.#generation;
  }

  admit(
    mutation: AuthorityMutation,
    options: { readonly expectedState?: string } = {},
  ): AuthoritySubmitResult {
    if (this.#stopped) return frozen({ status: 'refused' as const, reason: 'stopped' as const });
    const generation = this.#generation;
    const generationRevision = this.#generationRevision;
    if (generation === null) {
      return frozen({ status: 'refused' as const, reason: 'not-ready' as const });
    }
    if (this.#localSequence >= Number.MAX_SAFE_INTEGER) {
      return frozen({ status: 'refused' as const, reason: 'capacity' as const });
    }

    let clientOperationId: string;
    let originalWire: string;
    let proposal: AuthorityClientOperation['proposal'];
    try {
      clientOperationId = this.#createOperationId();
      if (!validId(clientOperationId)) {
        return frozen({ status: 'refused' as const, reason: 'invalid' as const });
      }
      if (this.#stopped) {
        return frozen({ status: 'refused' as const, reason: 'stopped' as const });
      }
      if (
        this.#generation !== generation ||
        this.#generationRevision !== generationRevision ||
        this.#operations.has(clientOperationId)
      ) {
        return frozen({ status: 'refused' as const, reason: 'invalid' as const });
      }
      if (
        this.#operations.size >= MAX_AUTHORITY_JOURNAL_OPERATIONS ||
        this.#wireBytes >= MAX_AUTHORITY_JOURNAL_BYTES ||
        this.#localSequence >= Number.MAX_SAFE_INTEGER
      ) {
        return frozen({ status: 'refused' as const, reason: 'capacity' as const });
      }
      const candidate: Extract<AuthorityClientFrame, { kind: 'propose' }> = {
        protocol: 'authority:1',
        kind: 'propose',
        generation,
        clientOperationId,
        mutation,
        ...(options.expectedState === undefined ? {} : { expectedState: options.expectedState }),
      };
      originalWire = serializeAuthorityFrame(candidate);
      const parsed = parseAuthorityClientFrame(originalWire);
      if (parsed?.kind !== 'propose') {
        return frozen({ status: 'refused' as const, reason: 'invalid' as const });
      }
      proposal = parsed;
    } catch {
      return frozen({ status: 'refused' as const, reason: 'invalid' as const });
    }

    const wireBytes = encoder.encode(originalWire).length;
    if (this.#stopped) {
      return frozen({ status: 'refused' as const, reason: 'stopped' as const });
    }
    if (
      this.#generation !== generation ||
      this.#generationRevision !== generationRevision ||
      this.#operations.has(clientOperationId)
    ) {
      return frozen({ status: 'refused' as const, reason: 'invalid' as const });
    }
    if (
      this.#operations.size >= MAX_AUTHORITY_JOURNAL_OPERATIONS ||
      wireBytes > MAX_AUTHORITY_JOURNAL_BYTES - this.#wireBytes ||
      this.#localSequence >= Number.MAX_SAFE_INTEGER
    ) {
      return frozen({ status: 'refused' as const, reason: 'capacity' as const });
    }

    const localSequence = this.#localSequence + 1;
    const snapshot: AuthorityClientOperation = frozen({
      clientOperationId,
      generation,
      localSequence,
      localEditGeneration: this.#localEditGeneration,
      proposal,
      originalWire,
      attempts: 0,
      status: 'draft' as const,
      wasUncertain: false,
    });
    this.#operations.set(clientOperationId, {
      snapshot,
      wireBytes,
      pins: 0,
      transitionRevision: 0,
    });
    this.#wireBytes += wireBytes;
    this.#localSequence = localSequence;
    return frozen({ status: 'admitted' as const, clientOperationId });
  }

  operations(): readonly AuthorityClientOperation[] {
    return Object.freeze(Array.from(this.#operations.values(), (record) => record.snapshot));
  }

  operation(clientOperationId: string): AuthorityClientOperation | null {
    return this.#operations.get(clientOperationId)?.snapshot ?? null;
  }

  prepareRetry(
    clientOperationId: string,
    currentGeneration: string | null,
    live: boolean,
  ): AuthorityJournalRetryAdmission {
    if (!live || this.#stopped) return retryRefused('not-live');
    const record = this.#operations.get(clientOperationId);
    if (record === undefined) return retryRefused('unknown');
    if (currentGeneration === null || record.snapshot.generation !== currentGeneration) {
      return retryRefused('generation-mismatch');
    }
    if (record.activeAttempt !== undefined || record.snapshot.status === 'pending') {
      return retryRefused('pending');
    }
    if (record.snapshot.status === 'accepted') return retryRefused('accepted');
    if (record.snapshot.status === 'rejected') return retryRefused('rejected');
    return frozen({
      status: 'ready' as const,
      clientOperationId: record.snapshot.clientOperationId,
      generation: record.snapshot.generation,
      originalWire: record.snapshot.originalWire,
      proposal: record.snapshot.proposal,
    });
  }

  attemptOperation(
    clientOperationId: string,
    trySend: (originalWire: string) => boolean,
  ): AuthorityJournalAttemptResult {
    const record = this.#operations.get(clientOperationId);
    if (
      this.#stopped ||
      record === undefined ||
      record.activeAttempt !== undefined ||
      record.snapshot.generation !== this.#generation ||
      (record.snapshot.status !== 'draft' && record.snapshot.status !== 'uncertain') ||
      record.snapshot.attempts >= Number.MAX_SAFE_INTEGER ||
      this.#nextAttemptToken >= Number.MAX_SAFE_INTEGER
    ) {
      return 'invalid';
    }
    const transaction: AttemptTransaction = {
      token: this.#nextAttemptToken + 1,
      record,
      startingGeneration: record.snapshot.generation,
      startingGenerationRevision: this.#generationRevision,
      startingStatus: record.snapshot.status,
      startingWasUncertain: record.snapshot.wasUncertain,
      startingTransitionRevision: record.transitionRevision,
      transitionRevision: record.transitionRevision,
      lostEpisode: false,
    };
    this.#nextAttemptToken = transaction.token;
    record.activeAttempt = transaction;
    record.pins += 1;
    let handedOff = false;
    let threw = false;
    try {
      handedOff = trySend(record.snapshot.originalWire);
    } catch {
      threw = true;
    }

    const retained = this.#operations.get(clientOperationId);
    if (
      retained !== record ||
      record.activeAttempt !== transaction ||
      record.activeAttempt.token !== transaction.token
    ) {
      return 'invalid';
    }

    const countedAttempt = handedOff || threw;
    const attempts = countedAttempt ? retained.snapshot.attempts + 1 : retained.snapshot.attempts;
    let result: AuthorityJournalAttemptResult;
    if (transaction.outcome === 'accepted' || retained.snapshot.status === 'accepted') {
      if (countedAttempt) this.#replace(retained, { attempts });
      result = 'invalid';
    } else if (transaction.outcome === 'rejected' || transaction.outcome === 'uncertain') {
      if (countedAttempt) this.#replace(retained, { attempts });
      result = transaction.outcome;
    } else if (!countedAttempt) {
      result = transaction.startingStatus;
    } else if (
      threw ||
      transaction.lostEpisode ||
      this.#stopped ||
      this.#generation !== transaction.startingGeneration ||
      this.#generationRevision !== transaction.startingGenerationRevision
    ) {
      this.#replace(retained, { attempts, status: 'uncertain', wasUncertain: true });
      result = 'uncertain';
    } else {
      this.#publishPending(retained, attempts);
      result = 'pending';
    }

    if (record.activeAttempt === transaction) delete record.activeAttempt;
    record.pins -= 1;
    if (countedAttempt || transaction.outcome !== undefined) this.#notifyWaiters();
    return result;
  }

  recordReceipt(receipt: AuthorityReceipt): AuthorityJournalReceiptResult {
    if (this.#stopped) return 'ignored';
    let retained: AuthorityReceipt;
    try {
      const wire = serializeAuthorityFrame({ protocol: 'authority:1', kind: 'receipt', receipt });
      const parsed = parseAuthorityServerFrame(wire);
      if (parsed?.kind !== 'receipt') return 'ignored';
      retained = parsed.receipt;
    } catch {
      return 'ignored';
    }
    const record = this.#operations.get(retained.clientOperationId);
    if (record === undefined || record.snapshot.generation !== retained.generation)
      return 'ignored';
    if (record.snapshot.status === 'accepted') {
      return record.snapshot.receipt?.receiptId === retained.receiptId ? 'duplicate' : 'conflict';
    }
    this.#replace(record, { status: 'accepted', receipt: retained });
    this.#reduceActiveAttempt(record, { kind: 'accepted' });
    this.#notifyWaiters();
    return 'accepted';
  }

  recordRejection(
    generation: string,
    clientOperationId: string,
    reason: AuthorityRejectionReason,
  ): AuthorityJournalRejectionResult {
    if (this.#stopped) return 'ignored';
    let retainedReason: AuthorityRejectionReason;
    try {
      const wire = serializeAuthorityFrame({
        protocol: 'authority:1',
        kind: 'rejected',
        generation,
        clientOperationId,
        reason,
      });
      const parsed = parseAuthorityServerFrame(wire);
      if (parsed?.kind !== 'rejected') return 'ignored';
      retainedReason = parsed.reason;
    } catch {
      return 'ignored';
    }
    const record = this.#operations.get(clientOperationId);
    if (record === undefined || record.snapshot.generation !== generation) return 'ignored';
    if (record.snapshot.status === 'accepted') return 'conflict';
    if (record.snapshot.status === 'rejected') {
      return record.snapshot.rejection === retainedReason ? 'duplicate' : 'conflict';
    }
    const transaction = record.activeAttempt;
    if (record.snapshot.status === 'draft' && transaction === undefined) return 'invalid';
    if (
      record.snapshot.status === 'uncertain' ||
      record.snapshot.wasUncertain ||
      transaction?.startingStatus === 'uncertain' ||
      transaction?.startingWasUncertain === true ||
      retainedReason === 'retry-window-expired'
    ) {
      this.#replace(record, {
        status: 'uncertain',
        rejection: retainedReason,
        wasUncertain: true,
      });
      this.#reduceActiveAttempt(record, {
        kind: 'rejected',
        outcome: 'uncertain',
        rejection: retainedReason,
      });
      this.#notifyWaiters();
      return 'uncertain';
    }
    this.#replace(record, { status: 'rejected', rejection: retainedReason });
    this.#reduceActiveAttempt(record, {
      kind: 'rejected',
      outcome: 'rejected',
      rejection: retainedReason,
    });
    this.#notifyWaiters();
    return 'rejected';
  }

  markAttemptedUncertain(): void {
    let changed = false;
    for (const record of this.#operations.values()) {
      this.#reduceActiveAttempt(record, { kind: 'lost-episode' });
      if (record.snapshot.status !== 'pending') continue;
      this.#replace(record, { status: 'uncertain', wasUncertain: true });
      changed = true;
    }
    if (changed) this.#notifyWaiters();
  }

  releaseOperation(
    clientOperationId: string,
    options: { readonly discardDraft?: boolean } = {},
  ): boolean {
    const record = this.#operations.get(clientOperationId);
    if (record === undefined || record.pins !== 0 || record.activeAttempt !== undefined)
      return false;
    if (record.snapshot.status !== 'accepted' && options.discardDraft !== true) return false;
    this.#operations.delete(clientOperationId);
    this.#wireBytes -= record.wireBytes;
    return true;
  }

  captureBarrier(): AuthorityBarrier | null {
    if (
      this.#stopped ||
      this.#barriers.size >= MAX_AUTHORITY_BARRIERS ||
      this.#localEditGeneration >= Number.MAX_SAFE_INTEGER ||
      this.#operations.size > MAX_AUTHORITY_BARRIER_REFERENCES - this.#barrierReferences
    ) {
      return null;
    }
    const generation = this.#generation;
    const generationRevision = this.#generationRevision;
    let barrierId: string;
    try {
      barrierId = this.#createBarrierId();
    } catch {
      return null;
    }
    if (
      !validId(barrierId) ||
      this.#stopped ||
      this.#generation !== generation ||
      this.#generationRevision !== generationRevision
    ) {
      return null;
    }
    for (const record of this.#barriers.values()) {
      if (record.barrier.barrierId === barrierId) return null;
    }
    if (
      this.#barriers.size >= MAX_AUTHORITY_BARRIERS ||
      this.#localEditGeneration >= Number.MAX_SAFE_INTEGER ||
      this.#operations.size > MAX_AUTHORITY_BARRIER_REFERENCES - this.#barrierReferences
    ) {
      return null;
    }

    const operations = Object.freeze(Array.from(this.#operations.values()));
    const operationIds = Object.freeze(
      operations.map((record) => record.snapshot.clientOperationId),
    );
    const barrier: AuthorityBarrier = frozen({
      barrierId,
      scopeId: this.#scopeId,
      generation,
      throughLocalSequence: this.#localSequence,
      localEditGeneration: this.#localEditGeneration,
      operationIds,
    });
    for (const record of operations) record.pins += 1;
    this.#barriers.set(barrier, { barrier, operations, waiters: 0 });
    this.#barrierReferences += operations.length;
    this.#localEditGeneration += 1;
    return barrier;
  }

  releaseBarrier(barrier: AuthorityBarrier): boolean {
    const record = this.#barriers.get(barrier);
    if (record === undefined || record.waiters !== 0) return false;
    this.#barriers.delete(barrier);
    this.#barrierReferences -= record.operations.length;
    for (const operation of record.operations) operation.pins -= 1;
    return true;
  }

  waitForAcknowledgements(
    barrier: AuthorityBarrier,
    options: { readonly signal?: AbortSignal; readonly timeoutMs?: number } = {},
  ): Promise<AuthorityBarrierResult> {
    const record = this.#barriers.get(barrier);
    if (record === undefined) return Promise.resolve(this.#result('invalid', barrier, null));
    const initialStatus = this.#captureWaitStatus(barrier, record);
    if (initialStatus !== null) {
      return Promise.resolve(
        this.#result(initialStatus, barrier, initialStatus === 'invalid' ? null : record),
      );
    }

    let timeoutMs: number;
    let sourceSignal: AbortSignal | undefined;
    let signal: SignalSnapshot | undefined;
    try {
      timeoutMs = options.timeoutMs ?? DEFAULT_AUTHORITY_WAIT_TIMEOUT_MS;
    } catch {
      return Promise.resolve(this.#captureFailureResult(barrier, record));
    }
    const afterTimeout = this.#captureWaitStatus(barrier, record);
    if (afterTimeout !== null) {
      return Promise.resolve(
        this.#result(afterTimeout, barrier, afterTimeout === 'invalid' ? null : record),
      );
    }
    try {
      sourceSignal = options.signal;
    } catch {
      return Promise.resolve(this.#captureFailureResult(barrier, record));
    }
    const afterSignal = this.#captureWaitStatus(barrier, record);
    if (afterSignal !== null) {
      return Promise.resolve(
        this.#result(afterSignal, barrier, afterSignal === 'invalid' ? null : record),
      );
    }
    if (
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > MAX_AUTHORITY_WAIT_TIMEOUT_MS
    ) {
      return Promise.resolve(this.#result('invalid', barrier, record));
    }
    if (sourceSignal !== undefined) {
      const captured = this.#captureSignal(sourceSignal, barrier, record);
      if ('status' in captured) {
        const resultRecord =
          captured.status === 'invalid' && this.#barriers.get(barrier) !== record ? null : record;
        return Promise.resolve(this.#result(captured.status, barrier, resultRecord));
      }
      signal = captured.signal;
    }
    const afterCapture = this.#captureWaitStatus(barrier, record);
    if (afterCapture !== null) {
      return Promise.resolve(
        this.#result(afterCapture, barrier, afterCapture === 'invalid' ? null : record),
      );
    }
    if (signal?.aborted === true) {
      return Promise.resolve(this.#result('aborted', barrier, record));
    }
    const immediate = this.#settledStatus(record);
    if (immediate !== null) return Promise.resolve(this.#result(immediate, barrier, record));
    if (!this.#waiterBudget.reserve()) {
      return Promise.resolve(this.#result('capacity', barrier, record));
    }

    let resolveResult: ((result: AuthorityBarrierResult) => void) | undefined;
    const promise = new Promise<AuthorityBarrierResult>((resolve) => {
      resolveResult = resolve;
    });
    if (resolveResult === undefined) throw new Error('Authority waiter initialization failed');
    const waiter: WaitTransaction = {
      barrier: record,
      resolve: resolveResult,
      signal,
      registration: signal === undefined ? 'complete' : 'none',
      detachAttempted: false,
      settled: false,
    };
    record.waiters += 1;
    for (const operation of record.operations) operation.pins += 1;
    this.#waiters.add(waiter);
    const onAbort = (): void => this.#settleWaiter(waiter, 'aborted');
    if (signal !== undefined) waiter.onAbort = onAbort;
    try {
      if (signal !== undefined) {
        waiter.registration = 'registering';
        try {
          signal.add(onAbort);
        } finally {
          waiter.registration = 'complete';
          if (waiter.settled) this.#detachWaiter(waiter);
        }
      }
      if (!waiter.settled && signal !== undefined) {
        const aborted = signal.check();
        if (aborted === null) this.#settleWaiter(waiter, 'invalid');
        else if (aborted) this.#settleWaiter(waiter, 'aborted');
      }
      if (!waiter.settled) {
        waiter.timer = setTimeout(() => this.#settleWaiter(waiter, 'timeout'), timeoutMs);
      }
    } catch {
      this.#settleWaiter(waiter, 'invalid');
    }
    return promise;
  }

  stop(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    for (const record of this.#operations.values()) {
      this.#reduceActiveAttempt(record, { kind: 'lost-episode' });
      if (record.snapshot.status === 'pending') {
        this.#replace(record, { status: 'uncertain', wasUncertain: true });
      }
    }
    for (const waiter of Array.from(this.#waiters)) this.#settleWaiter(waiter, 'stopped');
  }

  dispose(): void {
    this.stop();
  }

  stats(): AuthorityJournalStats {
    return frozen({
      operationCount: this.#operations.size,
      originalWireBytes: this.#wireBytes,
      barrierCount: this.#barriers.size,
      barrierReferences: this.#barrierReferences,
      waiterCount: this.#waiters.size,
      localSequence: this.#localSequence,
      localEditGeneration: this.#localEditGeneration,
      stopped: this.#stopped,
    });
  }

  #replace(
    record: OperationRecord,
    changes: Partial<
      Pick<
        AuthorityClientOperation,
        'attempts' | 'status' | 'receipt' | 'rejection' | 'wasUncertain'
      >
    >,
  ): void {
    record.snapshot = frozen({ ...record.snapshot, ...changes });
    this.#advanceTransition(record);
  }

  #publishPending(record: OperationRecord, attempts: number): void {
    const previous = record.snapshot;
    record.snapshot = frozen({
      clientOperationId: previous.clientOperationId,
      generation: previous.generation,
      localSequence: previous.localSequence,
      localEditGeneration: previous.localEditGeneration,
      proposal: previous.proposal,
      originalWire: previous.originalWire,
      attempts,
      status: 'pending',
      wasUncertain: previous.wasUncertain,
    });
    this.#advanceTransition(record);
  }

  #advanceTransition(record: OperationRecord): void {
    if (record.transitionRevision < Number.MAX_SAFE_INTEGER) record.transitionRevision += 1;
  }

  #reduceActiveAttempt(record: OperationRecord, transition: AttemptTransition): void {
    const transaction = record.activeAttempt;
    if (transaction === undefined || transaction.record !== record) return;
    if (transaction.transitionRevision < Number.MAX_SAFE_INTEGER) {
      transaction.transitionRevision += 1;
    }
    if (transition.kind === 'accepted') {
      transaction.outcome = 'accepted';
      return;
    }
    if (transition.kind === 'lost-episode') {
      transaction.lostEpisode = true;
      return;
    }
    if (transaction.outcome === 'accepted') return;
    transaction.outcome = transition.outcome;
    transaction.rejection = transition.rejection;
  }

  #partition(record: BarrierRecord): Partition {
    const accepted: AuthorityReceipt[] = [];
    const rejectedIds: string[] = [];
    const uncertainIds: string[] = [];
    const outstandingIds: string[] = [];
    for (const operation of record.operations) {
      const snapshot = operation.snapshot;
      if (snapshot.status === 'accepted' && snapshot.receipt !== undefined) {
        accepted.push(snapshot.receipt);
      } else if (snapshot.status === 'rejected') {
        rejectedIds.push(snapshot.clientOperationId);
      } else if (snapshot.status === 'uncertain') {
        uncertainIds.push(snapshot.clientOperationId);
      } else {
        outstandingIds.push(snapshot.clientOperationId);
      }
    }
    return frozen({
      accepted: Object.freeze(accepted),
      rejectedIds: Object.freeze(rejectedIds),
      uncertainIds: Object.freeze(uncertainIds),
      outstandingIds: Object.freeze(outstandingIds),
    });
  }

  #result(
    status: AuthorityBarrierResult['status'],
    barrier: AuthorityBarrier,
    record: BarrierRecord | null,
  ): AuthorityBarrierResult {
    const partition =
      record === null
        ? frozen({
            accepted: Object.freeze([]) as readonly AuthorityReceipt[],
            rejectedIds: Object.freeze([]) as readonly string[],
            uncertainIds: Object.freeze([]) as readonly string[],
            outstandingIds: Object.freeze([]) as readonly string[],
          })
        : this.#partition(record);
    return frozen({
      status,
      barrier: record === null ? this.#copyInvalidBarrier(barrier) : record.barrier,
      ...partition,
    });
  }

  #settledStatus(record: BarrierRecord): 'acknowledged' | 'blocked' | null {
    const partition = this.#partition(record);
    if (partition.accepted.length === record.operations.length) return 'acknowledged';
    if (
      partition.rejectedIds.length > 0 ||
      partition.uncertainIds.length > 0 ||
      record.operations.some((operation) => operation.snapshot.status === 'draft')
    ) {
      return 'blocked';
    }
    return null;
  }

  #notifyWaiters(): void {
    for (const waiter of Array.from(this.#waiters)) {
      const status = this.#settledStatus(waiter.barrier);
      if (status !== null) this.#settleWaiter(waiter, status);
    }
  }

  #settleWaiter(waiter: WaitTransaction, status: AuthorityBarrierResult['status']): void {
    if (waiter.settled) return;
    waiter.settled = true;
    this.#waiters.delete(waiter);
    waiter.barrier.waiters -= 1;
    for (const operation of waiter.barrier.operations) operation.pins -= 1;
    this.#waiterBudget.release();
    if (waiter.timer !== undefined) clearTimeout(waiter.timer);
    this.#detachWaiter(waiter);
    waiter.resolve(this.#result(status, waiter.barrier.barrier, waiter.barrier));
  }

  #detachWaiter(waiter: WaitTransaction): void {
    if (
      waiter.registration !== 'complete' ||
      waiter.detachAttempted ||
      waiter.signal === undefined ||
      waiter.onAbort === undefined
    ) {
      return;
    }
    waiter.detachAttempted = true;
    try {
      waiter.signal.remove(waiter.onAbort);
    } catch {
      // A hostile signal cannot prevent SDK reservation and pin cleanup.
    }
  }

  #captureWaitStatus(
    barrier: AuthorityBarrier,
    record: BarrierRecord,
  ): 'invalid' | 'stopped' | 'capacity' | null {
    if (record.barrier !== barrier || this.#barriers.get(barrier) !== record) return 'invalid';
    if (this.#stopped) return 'stopped';
    if (this.#settledStatus(record) === null && !this.#waiterBudget.hasCapacity()) {
      return 'capacity';
    }
    return null;
  }

  #captureFailureResult(barrier: AuthorityBarrier, record: BarrierRecord): AuthorityBarrierResult {
    const status = this.#captureWaitStatus(barrier, record);
    if (status === null) return this.#result('invalid', barrier, record);
    return this.#result(status, barrier, status === 'invalid' ? null : record);
  }

  #captureSignal(
    signal: AbortSignal,
    barrier: AuthorityBarrier,
    record: BarrierRecord,
  ): { readonly signal: SignalSnapshot } | { readonly status: 'invalid' | 'stopped' | 'capacity' } {
    if (typeof signal !== 'object' || signal === null) return { status: 'invalid' };
    let initialAborted: unknown;
    let add: unknown;
    let remove: unknown;
    let capturedAborted: unknown;
    try {
      initialAborted = signal.aborted;
    } catch {
      return { status: this.#captureWaitStatus(barrier, record) ?? 'invalid' };
    }
    let status = this.#captureWaitStatus(barrier, record);
    if (status !== null) return { status };
    try {
      add = signal.addEventListener;
    } catch {
      return { status: this.#captureWaitStatus(barrier, record) ?? 'invalid' };
    }
    status = this.#captureWaitStatus(barrier, record);
    if (status !== null) return { status };
    try {
      remove = signal.removeEventListener;
    } catch {
      return { status: this.#captureWaitStatus(barrier, record) ?? 'invalid' };
    }
    status = this.#captureWaitStatus(barrier, record);
    if (status !== null) return { status };
    try {
      capturedAborted = signal.aborted;
    } catch {
      return { status: this.#captureWaitStatus(barrier, record) ?? 'invalid' };
    }
    status = this.#captureWaitStatus(barrier, record);
    if (status !== null) return { status };
    if (
      typeof initialAborted !== 'boolean' ||
      typeof add !== 'function' ||
      typeof remove !== 'function' ||
      typeof capturedAborted !== 'boolean'
    ) {
      return { status: 'invalid' };
    }
    return {
      signal: {
        aborted: initialAborted || capturedAborted,
        add: (listener) => {
          Reflect.apply(add, signal, ['abort', listener, { once: true }]);
        },
        remove: (listener) => {
          Reflect.apply(remove, signal, ['abort', listener]);
        },
        check: () => {
          try {
            const aborted = signal.aborted;
            return typeof aborted === 'boolean' ? aborted : null;
          } catch {
            return null;
          }
        },
      },
    };
  }

  #copyInvalidBarrier(value: AuthorityBarrier): AuthorityBarrier {
    try {
      if (typeof value !== 'object' || value === null) return this.#invalidBarrier;
      const barrierId = this.#dataProperty(value, 'barrierId');
      const scopeId = this.#dataProperty(value, 'scopeId');
      const generation = this.#dataProperty(value, 'generation');
      const throughLocalSequence = this.#dataProperty(value, 'throughLocalSequence');
      const localEditGeneration = this.#dataProperty(value, 'localEditGeneration');
      const operationIds = this.#dataProperty(value, 'operationIds');
      if (
        !validId(barrierId) ||
        !validId(scopeId) ||
        (generation !== null && !validId(generation)) ||
        !Number.isSafeInteger(throughLocalSequence) ||
        (throughLocalSequence as number) < 0 ||
        !Number.isSafeInteger(localEditGeneration) ||
        (localEditGeneration as number) < 0 ||
        !Array.isArray(operationIds)
      ) {
        return this.#invalidBarrier;
      }
      const length = Object.getOwnPropertyDescriptor(operationIds, 'length');
      if (
        length === undefined ||
        !('value' in length) ||
        !Number.isSafeInteger(length.value) ||
        length.value < 0 ||
        length.value > MAX_AUTHORITY_JOURNAL_OPERATIONS
      ) {
        return this.#invalidBarrier;
      }
      const copiedIds: string[] = [];
      const seen = new Set<string>();
      for (let index = 0; index < length.value; index += 1) {
        const id = this.#dataProperty(operationIds, String(index));
        if (!validId(id) || seen.has(id)) return this.#invalidBarrier;
        seen.add(id);
        copiedIds.push(id);
      }
      return frozen({
        barrierId,
        scopeId,
        generation,
        throughLocalSequence: throughLocalSequence as number,
        localEditGeneration: localEditGeneration as number,
        operationIds: Object.freeze(copiedIds),
      });
    } catch {
      return this.#invalidBarrier;
    }
  }

  #dataProperty(value: object, key: string): unknown {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && descriptor.enumerable && 'value' in descriptor
      ? descriptor.value
      : undefined;
  }
}
