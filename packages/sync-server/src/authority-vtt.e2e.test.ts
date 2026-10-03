import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import {
  createAuthorityOperationId,
  createManagedAuthorityConnection,
  serializeAuthorityFrame,
  type AuthorityClientTransport,
  type AuthorityClientTransportHandlers,
  type AuthorityMutation,
  type ManagedAuthorityConnection,
  type ManagedSyncEndpoint,
  type SyncElement,
} from '@fieldnotes/sync';
import { createFogAuthorityClientExtension } from '@fieldnotes/vtt/sync';
import {
  applyFogAuthorityIntent,
  createFogServerPlugin,
  createFogAuthorityServerExtension,
  type FogAuthorityIntent,
} from '@fieldnotes/vtt/server';
import { createSyncServer } from './create-sync-server';
import { MemoryHubBackend } from './memory-hub-backend';
import type { HubBackend } from './hub-backend';
import { AuthorityFixtureDriver, AuthorityFixtureStore } from './test-support/authority-driver';
import type {
  AuthorityCommitContext,
  AuthorityCommitRequest,
  AuthorityCommitResult,
  AuthorityDriver,
  AuthorityExtension,
  JsonValue,
  AuthorityRoomDefinition,
} from './authority-types';

const room = 'table';
const definitionId = 'sdk-f-definition';
const storageKind = 'sdk-f:fog-state';
const fogServer = createFogAuthorityServerExtension();
const fogStorage: AuthorityExtension = {
  requirement: fogServer.requirement,
  extensionKinds: [storageKind],
  prepare: (mutation: AuthorityMutation) =>
    mutation.kind === 'extension' && mutation.extensionKind === storageKind
      ? (mutation.payload as JsonValue)
      : null,
  changes: fogServer.changes,
};

function operationDigest(context: AuthorityCommitContext, request: AuthorityCommitRequest): string {
  return createHash('sha256')
    .update('fieldnotes.authority-proposal.v1\0', 'utf8')
    .update(JSON.stringify([context.room, context.actorId]), 'utf8')
    .update('\0', 'utf8')
    .update(serializeAuthorityFrame(request.proposal), 'utf8')
    .digest('hex');
}

/** Test-only in-memory transaction adapter. It deliberately makes no durability claim. */
class VttFixtureDriver implements AuthorityDriver {
  readonly base: AuthorityFixtureDriver;
  fogCommits = 0;
  fogAttempts = 0;
  fogReplays = 0;
  private readonly prepared = new Map<
    string,
    { readonly digest: string; readonly translated: AuthorityCommitRequest }
  >();

  constructor(readonly store: AuthorityFixtureStore) {
    this.base = new AuthorityFixtureDriver(store);
  }

  head: AuthorityDriver['head'] = (...args) => this.base.head(...args);
  checkpoint: AuthorityDriver['checkpoint'] = (...args) => this.base.checkpoint(...args);
  readAfter: AuthorityDriver['readAfter'] = (...args) => this.base.readAfter(...args);
  readEvidence: AuthorityDriver['readEvidence'] = (...args) => this.base.readEvidence(...args);
  claimPublications: AuthorityDriver['claimPublications'] = (...args) =>
    this.base.claimPublications(...args);
  markPublished: AuthorityDriver['markPublished'] = (...args) => this.base.markPublished(...args);

