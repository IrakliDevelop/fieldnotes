import { Viewport } from '@fieldnotes/core';
import {
  createAuthorityClientExtension,
  createAuthorityExtensionReducer,
  createExtensionKind,
  createManagedAuthorityConnection,
} from '@fieldnotes/sync';
import { createFogAuthorityClientExtension } from '@fieldnotes/vtt/sync';
import type {
  AuthorityBarrier,
  AuthorityClientOperation,
  AuthorityClientTransport,
  AuthorityClientTransportHandlers,
  AuthorityMutation,
  ManagedAuthorityConnection,
  ManagedSyncEndpoint,
  SyncElement,
} from '@fieldnotes/sync';

export function operationBuckets(operations: readonly AuthorityClientOperation[]) {
  const result = {
    draft: [] as string[],
    pending: [] as string[],
    rejected: [] as string[],
    uncertain: [] as string[],
    accepted: [] as string[],
  };
  for (const operation of operations) result[operation.status].push(operation.clientOperationId);
  return result;
}

export function projectionIds(elements: readonly Pick<SyncElement, 'id'>[]): readonly string[] {
  return elements.map((element) => element.id);
}

const syntheticKind = createExtensionKind({
  extensionKind: 'synthetic:set',
  codec: { validate: (value: unknown): value is string => typeof value === 'string' },
});
const syntheticReducer = createAuthorityExtensionReducer<string, string>({
  kind: syntheticKind,
  reduce: (_state, payload) => payload,
});
const syntheticExtension = createAuthorityClientExtension({
  key: 'synthetic',
  pluginName: 'sdk-f-browser-fixture',
  version: 1,
  validate: (value: unknown): value is string => typeof value === 'string',
  reducers: [syntheticReducer],
});

interface TransportToken {
  readonly openedEpisode: number;
  readonly transports: ReadonlySet<ObservableTransport>;
}

class TransportGate {
  held = false;
  private openedEpisode = 0;
  private readonly transports = new Set<ObservableTransport>();
  private waiter: {
    readonly token: TransportToken;
    readonly finish: (transport: ObservableTransport | null) => void;
    readonly timeout: ReturnType<typeof setTimeout>;
  } | null = null;

  register(transport: ObservableTransport): void {
    this.transports.add(transport);
  }
  unregister(transport: ObservableTransport): void {
    this.transports.delete(transport);
  }
  hold(): TransportToken {
    this.cancelWaiter();
    const token = Object.freeze({
      openedEpisode: this.openedEpisode,
      transports: new Set(this.transports) as ReadonlySet<ObservableTransport>,
    });
    this.held = true;
    for (const transport of [...this.transports]) transport.disconnectForGate();
    return token;
  }
  release(): void {
    this.held = false;
    for (const transport of this.transports) transport.openIfPermitted();
  }
  noteOpen(transport: ObservableTransport): void {
    this.openedEpisode++;
    const waiter = this.waiter;
    if (
      !waiter ||
      this.openedEpisode <= waiter.token.openedEpisode ||
      waiter.token.transports.has(transport)
    )
      return;
    waiter.finish(transport);
  }
  waitForOpenAfter(token: TransportToken, deadlineAt: number): Promise<ObservableTransport | null> {
    this.cancelWaiter();
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) return Promise.resolve(null);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (transport: ObservableTransport | null): void => {
        if (settled) return;
        settled = true;
        if (this.waiter?.finish === finish) this.waiter = null;
        clearTimeout(timeout);
        resolve(transport);
      };
      const timeout = setTimeout(() => finish(null), remaining);
      this.waiter = { token, finish, timeout };
    });
  }
  cancelWaiter(): void {
    this.waiter?.finish(null);
  }
  diagnostics(): {
    readonly openedEpisode: number;
    readonly registrations: number;
    readonly waiters: number;
  } {
    return Object.freeze({
      openedEpisode: this.openedEpisode,
      registrations: this.transports.size,
      waiters: this.waiter ? 1 : 0,
    });
  }
}

const SYNTHETIC_CLIENT_CLOSE_CODE = 1000;

class ObservableTransport implements AuthorityClientTransport {
  private socket: WebSocket | null = null;
  private handlers: AuthorityClientTransportHandlers | null = null;
  private closed = false;

  constructor(
    private readonly endpoint: ManagedSyncEndpoint,
    private readonly checkpointCorruption: { pending: boolean; consumed: number },
    private readonly gate: TransportGate,
  ) {
    gate.register(this);
  }

  start(handlers: AuthorityClientTransportHandlers): void {
    this.handlers = handlers;
    this.openIfPermitted();
  }

  openIfPermitted(): void {
    if (this.closed || this.gate.held || this.socket || !this.handlers) return;
    const handlers = this.handlers;
    const socket = new WebSocket(this.endpoint.url, this.endpoint.protocols);
    this.socket = socket;
    socket.addEventListener('open', () => {
      if (this.closed || this.socket !== socket || this.gate.held) return;
      this.gate.noteOpen(this);
      handlers.onOpen();
    });
    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') {
        socket.close(4406);
        return;
      }
      let raw = event.data;
      if (this.checkpointCorruption.pending) {
        const value = JSON.parse(raw) as { kind?: string; manifest?: { sha256?: string } };
        if (value.kind === 'checkpoint-begin' && typeof value.manifest?.sha256 === 'string') {
          this.checkpointCorruption.pending = false;
          this.checkpointCorruption.consumed++;
          raw = JSON.stringify({
            ...value,
            manifest: { ...value.manifest, sha256: '0'.repeat(64) },
          });
        }
      }
      handlers.onMessage(raw);
    });
    socket.addEventListener('close', (event) => {
      if (this.socket === socket) this.socket = null;
      handlers.onClose(event.code, event.reason);
    });
  }

  trySend(raw: string): boolean {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN || this.gate.held) return false;
    socket.send(raw);
    return true;
  }

  disconnectForGate(): void {
    this.closed = true;
    this.gate.unregister(this);
    this.socket?.close(SYNTHETIC_CLIENT_CLOSE_CODE, 'fixture action gate');
  }
  disconnect(): void {
    this.closed = true;
    this.gate.unregister(this);
    this.socket?.close(SYNTHETIC_CLIENT_CLOSE_CODE, 'synthetic disconnect');
  }
  close(): void {
    this.closed = true;
    this.gate.unregister(this);
    this.socket?.close();
    this.socket = null;
  }
}

