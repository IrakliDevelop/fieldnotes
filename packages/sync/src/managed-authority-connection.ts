import { AuthorityCheckpointAssembler } from './authority-checkpoint';
import { AuthorityClientDocument } from './authority-client-document';
import {
  AuthorityClientJournal,
  AuthorityWaiterBudget,
  DEFAULT_AUTHORITY_WAIT_TIMEOUT_MS,
  MAX_AUTHORITY_WAIT_TIMEOUT_MS,
} from './authority-client-journal';
import {
  closeAuthorityWebSocketTransport,
  createAuthorityWebSocketTransport,
} from './authority-websocket-transport';
import { parseBoundedJson } from './authority-json';
import { createAuthorityCapabilities } from './capabilities';
import { createAuthorityOperationId } from './authority-operation-id';
import {
  MAX_AUTHORITY_FRAME_BYTES,
  MAX_AUTHORITY_JSON_DEPTH,
  MAX_AUTHORITY_JSON_NODES,
  parseAuthorityServerFrame,
  serializeAuthorityFrame,
} from './authority-protocol';
import { isValidEnvelope } from './protocol';
import type {
  AuthorityBarrier,
  AuthorityBarrierResult,
  AuthorityClientCheckpointResult,
  AuthorityClientState,
  AuthorityClientStatus,
  AuthorityClientTransport,
  AuthorityRetryResult,
  AuthoritySubmitResult,
  ManagedAuthorityConnection,
  ManagedAuthorityOptions,
} from './authority-client-types';
import type { AuthorityMutation } from './authority-protocol';
import type { SyncEnvelope } from './protocol';
import type { SyncCapabilities } from './protocol';

const MAX_LISTENERS = 64;
const MAX_INBOX_FRAMES = 64;
const MAX_INBOX_BYTES = 4 * 1024 * 1024;
const HANDSHAKE_TIMEOUT_MS = 5_000;
const CHECKPOINT_TIMEOUT_MS = 10_000;
const RESOLVE_TIMEOUT_MS = 10_000;
const CHECKPOINT_SPACING_MS = 10_000;
const encoder = new TextEncoder();
const idPattern = /^[\x20-\x7e]{1,128}$/;

interface CheckpointTransaction {
  readonly epoch: number;
  readonly requestId: string;
  readonly generation: string;
  readonly barrier: AuthorityBarrier | null;
  readonly key: AuthorityBarrier | null;
  readonly promise: Promise<AuthorityClientCheckpointResult>;
  resolve(result: AuthorityClientCheckpointResult): void;
  assembler: AuthorityCheckpointAssembler;
  timeout: ReturnType<typeof setTimeout> | null;
  settled: boolean;
  readonly automatic: boolean;
  readonly callers: Set<object>;
  gateTimer: ReturnType<typeof setTimeout> | null;
  sending: boolean;
  sent: boolean;
  sendNow?: () => void;
}

interface ManagedAuthoritySnapshot {
  readonly scopeId: string;
  readonly clientId: string;
  readonly resolveUrl: ManagedAuthorityOptions['resolveUrl'];
  readonly extensions: NonNullable<ManagedAuthorityOptions['extensions']>;
  readonly transportFactory: NonNullable<ManagedAuthorityOptions['transportFactory']>;
}

interface CallerSignalSnapshot {
  readonly aborted: boolean;
  readonly add: (listener: () => void) => void;
  readonly remove: (listener: () => void) => void;
  readonly check: () => boolean | null;
}

function frozen<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

function failure(
  reason: Extract<AuthorityClientCheckpointResult, { status: 'failed' }>['reason'],
): AuthorityClientCheckpointResult {
  return frozen({ status: 'failed' as const, reason });
}