  async commit(
    context: AuthorityCommitContext,
    request: AuthorityCommitRequest,
  ): Promise<AuthorityCommitResult> {
    if (
      request.proposal.mutation.kind !== 'fog-meta' &&
      request.proposal.mutation.kind !== 'fog-patch'
    )
      return this.base.commit(context, request);
    if (request.intent.kind !== 'extension' || request.intent.key !== 'fog')
      return { status: 'rejected', reason: 'invalid' };
    this.fogAttempts++;
    const dedupeKey = `${context.actorId}\0${context.clientOperationId}`;
    const previous = this.prepared.get(dedupeKey);
    if (previous) {
      if (previous.digest !== context.operationDigest)
        return { status: 'rejected', reason: 'operation-id-reused' };
      const replay = await this.base.commit(
        {
          ...context,
          operationDigest: operationDigest(context, previous.translated),
        },
        previous.translated,
      );
      if (replay.status === 'committed' && replay.replayed) this.fogReplays++;
      return replay;
    }
    const current = this.store.getRoom(context.room)?.state.extensions.fog?.data ?? null;
    const transition = applyFogAuthorityIntent(
      current as Parameters<typeof applyFogAuthorityIntent>[0],
      request.proposal.mutation,
      request.intent.payload as unknown as FogAuthorityIntent,
    );
    if (transition.status === 'rejected') return transition;
    const proposal = {
      ...request.proposal,
      mutation: {
        kind: 'extension' as const,
        extensionKind: storageKind,
        payload: transition.state,
      },
    };
    const translated: AuthorityCommitRequest = {
      proposal,
      intent: {
        schema: 1 as const,
        kind: 'extension' as const,
        key: 'fog',
        version: 1,
        payload: transition.state as JsonValue,
      },
    };
    this.prepared.set(dedupeKey, { digest: context.operationDigest, translated });
    try {
      const result = await this.base.commit(
        { ...context, operationDigest: operationDigest(context, translated) },
        translated,
      );
      if (result.status === 'committed' && !result.replayed) this.fogCommits++;
      if (result.status === 'rejected') this.prepared.delete(dedupeKey);
      return result;
    } catch (error) {
      const persisted = this.store.getRoom(context.room)?.state.extensions.fog?.data;
      if (JSON.stringify(persisted) === JSON.stringify(transition.state)) this.fogCommits++;
      else this.prepared.delete(dedupeKey);
      throw error;
    }
  }
}

class NodeTransport implements AuthorityClientTransport {
  readonly inbound: string[] = [];
  readonly outbound: string[] = [];
  readonly closes: { code: number; reason: string }[] = [];
  socket: WebSocket | null = null;

  constructor(
    private readonly endpoint: ManagedSyncEndpoint,
    private readonly inboundTransform: (raw: string) => string = (raw) => raw,
    private readonly dropReceiptOnce?: { pending: boolean },
  ) {}

  start(handlers: AuthorityClientTransportHandlers): void {
    const socket = new WebSocket(
      this.endpoint.url,
      this.endpoint.protocols as string[] | undefined,
    );
    this.socket = socket;
    sockets.add(socket);
    socket.on('error', () => undefined);
    socket.on('open', handlers.onOpen);
    socket.on('message', (data) => {
      const raw = this.inboundTransform(String(data));
      const frame = JSON.parse(raw) as { kind?: string };
      if (this.dropReceiptOnce?.pending && frame.kind === 'receipt') {
        this.dropReceiptOnce.pending = false;
        socket.close(1000, 'injected receipt loss');
        return;
      }
      this.inbound.push(raw);
      handlers.onMessage(raw);
    });
    socket.on('close', (code, reason) => {
      this.closes.push({ code, reason: String(reason) });
      handlers.onClose(code, String(reason));
    });
  }

  trySend(raw: string): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.outbound.push(raw);
    this.socket.send(raw);
    return true;
  }

  close(): void {
    if (this.socket?.readyState === WebSocket.CONNECTING) this.socket.terminate();
    else this.socket?.close();
    this.socket = null;
  }
}

const servers: ReturnType<typeof createSyncServer>[] = [];
const managers: ManagedAuthorityConnection[] = [];
const sockets = new Set<WebSocket>();

afterEach(async () => {
  for (const manager of managers) manager.stop();
  managers.length = 0;
  for (const socket of sockets) socket.close();
  sockets.clear();
  for (const server of servers) await server.close();
  servers.length = 0;
});