type FailureMode = 'reject' | 'lose-response' | 'checkpoint-failure';
type FailurePhase =
  | 'idle'
  | 'selected'
  | 'quiescing'
  | 'arming'
  | 'ready'
  | 'handed-off'
  | 'settling'
  | 'reconciling'
  | 'error';

interface FailureSnapshot {
  readonly controlId: string;
  readonly mode: FailureMode;
  readonly target: string | null;
  readonly generation: string | null;
  readonly phase: FailurePhase;
  readonly epoch: number;
  readonly deadlineAt: number;
}

type JsonObject = Readonly<Record<string, unknown>>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const validString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;
const exactKeys = (value: JsonObject, keys: readonly string[]): boolean => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};
const exactShape = (value: JsonObject, expected: JsonObject): boolean =>
  exactKeys(value, Object.keys(expected)) &&
  Object.entries(expected).every(([key, expectedValue]) => value[key] === expectedValue);

const validatedFailureArm = (
  value: JsonObject,
  transaction: FailureSnapshot,
  expectedGeneration: string,
): 'ready' | { readonly staleGeneration: string } | 'refused' | null => {
  if (
    (value.code === 'armed' || value.code === 'already-armed') &&
    exactShape(value, {
      ok: true,
      kind: 'failure-arm',
      code: value.code,
      controlId: transaction.controlId,
      mode: transaction.mode,
      target: transaction.target,
      generation: expectedGeneration,
    })
  )
    return 'ready';
  if (
    value.code === 'stale-generation' &&
    validString(value.currentGeneration) &&
    exactShape(value, {
      ok: false,
      kind: 'failure-arm',
      code: 'stale-generation',
      controlId: transaction.controlId,
      expectedGeneration,
      currentGeneration: value.currentGeneration,
    })
  )
    return { staleGeneration: value.currentGeneration };
  if (
    (value.code === 'owner-conflict' || value.code === 'control-busy') &&
    exactShape(value, {
      ok: false,
      kind: 'failure-arm',
      code: value.code,
      controlId: transaction.controlId,
    })
  )
    return 'refused';
  if (
    value.code === 'invalid-request' &&
    exactShape(value, { ok: false, kind: 'failure-arm', code: 'invalid-request' })
  )
    return 'refused';
  return null;
};

const validatedFailureStatus = (
  value: JsonObject,
  transaction: FailureSnapshot,
): JsonObject | null => {
  if (
    ['armed', 'reserved', 'armed-restored'].includes(String(value.code)) &&
    exactShape(value, {
      ok: true,
      kind: 'failure-status',
      code: value.code,
      controlId: transaction.controlId,
      mode: transaction.mode,
      target: transaction.target,
      generation: transaction.generation,
    }) &&
    validString(transaction.generation)
  )
    return value;
  if (
    ['consumed', 'cleared', 'invalidated-reset'].includes(String(value.code)) &&
    exactShape(value, {
      ok: true,
      kind: 'failure-status',
      code: value.code,
      controlId: transaction.controlId,
    })
  )
    return value;
  if (
    ['owner-mismatch', 'unknown-control'].includes(String(value.code)) &&
    exactShape(value, {
      ok: false,
      kind: 'failure-status',
      code: value.code,
      controlId: transaction.controlId,
    })
  )
    return value;
  if (
    value.code === 'invalid-request' &&
    exactShape(value, { ok: false, kind: 'failure-status', code: 'invalid-request' })
  )
    return value;
  return null;
};

const validatedFailureClear = (
  value: JsonObject,
  transaction: FailureSnapshot,
): JsonObject | null => {
  if (
    ['cleared', 'consumed', 'invalidated-reset'].includes(String(value.code)) &&
    exactShape(value, {
      ok: true,
      kind: 'failure-clear',
      code: value.code,
      controlId: transaction.controlId,
    })
  )
    return value;
  if (
    ['owner-mismatch', 'unknown-control', 'reservation-active'].includes(String(value.code)) &&
    exactShape(value, {
      ok: false,
      kind: 'failure-clear',
      code: value.code,
      controlId: transaction.controlId,
    })
  )
    return value;
  if (
    value.code === 'invalid-request' &&
    exactShape(value, { ok: false, kind: 'failure-clear', code: 'invalid-request' })
  )
    return value;
  return null;
};

const validatedReset = (
  value: JsonObject,
  kind: 'reset' | 'reset-status',
  resetId: string,
  expectedGeneration: string,
): JsonObject | null => {
  if (
    value.code === 'completed' &&
    validString(value.resultingGeneration) &&
    exactShape(value, {
      ok: true,
      kind,
      code: 'completed',
      resetId,
      expectedGeneration,
      resultingGeneration: value.resultingGeneration,
    })
  )
    return value;
  if (
    value.code === 'partial-failure' &&
    validString(value.currentGeneration) &&
    exactShape(value, {
      ok: false,
      kind,
      code: 'partial-failure',
      resetId,
      expectedGeneration,
      currentGeneration: value.currentGeneration,
    })
  )
    return value;
  if (
    value.code === 'stale-generation' &&
    validString(value.currentGeneration) &&
    exactShape(value, {
      ok: false,
      kind,
      code: 'stale-generation',
      resetId,
      expectedGeneration,
      currentGeneration: value.currentGeneration,
    })
  )
    return value;
  if (
    value.code === 'identity-mismatch' &&
    validString(value.currentGeneration) &&
    exactShape(value, {
      ok: false,
      kind,
      code: 'identity-mismatch',
      resetId,
      currentGeneration: value.currentGeneration,
    })
  )
    return value;
  if (
    kind === 'reset' &&
    value.code === 'reset-busy' &&
    validString(value.currentGeneration) &&
    exactShape(value, {
      ok: false,
      kind,
      code: 'reset-busy',
      resetId,
      currentGeneration: value.currentGeneration,
    })
  )
    return value;
  if (
    kind === 'reset-status' &&
    ['expired', 'unknown-reset', 'reset-mismatch'].includes(String(value.code)) &&
    validString(value.currentGeneration) &&
    exactShape(value, {
      ok: false,
      kind,
      code: value.code,
      resetId,
      currentGeneration: value.currentGeneration,
    })
  )
    return value;
  if (
    value.code === 'invalid-request' &&
    exactShape(value, { ok: false, kind, code: 'invalid-request' })
  )
    return value;
  return null;
};

