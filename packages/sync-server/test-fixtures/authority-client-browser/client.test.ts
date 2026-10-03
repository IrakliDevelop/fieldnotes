import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Core from '@fieldnotes/core';
import type * as Sync from '@fieldnotes/sync';
import type {
  AuthorityBarrier,
  AuthorityClientOperation,
  AuthorityClientState,
  AuthorityMutation,
  ManagedAuthorityConnection,
  SyncElement,
} from '@fieldnotes/sync';

interface ManagerRecord {
  stops: number;
  subscribers: number;
  activeBarriers: number;
  submissions: number;
  submittedMutations: AuthorityMutation[];
  checkpointHashes: string[];
  statusTransitions: AuthorityClientState['status'][];
  operationIds: string[];
  handedOffOperationIds: string[];
  retries: string[];
  operationStatuses(): AuthorityClientOperation['status'][];
  queueCallbacks(): () => void;
}

const fixture = vi.hoisted(() => ({
  createManager: undefined as
    | ((
        options: Parameters<typeof Sync.createManagedAuthorityConnection>[0],
      ) => ManagedAuthorityConnection)
    | undefined,
  managers: [] as ManagerRecord[],
}));

vi.mock('@fieldnotes/core', async (importOriginal) => {
  const actual = await importOriginal<typeof Core>();
  return { ...actual, Viewport: FakeViewport };
});
vi.mock('@fieldnotes/sync', async (importOriginal) => {
  const actual = await importOriginal<typeof Sync>();
  return {
    ...actual,
    createManagedAuthorityConnection: (
      options: Parameters<typeof Sync.createManagedAuthorityConnection>[0],
    ) => {
      if (!fixture.createManager) throw new Error('manager fixture unavailable');
      return fixture.createManager(options);
    },
  };
});

class FakeNode {
  textContent = '';
  value = '';
  hidden = true;
  dataset: Record<string, string> = {};
  private readonly listeners = new Map<string, ((event?: unknown) => unknown)[]>();
  addEventListener(kind: string, listener: (event?: unknown) => unknown): void {
    this.listeners.set(kind, [...(this.listeners.get(kind) ?? []), listener]);
  }
  async click(): Promise<void> {
    await Promise.all((this.listeners.get('click') ?? []).map((listener) => listener()));
  }
}

class FakeWindow {
  private readonly listeners = new Map<string, ((event: Record<string, unknown>) => void)[]>();
  addEventListener(kind: string, listener: (event: Record<string, unknown>) => void): void {
    this.listeners.set(kind, [...(this.listeners.get(kind) ?? []), listener]);
  }
  emit(kind: string, event: Record<string, unknown>): void {
    for (const listener of this.listeners.get(kind) ?? []) listener(event);
  }
}

class FakeStore {
  private readonly items = new Map<string, SyncElement>();
  clear(): void {
    this.items.clear();
  }
  add(element: SyncElement): void {
    this.items.set(element.id, element);
  }
  getAll(): SyncElement[] {
    return [...this.items.values()];
  }
}

class FakeViewport {
  readonly store = new FakeStore();
  readonly history = { undoCount: 0 };
}

class FakeSocket {
  static readonly CLOSING = 2;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: FakeSocket[] = [];
  static delayNextGateClose = false;
  readyState = FakeSocket.OPEN;
  readonly sent: string[] = [];
  readonly closeCodes: number[] = [];
  readonly url: string;
  private delayedClose: { readonly code: number; readonly reason: string } | null = null;
  private readonly listeners = new Map<string, ((event: Record<string, unknown>) => void)[]>();
  constructor(url: string, _protocols?: string | string[]) {
    this.url = url;
    FakeSocket.instances.push(this);
    queueMicrotask(() => this.emit('open'));
  }
  addEventListener(kind: string, listener: (event: Record<string, unknown>) => void): void {
    this.listeners.set(kind, [...(this.listeners.get(kind) ?? []), listener]);
  }
  emit(kind: string, event: Record<string, unknown> = {}): void {
    for (const listener of this.listeners.get(kind) ?? []) listener(event);
  }
  send(raw: string): void {
    this.sent.push(raw);
  }
  close(code = 1000, reason = ''): void {
    if (code !== 1000 && (code < 3000 || code > 4999))
      throw new DOMException(
        `The close code must be 1000 or in the range 3000-4999; received ${code}`,
        'InvalidAccessError',
      );
    this.closeCodes.push(code);
    if (reason === 'fixture action gate' && FakeSocket.delayNextGateClose) {
      FakeSocket.delayNextGateClose = false;
      this.readyState = FakeSocket.CLOSING;
      this.delayedClose = { code, reason };
      return;
    }
    this.readyState = FakeSocket.CLOSED;
    this.emit('close', { code, reason });
  }
  finishDelayedClose(): void {
    const delayed = this.delayedClose;
    if (!delayed) throw new Error('No delayed close is pending');
    this.delayedClose = null;
    this.readyState = FakeSocket.CLOSED;
    this.emit('close', delayed);
  }
}

type FailureMode = 'reject' | 'lose-response' | 'checkpoint-failure';
interface TestOwner {
  controlId: string;
  mode: FailureMode;
  target: string;
  generation: string;
  phase: 'armed' | 'reserved';
}

class StatefulControlServer {
  generationNumber = 1;
  owner: TestOwner | null = null;
  readonly tombstones = new Map<string, string>();
  readonly resets = new Map<string, Record<string, unknown>>();
  dropNextArm = false;
  dropNextReset = false;
  dropNextClear = false;
  restoreNextStatus = false;
  partialNextReset = false;
  replaceBeforeNextReset = false;
  mismatchNextStatus = false;
  readonly statusPhases: ('armed' | 'reserved')[] = [];
  holdStatus: ReturnType<typeof deferred<Response>> | null = null;

  get generation(): string {
    return `g${this.generationNumber}`;
  }

  private response(value: Record<string, unknown>, ok = value.ok === true): Response {
    return { ok, json: async () => value } as Response;
  }

  private consumeIfTargetArrived(): void {
    const owner = this.owner;
    if (!owner || owner.phase !== 'armed') return;
    if (owner.mode === 'checkpoint-failure') {
      if (!FakeSocket.instances.some((socket) => socket.url.includes(owner.target))) return;
    } else if (
      !fixture.managers.some((manager) => manager.handedOffOperationIds.includes(owner.target)) ||
      !FakeSocket.instances.some((socket) => socket.readyState === FakeSocket.OPEN)
    ) {
      return;
    }
    this.owner = null;
    this.tombstones.set(owner.controlId, 'consumed');
  }