async function start() {
  const store = new AuthorityFixtureStore();
  store.now = Date.now();
  store.provision(room, 'g1', definitionId);
  store.policy.extensions = [fogStorage];
  store.policy.canUseExtension = () => true;
  const driver = new VttFixtureDriver(store);
  const memoryBackend = new MemoryHubBackend();
  const legacyBackendLookup: NonNullable<HubBackend['getService']> = vi.fn(() => undefined);
  const backend: HubBackend = {
    snapshot: (name: string) => memoryBackend.snapshot(name),
    get: (name: string, id: string) => memoryBackend.get(name, id),
    apply: (name: string, op: Parameters<MemoryHubBackend['apply']>[1]) =>
      memoryBackend.apply(name, op),
    layerRecords: (name: string) => memoryBackend.layerRecords(name),
    getLayerRecord: (name: string, id: string) => memoryBackend.getLayerRecord(name, id),
    applyLayerRecord: (
      name: string,
      record: Parameters<NonNullable<MemoryHubBackend['applyLayerRecord']>>[1],
    ) => memoryBackend.applyLayerRecord(name, record),
    getService: legacyBackendLookup,
  };
  const legacyFog = createFogServerPlugin();
  const legacyProcess = vi.fn(legacyFog.process);
  const seededFog = {
    meta: {
      version: 1,
      editor: 'seed',
      definition: {
        version: 1 as const,
        generation: 'fog-g1',
        bounds: { x: 0, y: 0, w: 128, h: 128 },
        cellSize: 1,
        tileCells: 128 as const,
        base: 'covered' as const,
      },
    },
    tiles: [],
  };
  const seedProposal = {
    protocol: 'authority:1' as const,
    kind: 'propose' as const,
    generation: 'g1',
    clientOperationId: createAuthorityOperationId(store.now),
    mutation: { kind: 'extension' as const, extensionKind: storageKind, payload: seededFog },
  };
  const seedRequest = {
    proposal: seedProposal,
    intent: {
      schema: 1 as const,
      kind: 'extension' as const,
      key: 'fog',
      version: 1,
      payload: seededFog,
    },
  };
  const seedContext = {
    room,
    actorId: 'seed',
    ownershipId: 'seed',
    connectionId: 'seed',
    userId: 'seed',
    deadlineAt: store.now + 5_000,
    signal: new AbortController().signal,
    definitionId,
    roomGeneration: 'g1',
    clientOperationId: seedProposal.clientOperationId,
    operationDigest: '',
  };
  const seed = await driver.base.commit(
    { ...seedContext, operationDigest: operationDigest(seedContext, seedRequest) },
    seedRequest,
  );
  if (seed.status !== 'committed') throw new Error(`fog seed rejected: ${seed.reason}`);
  const definition: AuthorityRoomDefinition = {
    id: definitionId,
    extensions: [fogServer],
    project: (_context, state) => state,
    canReadOwnerId: () => false,
  };
  const server = createSyncServer({
    port: 0,
    backend,
    plugins: [{ ...legacyFog, process: legacyProcess }],
    authenticate: ({ req }) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      return { userId: url.searchParams.get('identity') ?? 'actor' };
    },
    framePolicy: { authorize: () => true },
    authority: {
      driver,
      resolveRoom: (value) => (value === room ? definition : null),
      resolveIdentity: (connection) => ({
        actorId: connection.userId ?? 'actor',
        ownershipId: connection.userId ?? 'actor',
      }),
    },
  });
  servers.push(server);
  const seedGeneration = async (generation: string): Promise<void> => {
    store.now = Date.now();
    const state = structuredClone(seededFog);
    state.meta.definition.generation = `fog-${generation}`;
    const proposal = {
      protocol: 'authority:1' as const,
      kind: 'propose' as const,
      generation,
      clientOperationId: createAuthorityOperationId(store.now),
      mutation: { kind: 'extension' as const, extensionKind: storageKind, payload: state },
    };
    const request: AuthorityCommitRequest = {
      proposal,
      intent: {
        schema: 1,
        kind: 'extension',
        key: 'fog',
        version: 1,
        payload: state as JsonValue,
      },
    };
    const context = {
      ...seedContext,
      roomGeneration: generation,
      clientOperationId: proposal.clientOperationId,
    };
    const result = await driver.base.commit(
      { ...context, operationDigest: operationDigest(context, request) },
      request,
    );
    if (result.status !== 'committed')
      throw new Error(`replacement seed rejected: ${result.reason}`);
  };
  return {
    store,
    driver,
    legacyProcess,
    legacyBackendLookup,
    replaceGeneration: async (generation: string) => {
      store.replace(room, generation, definitionId);
      await seedGeneration(generation);
    },
    port: (server.wss.address() as AddressInfo).port,
  };
}