const validatedGenerationStatus = (value: JsonObject): string | null =>
  validString(value.currentGeneration) &&
  exactShape(value, {
    ok: true,
    kind: 'generation-status',
    code: 'current',
    currentGeneration: value.currentGeneration,
  })
    ? value.currentGeneration
    : null;

const validatedGenerationReplace = (
  value: JsonObject,
  replaceId: string,
  expectedGeneration: string,
): JsonObject | null => {
  if (
    value.code === 'completed' &&
    validString(value.resultingGeneration) &&
    exactShape(value, {
      ok: true,
      kind: 'generation-replace',
      code: 'completed',
      replaceId,
      expectedGeneration,
      resultingGeneration: value.resultingGeneration,
    })
  )
    return value;
  if (
    value.code === 'partial-failure' &&
    validString(value.currentGeneration) &&
    exactShape(value, {
      ok: false,
      kind: 'generation-replace',
      code: 'partial-failure',
      replaceId,
      expectedGeneration,
      currentGeneration: value.currentGeneration,
    })
  )
    return value;
  if (
    value.code === 'stale-generation' &&
    validString(value.currentGeneration) &&
    exactShape(value, {
      ok: false,
      kind: 'generation-replace',
      code: 'stale-generation',
      replaceId,
      expectedGeneration,
      currentGeneration: value.currentGeneration,
    })
  )
    return value;
  if (
    ['control-busy', 'identity-mismatch'].includes(String(value.code)) &&
    validString(value.currentGeneration) &&
    exactShape(value, {
      ok: false,
      kind: 'generation-replace',
      code: value.code,
      replaceId,
      currentGeneration: value.currentGeneration,
    })
  )
    return value;
  return null;
};