function snapshotOptions(options: ManagedAuthorityOptions): ManagedAuthoritySnapshot {
  if (typeof options !== 'object' || options === null) {
    throw new TypeError('Invalid managed authority options');
  }
  let scopeId: unknown;
  let clientId: unknown;
  let resolveUrl: unknown;
  let extensions: unknown;
  let transportFactory: unknown;
  try {
    scopeId = Reflect.get(options, 'scopeId');
    clientId = Reflect.get(options, 'clientId');
    resolveUrl = Reflect.get(options, 'resolveUrl');
    extensions = Reflect.get(options, 'extensions');
    transportFactory = Reflect.get(options, 'transportFactory');
  } catch {
    throw new TypeError('Invalid managed authority options');
  }
  if (
    typeof scopeId !== 'string' ||
    !idPattern.test(scopeId) ||
    typeof clientId !== 'string' ||
    !idPattern.test(clientId) ||
    typeof resolveUrl !== 'function' ||
    (extensions !== undefined && !Array.isArray(extensions)) ||
    (transportFactory !== undefined && typeof transportFactory !== 'function')
  ) {
    throw new TypeError('Invalid managed authority options');
  }
  let extensionSnapshot: readonly NonNullable<ManagedAuthorityOptions['extensions']>[number][];
  try {
    extensionSnapshot = Object.freeze([...(extensions ?? [])]);
  } catch {
    throw new TypeError('Invalid managed authority options');
  }
  return Object.freeze({
    scopeId,
    clientId,
    resolveUrl: resolveUrl as ManagedAuthorityOptions['resolveUrl'],
    extensions: extensionSnapshot,
    transportFactory:
      (transportFactory as ManagedAuthorityOptions['transportFactory']) ??
      createAuthorityWebSocketTransport,
  });
}

function capabilitySignature(
  capabilities: SyncCapabilities,
  expected: SyncCapabilities,
): string | null {
  if (
    capabilities.protocolVersion !== 1 ||
    capabilities.authority !== 1 ||
    capabilities.elementEnvelope !== true ||
    !Array.isArray(capabilities.extensionKinds)
  ) {
    return null;
  }
  const kinds = capabilities.extensionKinds;
  if (
    kinds.length !== expected.extensionKinds.length ||
    new Set(kinds).size !== kinds.length ||
    kinds.some(
      (kind) =>
        typeof kind !== 'string' ||
        kind.length < 1 ||
        kind.length > 128 ||
        !/^[\x20-\x7e]+$/.test(kind) ||
        !expected.extensionKinds.includes(kind),
    )
  ) {
    return null;
  }
  const inventory = capabilities.authorityExtensions ?? [];
  const expectedInventory = expected.authorityExtensions ?? [];
  if (!Array.isArray(inventory) || inventory.length !== expectedInventory.length) return null;
  const byKey = new Map(expectedInventory.map((entry) => [entry.key, entry]));
  const seen = new Set<string>();
  for (const entry of inventory) {
    const match = byKey.get(entry.key);
    if (
      seen.has(entry.key) ||
      match === undefined ||
      entry.pluginName !== match.pluginName ||
      entry.version !== match.version
    ) {
      return null;
    }
    seen.add(entry.key);
  }
  return JSON.stringify({
    protocolVersion: 1,
    authority: 1,
    elementEnvelope: true,
    extensionKinds: [...kinds].sort(),
    authorityExtensions: [...inventory]
      .map(({ key, pluginName, version }) => ({ key, pluginName, version }))
      .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0)),
  });
}

function parseLegacyEnvelope(raw: string): SyncEnvelope | null {
  const value = parseBoundedJson(raw, {
    bytes: MAX_AUTHORITY_FRAME_BYTES,
    depth: MAX_AUTHORITY_JSON_DEPTH,
    nodes: MAX_AUTHORITY_JSON_NODES,
  });
  return isValidEnvelope(value) ? value : null;
}

function captureCallerSignal(signal: AbortSignal): CallerSignalSnapshot | null {
  if (typeof signal !== 'object' || signal === null) return null;
  let initialAborted: unknown;
  let add: unknown;
  let remove: unknown;
  let capturedAborted: unknown;
  try {
    initialAborted = signal.aborted;
    add = signal.addEventListener;
    remove = signal.removeEventListener;
    capturedAborted = signal.aborted;
  } catch {
    return null;
  }
  if (
    typeof initialAborted !== 'boolean' ||
    typeof add !== 'function' ||
    typeof remove !== 'function' ||
    typeof capturedAborted !== 'boolean'
  ) {
    return null;
  }
  return {
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
  };
}