function connect(
  port: number,
  identity: string,
  options: {
    fog?: boolean;
    corruptCheckpoint?: boolean;
    dropReceiptOnce?: { pending: boolean };
  } = {},
) {
  const transports: NodeTransport[] = [];
  let corrupt = options.corruptCheckpoint === true;
  const manager = createManagedAuthorityConnection({
    scopeId: `${identity}/${room}`,
    clientId: identity,
    extensions: options.fog === false ? [] : [createFogAuthorityClientExtension()],
    resolveUrl: () => ({ url: `ws://127.0.0.1:${port}?room=${room}&identity=${identity}` }),
    transportFactory: (endpoint) => {
      const transport = new NodeTransport(
        endpoint,
        (raw) => {
          if (!corrupt) return raw;
          const value = JSON.parse(raw) as { kind?: string; manifest?: { sha256?: string } };
          if (value.kind !== 'checkpoint-begin' || typeof value.manifest?.sha256 !== 'string')
            return raw;
          corrupt = false;
          return JSON.stringify({
            ...value,
            manifest: { ...value.manifest, sha256: '0'.repeat(64) },
          });
        },
        options.dropReceiptOnce,
      );
      transports.push(transport);
      return transport;
    },
  });
  managers.push(manager);
  return { manager, transports };
}

async function live(
  manager: ManagedAuthorityConnection,
  transports?: readonly NodeTransport[],
): Promise<void> {
  try {
    await vi.waitFor(() => expect(manager.getState().status).toBe('live'), { timeout: 3_000 });
  } catch {
    throw new Error(
      JSON.stringify({
        state: manager.getState(),
        closes: transports?.flatMap((item) => item.closes),
      }),
    );
  }
}

async function accepted(manager: ManagedAuthorityConnection, mutation: AuthorityMutation) {
  const result = manager.submit(mutation);
  expect(result.status).toBe('admitted');
  if (result.status !== 'admitted') throw new Error('proposal refused');
  await vi.waitFor(
    () =>
      expect(
        manager
          .getState()
          .operations.find((item) => item.clientOperationId === result.clientOperationId)?.status,
      ).toBe('accepted'),
    { timeout: 5_000 },
  );
  return result.clientOperationId;
}

async function operationStatus(
  manager: ManagedAuthorityConnection,
  id: string,
  status: 'accepted' | 'rejected' | 'uncertain' | 'draft',
): Promise<void> {
  await vi.waitFor(
    () =>
      expect(
        manager.getState().operations.find((item) => item.clientOperationId === id)?.status,
      ).toBe(status),
    { timeout: 5_000 },
  );
}

const shape = (id: string): SyncElement => ({
  id,
  type: 'shape',
  position: { x: 2, y: 3 },
  zIndex: 0,
  locked: false,
  layerId: 'tokens',
  shape: 'rectangle',
  size: { w: 20, h: 10 },
  strokeColor: '#111827',
  strokeWidth: 1,
  fillColor: '#38bdf8',
});

const fogMeta = (version: number, generation = 'fog-g1') => ({
  version,
  editor: 'author',
  definition: {
    version: 1 as const,
    generation,
    bounds: { x: 0, y: 0, w: 128, h: 128 },
    cellSize: 1,
    tileCells: 128 as const,
    base: 'covered' as const,
  },
});