  async fetch(_input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    const command = body.command;
    if (command === 'failure-arm') {
      const controlId = String(body.controlId);
      const mode = body.mode as FailureMode;
      const target = String(
        mode === 'checkpoint-failure' ? body.targetEpisodeId : body.targetOperationId,
      );
      if (body.expectedGeneration !== this.generation)
        return this.response(
          {
            ok: false,
            kind: 'failure-arm',
            code: 'stale-generation',
            controlId,
            expectedGeneration: body.expectedGeneration,
            currentGeneration: this.generation,
          },
          false,
        );
      this.owner = {
        controlId,
        mode,
        target,
        generation: this.generation,
        phase: 'armed',
      };
      if (this.dropNextArm) {
        this.dropNextArm = false;
        throw new Error('arm acknowledgement lost');
      }
      return this.response({
        ok: true,
        kind: 'failure-arm',
        code: 'armed',
        controlId,
        mode,
        target,
        generation: this.generation,
      });
    }
    if (command === 'failure-status') {
      if (this.holdStatus) return this.holdStatus.promise;
      if (this.mismatchNextStatus) {
        this.mismatchNextStatus = false;
        return this.response({
          ok: true,
          kind: 'failure-status',
          code: 'armed',
          controlId: 'mismatched-control',
        });
      }
      const forcedPhase = this.statusPhases.shift();
      if (forcedPhase && this.owner?.controlId === body.controlId)
        return this.response({
          ok: true,
          kind: 'failure-status',
          code: forcedPhase,
          controlId: this.owner.controlId,
          mode: this.owner.mode,
          target: this.owner.target,
          generation: this.owner.generation,
        });
      if (this.restoreNextStatus && this.owner?.controlId === body.controlId) {
        this.restoreNextStatus = false;
        return this.response({
          ok: true,
          kind: 'failure-status',
          code: 'armed-restored',
          controlId: this.owner.controlId,
          mode: this.owner.mode,
          target: this.owner.target,
          generation: this.owner.generation,
        });
      }
      this.consumeIfTargetArrived();
      const controlId = String(body.controlId);
      const terminal = this.tombstones.get(controlId);
      if (terminal)
        return this.response({ ok: true, kind: 'failure-status', code: terminal, controlId });
      if (this.owner?.controlId === controlId)
        return this.response({
          ok: true,
          kind: 'failure-status',
          code: this.owner.phase,
          controlId,
          mode: this.owner.mode,
          target: this.owner.target,
          generation: this.owner.generation,
        });
      return this.response(
        { ok: false, kind: 'failure-status', code: 'unknown-control', controlId },
        false,
      );
    }
    if (command === 'failure-clear') {
      const controlId = String(body.controlId);
      if (this.owner?.controlId === controlId) this.owner = null;
      this.tombstones.set(controlId, 'cleared');
      if (this.dropNextClear) {
        this.dropNextClear = false;
        throw new Error('clear acknowledgement lost');
      }
      return this.response({ ok: true, kind: 'failure-clear', code: 'cleared', controlId });
    }
    if (command === 'generation-status')
      return this.response({
        ok: true,
        kind: 'generation-status',
        code: 'current',
        currentGeneration: this.generation,
      });
    if (command === 'reset-begin') {
      const resetId = String(body.resetId);
      const retained = this.resets.get(resetId);
      if (retained) return this.response(retained);
      if (this.replaceBeforeNextReset) {
        this.replaceBeforeNextReset = false;
        this.generationNumber++;
      }
      if (body.expectedGeneration !== this.generation)
        return this.response(
          {
            ok: false,
            kind: 'reset',
            code: 'stale-generation',
            resetId,
            expectedGeneration: body.expectedGeneration,
            currentGeneration: this.generation,
          },
          false,
        );
      const expectedGeneration = this.generation;
      if (this.owner) this.tombstones.set(this.owner.controlId, 'invalidated-reset');
      this.owner = null;
      this.generationNumber++;
      if (this.partialNextReset) {
        this.partialNextReset = false;
        const partial = {
          ok: false,
          kind: 'reset',
          code: 'partial-failure',
          resetId,
          expectedGeneration,
          currentGeneration: this.generation,
        };
        this.resets.set(resetId, partial);
        return this.response(partial, false);
      }
      const result = {
        ok: true,
        kind: 'reset',
        code: 'completed',
        resetId,
        expectedGeneration,
        resultingGeneration: this.generation,
      };
      this.resets.set(resetId, result);
      if (this.dropNextReset) {
        this.dropNextReset = false;
        throw new Error('reset acknowledgement lost');
      }
      return this.response(result);
    }
    if (command === 'reset-status') {
      const resetId = String(body.resetId);
      const retained = this.resets.get(resetId);
      if (retained) return this.response({ ...retained, kind: 'reset-status' });
      return this.response(
        {
          ok: false,
          kind: 'reset-status',
          code: 'unknown-reset',
          resetId,
          currentGeneration: this.generation,
        },
        false,
      );
    }
    if (command === 'generation-replace') {
      const replaceId = String(body.replaceId);
      const expectedGeneration = String(body.expectedGeneration);
      if (expectedGeneration !== this.generation)
        return this.response(
          {
            ok: false,
            kind: 'generation-replace',
            code: 'stale-generation',
            replaceId,
            expectedGeneration,
            currentGeneration: this.generation,
          },
          false,
        );
      this.owner = null;
      this.generationNumber++;
      return this.response({
        ok: true,
        kind: 'generation-replace',
        code: 'completed',
        replaceId,
        expectedGeneration,
        resultingGeneration: this.generation,
      });
    }
    return this.response({ ok: false, kind: 'control', code: 'unknown-command' }, false);
  }
}

function shape(id: string): SyncElement {
  return {
    id,
    type: 'shape',
    position: { x: 1, y: 2 },
    zIndex: 0,
    locked: false,
    layerId: 'default',
    shape: 'rectangle',
    size: { w: 10, h: 10 },
    strokeColor: '#111827',
    strokeWidth: 1,
    fillColor: '#38bdf8',
  };
}

function operation(
  id: string,
  status: AuthorityClientOperation['status'],
): AuthorityClientOperation {
  return {
    clientOperationId: id,
    generation: 'g',
    localSequence: 1,
    localEditGeneration: 0,
    proposal: {
      protocol: 'authority:1',
      kind: 'propose',
      generation: 'g',
      clientOperationId: id,
      mutation: { kind: 'remove', id: 'shape' },
    },
    originalWire: '{}',
    attempts: 1,
    status,
    wasUncertain: status === 'uncertain',
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

let controlServer: StatefulControlServer;
let heldWait: Promise<
  Awaited<ReturnType<ManagedAuthorityConnection['waitForAcknowledgements']>>
> | null;
let heldCheckpoint: Promise<
  Awaited<ReturnType<ManagedAuthorityConnection['requestCheckpoint']>>
> | null;
let keepRecoveryOnOpen = false;
let retryRefusalReason: 'not-live' | 'transport' | null = null;

function fakeManager(
  options: Parameters<typeof Sync.createManagedAuthorityConnection>[0],
): ManagedAuthorityConnection {
  let sequence = 0;
  let editGeneration = 0;
  const listeners = new Set<() => void>();
  const operations: AuthorityClientOperation[] = [];
  let state: AuthorityClientState = Object.freeze({
    status: 'live',
    scopeId: options.scopeId,
    generation: controlServer.generation,
    document: Object.freeze({
      cursor: Object.freeze({
        generation: controlServer.generation,
        streamId: 'stream',
        revision: 0,
      }),
      casToken: 'a'.repeat(64),
      elements: Object.freeze([shape('confirmed')]),
      layers: Object.freeze([]),
      extensions: Object.freeze({
        synthetic: Object.freeze({
          pluginName: 'sdk-e-browser-fixture',
          version: 1,
          data: 'ready',
        }),
      }),
    }),
    operations: Object.freeze([]),
    localSequence: sequence,
    localEditGeneration: editGeneration,
    error: null,
  });
  let stopped = false;
  let transport: Sync.AuthorityClientTransport | undefined;
  const record: ManagerRecord = {
    stops: 0,
    subscribers: 0,
    activeBarriers: 0,
    submissions: 0,
    submittedMutations: [],
    checkpointHashes: [],
    statusTransitions: ['live'],
    operationIds: [],
    handedOffOperationIds: [],
    retries: [],
    operationStatuses: () => operations.map((operation) => operation.status),
    queueCallbacks() {
      const queued = [...listeners];
      return () => {
        for (const listener of queued) listener();
      };
    },
  };
  fixture.managers.push(record);
  const publish = () => {
    state = Object.freeze({
      ...state,
      operations: Object.freeze([...operations]),
      localSequence: sequence,
      localEditGeneration: editGeneration,
    });
    for (const listener of listeners) listener();
  };
  const transition = (status: AuthorityClientState['status']): void => {
    state = Object.freeze({ ...state, status });
    record.statusTransitions.push(status);
    publish();
  };
  const startTransport = (): void => {
    const resolved = options.resolveUrl();
    if (resolved instanceof Promise) throw new Error('async endpoint not supported by fixture');
    transport = options.transportFactory?.(resolved);
    transport?.start({
      onOpen() {
        if (keepRecoveryOnOpen) return;
        transition('live');
      },
      onMessage(raw) {
        const value = JSON.parse(raw) as { kind?: string; manifest?: { sha256?: string } };
        if (value.kind !== 'checkpoint-begin' || typeof value.manifest?.sha256 !== 'string') return;
        record.checkpointHashes.push(value.manifest.sha256);
        transition(value.manifest.sha256 === '0'.repeat(64) ? 'recovery' : 'live');
      },
      onClose(code) {
        if (stopped) return;
        if (code >= 4000 && code <= 4999 && code !== 4401) {
          transition(code === 4406 ? 'upgrade-required' : 'denied');
          return;
        }
        transition('recovery');
        startTransport();
      },
    });
  };
  startTransport();
  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      record.subscribers++;
      return () => {
        if (listeners.delete(listener)) record.subscribers--;
      };
    },
    stop() {
      stopped = true;
      record.stops++;
      transport?.close();
    },
    submit(mutation: AuthorityMutation) {
      record.submissions++;
      record.submittedMutations.push(structuredClone(mutation));
      const id = `operation-${++sequence}`;
      record.operationIds.push(id);
      const connected = FakeSocket.instances.some(
        (socket) => socket.readyState === FakeSocket.OPEN,
      );
      if (connected) record.handedOffOperationIds.push(id);
      operations.push({
        ...operation(id, connected ? 'pending' : 'draft'),
        localSequence: sequence,
        proposal: { ...operation(id, 'pending').proposal, mutation },
      });
      publish();
      return { status: 'admitted', clientOperationId: id };
    },
    retryOperation(id) {
      record.retries.push(id);
      if (retryRefusalReason)
        return Object.freeze({ status: 'refused' as const, reason: retryRefusalReason });
      if (!record.handedOffOperationIds.includes(id)) record.handedOffOperationIds.push(id);
      const current = operations.find((item) => item.clientOperationId === id);
      if (current) {
        const index = operations.indexOf(current);
        const controlled = controlServer.owner?.target === id ? controlServer.owner.mode : null;
        operations[index] = {
          ...current,
          status:
            controlled === 'lose-response'
              ? 'uncertain'
              : controlled === 'reject'
                ? 'rejected'
                : 'accepted',
        };
        publish();
      }
      return { status: 'sent' };
    },
    releaseOperation(id) {
      const index = operations.findIndex((item) => item.clientOperationId === id);
      if (index < 0) return false;
      operations.splice(index, 1);
      publish();
      return true;
    },
    captureBarrier() {
      editGeneration++;
      record.activeBarriers++;
      publish();
      return Object.freeze({
        barrierId: 'barrier',
        scopeId: options.scopeId,
        generation: 'g',
        throughLocalSequence: sequence,
        localEditGeneration: editGeneration,
        operationIds: Object.freeze(operations.map((item) => item.clientOperationId)),
      });
    },
    releaseBarrier: () => {
      if (record.activeBarriers === 0) return false;
      record.activeBarriers--;
      return true;
    },
    async waitForAcknowledgements(barrier: AuthorityBarrier) {
      if (heldWait) return heldWait;
      return Object.freeze({
        status: 'acknowledged',
        barrier,
        accepted: Object.freeze([]),
        rejectedIds: Object.freeze([]),
        uncertainIds: Object.freeze([]),
        outstandingIds: Object.freeze([]),
      });
    },
    async requestCheckpoint(request) {
      if (heldCheckpoint) return heldCheckpoint;
      const checkpoint = state.document;
      if (!checkpoint) throw new Error('Fake manager checkpoint document unavailable');
      return Object.freeze({
        status: 'complete',
        checkpoint,
        barrier: request?.barrier ?? null,
      });
    },
  };
}