/** Owns one bounded authoritative connection lifecycle and its canonical confirmed document. */
export function createManagedAuthorityConnection(
  options: ManagedAuthorityOptions,
): ManagedAuthorityConnection {
  const config = snapshotOptions(options);
  const document = new AuthorityClientDocument(config.extensions);
  const waiterBudget = new AuthorityWaiterBudget();
  const journal = new AuthorityClientJournal({ scopeId: config.scopeId, waiterBudget });
  const requirements = document.checkpointRequirements;
  const expectedCapabilities = createAuthorityCapabilities(
    document.extensionKinds,
    requirements.map(({ key, pluginName, version }) => ({ key, pluginName, version })),
  );
  const expectedCapabilitySignature = capabilitySignature(
    expectedCapabilities,
    expectedCapabilities,
  );
  if (expectedCapabilitySignature === null) throw new TypeError('Invalid authority capabilities');
  const transportFactory = config.transportFactory;
  const listeners = new Set<() => void>();
  let status: AuthorityClientStatus = 'connecting';
  let error: string | null = null;
  let state: AuthorityClientState;
  let stopped = false;
  let stopPublished = false;
  let epoch = 0;
  let transport: AuthorityClientTransport | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let handshakeTimer: ReturnType<typeof setTimeout> | null = null;
  let credentialTimer: ReturnType<typeof setTimeout> | null = null;
  let retryAttempt = 0;
  let authFailures = 0;
  let capabilitiesAccepted = false;
  let capabilityWire: string | null = null;
  let checkpoint: CheckpointTransaction | null = null;
  let lastCheckpointRequestAt = Number.NEGATIVE_INFINITY;
  let inbox: string[] = [];
  let inboxBytes = 0;
  let drainOwner: object | null = null;

  const rebuildState = (): AuthorityClientState => {
    const stats = journal.stats();
    return frozen({
      status,
      scopeId: config.scopeId,
      generation: journal.generation,
      document: document.getSnapshot(),
      operations: journal.operations(),
      localSequence: stats.localSequence,
      localEditGeneration: stats.localEditGeneration,
      error,
    });
  };
  state = rebuildState();

  const publish = (): void => {
    if (stopPublished) return;
    const next = rebuildState();
    if (
      next.status === state.status &&
      next.generation === state.generation &&
      next.document === state.document &&
      next.operations.length === state.operations.length &&
      next.operations.every((entry, index) => entry === state.operations[index]) &&
      next.localSequence === state.localSequence &&
      next.localEditGeneration === state.localEditGeneration &&
      next.error === state.error
    ) {
      return;
    }
    state = next;
    for (const listener of [...listeners]) {
      if (state !== next) break;
      try {
        listener();
      } catch {
        // Listener failure is isolated after the atomic state swap.
      }
    }
  };

  const setStatus = (next: AuthorityClientStatus, nextError: string | null = null): void => {
    if (stopped) return;
    status = next;
    error = nextError;
    publish();
  };

  const clearEpisodeTimers = (): void => {
    if (handshakeTimer !== null) clearTimeout(handshakeTimer);
    if (credentialTimer !== null) clearTimeout(credentialTimer);
    handshakeTimer = null;
    credentialTimer = null;
  };

  const closeTransport = (code?: number): void => {
    const active = transport;
    transport = null;
    try {
      if (
        active !== null &&
        (code === undefined || !closeAuthorityWebSocketTransport(active, code))
      ) {
        active.close();
      }
    } catch {
      // A hostile transport close cannot retain the manager episode.
    }
  };

  const resolveCheckpoint = (
    active: CheckpointTransaction,
    result: AuthorityClientCheckpointResult,
  ): void => {
    if (active.settled) return;
    active.settled = true;
    if (active.gateTimer !== null) clearTimeout(active.gateTimer);
    active.gateTimer = null;
    if (active.timeout !== null) clearTimeout(active.timeout);
    active.timeout = null;
    active.resolve(result);
  };

  const releaseCheckpoint = async (
    active: CheckpointTransaction,
    abandonReason?: Extract<AuthorityClientCheckpointResult, { status: 'failed' }>['reason'],
  ): Promise<void> => {
    if (active.gateTimer !== null) clearTimeout(active.gateTimer);
    active.gateTimer = null;
    if (active.timeout !== null) clearTimeout(active.timeout);
    active.timeout = null;
    if (abandonReason !== undefined) {
      active.assembler.dispose();
      resolveCheckpoint(active, failure(abandonReason));
    }
    await active.assembler.whenSettled();
    if (checkpoint === active) checkpoint = null;
  };

  const scheduleRetry = (afterSettlement?: Promise<void>): void => {
    if (stopped || status === 'denied' || status === 'upgrade-required') return;
    setStatus('offline', 'connection');
    const scheduledEpoch = epoch;
    const schedule = (): void => {
      if (stopped || scheduledEpoch !== epoch || retryTimer !== null) return;
      const delay = Math.min(15_000, 1_000 * 2 ** Math.min(retryAttempt, 4));
      retryAttempt += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (!stopped && scheduledEpoch === epoch) beginCycle();
      }, delay);
    };
    if (afterSettlement) void afterSettlement.then(schedule, schedule);
    else schedule();
  };

  const abandonEpisode = (
    reason: Extract<AuthorityClientCheckpointResult, { status: 'failed' }>['reason'] = 'recovery',
    closeCode?: number,
  ): Promise<void> | undefined => {
    clearEpisodeTimers();
    closeTransport(closeCode);
    capabilitiesAccepted = false;
    capabilityWire = null;
    inbox = [];
    inboxBytes = 0;
    drainOwner = null;
    journal.markAttemptedUncertain();
    publish();
    const active = checkpoint;
    return active ? releaseCheckpoint(active, reason) : undefined;
  };

  const protocolFailure = (
    code: number,
    nextStatus: AuthorityClientStatus,
    codeName: string,
  ): void => {
    epoch += 1;
    const failureEpoch = epoch;
    const settlement = abandonEpisode(
      nextStatus === 'upgrade-required' ? 'upgrade-required' : 'recovery',
      code,
    );
    if (stopped || epoch !== failureEpoch) return;
    if (nextStatus === 'offline') scheduleRetry(settlement);
    else setStatus(nextStatus, codeName);
    void code;
  };

  const finishCheckpoint = async (
    active: CheckpointTransaction,
    result: Awaited<ReturnType<AuthorityCheckpointAssembler['accept']>>,
  ): Promise<void> => {
    await active.assembler.whenSettled();
    if (checkpoint !== active || active.settled) return;
    if (stopped || active.epoch !== epoch || result.status !== 'complete') {
      checkpoint = null;
      if (result.status === 'failed') {
        const reason =
          result.reason === 'crypto'
            ? 'crypto'
            : result.reason === 'timeout'
              ? 'timeout'
              : 'invalid';
        resolveCheckpoint(active, failure(reason));
        if (!stopped && active.epoch === epoch) protocolFailure(1013, 'offline', 'checkpoint');
      }
      return;
    }
    const installed = document.installCheckpoint(result.checkpoint);
    if (stopped || active.epoch !== epoch || checkpoint !== active || active.settled) {
      return;
    }
    checkpoint = null;
    if (installed.status !== 'applied') {
      resolveCheckpoint(active, failure('invalid'));
      protocolFailure(1013, 'offline', 'checkpoint');
      return;
    }
    const captured = result.checkpoint;
    resolveCheckpoint(
      active,
      frozen({ status: 'complete' as const, checkpoint: captured, barrier: active.barrier }),
    );
    retryAttempt = 0;
    authFailures = 0;
    publish();
  };

  const processStateFrame = async (raw: string, frameEpoch: number): Promise<void> => {
    if (stopped || frameEpoch !== epoch) return;
    const frame = parseAuthorityServerFrame(raw);
    if (!frame) {
      const legacy = parseLegacyEnvelope(raw);
      if (legacy?.op.kind === 'snapshot') protocolFailure(4406, 'upgrade-required', 'legacy');
      else protocolFailure(4406, 'upgrade-required', 'protocol');
      return;
    }
    if (frame.kind === 'upgrade-required') {
      protocolFailure(4406, 'upgrade-required', 'upgrade-required');
      return;
    }
    if (frame.kind === 'resync-required') {
      if (!capabilitiesAccepted) {
        protocolFailure(4406, 'upgrade-required', 'capabilities');
        return;
      }
      if (!journal.setGeneration(frame.generation)) {
        protocolFailure(1013, 'offline', 'generation');
        return;
      }
      if (handshakeTimer !== null) clearTimeout(handshakeTimer);
      handshakeTimer = null;
      setStatus('recovering');
      if (stopped || frameEpoch !== epoch || transport === null) return;
      const current = checkpoint;
      if (current !== null) {
        if (current.generation === frame.generation) {
          if (!current.sent) {
            if (current.gateTimer !== null) clearTimeout(current.gateTimer);
            current.gateTimer = null;
            current.sendNow?.();
          }
          return;
        }
        await releaseCheckpoint(current, 'recovery');
        if (stopped || frameEpoch !== epoch || transport === null) return;
      }
      startCheckpoint(null, true, true);
      return;
    }
    if (
      frame.kind === 'checkpoint-begin' ||
      frame.kind === 'checkpoint-chunk' ||
      frame.kind === 'checkpoint-end'
    ) {
      const active = checkpoint;
      if (active === null) {
        protocolFailure(1013, 'offline', 'checkpoint');
        return;
      }
      const result = await active.assembler.accept(raw);
      if (result.status !== 'pending') await finishCheckpoint(active, result);
      return;
    }
    if (frame.kind === 'changes') {
      const result = document.applyChanges(frame.cursor, frame.mutations);
      if (stopped || frameEpoch !== epoch) return;
      if (result.status === 'recovery') {
        protocolFailure(1013, 'offline', 'changes');
        return;
      }
      if (result.status === 'applied') publish();
    }
  };

  const drainInbox = async (): Promise<void> => {
    if (drainOwner !== null) return;
    const owner = {};
    const drainEpoch = epoch;
    drainOwner = owner;
    try {
      while (!stopped && drainEpoch === epoch && drainOwner === owner && inbox.length > 0) {
        const raw = inbox[0];
        if (raw === undefined) break;
        await processStateFrame(raw, drainEpoch);
        if (drainEpoch !== epoch || drainOwner !== owner) break;
        if (inbox[0] === raw) {
          inbox.shift();
          inboxBytes -= encoder.encode(raw).length;
        }
      }
      if (
        !stopped &&
        drainEpoch === epoch &&
        drainOwner === owner &&
        checkpoint === null &&
        inbox.length === 0 &&
        document.getSnapshot() !== null &&
        capabilitiesAccepted
      ) {
        setStatus('live');
      }
    } finally {
      if (drainOwner === owner) drainOwner = null;
    }
  };

  const enqueueState = (raw: string): void => {
    const bytes = encoder.encode(raw).length;
    if (
      bytes > MAX_AUTHORITY_FRAME_BYTES ||
      inbox.length >= MAX_INBOX_FRAMES ||
      bytes > MAX_INBOX_BYTES - inboxBytes
    ) {
      protocolFailure(1013, 'offline', 'inbox');
      return;
    }
    inbox.push(raw);
    inboxBytes += bytes;
    void drainInbox();
  };

  const handleMessage = (messageEpoch: number, raw: string): void => {
    if (stopped || messageEpoch !== epoch || typeof raw !== 'string') return;
    if (encoder.encode(raw).length > MAX_AUTHORITY_FRAME_BYTES) {
      protocolFailure(1013, 'offline', 'frame');
      return;
    }
    const legacy = parseLegacyEnvelope(raw);
    if (legacy?.op.kind === 'capabilities') {
      const signature = capabilitySignature(legacy.op.capabilities, expectedCapabilities);
      if (legacy.from !== 'hub' || signature !== expectedCapabilitySignature) {
        protocolFailure(4406, 'upgrade-required', 'capabilities');
        return;
      }
      if (capabilitiesAccepted && capabilityWire !== signature) {
        protocolFailure(4406, 'upgrade-required', 'capabilities');
        return;
      }
      capabilitiesAccepted = true;
      capabilityWire = signature;
      return;
    }
    const frame = parseAuthorityServerFrame(raw);
    if (!capabilitiesAccepted) {
      if (legacy?.op.kind === 'snapshot' || frame?.kind === 'upgrade-required') {
        protocolFailure(4406, 'upgrade-required', 'upgrade-required');
      } else {
        protocolFailure(4406, 'upgrade-required', 'negotiation-order');
      }
      return;
    }
    if (frame?.kind === 'receipt') {
      const outcome = journal.recordReceipt(frame.receipt);
      if (outcome === 'conflict') protocolFailure(1013, 'offline', 'receipt');
      else if (outcome === 'accepted') publish();
      return;
    }
    if (frame?.kind === 'rejected') {
      const outcome = journal.recordRejection(
        frame.generation,
        frame.clientOperationId,
        frame.reason,
      );
      if (outcome === 'conflict') protocolFailure(1013, 'offline', 'rejection');
      else if (outcome === 'rejected' || outcome === 'uncertain') publish();
      return;
    }
    enqueueState(raw);
  };

  function startCheckpoint(
    barrier: AuthorityBarrier | null,
    bypassSpacing: boolean,
    automatic: boolean,
  ): CheckpointTransaction | null {
    if (stopped || transport === null || journal.generation === null) return null;
    if (checkpoint !== null) {
      return !checkpoint.sent && !checkpoint.sending && checkpoint.key === barrier
        ? checkpoint
        : null;
    }
    let resolve!: (result: AuthorityClientCheckpointResult) => void;
    const promise = new Promise<AuthorityClientCheckpointResult>((done) => {
      resolve = done;
    });
    const requestId = createAuthorityOperationId();
    const active: CheckpointTransaction = {
      epoch,
      requestId,
      generation: journal.generation,
      barrier,
      key: barrier,
      promise,
      resolve,
      assembler: new AuthorityCheckpointAssembler({
        requestId,
        generation: journal.generation,
        requiredExtensions: requirements,
      }),
      timeout: null,
      settled: false,
      automatic,
      callers: new Set(),
      gateTimer: null,
      sending: false,
      sent: false,
    };
    checkpoint = active;
    const send = (): void => {
      if (stopped || checkpoint !== active || active.epoch !== epoch || transport === null) {
        void releaseCheckpoint(active, stopped ? 'stopped' : 'recovery');
        return;
      }
      if (active.sent || active.sending) return;
      if (active.gateTimer !== null) clearTimeout(active.gateTimer);
      active.gateTimer = null;
      const snapshot = document.getSnapshot();
      const wire = serializeAuthorityFrame({
        protocol: 'authority:1',
        kind: 'checkpoint-request',
        requestId,
        generation: active.generation,
        ...(snapshot === null || snapshot.cursor.generation !== active.generation
          ? {}
          : { cursor: snapshot.cursor }),
      });
      let sent: boolean;
      active.sending = true;
      const sendingTransport = transport;
      try {
        sent = sendingTransport.trySend(wire);
      } catch {
        sent = false;
      }
      if (
        stopped ||
        checkpoint !== active ||
        active.epoch !== epoch ||
        transport !== sendingTransport
      ) {
        active.sending = false;
        return;
      }
      active.sending = false;
      if (!sent) {
        void releaseCheckpoint(active, 'recovery');
        protocolFailure(1013, 'offline', 'transport');
        return;
      }
      lastCheckpointRequestAt = Date.now();
      active.sent = true;
      active.timeout = setTimeout(() => {
        if (checkpoint !== active) return;
        void releaseCheckpoint(active, 'timeout').then(() => {
          if (!stopped && active.epoch === epoch) protocolFailure(1013, 'offline', 'checkpoint');
        });
      }, CHECKPOINT_TIMEOUT_MS);
    };
    active.sendNow = send;
    const wait = bypassSpacing
      ? 0
      : Math.max(0, lastCheckpointRequestAt + CHECKPOINT_SPACING_MS - Date.now());
    if (wait === 0) send();
    else {
      active.gateTimer = setTimeout(() => {
        if (active.gateTimer === null) return;
        active.gateTimer = null;
        if (checkpoint !== active || active.epoch !== epoch || stopped) return;
        send();
      }, wait);
    }
    return active;
  }

  const handleClose = (closeEpoch: number, code: number): void => {
    if (stopped || closeEpoch !== epoch) return;
    epoch += 1;
    const terminalEpoch = epoch;
    const settlement = abandonEpisode(
      code === 4406
        ? 'upgrade-required'
        : code >= 4000 && code <= 4999 && code !== 4401
          ? 'denied'
          : 'recovery',
    );
    if (stopped || epoch !== terminalEpoch) return;
    if (code === 4406) setStatus('upgrade-required', 'protocol');
    else if (code === 4401) {
      authFailures += 1;
      if (authFailures >= 4) setStatus('denied', 'authentication');
      else scheduleRetry(settlement);
    } else if (code >= 4000 && code <= 4999) setStatus('denied', 'denied');
    else scheduleRetry(settlement);
  };

  function beginCycle(): void {
    if (stopped || transport !== null) return;
    epoch += 1;
    const cycleEpoch = epoch;
    capabilitiesAccepted = false;
    capabilityWire = null;
    setStatus('connecting');
    if (stopped || cycleEpoch !== epoch || transport !== null) return;
    let timedOut = false;
    credentialTimer = setTimeout(() => {
      if (stopped || cycleEpoch !== epoch) return;
      timedOut = true;
      setStatus('offline', 'credentials');
    }, RESOLVE_TIMEOUT_MS);
    let resolution: Promise<Awaited<ReturnType<ManagedAuthorityOptions['resolveUrl']>>>;
    try {
      resolution = Promise.resolve(config.resolveUrl());
    } catch {
      resolution = Promise.resolve(null);
    }
    void resolution.then(
      (endpoint) => {
        if (credentialTimer !== null) clearTimeout(credentialTimer);
        credentialTimer = null;
        if (stopped || cycleEpoch !== epoch) return;
        if (timedOut || endpoint === null) {
          scheduleRetry();
          return;
        }
        let active: AuthorityClientTransport;
        try {
          active = transportFactory(endpoint);
        } catch {
          scheduleRetry();
          return;
        }
        if (stopped || cycleEpoch !== epoch || transport !== null) {
          try {
            active.close();
          } catch {
            // A rejected stale transport cannot retain the stopped manager.
          }
          return;
        }
        transport = active;
        let opened = false;
        try {
          handshakeTimer = setTimeout(() => {
            if (!stopped && cycleEpoch === epoch) handleClose(cycleEpoch, 1006);
          }, RESOLVE_TIMEOUT_MS);
          active.start({
            onOpen: () => {
              if (stopped || cycleEpoch !== epoch || transport !== active || opened) return;
              opened = true;
              if (handshakeTimer !== null) clearTimeout(handshakeTimer);
              const wire = JSON.stringify({
                from: config.clientId,
                op: { kind: 'capabilities', capabilities: expectedCapabilities },
              });
              try {
                if (!active.trySend(wire)) return handleClose(cycleEpoch, 1006);
              } catch {
                return handleClose(cycleEpoch, 1006);
              }
              if (stopped || cycleEpoch !== epoch || transport !== active) return;
              handshakeTimer = setTimeout(() => {
                if (!stopped && cycleEpoch === epoch && status !== 'live')
                  handleClose(cycleEpoch, 1013);
              }, HANDSHAKE_TIMEOUT_MS);
            },
            onMessage: (raw) => {
              try {
                handleMessage(cycleEpoch, raw);
              } catch {
                protocolFailure(1013, 'offline', 'callback');
              }
            },
            onClose: (code) => handleClose(cycleEpoch, code),
          });
          if (stopped || cycleEpoch !== epoch || transport !== active) return;
        } catch {
          handleClose(cycleEpoch, 1006);
        }
      },
      () => {
        if (credentialTimer !== null) clearTimeout(credentialTimer);
        credentialTimer = null;
        if (!stopped && cycleEpoch === epoch) scheduleRetry();
      },
    );
  }

  const withCallerDeadline = (
    active: CheckpointTransaction,
    signal: CallerSignalSnapshot | undefined,
    timeoutMs: number,
  ): Promise<AuthorityClientCheckpointResult> =>
    new Promise((resolve) => {
      const token = {};
      let settled = false;
      let registration: 'none' | 'registering' | 'complete' =
        signal === undefined ? 'complete' : 'none';
      let detachAttempted = false;
      const detach = (): void => {
        if (registration !== 'complete' || detachAttempted || signal === undefined) {
          return;
        }
        detachAttempted = true;
        try {
          signal.remove(onAbort);
        } catch {
          // A hostile signal cannot prevent SDK reservation cleanup.
        }
      };
      const finish = (result: AuthorityClientCheckpointResult): void => {
        if (settled) return;
        settled = true;
        active.callers.delete(token);
        clearTimeout(timer);
        detach();
        resolve(result);
        if (
          active.callers.size === 0 &&
          !active.automatic &&
          !active.sent &&
          !active.sending &&
          checkpoint === active
        ) {
          checkpoint = null;
          const reason =
            result.status === 'failed' &&
            (result.reason === 'timeout' || result.reason === 'aborted')
              ? result.reason
              : 'recovery';
          void releaseCheckpoint(active, reason);
        }
      };
      const onAbort = (): void => finish(failure('aborted'));
      const timer = setTimeout(() => finish(failure('timeout')), timeoutMs);
      active.callers.add(token);
      if (signal?.aborted) {
        finish(failure('aborted'));
      } else if (signal === undefined) {
        void active.promise.then(finish);
      } else {
        let registrationFailed = false;
        registration = 'registering';
        try {
          signal.add(onAbort);
        } catch {
          registrationFailed = true;
        } finally {
          registration = 'complete';
          if (settled) detach();
        }
        if (!settled && registrationFailed) finish(failure('invalid'));
        if (!settled) {
          const aborted = signal.check();
          if (aborted === null) finish(failure('invalid'));
          else if (aborted) finish(failure('aborted'));
        }
        if (!settled) void active.promise.then(finish);
      }
    });

  queueMicrotask(beginCycle);

  return {
    getState: () => state,
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('Invalid authority listener');
      if (listeners.size >= MAX_LISTENERS)
        throw new RangeError('Authority listener limit exceeded');
      listeners.add(listener);
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        listeners.delete(listener);
      };
    },
    stop() {
      if (stopped) return;
      stopped = true;
      epoch += 1;
      if (retryTimer !== null) clearTimeout(retryTimer);
      retryTimer = null;
      const active = checkpoint;
      clearEpisodeTimers();
      closeTransport();
      inbox = [];
      inboxBytes = 0;
      drainOwner = null;
      journal.stop();
      if (active) void releaseCheckpoint(active, 'stopped');
      status = 'stopped';
      error = null;
      publish();
      stopPublished = true;
      listeners.clear();
    },
    submit(mutation: AuthorityMutation, submitOptions = {}): AuthoritySubmitResult {
      if (stopped) return frozen({ status: 'refused' as const, reason: 'stopped' as const });
      if (status === 'denied' || status === 'upgrade-required') {
        return frozen({ status: 'refused' as const, reason: 'not-ready' as const });
      }
      const result = journal.admit(mutation, submitOptions);
      if (result.status === 'admitted' && status === 'live' && transport !== null) {
        journal.attemptOperation(
          result.clientOperationId,
          (raw) => transport?.trySend(raw) ?? false,
        );
      }
      publish();
      return result;
    },
    retryOperation(clientOperationId: string): AuthorityRetryResult {
      const ready = journal.prepareRetry(clientOperationId, journal.generation, status === 'live');
      if (ready.status !== 'ready') return ready;
      if (transport === null)
        return frozen({ status: 'refused' as const, reason: 'transport' as const });
      const result = journal.attemptOperation(
        clientOperationId,
        (raw) => transport?.trySend(raw) ?? false,
      );
      publish();
      return result === 'pending' || result === 'uncertain'
        ? frozen({ status: 'sent' as const })
        : frozen({ status: 'refused' as const, reason: 'transport' as const });
    },
    releaseOperation(clientOperationId, releaseOptions = {}) {
      const released = journal.releaseOperation(clientOperationId, releaseOptions);
      if (released) publish();
      return released;
    },
    captureBarrier() {
      const barrier = journal.captureBarrier();
      if (barrier !== null) publish();
      return barrier;
    },
    releaseBarrier(barrier) {
      const released = journal.releaseBarrier(barrier);
      if (released) publish();
      return released;
    },
    waitForAcknowledgements(barrier, waitOptions = {}) {
      return journal.waitForAcknowledgements(barrier, waitOptions);
    },
    async requestCheckpoint(requestOptions = {}) {
      try {
        if (stopped) return failure('stopped');
        const timeoutMs = requestOptions.timeoutMs ?? DEFAULT_AUTHORITY_WAIT_TIMEOUT_MS;
        if (stopped) return failure('stopped');
        const sourceSignal = requestOptions.signal;
        if (stopped) return failure('stopped');
        const barrier = requestOptions.barrier ?? null;
        if (stopped) return failure('stopped');
        if (
          !Number.isSafeInteger(timeoutMs) ||
          timeoutMs < 1 ||
          timeoutMs > MAX_AUTHORITY_WAIT_TIMEOUT_MS
        ) {
          return failure('invalid');
        }
        const deadlineAt = Date.now() + timeoutMs;
        const callerSignal =
          sourceSignal === undefined ? undefined : captureCallerSignal(sourceSignal);
        if (callerSignal === null) return failure('invalid');
        if (stopped) return failure('stopped');
        if (callerSignal?.aborted) return failure('aborted');
        if (barrier !== null) {
          const acknowledged: AuthorityBarrierResult = await journal.waitForAcknowledgements(
            barrier,
            {
              signal: sourceSignal,
              timeoutMs,
            },
          );
          if (acknowledged.status !== 'acknowledged' || barrier.generation !== journal.generation) {
            if (
              acknowledged.status === 'timeout' ||
              acknowledged.status === 'aborted' ||
              acknowledged.status === 'stopped'
            ) {
              return failure(acknowledged.status);
            }
            return failure('barrier');
          }
        }
        if (stopped) return failure('stopped');
        if (callerSignal !== undefined) {
          const aborted = callerSignal.check();
          if (aborted === null) return failure('invalid');
          if (aborted) return failure('aborted');
        }
        if (stopped) return failure('stopped');
        if (status !== 'live') {
          if (status === 'denied') return failure('denied');
          if (status === 'upgrade-required') return failure('upgrade-required');
          return failure('recovery');
        }
        const remaining = deadlineAt - Date.now();
        if (remaining < 1) return failure('timeout');
        if (!waiterBudget.reserve()) return failure('capacity');
        try {
          const existing = checkpoint;
          const active = existing ?? startCheckpoint(barrier, false, false);
          if (
            active === null ||
            active.key !== barrier ||
            (existing !== null && (active.sent || active.sending))
          ) {
            return failure('capacity');
          }
          return await withCallerDeadline(active, callerSignal ?? undefined, remaining);
        } finally {
          waiterBudget.release();
        }
      } catch {
        return failure(stopped ? 'stopped' : 'invalid');
      }
    },
  };
}