describe('managed VTT authority compatibility over public sockets', () => {
  it('negotiates exact fog inventory and converges core, layer tombstones, and fog on two peers', async () => {
    const { port, driver } = await start();
    const author = connect(port, 'author');
    const peer = connect(port, 'peer');
    await Promise.all([
      live(author.manager, author.transports),
      live(peer.manager, peer.transports),
    ]);

    const serialized = author.transports[0]?.outbound.join('\n') ?? '';
    expect(serialized).toContain('capabilities');
    expect(serialized.match(/fog-meta/g)).toHaveLength(1);
    expect(serialized.match(/fog-patch/g)).toHaveLength(1);
    expect(serialized).toContain('"key":"fog"');
    expect(serialized).toContain('"pluginName":"fog"');
    expect(serialized).toContain('"version":1');

    await accepted(author.manager, { kind: 'upsert', element: shape('token') });
    await accepted(author.manager, {
      kind: 'layer-upsert',
      layer: { id: 'tokens', name: 'Tokens', visible: true, locked: false, order: 1, opacity: 1 },
      version: 1,
      editor: 'author',
    });
    await accepted(author.manager, { kind: 'fog-meta', record: fogMeta(2) });
    await accepted(author.manager, {
      kind: 'fog-patch',
      generation: 'fog-g1',
      tiles: [{ generation: 'fog-g1', x: 0, y: 0, version: 1, editor: 'author' }],
    });
    await accepted(author.manager, {
      kind: 'layer-remove',
      id: 'tokens',
      version: 2,
      editor: 'author',
    });

    await vi.waitFor(() => {
      const authorDocument = author.manager.getState().document;
      const peerDocument = peer.manager.getState().document;
      expect(peerDocument?.cursor.revision).toBe(authorDocument?.cursor.revision);
      expect(peerDocument?.elements).toEqual(authorDocument?.elements);
      expect(peerDocument?.layers).toEqual(authorDocument?.layers);
      expect(peerDocument?.extensions).toEqual(authorDocument?.extensions);
    });
    const document = author.manager.getState().document;
    expect(document?.elements.map((element) => element.id)).toEqual(['token']);
    expect(document?.layers).toEqual([{ id: 'tokens', version: 2, editor: 'author' }]);
    expect(document?.extensions.fog?.data).toMatchObject({
      meta: { definition: { generation: 'fog-g1' } },
      tiles: [{ x: 0, y: 0 }],
    });
    expect(driver.fogCommits).toBe(2);

    const barrier = author.manager.captureBarrier();
    expect(barrier).not.toBeNull();
    if (!barrier) return;
    await expect(author.manager.waitForAcknowledgements(barrier)).resolves.toMatchObject({
      status: 'acknowledged',
    });
    author.manager.releaseBarrier(barrier);
  }, 15_000);

  it('retries an uncertain fog operation with the exact wire and applies it only once', async () => {
    const { port, driver, legacyProcess, legacyBackendLookup } = await start();
    const loss = { pending: true };
    const author = connect(port, 'author', { dropReceiptOnce: loss });
    await live(author.manager, author.transports);

    const submitted = author.manager.submit({ kind: 'fog-meta', record: fogMeta(2) });
    expect(submitted.status).toBe('admitted');
    if (submitted.status !== 'admitted') return;
    await operationStatus(author.manager, submitted.clientOperationId, 'uncertain');
    await live(author.manager, author.transports);
    expect(driver.fogCommits).toBe(1);
    expect(author.manager.getState().document?.extensions.fog?.data).toMatchObject({
      meta: { version: 2 },
    });

    expect(author.manager.retryOperation(submitted.clientOperationId)).toEqual({ status: 'sent' });
    await operationStatus(author.manager, submitted.clientOperationId, 'accepted');
    expect(driver.fogAttempts).toBe(2);
    expect(driver.fogCommits).toBe(1);
    expect(driver.fogReplays).toBe(1);
    const retained = author.manager
      .getState()
      .operations.find((item) => item.clientOperationId === submitted.clientOperationId);
    expect(
      author.transports
        .flatMap((transport) => transport.outbound)
        .filter((wire) => wire === retained?.originalWire),
    ).toHaveLength(2);
    expect(legacyProcess).not.toHaveBeenCalled();
    expect(legacyBackendLookup).not.toHaveBeenCalled();
  }, 15_000);

  it('definitely rejects forbidden fog without changing canonical state or legacy backends', async () => {
    const { port, store, driver, legacyProcess, legacyBackendLookup } = await start();
    const author = connect(port, 'author');
    await live(author.manager, author.transports);
    const before = structuredClone(author.manager.getState().document);
    store.policy.canWrite = () => false;

    const submitted = author.manager.submit({ kind: 'fog-meta', record: fogMeta(2) });
    expect(submitted.status).toBe('admitted');
    if (submitted.status !== 'admitted') return;
    await operationStatus(author.manager, submitted.clientOperationId, 'rejected');

    expect(author.manager.getState().document).toEqual(before);
    expect(driver.fogCommits).toBe(0);
    expect(legacyProcess).not.toHaveBeenCalled();
    expect(legacyBackendLookup).not.toHaveBeenCalled();
  }, 15_000);

  it('retains old-generation fog work without implicit replay after generation replacement', async () => {
    const { port, store, driver, replaceGeneration } = await start();
    const author = connect(port, 'author');
    await live(author.manager, author.transports);
    store.loseCommitResponse = true;
    const submitted = author.manager.submit({ kind: 'fog-meta', record: fogMeta(2) });
    expect(submitted.status).toBe('admitted');
    if (submitted.status !== 'admitted') return;
    await operationStatus(author.manager, submitted.clientOperationId, 'uncertain');
    const retainedBefore = author.manager
      .getState()
      .operations.find((item) => item.clientOperationId === submitted.clientOperationId);
    store.loseCommitResponse = false;

    await replaceGeneration('g2');
    await vi.waitFor(() => expect(author.manager.getState().generation).toBe('g2'), {
      timeout: 5_000,
    });
    await live(author.manager, author.transports);

    const retained = author.manager
      .getState()
      .operations.find((item) => item.clientOperationId === submitted.clientOperationId);
    expect(retained?.status).toBe('uncertain');
    expect(retained?.generation).toBe('g1');
    expect(retained?.proposal).toBe(retainedBefore?.proposal);
    expect(retained?.originalWire).toBe(retainedBefore?.originalWire);
    expect(author.manager.retryOperation(submitted.clientOperationId)).toEqual({
      status: 'refused',
      reason: 'generation-mismatch',
    });
    expect(driver.fogCommits).toBe(1);
    expect(driver.fogReplays).toBe(0);
    expect(
      author.transports
        .flatMap((transport) => transport.outbound)
        .filter((wire) => wire === retained?.originalWire),
    ).toHaveLength(1);
    expect(author.manager.getState().document?.extensions.fog?.data).toMatchObject({
      meta: { definition: { generation: 'fog-g2' } },
    });
  }, 15_000);

  it('fails closed for incapable and corrupt-checkpoint peers without invoking fog commits', async () => {
    const { port, driver } = await start();
    const author = connect(port, 'author');
    await live(author.manager, author.transports);
    await accepted(author.manager, { kind: 'fog-meta', record: fogMeta(2) });
    const committed = driver.fogCommits;

    const incapable = connect(port, 'incapable', { fog: false });
    const corrupt = connect(port, 'corrupt', { corruptCheckpoint: true });
    await vi.waitFor(() => expect(incapable.manager.getState().status).not.toBe('live'), {
      timeout: 2_000,
    });
    await vi.waitFor(() => expect(corrupt.manager.getState().status).not.toBe('live'), {
      timeout: 2_000,
    });
    expect(incapable.manager.getState().document).toBeNull();
    expect(corrupt.manager.getState().document).toBeNull();
    expect(driver.fogCommits).toBe(committed);
  }, 15_000);
});