let nodes: Map<string, FakeNode>;
let fakeWindow: FakeWindow;
const node = (id: string): FakeNode => {
  const value = nodes.get(id);
  if (!value) throw new Error(`Missing node ${id}`);
  return value;
};

beforeEach(() => {
  vi.resetModules();
  fixture.createManager = fakeManager;
  fixture.managers = [];
  FakeSocket.instances = [];
  FakeSocket.delayNextGateClose = false;
  controlServer = new StatefulControlServer();
  heldWait = null;
  heldCheckpoint = null;
  keepRecoveryOnOpen = false;
  retryRefusalReason = null;
  fakeWindow = new FakeWindow();
  nodes = new Map(
    [
      'viewport',
      'status',
      'canonical',
      'events',
      'draft-id',
      'extension-value',
      'duplicate-warning',
      'draft-element',
      'draft-extension',
      'submit',
      'retry',
      'reapply',
      'discard',
      'capture-barrier',
      'release-barrier',
      'wait-ack',
      'checkpoint',
      'disconnect',
      'reconnect',
      'corrupt-checkpoint',
      'reject-next',
      'lose-response',
      'replace-generation',
      'fail-extension',
      'reset',
      'theme',
    ].map((id) => [id, new FakeNode()]),
  );
  node('draft-id').value = 'draft-shape';
  node('extension-value').value = 'changed';
  vi.stubGlobal('document', {
    documentElement: { dataset: { theme: 'light' } },
    getElementById: (id: string) => nodes.get(id),
  });
  vi.stubGlobal('window', fakeWindow);
  vi.stubGlobal('location', { protocol: 'http:', host: 'sdk-e.localhost:4179' });
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('fetch', vi.fn(controlServer.fetch.bind(controlServer)));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('managed authority browser fixture', () => {
  it('exposes stable automation buckets and projection IDs', async () => {
    vi.unstubAllGlobals();
    const { operationBuckets, projectionIds } = await import('./client');
    expect(
      operationBuckets([
        operation('draft', 'draft'),
        operation('pending', 'pending'),
        operation('rejected', 'rejected'),
        operation('uncertain', 'uncertain'),
        operation('accepted', 'accepted'),
      ]),
    ).toEqual({
      draft: ['draft'],
      pending: ['pending'],
      rejected: ['rejected'],
      uncertain: ['uncertain'],
      accepted: ['accepted'],
    });
    expect(projectionIds([shape('a'), shape('b')])).toEqual(['a', 'b']);
  });

  it('carries one corrupt-checkpoint request into the next transport episode exactly once', async () => {
    await import('./client');
    const first = FakeSocket.instances[0];
    expect(first).toBeDefined();

    await node('corrupt-checkpoint').click();
    expect(first?.readyState).not.toBe(FakeSocket.OPEN);
    expect(FakeSocket.instances).toHaveLength(2);
    const recovery = FakeSocket.instances[1];
    expect(recovery?.readyState).toBe(FakeSocket.OPEN);
    expect(node('status').dataset.corruptCheckpoint).toBe('armed');

    recovery?.emit('message', {
      data: JSON.stringify({
        kind: 'checkpoint-begin',
        manifest: { sha256: 'f'.repeat(64) },
      }),
    });
    expect(fixture.managers[0]?.checkpointHashes).toEqual(['0'.repeat(64)]);
    expect(node('status').dataset).toMatchObject({
      status: 'recovery',
      corruptCheckpoint: 'idle',
      corruptedCheckpoints: '1',
    });
    expect(node('canonical').textContent).toContain('confirmed');
    expect(node('canonical').textContent).toContain('projectedIds');

    recovery?.emit('message', {
      data: JSON.stringify({
        kind: 'checkpoint-begin',
        manifest: { sha256: 'e'.repeat(64) },
      }),
    });
    expect(fixture.managers[0]?.checkpointHashes).toEqual(['0'.repeat(64), 'e'.repeat(64)]);
    expect(node('status').dataset).toMatchObject({
      status: 'live',
      corruptCheckpoint: 'idle',
      corruptedCheckpoints: '1',
    });
    expect(node('canonical').textContent).toContain('confirmed');
  });

  it('uses browser-valid outbound close codes for gate, manual disconnect, and Reset', async () => {
    await import('./client');

    await node('disconnect').click();
    await node('draft-element').click();
    await node('lose-response').click();
    await node('submit').click();
    await node('reset').click();
    await vi.waitFor(() => expect(node('status').dataset.reset).toBe('ok'));

    const codes = FakeSocket.instances.flatMap((socket) => socket.closeCodes);
    expect(codes.length).toBeGreaterThanOrEqual(3);
    expect(codes.every((code) => code === 1000)).toBe(true);
    expect(fixture.managers[0]?.statusTransitions).not.toContain('denied');
    expect(fixture.managers[0]?.handedOffOperationIds).toContain('operation-1');
    expect(node('status').dataset.console).toBe('clean');
  });

  it.each(['reject-next', 'lose-response'])(
    'binds %s to the operation created while transport is quiesced',
    async (control) => {
      await import('./client');
      await node('draft-element').click();
      await node(control).click();
      expect(fetch).not.toHaveBeenCalled();
      expect(node('status').dataset.failureControl).toBe('selected');

      await node('submit').click();

      expect(fixture.managers[0]?.submissions).toBe(1);
      expect(fixture.managers[0]?.operationIds).toEqual(['operation-1']);
      const arm = vi
        .mocked(fetch)
        .mock.calls.map((call) => JSON.parse(String(call[1]?.body)))
        .find((body) => body.command === 'failure-arm');
      expect(arm).toMatchObject({
        mode: control === 'reject-next' ? 'reject' : 'lose-response',
        targetOperationId: 'operation-1',
        expectedGeneration: 'g1',
      });
      expect(controlServer.owner).toBeNull();
      expect(node('status').dataset.failureControl).toBe('idle');
    },
  );

  it('waits for a distinct opened transport episode when gate close delivery is delayed', async () => {
    const armResponse = deferred<Response>();
    const actualFetch = controlServer.fetch.bind(controlServer);
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { command?: string };
      const response = await actualFetch(input, init);
      return body.command === 'failure-arm' ? armResponse.promise : response;
    });
    await import('./client');
    await node('draft-element').click();
    await node('lose-response').click();
    FakeSocket.delayNextGateClose = true;

    const controlled = node('submit').click();
    await vi.waitFor(() => expect(controlServer.owner?.phase).toBe('armed'));

    const closing = FakeSocket.instances[0];
    expect(closing?.readyState).toBe(FakeSocket.CLOSING);
    const owner = controlServer.owner;
    armResponse.resolve({
      ok: true,
      json: async () => ({
        ok: true,
        kind: 'failure-arm',
        code: 'armed',
        controlId: owner?.controlId,
        mode: owner?.mode,
        target: owner?.target,
        generation: owner?.generation,
      }),
    } as Response);
    await vi.waitFor(() => expect(node('status').dataset.failureControl).not.toBe('arming'));
    expect(fixture.managers[0]?.retries).toEqual([]);
    expect(controlServer.owner?.target).toBe('operation-1');

    closing?.finishDelayedClose();
    await controlled;

    expect(FakeSocket.instances).toHaveLength(2);
    expect(FakeSocket.instances[1]?.readyState).toBe(FakeSocket.OPEN);
    expect(fixture.managers[0]?.retries).toEqual(['operation-1']);
    expect(fixture.managers[0]?.operationStatuses()).toEqual(['uncertain']);
    expect(controlServer.owner).toBeNull();
  });

  it('re-holds and reconciles the same owner on fresh-open timeout with a fresh deadline', async () => {
    vi.useFakeTimers();
    controlServer.dropNextClear = true;
    await import('./client');
    await node('draft-element').click();
    await node('lose-response').click();
    FakeSocket.delayNextGateClose = true;

    const controlled = node('submit').click();
    await vi.waitFor(() => expect(node('status').dataset.transportWaiters).toBe('1'));
    const controlId = controlServer.owner?.controlId;

    await vi.advanceTimersByTimeAsync(5_100);
    await controlled;

    const commands = vi
      .mocked(fetch)
      .mock.calls.map((call) => JSON.parse(String(call[1]?.body)) as Record<string, unknown>);
    expect(commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ command: 'failure-clear', controlId }),
        expect.objectContaining({ command: 'failure-status', controlId }),
      ]),
    );
    expect(fixture.managers[0]?.retries).toEqual([]);
    expect(node('events').textContent).not.toContain('handed off');
    expect(node('status').dataset).toMatchObject({
      failureControl: 'idle',
      transportWaiters: '0',
      transportRegistrations: '0',
    });
    vi.useRealTimers();
  });

  it('clears the exact owner when the distinct replacement opens but its manager never becomes live', async () => {
    vi.useFakeTimers();
    await import('./client');
    keepRecoveryOnOpen = true;
    await node('draft-element').click();
    await node('reject-next').click();

    const controlled = node('submit').click();
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(2));
    const controlId = controlServer.owner?.controlId;
    expect(FakeSocket.instances[1]?.readyState).toBe(FakeSocket.OPEN);
    expect(fixture.managers[0]?.statusTransitions.at(-1)).toBe('recovery');

    await vi.advanceTimersByTimeAsync(5_100);
    await controlled;

    const clears = vi
      .mocked(fetch)
      .mock.calls.map((call) => JSON.parse(String(call[1]?.body)) as Record<string, unknown>)
      .filter((body) => body.command === 'failure-clear');
    expect(clears).toContainEqual(expect.objectContaining({ controlId }));
    expect(fixture.managers[0]?.retries).toEqual([]);
    expect(node('events').textContent).toContain('recovery never became live; exact owner cleared');
    expect(node('status').dataset.transportWaiters).toBe('0');
    vi.useRealTimers();
  });

  it('treats retry refusal as no handoff and clears the same control ID', async () => {
    retryRefusalReason = 'transport';
    await import('./client');
    await node('draft-element').click();
    await node('lose-response').click();
    await node('submit').click();

    const commands = vi
      .mocked(fetch)
      .mock.calls.map((call) => JSON.parse(String(call[1]?.body)) as Record<string, unknown>);
    const arm = commands.find((body) => body.command === 'failure-arm');
    expect(commands).toContainEqual(
      expect.objectContaining({ command: 'failure-clear', controlId: arm?.controlId }),
    );
    expect(fixture.managers[0]?.retries).toEqual(['operation-1']);
    expect(fixture.managers[0]?.handedOffOperationIds).toEqual([]);
    expect(node('events').textContent).not.toContain('handed off');
    expect(node('events').textContent).toContain('retry refused: transport; exact owner cleared');
    expect(node('status').dataset.failureControl).toBe('idle');
  });

  it('cancels the episode waiter immediately on Reset and never resumes against the fresh manager', async () => {
    await import('./client');
    await node('draft-element').click();
    await node('lose-response').click();
    FakeSocket.delayNextGateClose = true;
    const controlled = node('submit').click();
    await vi.waitFor(() => expect(node('status').dataset.transportWaiters).toBe('1'));
    const closing = FakeSocket.instances[0];

    await node('reset').click();
    expect(node('status').dataset.transportWaiters).toBe('0');
    expect(node('status').dataset.reset).toBe('queued');
    await controlled;
    await vi.waitFor(() => expect(node('status').dataset.reset).toBe('ok'));
    closing?.finishDelayedClose();
    await Promise.resolve();

    expect(fixture.managers).toHaveLength(2);
    expect(fixture.managers[0]?.retries).toEqual([]);
    expect(fixture.managers[1]?.retries).toEqual([]);
    expect(fixture.managers[1]).toMatchObject({ stops: 0, subscribers: 1 });
    expect(node('status').dataset).toMatchObject({
      transportWaiters: '0',
      transportRegistrations: '1',
    });
  });

  it('keeps waiter and transport registration storage bounded across repeated controlled cycles', async () => {
    await import('./client');
    await node('draft-element').click();
    for (let cycle = 0; cycle < 3; cycle++) {
      await node('reject-next').click();
      await node('submit').click();
      expect(node('status').dataset).toMatchObject({
        failureControl: 'idle',
        transportWaiters: '0',
        transportRegistrations: '1',
      });
    }
    expect(fixture.managers[0]?.retries).toEqual(['operation-1', 'operation-2', 'operation-3']);
    expect(
      FakeSocket.instances.flatMap((socket) => socket.closeCodes).every((code) => code === 1000),
    ).toBe(true);
  });

  it.each([
    ['retry', 'operation-1'],
    ['reapply', 'operation-2'],
  ] as const)('binds the %s path to its exact intended operation ID', async (action, target) => {
    await import('./client');
    await node('draft-element').click();
    await node('submit').click();
    await node('reject-next').click();
    await node(action).click();

    const arms = vi
      .mocked(fetch)
      .mock.calls.map((call) => JSON.parse(String(call[1]?.body)))
      .filter((body) => body.command === 'failure-arm');
    expect(arms).toHaveLength(1);
    expect(arms[0]).toMatchObject({
      mode: 'reject',
      targetOperationId: target,
      expectedGeneration: 'g1',
    });
    expect(node('status').dataset.failureControl).toBe('idle');
  });

  it.each([
    ['submit', 'operation-1'],
    ['reapply', 'operation-2'],
  ] as const)(
    'does not let %s consume server ownership before explicit retained-wire handoff',
    async (action, target) => {
      await import('./client');
      await node('draft-element').click();
      if (action === 'reapply') await node('submit').click();
      await node('lose-response').click();
      const controlled = node(action).click();
      await vi.waitFor(() =>
        expect(
          vi
            .mocked(fetch)
            .mock.calls.map((call) => JSON.parse(String(call[1]?.body)))
            .some((body) => body.command === 'failure-status'),
        ).toBe(true),
      );
      const retriesBeforeReset = [...(fixture.managers[0]?.retries ?? [])];
      const ownerBeforeReset = controlServer.owner;
      await node('reset').click();
      await vi.waitFor(() => expect(node('status').dataset.reset).toBe('ok'));
      await controlled;

      expect(retriesBeforeReset).toContain(target);
      expect(ownerBeforeReset).toBeNull();
    },
  );

  it('retries an uncertain operation with the exact ID without rearming response loss', async () => {
    await import('./client');
    await node('draft-element').click();
    await node('lose-response').click();
    await node('submit').click();
    expect(fixture.managers[0]?.operationStatuses()).toEqual(['uncertain']);
    expect(fixture.managers[0]?.submissions).toBe(1);

    await node('retry').click();

    expect(fixture.managers[0]?.operationIds).toEqual(['operation-1']);
    expect(fixture.managers[0]?.operationStatuses()).toEqual(['accepted']);
    expect(fixture.managers[0]?.submissions).toBe(1);
    const arms = vi
      .mocked(fetch)
      .mock.calls.map((call) => JSON.parse(String(call[1]?.body)))
      .filter((body) => body.command === 'failure-arm');
    expect(arms).toHaveLength(1);
  });

  it('keeps an exact retry uncertain when response loss is deliberately rearmed', async () => {
    await import('./client');
    await node('draft-element').click();
    await node('lose-response').click();
    await node('submit').click();
    expect(fixture.managers[0]?.operationStatuses()).toEqual(['uncertain']);

    await node('lose-response').click();
    await node('retry').click();

    expect(fixture.managers[0]?.operationIds).toEqual(['operation-1']);
    expect(fixture.managers[0]?.operationStatuses()).toEqual(['uncertain']);
    const arms = vi
      .mocked(fetch)
      .mock.calls.map((call) => JSON.parse(String(call[1]?.body)))
      .filter((body) => body.command === 'failure-arm');
    expect(arms).toHaveLength(2);
  });

  it('rejects contradictory terminal status and clear shapes without reopening admission', async () => {
    controlServer.restoreNextStatus = true;
    const actualFetch = controlServer.fetch.bind(controlServer);
    let statusCount = 0;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { command?: string };
      const response = await actualFetch(input, init);
      const value = (await response.json()) as Record<string, unknown>;
      if (body.command === 'failure-status') statusCount++;
      if (body.command === 'failure-clear' || statusCount > 1)
        return { ok: true, json: async () => ({ ...value, extra: 'forbidden' }) } as Response;
      return { ok: true, json: async () => value } as Response;
    });
    await import('./client');
    await node('draft-element').click();
    await node('lose-response').click();
    await node('submit').click();

    expect(node('status').dataset.failureControl).toBe('reconciling');
    expect(fixture.managers[0]?.retries).toEqual(['operation-1']);
    const submissions = fixture.managers[0]?.submissions;
    await node('submit').click();
    expect(fixture.managers[0]?.submissions).toBe(submissions);
  });

  it('keeps all proposal paths fenced while an arm acknowledgement is held', async () => {
    const held = deferred<Response>();
    const actualFetch = controlServer.fetch.bind(controlServer);
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { command?: string };
      if (body.command === 'failure-arm') {
        await actualFetch(input, init);
        return held.promise;
      }
      return actualFetch(input, init);
    });
    await import('./client');
    await node('draft-element').click();
    await node('lose-response').click();
    const submission = node('submit').click();
    await vi.waitFor(() => expect(node('status').dataset.failureControl).toBe('arming'));

    await Promise.all([node('submit').click(), node('retry').click(), node('reapply').click()]);
    await Promise.all([node('draft-element').click(), node('draft-extension').click()]);
    expect(fixture.managers[0]?.submissions).toBe(1);
    expect(node('events').textContent).toContain('action gate');

    const owner = controlServer.owner;
    expect(owner).not.toBeNull();
    held.resolve({
      ok: true,
      json: async () => ({
        ok: true,
        kind: 'failure-arm',
        code: 'armed',
        controlId: owner?.controlId,
        mode: owner?.mode,
        target: owner?.target,
        generation: owner?.generation,
      }),
    } as Response);
    await submission;
    expect(node('status').dataset.failureControl).toBe('idle');
  });

  it('reconciles a lost arm acknowledgement before reconnecting and consuming the exact target', async () => {
    controlServer.dropNextArm = true;
    await import('./client');
    await node('draft-element').click();
    await node('lose-response').click();
    await node('submit').click();

    expect(controlServer.owner).toBeNull();
    expect([...controlServer.tombstones.values()]).toContain('consumed');
    expect(node('status').dataset.failureControl).toBe('idle');
    expect(
      FakeSocket.instances.filter((socket) => socket.readyState === FakeSocket.OPEN),
    ).toHaveLength(1);
  });

  it('polls through exact armed and reserved settlement states before terminal consumption', async () => {
    controlServer.statusPhases.push('armed', 'reserved');
    await import('./client');
    await node('draft-element').click();
    await node('lose-response').click();
    await node('submit').click();

    expect(controlServer.owner).toBeNull();
    expect(node('status').dataset.failureControl).toBe('idle');
    expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it('keeps a mismatched status response blocked until exact same-control cleanup', async () => {
    controlServer.dropNextArm = true;
    controlServer.mismatchNextStatus = true;
    await import('./client');
    await node('draft-element').click();
    await node('lose-response').click();
    await node('submit').click();
    expect(node('status').dataset.failureControl).toBe('reconciling');
    expect(controlServer.owner).not.toBeNull();

    const before = {
      fetches: vi.mocked(fetch).mock.calls.length,
      managers: fixture.managers.length,
      submissions: fixture.managers[0]?.submissions,
      barriers: fixture.managers[0]?.activeBarriers,
      sockets: FakeSocket.instances.length,
      status: node('status').textContent,
    };
    for (const id of [
      'draft-element',
      'draft-extension',
      'submit',
      'retry',
      'reapply',
      'discard',
      'capture-barrier',
      'release-barrier',
      'wait-ack',
      'checkpoint',
      'disconnect',
      'reconnect',
      'corrupt-checkpoint',
      'replace-generation',
      'fail-extension',
    ])
      await node(id).click();
    expect({
      fetches: vi.mocked(fetch).mock.calls.length,
      managers: fixture.managers.length,
      submissions: fixture.managers[0]?.submissions,
      barriers: fixture.managers[0]?.activeBarriers,
      sockets: FakeSocket.instances.length,
      status: node('status').textContent,
    }).toEqual(before);

    await node('reject-next').click();
    expect(node('events').textContent).toContain('another control ID');
    await node('lose-response').click();
    await vi.waitFor(() => expect(node('status').dataset.failureControl).toBe('idle'));
    expect(controlServer.owner).toBeNull();
  });

  it.each([
    [
      'missing-ok',
      (value: Record<string, unknown>) => {
        const rest = { ...value };
        delete rest.ok;
        return rest;
      },
    ],
    ['wrong-polarity', (value: Record<string, unknown>) => ({ ...value, ok: false })],
    ['wrong-kind', (value: Record<string, unknown>) => ({ ...value, kind: 'failure-clear' })],
    ['extra-field', (value: Record<string, unknown>) => ({ ...value, extra: true })],
  ] as const)(
    'rejects %s arm/status response shapes before reconnect or handoff',
    async (_label, mutate) => {
      const actualFetch = controlServer.fetch.bind(controlServer);
      vi.mocked(fetch).mockImplementation(async (input, init) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as { command?: string };
        const response = await actualFetch(input, init);
        if (body.command !== 'failure-arm' && body.command !== 'failure-status') return response;
        const value = (await response.json()) as Record<string, unknown>;
        return { ok: true, json: async () => mutate(value) } as Response;
      });
      await import('./client');
      await node('draft-element').click();
      await node('lose-response').click();
      await node('submit').click();

      expect(node('status').dataset.failureControl).toBe('reconciling');
      expect(fixture.managers[0]?.retries).toEqual([]);
      expect(fixture.managers[0]?.handedOffOperationIds).toEqual([]);
      expect(controlServer.owner).not.toBeNull();
      expect(
        FakeSocket.instances.filter((socket) => socket.readyState === FakeSocket.OPEN),
      ).toHaveLength(0);
    },
  );

  it('clears an armed-restored owner and reconciles a lost clear acknowledgement by exact status', async () => {
    controlServer.restoreNextStatus = true;
    controlServer.dropNextClear = true;
    await import('./client');
    await node('draft-element').click();
    await node('lose-response').click();
    await node('submit').click();

    expect(controlServer.owner).toBeNull();
    expect([...controlServer.tombstones.values()]).toContain('cleared');
    expect(node('status').dataset.failureControl).toBe('idle');
    expect(node('status').dataset.console).toBe('clean');
  });

  it('turns a stale arm into one generation-observed Reset before creating a fresh manager', async () => {
    await import('./client');
    const first = fixture.managers[0];
    controlServer.generationNumber++;
    await node('draft-element').click();
    await node('reject-next').click();
    await node('submit').click();

    expect(first).toMatchObject({ stops: 1, subscribers: 0 });
    expect(fixture.managers).toHaveLength(2);
    expect(node('status').dataset.reset).toBe('ok');
    expect(controlServer.generation).toBe('g3');
    expect(controlServer.owner).toBeNull();
  });

  it('recovers a partial Reset through authoritative generation status and a new ID', async () => {
    controlServer.partialNextReset = true;
    await import('./client');
    await node('reset').click();
    await vi.waitFor(() => expect(node('status').dataset.reset).toBe('ok'));

    expect(controlServer.generation).toBe('g3');
    expect(controlServer.resets.size).toBe(2);
    expect(fixture.managers).toHaveLength(2);
    const commands = vi.mocked(fetch).mock.calls.map((call) => JSON.parse(String(call[1]?.body)));
    expect(commands.map((value) => value.command)).toContain('generation-status');
  });

  it.each(['reset-busy', 'reset-mismatch'] as const)(
    'keeps %s persistently fenced without automatically beginning a new Reset ID',
    async (code) => {
      const actualFetch = controlServer.fetch.bind(controlServer);
      let resetBegins = 0;
      vi.mocked(fetch).mockImplementation(async (input, init) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        if (body.command === 'reset-begin' && resetBegins++ === 0) {
          if (code === 'reset-mismatch') throw new Error('ambiguous reset acknowledgement');
          return {
            ok: false,
            json: async () => ({
              ok: false,
              kind: 'reset',
              code,
              resetId: body.resetId,
              currentGeneration: controlServer.generation,
            }),
          } as Response;
        }
        if (code === 'reset-mismatch' && body.command === 'reset-status')
          return {
            ok: false,
            json: async () => ({
              ok: false,
              kind: 'reset-status',
              code,
              resetId: body.resetId,
              currentGeneration: controlServer.generation,
            }),
          } as Response;
        return actualFetch(input, init);
      });

      await import('./client');
      await node('reset').click();
      await vi.waitFor(() => expect(node('status').dataset.reset).toBe('blocked'));

      expect(resetBegins).toBe(1);
      expect(controlServer.generation).toBe('g1');
      expect(controlServer.resets.size).toBe(0);
      expect(fixture.managers).toHaveLength(1);
      expect(fixture.managers[0]).toMatchObject({ stops: 1, subscribers: 0 });

      await node('reset').click();
      await vi.waitFor(() => expect(node('status').dataset.reset).toBe('ok'));
      expect(resetBegins).toBe(2);
      expect(controlServer.generation).toBe('g2');
      expect(fixture.managers).toHaveLength(2);
    },
  );

  it('bounds delayed valid failure-status polling by one absolute transaction deadline', async () => {
    vi.useFakeTimers();
    const actualFetch = controlServer.fetch.bind(controlServer);
    let statusRequests = 0;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      if (body.command !== 'failure-status') return actualFetch(input, init);
      statusRequests++;
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(resolve, 1_000);
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(timeout);
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
      const owner = controlServer.owner;
      return {
        ok: true,
        json: async () => ({
          ok: true,
          kind: 'failure-status',
          code: 'armed',
          controlId: body.controlId,
          mode: owner?.mode,
          target: owner?.target,
          generation: owner?.generation,
        }),
      } as Response;
    });

    await import('./client');
    await node('draft-element').click();
    await node('lose-response').click();
    let settled = false;
    void node('submit')
      .click()
      .then(() => {
        settled = true;
      });
    await vi.advanceTimersByTimeAsync(5_100);

    expect(settled).toBe(true);
    expect(statusRequests).toBeLessThanOrEqual(5);
    expect(node('status').dataset.failureControl).toBe('reconciling');
    vi.useRealTimers();
  });

  it('gives an explicit same-ID cleanup a fresh deadline after the original transaction expires', async () => {
    vi.useFakeTimers();
    controlServer.dropNextArm = true;
    controlServer.mismatchNextStatus = true;
    await import('./client');
    await node('draft-element').click();
    await node('lose-response').click();
    await node('submit').click();
    expect(node('status').dataset.failureControl).toBe('reconciling');

    await vi.advanceTimersByTimeAsync(5_100);
    const before = vi.mocked(fetch).mock.calls.length;
    await node('lose-response').click();

    expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(before);
    expect(node('status').dataset.failureControl).toBe('idle');
    expect(controlServer.owner).toBeNull();
    vi.useRealTimers();
  });

  it('queues Reset behind an explicit same-ID cleanup attempt', async () => {
    controlServer.dropNextArm = true;
    controlServer.mismatchNextStatus = true;
    await import('./client');
    await node('draft-element').click();
    await node('lose-response').click();
    await node('submit').click();
    expect(node('status').dataset.failureControl).toBe('reconciling');

    const held = deferred<Response>();
    const actualFetch = controlServer.fetch.bind(controlServer);
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { command?: string };
      const response = await actualFetch(input, init);
      return body.command === 'failure-clear' ? held.promise : response;
    });
    const cleanup = node('lose-response').click();
    await vi.waitFor(() =>
      expect(
        vi
          .mocked(fetch)
          .mock.calls.map((call) => JSON.parse(String(call[1]?.body)))
          .some((body) => body.command === 'failure-clear'),
      ).toBe(true),
    );
    await node('reset').click();
    expect(node('status').dataset.reset).toBe('queued');
    held.resolve({
      ok: true,
      json: async () => ({
        ok: true,
        kind: 'failure-clear',
        code: 'cleared',
        controlId: [...controlServer.tombstones.keys()].at(-1),
      }),
    } as Response);

    await cleanup;
    await vi.waitFor(() => expect(node('status').dataset.reset).toBe('ok'));
    expect(fixture.managers).toHaveLength(2);
  });

  it('does not begin queued Reset before a delayed wait continuation finishes', async () => {
    const gate =
      deferred<Awaited<ReturnType<ManagedAuthorityConnection['waitForAcknowledgements']>>>();
    heldWait = gate.promise;
    await import('./client');
    await node('capture-barrier').click();
    const action = node('wait-ack').click();
    await Promise.resolve();
    await node('reset').click();

    expect(node('status').dataset.reset).toBe('queued');
    expect(fixture.managers[0]?.stops).toBe(0);
    gate.resolve(
      Object.freeze({
        status: 'acknowledged',
        barrier: Object.freeze({
          barrierId: 'barrier',
          scopeId: 'fixture-user/sdk-e-table',
          generation: 'g',
          throughLocalSequence: 0,
          localEditGeneration: 1,
          operationIds: Object.freeze([]),
        }),
        accepted: Object.freeze([]),
        rejectedIds: Object.freeze([]),
        uncertainIds: Object.freeze([]),
        outstandingIds: Object.freeze([]),
      }),
    );
    await action;
    await vi.waitFor(() => expect(node('status').dataset.reset).toBe('ok'));
    expect(node('events').textContent).toContain('barrier: acknowledged');
    expect(fixture.managers).toHaveLength(2);
  });

  it('does not begin queued Reset before a delayed checkpoint continuation finishes', async () => {
    const gate = deferred<Awaited<ReturnType<ManagedAuthorityConnection['requestCheckpoint']>>>();
    heldCheckpoint = gate.promise;
    await import('./client');
    const action = node('checkpoint').click();
    await Promise.resolve();
    await node('reset').click();

    expect(node('status').dataset.reset).toBe('queued');
    expect(fixture.managers[0]?.stops).toBe(0);
    const document = fixture.managers.length > 0 ? shape('checkpoint') : shape('missing');
    gate.resolve(
      Object.freeze({
        status: 'complete',
        checkpoint: Object.freeze({
          cursor: Object.freeze({ generation: 'g1', streamId: 'stream', revision: 0 }),
          casToken: 'a'.repeat(64),
          elements: Object.freeze([document]),
          layers: Object.freeze([]),
          extensions: Object.freeze({}),
        }),
        barrier: null,
      }),
    );
    await action;
    await vi.waitFor(() => expect(node('status').dataset.reset).toBe('ok'));
    expect(node('events').textContent).toContain('checkpoint: complete');
    expect(fixture.managers).toHaveLength(2);
  });

  it('serializes a delayed generation replacement before Reset and never disconnects the fresh manager', async () => {
    const response = deferred<Response>();
    const actualFetch = controlServer.fetch.bind(controlServer);
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { command?: string };
      const result = await actualFetch(input, init);
      return body.command === 'generation-replace' ? response.promise : result;
    });
    await import('./client');
    const replacement = node('replace-generation').click();
    await vi.waitFor(() => expect(controlServer.generation).toBe('g2'));
    await node('reset').click();
    expect(node('status').dataset.reset).toBe('queued');

    response.resolve({
      ok: true,
      json: async () => ({
        ok: true,
        kind: 'generation-replace',
        code: 'completed',
        replaceId: JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body)).replaceId,
        expectedGeneration: 'g1',
        resultingGeneration: 'g2',
      }),
    } as Response);
    await replacement;
    await vi.waitFor(() => expect(node('status').dataset.reset).toBe('ok'));

    expect(fixture.managers).toHaveLength(2);
    expect(fixture.managers[1]).toMatchObject({ stops: 0, subscribers: 1 });
    expect(
      FakeSocket.instances.filter((socket) => socket.readyState === FakeSocket.OPEN),
    ).toHaveLength(1);
  });

  it('reconciles the exact queued Reset after replacement and Reset fetch deadlines expire', async () => {
    vi.useFakeTimers();
    const seed = deferred<undefined>();
    const actualFetch = controlServer.fetch.bind(controlServer);
    let queuedResetId: string | null = null;
    let queuedResetResult: Promise<Record<string, unknown>> | null = null;
    const abandonOnAbort = (signal: AbortSignal | null | undefined): Promise<Response> =>
      new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
          once: true,
        });
      });
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      if (body.command === 'generation-replace') {
        controlServer.generationNumber = 2;
        void seed.promise;
        return abandonOnAbort(init?.signal);
      }
      if (body.command === 'reset-begin' && queuedResetId === null) {
        queuedResetId = String(body.resetId);
        queuedResetResult = seed.promise.then(() => ({
          ok: false,
          kind: 'reset',
          code: 'stale-generation',
          resetId: queuedResetId,
          expectedGeneration: 'g1',
          currentGeneration: 'g2',
        }));
        return abandonOnAbort(init?.signal);
      }
      if (body.command === 'reset-status' && body.resetId === queuedResetId) {
        const result = await queuedResetResult;
        return {
          ok: false,
          json: async () => ({ ...result, kind: 'reset-status' }),
        } as Response;
      }
      return actualFetch(input, init);
    });

    await import('./client');
    void node('replace-generation').click();
    await Promise.resolve();
    await node('reset').click();
    expect(node('status').dataset.reset).toBe('queued');

    await vi.advanceTimersByTimeAsync(5_100);
    await vi.waitFor(() => expect(queuedResetId).not.toBeNull());
    await vi.advanceTimersByTimeAsync(5_100);
    seed.resolve(undefined);
    await vi.runAllTimersAsync();
    await vi.waitFor(() => expect(node('status').dataset.reset).toBe('ok'));

    const commands = vi
      .mocked(fetch)
      .mock.calls.map((call) => JSON.parse(String(call[1]?.body)) as Record<string, unknown>);
    expect(
      commands.filter(
        (command) => command.command === 'reset-begin' && command.resetId === queuedResetId,
      ),
    ).toHaveLength(1);
    expect(
      commands.filter(
        (command) => command.command === 'reset-status' && command.resetId === queuedResetId,
      ),
    ).toHaveLength(1);
    expect(controlServer.generation).toBe('g3');
    expect(fixture.managers).toHaveLength(2);
    expect(
      FakeSocket.instances.filter((socket) => socket.readyState === FakeSocket.OPEN),
    ).toHaveLength(1);
    vi.useRealTimers();
  });

  it.each(['reset-begin', 'reset-status', 'generation-status'] as const)(
    'rejects extra fields in %s responses before creating a live manager',
    async (malformedCommand) => {
      const actualFetch = controlServer.fetch.bind(controlServer);
      if (malformedCommand === 'reset-status') controlServer.dropNextReset = true;
      if (malformedCommand === 'generation-status') controlServer.partialNextReset = true;
      vi.mocked(fetch).mockImplementation(async (input, init) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as { command?: string };
        const response = await actualFetch(input, init);
        const value = (await response.json()) as Record<string, unknown>;
        if (
          body.command === malformedCommand ||
          (malformedCommand === 'reset-begin' && body.command === 'reset-status')
        )
          return { ok: true, json: async () => ({ ...value, extra: true }) } as Response;
        return { ok: true, json: async () => value } as Response;
      });
      await import('./client');
      await node('reset').click();
      await vi.waitFor(() => expect(node('status').dataset.reset).toBe('blocked'));

      expect(fixture.managers).toHaveLength(1);
      expect(fixture.managers[0]).toMatchObject({ stops: 1, subscribers: 0 });
      expect(
        FakeSocket.instances.filter((socket) => socket.readyState === FakeSocket.OPEN),
      ).toHaveLength(0);
    },
  );

  it('stays blocked when generation changes between authoritative observation and recovery begin', async () => {
    controlServer.partialNextReset = true;
    const actualFetch = controlServer.fetch.bind(controlServer);
    let observed = false;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { command?: string };
      if (body.command === 'generation-status') observed = true;
      if (observed && body.command === 'reset-begin' && controlServer.resets.size === 1)
        controlServer.replaceBeforeNextReset = true;
      return actualFetch(input, init);
    });
    await import('./client');
    await node('reset').click();
    await vi.waitFor(() => expect(node('status').dataset.reset).toBe('blocked'));

    expect(fixture.managers).toHaveLength(1);
    expect(fixture.managers[0]).toMatchObject({ stops: 1, subscribers: 0 });
    expect(
      FakeSocket.instances.filter((socket) => socket.readyState === FakeSocket.OPEN),
    ).toHaveLength(0);
  });

  it('quiesces the old manager before checkpoint arm and fences every reconnect path while status is held', async () => {
    const status = deferred<Response>();
    controlServer.holdStatus = status;
    await import('./client');
    const first = fixture.managers[0];
    const checkpoint = node('fail-extension').click();
    await vi.waitFor(() => expect(node('status').dataset.failureControl).toBe('settling'));
    expect(first).toMatchObject({ stops: 1, subscribers: 0 });
    expect(FakeSocket.instances.at(-1)?.url).toContain('fixtureEpisode=');

    await Promise.all([
      node('checkpoint').click(),
      node('disconnect').click(),
      node('reconnect').click(),
      node('corrupt-checkpoint').click(),
    ]);
    expect(node('events').textContent).toContain('action gate');
    const owner = controlServer.owner;
    expect(owner?.mode).toBe('checkpoint-failure');
    controlServer.holdStatus = null;
    controlServer.owner = null;
    if (owner) controlServer.tombstones.set(owner.controlId, 'consumed');
    status.resolve({
      ok: true,
      json: async () => ({
        ok: true,
        kind: 'failure-status',
        code: 'consumed',
        controlId: owner?.controlId,
      }),
    } as Response);
    await checkpoint;
    expect(node('status').dataset.failureControl).toBe('idle');
    expect(FakeSocket.instances.at(-1)?.url).not.toContain('fixtureEpisode=');
  });

  it('retains the last confirmed presentation through checkpoint recovery and clears it on Reset', async () => {
    const armResponse = deferred<Response>();
    const statusResponse = deferred<Response>();
    controlServer.holdStatus = statusResponse;
    const actualFetch = controlServer.fetch.bind(controlServer);
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { command?: string };
      const response = await actualFetch(input, init);
      return body.command === 'failure-arm' ? armResponse.promise : response;
    });
    await import('./client');
    await node('draft-element').click();
    await node('submit').click();
    expect(node('status').dataset).toMatchObject({ status: 'live', pending: '1' });
    expect(JSON.parse(node('canonical').textContent)).toMatchObject({
      elements: [expect.objectContaining({ id: 'confirmed' })],
      projectedIds: ['confirmed'],
    });

    const checkpoint = node('fail-extension').click();
    await vi.waitFor(() => expect(node('status').dataset.failureControl).toBe('arming'));
    expect(node('status').dataset).toMatchObject({ pending: '0', accepted: '0' });
    expect(JSON.parse(node('canonical').textContent)).toMatchObject({
      elements: [expect.objectContaining({ id: 'confirmed' })],
      projectedIds: ['confirmed'],
    });

    const owner = controlServer.owner;
    armResponse.resolve({
      ok: true,
      json: async () => ({
        ok: true,
        kind: 'failure-arm',
        code: 'armed',
        controlId: owner?.controlId,
        mode: owner?.mode,
        target: owner?.target,
        generation: owner?.generation,
      }),
    } as Response);
    await vi.waitFor(() => expect(node('status').dataset.failureControl).toBe('settling'));
    controlServer.holdStatus = null;
    controlServer.owner = null;
    if (owner) controlServer.tombstones.set(owner.controlId, 'consumed');
    statusResponse.resolve({
      ok: true,
      json: async () => ({
        ok: true,
        kind: 'failure-status',
        code: 'consumed',
        controlId: owner?.controlId,
      }),
    } as Response);
    await checkpoint;
    expect(node('status').dataset).toMatchObject({ status: 'live', failureControl: 'idle' });
    expect(JSON.parse(node('canonical').textContent)).toMatchObject({
      elements: [expect.objectContaining({ id: 'confirmed' })],
      projectedIds: ['confirmed'],
    });

    vi.mocked(fetch).mockRejectedValue(new Error('control unavailable'));
    await node('reset').click();
    await vi.waitFor(() => expect(node('status').dataset.reset).toBe('blocked'));
    expect(JSON.parse(node('canonical').textContent)).toMatchObject({
      elements: [],
      projectedIds: [],
    });
  });

  it.each([
    ['reject-next', 'submit'],
    ['lose-response', 'submit'],
    ['fail-extension', 'checkpoint'],
  ] as const)(
    'queues Reset until the active %s settlement continuation is complete',
    async (control, kind) => {
      const held = deferred<Response>();
      controlServer.holdStatus = held;
      await import('./client');
      if (kind === 'submit') {
        await node('draft-element').click();
        await node(control).click();
      }
      const oldAction = node(kind === 'submit' ? 'submit' : control).click();
      await vi.waitFor(() => expect(node('status').dataset.failureControl).toBe('settling'));
      const owner = controlServer.owner;
      expect(owner).not.toBeNull();

      await node('reset').click();
      expect(node('status').dataset.reset).toBe('queued');

      controlServer.holdStatus = null;
      controlServer.owner = null;
      if (owner) controlServer.tombstones.set(owner.controlId, 'consumed');
      held.resolve({
        ok: true,
        json: async () => ({
          ok: true,
          kind: 'failure-status',
          code: 'consumed',
          controlId: owner?.controlId,
        }),
      } as Response);
      await oldAction;
      await vi.waitFor(() => expect(node('status').dataset.reset).toBe('ok'));
      expect(controlServer.owner).toBeNull();
      expect(controlServer.tombstones.get(String(owner?.controlId))).toBe('consumed');
      expect(node('status').dataset.reset).toBe('ok');
      expect(
        FakeSocket.instances.filter((socket) => socket.readyState === FakeSocket.OPEN),
      ).toHaveLength(1);
    },
  );

  it('reconciles a lost Reset response, isolates old callbacks, and creates one fresh manager', async () => {
    controlServer.dropNextReset = true;
    await import('./client');
    await node('draft-element').click();
    await node('submit').click();
    await node('capture-barrier').click();
    const first = fixture.managers[0];
    const oldCallback = first?.queueCallbacks();
    await node('reset').click();
    await vi.waitFor(() => expect(node('status').dataset.reset).toBe('ok'));
    oldCallback?.();

    expect(first).toMatchObject({ stops: 1, subscribers: 0, activeBarriers: 0 });
    expect(fixture.managers).toHaveLength(2);
    expect(fixture.managers[1]).toMatchObject({ stops: 0, subscribers: 1 });
    expect(node('status').dataset).toMatchObject({
      pending: '0',
      failureControl: 'idle',
      reset: 'ok',
    });
    expect(JSON.parse(node('status').textContent)).toMatchObject({
      retainedDraftIds: [],
      activeDraft: null,
      barrier: null,
    });
  });

  it('keeps an inert stopped manager and all work fenced when Reset completion cannot be proven', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(fetch).mockRejectedValue(new Error('control unavailable'));
    await import('./client');
    const first = fixture.managers[0];
    fakeWindow.emit('error', { error: new Error('fixture error'), message: 'fixture error' });
    fakeWindow.emit('unhandledrejection', { reason: new Error('fixture rejection') });
    expect(consoleError).toHaveBeenCalledTimes(2);

    await node('reset').click();
    await vi.waitFor(() => expect(node('status').dataset.reset).toBe('blocked'));
    const before = {
      fetches: vi.mocked(fetch).mock.calls.length,
      managers: fixture.managers.length,
      submissions: first?.submissions,
      barriers: first?.activeBarriers,
      sockets: FakeSocket.instances.length,
      status: node('status').textContent,
    };
    for (const id of [
      'draft-element',
      'draft-extension',
      'submit',
      'retry',
      'reapply',
      'discard',
      'capture-barrier',
      'release-barrier',
      'wait-ack',
      'checkpoint',
      'disconnect',
      'reconnect',
      'corrupt-checkpoint',
      'reject-next',
      'lose-response',
      'replace-generation',
      'fail-extension',
    ])
      await node(id).click();
    expect(first).toMatchObject({ stops: 1, subscribers: 0 });
    expect({
      fetches: vi.mocked(fetch).mock.calls.length,
      managers: fixture.managers.length,
      submissions: first?.submissions,
      barriers: first?.activeBarriers,
      sockets: FakeSocket.instances.length,
      status: node('status').textContent,
    }).toEqual(before);
    expect(node('status').dataset.console).toBe('error');
    expect(node('events').textContent).toContain('action gate');
  });

  it('drives ordinary controls and keeps projection history transparent', async () => {
    await import('./client');
    await node('submit').click();
    await node('retry').click();
    await node('reapply').click();
    await node('discard').click();
    await node('wait-ack').click();
    expect(node('events').textContent).toContain('no draft');
    await node('draft-element').click();
    await node('submit').click();
    await node('capture-barrier').click();
    await node('wait-ack').click();
    await node('checkpoint').click();
    await node('release-barrier').click();
    await node('reapply').click();
    expect(node('duplicate-warning').hidden).toBe(false);
    await node('disconnect').click();
    await node('reconnect').click();
    await node('replace-generation').click();
    await node('theme').click();
    await node('theme').click();
    expect(node('status').dataset.invariant).toBe('passed');
    expect(node('status').textContent).toContain('projectionHistory');
    expect(node('canonical').textContent).toContain('confirmed');
    expect(node('status').dataset.console).toBe('clean');
  });
});