function bootstrap(): void {
  const node = <T extends HTMLElement>(id: string): T => {
    const value = document.getElementById(id);
    if (!value) throw new Error(`Missing fixture node ${id}`);
    return value as T;
  };
  const viewport = new Viewport(node('viewport'), {
    background: { pattern: 'dots', spacing: 24 },
  });
  const status = node<HTMLElement>('status');
  const canonical = node<HTMLElement>('canonical');
  const peer = node<HTMLElement>('peer');
  const events = node<HTMLElement>('events');
  const draftId = node<HTMLInputElement>('draft-id');
  const extensionValue = node<HTMLInputElement>('extension-value');
  const warning = node<HTMLElement>('duplicate-warning');
  const lines: string[] = [];
  const retained = new Map<string, AuthorityClientOperation>();
  const checkpointCorruption = { pending: false, consumed: 0 };
  const transportGate = new TransportGate();
  let manager: ManagedAuthorityConnection;
  let managerActive = true;
  let unsubscribeManager: () => void = () => undefined;
  let managerEpoch = 0;
  let lifecycleEpoch = 0;
  let resetRequested = false;
  let queuedReset: { readonly requestedAt: number } | null = null;
  let actionBusy = false;
  let activeAction: Promise<void> | null = null;
  let transport: ObservableTransport | null = null;
  let checkpointEpisode: string | null = null;
  let draft: AuthorityMutation | null = null;
  let barrier: AuthorityBarrier | null = null;
  let checkpointResult = 'none';
  let barrierResult = 'none';
  let projectionInvariant = 'not checked';
  let lastConfirmedDocument: ReturnType<ManagedAuthorityConnection['getState']>['document'] = null;
  let selectedFailure: Exclude<FailureMode, 'checkpoint-failure'> | null = null;
  let failureSnapshot: FailureSnapshot | null = null;
  let failureError: string | null = null;
  let resetResult = 'none';
  let peerConvergence = 'not checked';
  let idSequence = 0;
  let startQueuedReset: () => void = () => undefined;

  status.dataset.console = 'clean';

  const event = (label: string): void => {
    lines.unshift(`${new Date().toLocaleTimeString()} · ${label}`);
    if (lines.length > 30) lines.pop();
    events.textContent = lines.join('\n');
  };
  const makeId = (kind: string): string => `${crypto.randomUUID()}:${kind}:${++idSequence}`;
  const markConsoleError = (label: string, error: unknown): void => {
    console.error(label, error);
    status.dataset.console = 'error';
  };
  const phase = (): FailurePhase =>
    failureSnapshot?.phase ?? (selectedFailure ? 'selected' : 'idle');
  const admissionFenced = (): boolean =>
    transportGate.held ||
    !managerActive ||
    failureSnapshot !== null ||
    resetResult === 'resetting' ||
    resetResult === 'blocked';
  const replaceFailure = (
    value: Omit<FailureSnapshot, 'epoch'> & { readonly epoch?: number },
  ): FailureSnapshot => {
    const snapshot = Object.freeze({ ...value, epoch: value.epoch ?? lifecycleEpoch });
    failureSnapshot = snapshot;
    return snapshot;
  };
  const sleep = (milliseconds: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, milliseconds));

  const project = (owner = manager): void => {
    const documentState = owner.getState().document;
    if (!documentState) return;
    const before = viewport.history.undoCount;
    viewport.store.clear({ origin: 'remote' });
    for (const element of documentState.elements)
      viewport.store.add(structuredClone(element), { origin: 'remote' });
    const after = viewport.history.undoCount;
    projectionInvariant =
      before === after ? `PASS (${before} → ${after})` : `FAIL (${before} → ${after})`;
    if (before !== after) {
      console.error('INVARIANT: remote canonical projection created core history');
      status.dataset.invariant = 'failed';
    } else status.dataset.invariant = 'passed';
  };

  const render = (owner = manager): void => {
    const state = owner.getState();
    const visibleOperations = managerActive ? state.operations : [];
    if (managerActive && state.document) lastConfirmedDocument = state.document;
    const visibleDocument = managerActive
      ? (state.document ?? lastConfirmedDocument)
      : lastConfirmedDocument;
    for (const operation of visibleOperations) retained.set(operation.clientOperationId, operation);
    const buckets = operationBuckets(visibleOperations);
    const extension = visibleDocument?.extensions.synthetic?.data ?? null;
    const fog = visibleDocument?.extensions.fog?.data ?? null;
    status.dataset.status = state.status;
    status.dataset.generation = state.generation ?? 'none';
    status.dataset.pending = String(buckets.pending.length);
    status.dataset.rejected = String(buckets.rejected.length);
    status.dataset.uncertain = String(buckets.uncertain.length);
    status.dataset.draft = String(buckets.draft.length);
    status.dataset.accepted = String(buckets.accepted.length);
    status.dataset.corruptCheckpoint = checkpointCorruption.pending ? 'armed' : 'idle';
    status.dataset.corruptedCheckpoints = String(checkpointCorruption.consumed);
    status.dataset.failureControl = phase();
    status.dataset.failureControlCommand = failureSnapshot?.mode ?? selectedFailure ?? 'none';
    status.dataset.reset = resetResult;
    status.dataset.fog = fog ? 'defined' : 'missing';
    status.dataset.fogTiles = String(
      fog && typeof fog === 'object' && 'tiles' in fog && Array.isArray(fog.tiles)
        ? fog.tiles.length
        : 0,
    );
    status.dataset.layerRecords = String(visibleDocument?.layers.length ?? 0);
    status.dataset.peerConvergence = peerConvergence;
    const transportDiagnostics = transportGate.diagnostics();
    status.dataset.transportOpenedEpisode = String(transportDiagnostics.openedEpisode);
    status.dataset.transportRegistrations = String(transportDiagnostics.registrations);
    status.dataset.transportWaiters = String(transportDiagnostics.waiters);
    status.textContent = JSON.stringify(
      {
        status: state.status,
        generation: state.generation,
        cursor: visibleDocument?.cursor ?? null,
        checkpointCAS: visibleDocument?.casToken ?? null,
        operations: buckets,
        retainedDraftIds: [...retained.keys()],
        activeDraft: draft,
        barrier: barrier
          ? {
              barrierId: barrier.barrierId,
              throughLocalSequence: barrier.throughLocalSequence,
              localEditGeneration: barrier.localEditGeneration,
              operationIds: barrier.operationIds,
            }
          : null,
        barrierResult,
        checkpointResult,
        projectionHistory: projectionInvariant,
        checkpointCorruption: {
          state: checkpointCorruption.pending ? 'armed' : 'idle',
          consumed: checkpointCorruption.consumed,
        },
        failureControl: failureSnapshot
          ? { ...failureSnapshot, error: failureError }
          : { phase: phase(), mode: selectedFailure, error: failureError },
        transportGate: transportDiagnostics,
        resetResult,
        authorityVtt: {
          checkpointInventory: ['fog/fog/1'],
          kinds: ['fog-meta', 'fog-patch'],
          deterministicDriver: 'in-memory test code; not Redis durability',
        },
        peerConvergence,
      },
      null,
      2,
    );
    canonical.textContent = JSON.stringify(
      {
        elements: visibleDocument?.elements ?? [],
        layersAndTombstones: visibleDocument?.layers ?? [],
        extension,
        fog,
        projectedIds: projectionIds(viewport.store.getAll()),
      },
      null,
      2,
    );
  };

  const createManager = (): ManagedAuthorityConnection => {
    managerActive = true;
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const value = createManagedAuthorityConnection({
      scopeId: 'fixture-user/sdk-f-table',
      clientId: 'sdk-f-browser',
      extensions: [syntheticExtension, createFogAuthorityClientExtension()],
      resolveUrl: () => ({
        url: `${scheme}//${location.host}/?room=sdk-f-table${
          checkpointEpisode ? `&fixtureEpisode=${encodeURIComponent(checkpointEpisode)}` : ''
        }`,
      }),
      transportFactory: (endpoint) => {
        transport = new ObservableTransport(endpoint, checkpointCorruption, transportGate);
        return transport;
      },
    });
    const epoch = ++managerEpoch;
    unsubscribeManager = value.subscribe(() => {
      if (epoch !== managerEpoch || manager !== value) return;
      project(value);
      render(value);
    });
    return value;
  };
  manager = createManager();

  const postControl = async (
    payload: JsonObject,
    deadlineAt = Date.now() + 5_000,
  ): Promise<JsonObject> => {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) throw new Error('Control transaction deadline expired');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(5_000, remaining));
    try {
      const response = await fetch('/control', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const value: unknown = await response.json();
      if (!isObject(value)) throw new Error('Malformed control response');
      return value;
    } finally {
      clearTimeout(timeout);
    }
  };

  const failureStatus = async (
    transaction: FailureSnapshot,
    deadlineAt = transaction.deadlineAt,
  ): Promise<JsonObject | null> => {
    try {
      const value = await postControl(
        {
          command: 'failure-status',
          controlId: transaction.controlId,
        },
        deadlineAt,
      );
      return validatedFailureStatus(value, transaction);
    } catch {
      return null;
    }
  };

  const clearFailure = async (
    transaction: FailureSnapshot,
    deadlineAt = transaction.deadlineAt,
  ): Promise<boolean> => {
    replaceFailure({ ...transaction, phase: 'reconciling' });
    render();
    try {
      const value = await postControl(
        {
          command: 'failure-clear',
          controlId: transaction.controlId,
        },
        deadlineAt,
      );
      if (transaction.epoch !== lifecycleEpoch) return false;
      const validated = validatedFailureClear(value, transaction);
      if (
        validated?.ok === true &&
        ['cleared', 'consumed', 'invalidated-reset'].includes(String(validated.code))
      ) {
        failureSnapshot = null;
        failureError = null;
        transportGate.release();
        render();
        return true;
      }
    } catch {
      // Exact status reconciliation below.
    }
    const statusValue = await failureStatus(transaction, deadlineAt);
    if (transaction.epoch !== lifecycleEpoch) return false;
    if (
      statusValue?.ok === true &&
      ['cleared', 'consumed', 'invalidated-reset'].includes(String(statusValue.code))
    ) {
      failureSnapshot = null;
      failureError = null;
      transportGate.release();
      render();
      return true;
    }
    failureError = 'Failure ownership remains ambiguous';
    replaceFailure({ ...transaction, phase: 'reconciling' });
    render();
    return false;
  };

  const armFailure = async (
    transaction: FailureSnapshot,
    generation: string,
  ): Promise<'ready' | 'blocked' | { readonly staleGeneration: string }> => {
    replaceFailure({ ...transaction, phase: 'arming' });
    render();
    const request = {
      command: 'failure-arm',
      controlId: transaction.controlId,
      mode: transaction.mode,
      ...(transaction.mode === 'checkpoint-failure'
        ? { targetEpisodeId: transaction.target }
        : { targetOperationId: transaction.target }),
      expectedGeneration: generation,
    };
    try {
      const value = await postControl(request, transaction.deadlineAt);
      const validated = validatedFailureArm(value, transaction, generation);
      if (validated === 'ready') {
        replaceFailure({ ...transaction, phase: 'ready' });
        render();
        return 'ready';
      }
      if (typeof validated === 'object' && validated) {
        failureError = 'Generation changed before failure control armed';
        replaceFailure({ ...transaction, phase: 'error' });
        render();
        return validated;
      }
      if (validated === 'refused') {
        failureError = `Failure arm refused: ${String(value.code)}`;
        replaceFailure({ ...transaction, phase: 'error' });
        render();
        return 'blocked';
      }
    } catch {
      // Ambiguous acknowledgement is reconciled by exact status.
    }
    replaceFailure({ ...transaction, phase: 'reconciling' });
    render();
    const reconciled = await failureStatus(transaction);
    if (
      reconciled?.ok === true &&
      reconciled.code === 'armed' &&
      reconciled.generation === generation
    ) {
      replaceFailure({ ...transaction, phase: 'ready' });
      render();
      return 'ready';
    }
    failureError = 'Failure arm acknowledgement is ambiguous';
    render();
    return 'blocked';
  };

  const settleFailure = async (transaction: FailureSnapshot): Promise<void> => {
    replaceFailure({ ...transaction, phase: 'settling' });
    render();
    for (
      let attempt = 0;
      attempt < 100 && transaction.epoch === lifecycleEpoch && Date.now() < transaction.deadlineAt;
      attempt++
    ) {
      const value = await failureStatus(transaction);
      if (transaction.epoch !== lifecycleEpoch) return;
      if (value?.ok === true && value.code === 'consumed') {
        failureSnapshot = null;
        failureError = null;
        render();
        return;
      }
      if (value?.ok === true && value.code === 'invalidated-reset') return;
      if (value?.ok === true && value.code === 'armed-restored') {
        transportGate.hold();
        await clearFailure(transaction);
        return;
      }
      if (value?.ok !== true || !['armed', 'reserved'].includes(String(value.code))) break;
      const remaining = transaction.deadlineAt - Date.now();
      if (remaining <= 0) break;
      await sleep(Math.min(50, remaining));
    }
    if (transaction.epoch !== lifecycleEpoch) return;
    transportGate.hold();
    failureError = 'Failure result is unresolved; retry the same control or Reset';
    replaceFailure({ ...transaction, phase: 'reconciling' });
    render();
  };

  const runAction = (
    label: string,
    action: (epoch: number) => Promise<void>,
    options: { readonly allowFenced?: boolean } = {},
  ): Promise<void> => {
    if (actionBusy || resetRequested || (!options.allowFenced && admissionFenced())) {
      event(`${label} refused: another control transaction owns the action gate`);
      return Promise.resolve();
    }
    actionBusy = true;
    const epoch = lifecycleEpoch;
    const running = action(epoch)
      .catch((error: unknown) => {
        failureError = `${label} failed`;
        markConsoleError(`Fixture ${label} error`, error);
        render();
      })
      .finally(() => {
        if (activeAction === running) {
          activeAction = null;
          actionBusy = false;
          if (queuedReset)
            queueMicrotask(() => {
              if (!activeAction && queuedReset) startQueuedReset();
            });
        }
      });
    activeAction = running;
    return running;
  };

  const latestActionable = (): AuthorityClientOperation | undefined =>
    [...manager.getState().operations]
      .reverse()
      .find((operation) => operation.status !== 'accepted') ??
    [...retained.values()].reverse().find((operation) => operation.status !== 'accepted');

  const waitForCurrentManagerLive = async (
    owner: ManagedAuthorityConnection,
    epoch: number,
    deadlineAt: number,
  ): Promise<boolean> => {
    while (
      epoch === lifecycleEpoch &&
      !resetRequested &&
      owner === manager &&
      owner.getState().status !== 'live'
    ) {
      const remaining = deadlineAt - Date.now();
      if (remaining <= 0) return false;
      await sleep(Math.min(50, remaining));
    }
    return (
      epoch === lifecycleEpoch &&
      !resetRequested &&
      owner === manager &&
      owner.getState().status === 'live'
    );
  };

  const recoverUnsentProposal = async (
    transaction: FailureSnapshot,
    reason: string,
  ): Promise<void> => {
    transportGate.hold();
    failureError = reason;
    replaceFailure({ ...transaction, phase: 'reconciling' });
    render();
    const cleanupDeadline = Date.now() + 5_000;
    const cleared = await clearFailure(transaction, cleanupDeadline);
    event(cleared ? `${reason}; exact owner cleared` : `${reason}; exact owner remains ambiguous`);
  };

  const proposalAction = async (kind: 'submit' | 'retry' | 'reapply'): Promise<void> => {
    const selected = selectedFailure;
    if (!selected) {
      if (kind === 'submit') {
        if (!draft) return event('submit refused: no draft');
        const result = manager.submit(structuredClone(draft) as AuthorityMutation);
        event(`submit: ${result.status}${result.status === 'refused' ? `/${result.reason}` : ''}`);
      } else if (kind === 'retry') {
        const operation = latestActionable();
        event(
          operation
            ? `retry: ${manager.retryOperation(operation.clientOperationId).status}`
            : 'retry: no operation',
        );
      } else {
        const operation = latestActionable();
        if (!operation) return event('reapply: no retained operation');
        warning.hidden = false;
        draft = structuredClone(operation.proposal.mutation) as AuthorityMutation;
        event(`reapply as new ID: ${manager.submit(draft).status}`);
      }
      render();
      return;
    }
    const generation = manager.getState().generation;
    if (!validString(generation)) return event(`${kind} refused: no authoritative generation`);
    const epoch = lifecycleEpoch;
    selectedFailure = null;
    const transportToken = transportGate.hold();
    let operationId: string | null;
    if (kind === 'retry') operationId = latestActionable()?.clientOperationId ?? null;
    else {
      const retainedOperation = kind === 'reapply' ? latestActionable() : null;
      const mutation =
        kind === 'submit'
          ? draft
          : retainedOperation
            ? (structuredClone(retainedOperation.proposal.mutation) as AuthorityMutation)
            : null;
      if (!mutation) {
        transportGate.release();
        return event(`${kind} refused: no operation`);
      }
      if (kind === 'reapply') {
        warning.hidden = false;
        draft = mutation;
      }
      const result = manager.submit(structuredClone(mutation) as AuthorityMutation);
      if (result.status !== 'admitted') {
        transportGate.release();
        return event(`${kind} refused: ${result.reason}`);
      }
      operationId = result.clientOperationId;
    }
    if (!operationId) {
      transportGate.release();
      return event(`${kind} refused: no retained operation`);
    }
    const transaction = replaceFailure({
      controlId: makeId('failure'),
      mode: selected,
      target: operationId,
      generation,
      phase: 'quiescing',
      epoch,
      deadlineAt: Date.now() + 5_000,
    });
    render();
    const armed = await armFailure(transaction, generation);
    if (typeof armed === 'object') {
      if (resetRequested) return;
      await resetAction(armed.staleGeneration);
      return;
    }
    if (armed !== 'ready' || epoch !== lifecycleEpoch || resetRequested) return;
    const owner = manager;
    transportGate.release();
    const opened = transportGate.waitForOpenAfter(transportToken, transaction.deadlineAt);
    render();
    const openedTransport = await opened;
    render();
    if (epoch !== lifecycleEpoch || resetRequested || owner !== manager) return;
    if (!openedTransport) {
      await recoverUnsentProposal(transaction, `${kind} recovery timed out before a fresh open`);
      return;
    }
    if (!(await waitForCurrentManagerLive(owner, epoch, transaction.deadlineAt))) {
      if (epoch !== lifecycleEpoch || resetRequested || owner !== manager) return;
      await recoverUnsentProposal(transaction, `${kind} recovery never became live`);
      return;
    }
    const retry = owner.retryOperation(operationId);
    if (retry.status !== 'sent') {
      await recoverUnsentProposal(transaction, `${kind} retry refused: ${retry.reason}`);
      return;
    }
    replaceFailure({ ...transaction, phase: 'handed-off' });
    event(`${kind} handed off: ${operationId}`);
    await settleFailure(transaction);
  };

  const checkpointFailureAction = async (): Promise<void> => {
    const generation = manager.getState().generation;
    if (!validString(generation)) return event('checkpoint failure refused: no generation');
    const epoch = ++lifecycleEpoch;
    const episode = makeId('episode');
    const transaction = replaceFailure({
      controlId: makeId('failure'),
      mode: 'checkpoint-failure',
      target: episode,
      generation,
      phase: 'quiescing',
      epoch,
      deadlineAt: Date.now() + 5_000,
    });
    transportGate.hold();
    if (barrier) {
      manager.releaseBarrier(barrier);
      barrier = null;
    }
    managerEpoch++;
    unsubscribeManager();
    unsubscribeManager = () => undefined;
    manager.stop();
    managerActive = false;
    transport = null;
    render(manager);
    const armed = await armFailure(transaction, generation);
    if (typeof armed === 'object') {
      if (resetRequested) return;
      await resetAction(armed.staleGeneration);
      return;
    }
    if (armed !== 'ready' || epoch !== lifecycleEpoch || resetRequested) return;
    checkpointEpisode = episode;
    manager = createManager();
    transportGate.release();
    replaceFailure({ ...transaction, phase: 'handed-off' });
    await settleFailure(transaction);
    if (epoch !== lifecycleEpoch || failureSnapshot) return;
    checkpointEpisode = null;
    transport?.disconnect();
    event('checkpoint failure consumed; valid untagged recovery started');
  };

  const teardownManager = (): void => {
    transportGate.cancelWaiter();
    if (managerActive) {
      if (barrier) manager.releaseBarrier(barrier);
      managerEpoch++;
      unsubscribeManager();
      unsubscribeManager = () => undefined;
      manager.stop();
    }
    managerActive = false;
    transport = null;
    checkpointEpisode = null;
    draft = null;
    barrier = null;
    retained.clear();
    lastConfirmedDocument = null;
    checkpointResult = 'none';
    barrierResult = 'none';
    projectionInvariant = 'not checked';
    checkpointCorruption.pending = false;
    checkpointCorruption.consumed = 0;
    warning.hidden = true;
    viewport.store.clear({ origin: 'remote' });
    canonical.textContent = '';
    peer.textContent = '';
    peerConvergence = 'not checked';
  };

  const completedReset = (
    value: JsonObject,
    resetId: string,
    expectedGeneration: string,
  ): value is JsonObject => {
    const kind = value.kind === 'reset-status' ? 'reset-status' : 'reset';
    return validatedReset(value, kind, resetId, expectedGeneration)?.code === 'completed';
  };

  const attemptReset = async (
    resetId: string,
    expectedGeneration: string,
  ): Promise<JsonObject | null> => {
    try {
      const value = await postControl({ command: 'reset-begin', resetId, expectedGeneration });
      const validated = validatedReset(value, 'reset', resetId, expectedGeneration);
      if (validated) return validated;
    } catch {
      // Reconcile exact ID.
    }
    try {
      const statusValue = await postControl({
        command: 'reset-status',
        resetId,
        expectedGeneration,
      });
      const validatedStatus = validatedReset(
        statusValue,
        'reset-status',
        resetId,
        expectedGeneration,
      );
      if (!validatedStatus) return null;
      if (completedReset(validatedStatus, resetId, expectedGeneration)) return validatedStatus;
      if (
        validatedStatus.code === 'unknown-reset' &&
        validString(validatedStatus.currentGeneration)
      ) {
        const retry = await postControl({ command: 'reset-begin', resetId, expectedGeneration });
        return validatedReset(retry, 'reset', resetId, expectedGeneration);
      }
      return validatedStatus;
    } catch {
      return null;
    }
  };

  const authoritativeGeneration = async (candidate: unknown): Promise<string | null> => {
    if (!validString(candidate)) return null;
    try {
      const value = await postControl({ command: 'generation-status' });
      return validatedGenerationStatus(value) === candidate ? candidate : null;
    } catch {
      return null;
    }
  };

  const resetAction = async (initialGeneration: string | null): Promise<void> => {
    const epoch = ++lifecycleEpoch;
    resetResult = 'resetting';
    transportGate.hold();
    teardownManager();
    failureSnapshot = null;
    selectedFailure = null;
    failureError = null;
    render(manager);
    let expectedGeneration = initialGeneration;
    if (!expectedGeneration) {
      try {
        const observed = await postControl({ command: 'generation-status' });
        expectedGeneration = validatedGenerationStatus(observed);
      } catch {
        expectedGeneration = null;
      }
    }
    let result: JsonObject | null = null;
    if (expectedGeneration) {
      const resetId = makeId('reset');
      result = await attemptReset(resetId, expectedGeneration);
      if (result && completedReset(result, resetId, expectedGeneration)) {
        checkpointEpisode = null;
        transportGate.release();
        manager = createManager();
        resetResult = 'ok';
        resetRequested = false;
        event('fixture reset completed; fresh lifecycle created');
        render(manager);
        return;
      }
    }
    const recoverable =
      result &&
      ['stale-generation', 'expired', 'partial-failure', 'unknown-reset'].includes(
        String(result.code),
      );
    const observed = recoverable ? await authoritativeGeneration(result.currentGeneration) : null;
    if (observed && epoch === lifecycleEpoch) {
      const recoveryId = makeId('reset-recovery');
      const recovered = await attemptReset(recoveryId, observed);
      if (recovered && completedReset(recovered, recoveryId, observed)) {
        transportGate.release();
        manager = createManager();
        resetResult = 'ok';
        resetRequested = false;
        event('fixture reset recovered with authoritative generation');
        render(manager);
        return;
      }
    }
    resetResult = 'blocked';
    failureError = 'Reset completion is not proven; all work remains fenced';
    resetRequested = false;
    event('reset blocked pending explicit reconciliation');
    render(manager);
  };

  startQueuedReset = (): void => {
    if (activeAction || !queuedReset) return;
    queuedReset = null;
    const generation = manager.getState().generation ?? null;
    actionBusy = true;
    const running = resetAction(generation).finally(() => {
      if (activeAction === running) {
        actionBusy = false;
        activeAction = null;
      }
    });
    activeAction = running;
  };

  node('draft-element').addEventListener('click', () => {
    if (actionBusy || resetRequested || admissionFenced())
      return event('draft refused: action gate is occupied');
    draft = {
      kind: 'upsert',
      element: {
        id: draftId.value || `shape-${Date.now()}`,
        type: 'shape',
        position: { x: 20, y: 20 },
        zIndex: 0,
        locked: false,
        layerId: 'default',
        shape: 'rectangle',
        size: { w: 90, h: 55 },
        strokeColor: '#0f172a',
        strokeWidth: 2,
        fillColor: '#38bdf8',
      },
    };
    event('element draft created');
    render();
  });
  node('draft-extension').addEventListener('click', () => {
    if (actionBusy || resetRequested || admissionFenced())
      return event('draft refused: action gate is occupied');
    draft = { kind: 'extension', extensionKind: 'synthetic:set', payload: extensionValue.value };
    event('extension draft created');
    render();
  });
  node('draft-layer').addEventListener('click', () => {
    if (actionBusy || resetRequested || admissionFenced())
      return event('draft refused: action gate is occupied');
    draft = {
      kind: 'layer-upsert',
      layer: { id: 'tokens', name: 'Tokens', visible: true, locked: false, order: 1, opacity: 1 },
      version: 1,
      editor: 'sdk-f-browser',
    };
    event('layer upsert draft created');
    render();
  });
  node('remove-layer').addEventListener('click', () => {
    if (actionBusy || resetRequested || admissionFenced())
      return event('draft refused: action gate is occupied');
    draft = { kind: 'layer-remove', id: 'tokens', version: 2, editor: 'sdk-f-browser' };
    event('layer tombstone draft created');
    render();
  });
  node('define-fog').addEventListener('click', () => {
    if (actionBusy || resetRequested || admissionFenced())
      return event('draft refused: action gate is occupied');
    draft = {
      kind: 'fog-meta',
      record: {
        version: 2,
        editor: 'sdk-f-browser',
        definition: {
          version: 1,
          generation: 'fog-g1',
          bounds: { x: 0, y: 0, w: 256, h: 256 },
          cellSize: 1,
          tileCells: 128,
          base: 'covered',
        },
      },
    };
    event('fog definition draft created');
    render();
  });
  node('reveal-fog').addEventListener('click', () => {
    if (actionBusy || resetRequested || admissionFenced())
      return event('draft refused: action gate is occupied');
    draft = {
      kind: 'fog-patch',
      generation: 'fog-g1',
      tiles: [{ generation: 'fog-g1', x: 0, y: 0, version: 1, editor: 'sdk-f-browser' }],
    };
    event('fog reveal/hide patch draft created');
    render();
  });
  node('reset-fog-generation').addEventListener('click', () => {
    if (actionBusy || resetRequested || admissionFenced())
      return event('draft refused: action gate is occupied');
    draft = {
      kind: 'fog-meta',
      record: {
        version: 3,
        editor: 'sdk-f-browser',
        definition: {
          version: 1,
          generation: 'fog-g2',
          bounds: { x: 0, y: 0, w: 256, h: 256 },
          cellSize: 1,
          tileCells: 128,
          base: 'covered',
        },
      },
    };
    event('fog generation replacement draft created');
    render();
  });
  node('submit').addEventListener('click', () =>
    runAction('submit', () => proposalAction('submit')),
  );
  node('retry').addEventListener('click', () => runAction('retry', () => proposalAction('retry')));
  node('reapply').addEventListener('click', () =>
    runAction('reapply', () => proposalAction('reapply')),
  );
  node('discard').addEventListener('click', () =>
    runAction('discard', async () => {
      const operation = latestActionable();
      if (!operation) return event('discard: no retained operation');
      const released = manager.releaseOperation(operation.clientOperationId, {
        discardDraft: true,
      });
      if (released) retained.delete(operation.clientOperationId);
      event(`explicit discard: ${released}`);
      render();
    }),
  );
  node('capture-barrier').addEventListener('click', () =>
    runAction('capture barrier', async () => {
      barrier = manager.captureBarrier();
      barrierResult = barrier ? 'captured' : 'capture failed';
      event(barrierResult);
      render();
    }),
  );
  node('release-barrier').addEventListener('click', () =>
    runAction('release barrier', async () => {
      const released = barrier ? manager.releaseBarrier(barrier) : false;
      if (released) barrier = null;
      event(`release barrier: ${released}`);
      render();
    }),
  );
  node('wait-ack').addEventListener('click', () =>
    runAction('wait acknowledgements', async (epoch) => {
      if (!barrier) return event('wait: no barrier');
      const owner = manager;
      const capturedBarrier = barrier;
      const result = await owner.waitForAcknowledgements(capturedBarrier);
      if (epoch !== lifecycleEpoch || owner !== manager) return event('wait continuation stale');
      barrierResult = result.status;
      event(`barrier: ${barrierResult}`);
      render();
    }),
  );
  node('checkpoint').addEventListener('click', () =>
    runAction('checkpoint', async (epoch) => {
      const owner = manager;
      const result = await owner.requestCheckpoint({ ...(barrier ? { barrier } : {}) });
      if (epoch !== lifecycleEpoch || owner !== manager)
        return event('checkpoint continuation stale');
      checkpointResult = result.status === 'complete' ? 'complete' : `failed/${result.reason}`;
      event(`checkpoint: ${checkpointResult}`);
      render();
    }),
  );
  node('refresh-peer').addEventListener('click', () =>
    runAction('refresh second peer', async (epoch) => {
      const response = await fetch('/events');
      const value: unknown = await response.json();
      if (epoch !== lifecycleEpoch || !isObject(value) || !isObject(value.peer))
        return event('second peer response invalid or stale');
      const peerDocument = value.peer.document;
      const canonicalDocument = manager.getState().document;
      const peerComparable = isObject(peerDocument)
        ? {
            elements: peerDocument.elements,
            layers: peerDocument.layers,
            extensions: peerDocument.extensions,
            revision: isObject(peerDocument.cursor) ? peerDocument.cursor.revision : null,
          }
        : null;
      const canonicalComparable = canonicalDocument
        ? {
            elements: canonicalDocument.elements,
            layers: canonicalDocument.layers,
            extensions: canonicalDocument.extensions,
            revision: canonicalDocument.cursor.revision,
          }
        : null;
      peerConvergence =
        JSON.stringify(peerComparable) === JSON.stringify(canonicalComparable)
          ? 'converged'
          : 'pending';
      peer.textContent = JSON.stringify(value.peer, null, 2);
      event(`second peer: ${peerConvergence}`);
      render();
    }),
  );
  node('disconnect').addEventListener('click', () =>
    runAction('disconnect', async () => transport?.disconnect()),
  );
  node('reconnect').addEventListener('click', () =>
    runAction('reconnect', async () => transport?.disconnect()),
  );
  node('corrupt-checkpoint').addEventListener('click', () =>
    runAction('corrupt checkpoint', async () => {
      checkpointCorruption.pending = true;
      render();
      transport?.disconnect();
      event('next recovery checkpoint hash will be corrupted');
    }),
  );

  const selectFailure = (mode: Exclude<FailureMode, 'checkpoint-failure'>): void => {
    if (failureSnapshot && ['reconciling', 'error'].includes(failureSnapshot.phase)) {
      if (failureSnapshot.mode !== mode)
        return event('failure reconciliation refused: another control ID owns the gate');
      const transaction = failureSnapshot;
      const cleanupAttempt = Object.freeze({
        attemptId: makeId('cleanup'),
        controlId: transaction.controlId,
        deadlineAt: Date.now() + 5_000,
      });
      event(`failure cleanup attempt: ${cleanupAttempt.attemptId}`);
      void runAction(
        'failure reconciliation',
        () => clearFailure(transaction, cleanupAttempt.deadlineAt),
        {
          allowFenced: true,
        },
      ).then(() => render());
      return;
    }
    if (actionBusy || resetRequested || failureSnapshot || admissionFenced()) {
      event('failure selection refused: action gate is occupied');
      return;
    }
    selectedFailure = mode;
    failureError = null;
    event(`failure selected: ${mode}`);
    render();
  };
  node('reject-next').addEventListener('click', () => selectFailure('reject'));
  node('lose-response').addEventListener('click', () => selectFailure('lose-response'));
  node('replace-generation').addEventListener('click', () =>
    runAction('replace generation', async (epoch) => {
      const expectedGeneration = manager.getState().generation;
      if (!validString(expectedGeneration))
        return event('generation replacement refused: no generation');
      const replaceId = makeId('replace');
      let value: JsonObject;
      try {
        value = await postControl({
          command: 'generation-replace',
          replaceId,
          expectedGeneration,
        });
      } catch {
        failureError = 'Generation replacement acknowledgement is unresolved; use Reset';
        event('generation replacement failed or timed out');
        render();
        return;
      }
      if (epoch !== lifecycleEpoch) return event('generation replacement continuation stale');
      const validated = validatedGenerationReplace(value, replaceId, expectedGeneration);
      if (!validated || validated.code !== 'completed') {
        failureError = `Generation replacement failed: ${String(validated?.code ?? 'malformed')}`;
        event('generation replacement failed or stale');
        render();
        return;
      }
      transport?.disconnect();
    }),
  );
  node('fail-extension').addEventListener('click', () =>
    runAction('checkpoint failure', checkpointFailureAction),
  );
  node('reset').addEventListener('click', () => {
    if (resetRequested) return event('reset already in progress');
    resetRequested = true;
    transportGate.cancelWaiter();
    queuedReset = { requestedAt: Date.now() };
    if (activeAction) {
      resetResult = 'queued';
      event('reset queued behind active action');
      render();
      return;
    }
    startQueuedReset();
  });
  node('theme').addEventListener('click', () => {
    document.documentElement.dataset.theme =
      document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  });

  window.addEventListener('error', (error) => {
    markConsoleError('Fixture error', error.error ?? error.message);
  });
  window.addEventListener('unhandledrejection', (error) => {
    markConsoleError('Fixture unhandled rejection', error.reason);
  });
  render();
}

if (typeof document !== 'undefined') bootstrap();
