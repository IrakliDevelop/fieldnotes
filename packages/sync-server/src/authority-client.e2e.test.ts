import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import {
  SyncClient,
  WebSocketTransport,
  createManagedAuthorityConnection,
  type AuthorityClientTransport,
  type AuthorityClientTransportHandlers,
  type ManagedAuthorityConnection,
  type ManagedSyncEndpoint,
  type SyncElement,
} from '@fieldnotes/sync';
import { ElementStore } from '@fieldnotes/core';
import { createSyncServer, type CreateSyncServerOptions } from './create-sync-server';
import { AuthorityFixtureDriver, AuthorityFixtureStore } from './test-support/authority-driver';
import type { AuthorityDriver, AuthorityRoomDefinition } from './authority-types';

const definition: AuthorityRoomDefinition = {
  id: 'definition',
  extensions: [],
  project: (_context, state) => state,
  canReadOwnerId: () => false,
};
const servers: ReturnType<typeof createSyncServer>[] = [];
const managers: ManagedAuthorityConnection[] = [];
const sockets = new Set<WebSocket>();
const legacyClients: SyncClient[] = [];
const legacyTransports: WebSocketTransport[] = [];

afterEach(async () => {
  for (const client of legacyClients) client.stop();
  legacyClients.length = 0;
  for (const transport of legacyTransports) transport.close();
  legacyTransports.length = 0;
  for (const manager of managers) manager.stop();
  managers.length = 0;
  for (const socket of sockets) socket.close();
  sockets.clear();
  for (const server of servers) await server.close();
  servers.length = 0;
});

class NodeSocketTransport implements AuthorityClientTransport {
  readonly inbound: string[] = [];
  readonly outbound: string[] = [];
  readonly closes: { code: number; reason: string }[] = [];
  socket: WebSocket | null = null;

  constructor(
    private readonly endpoint: ManagedSyncEndpoint,
    private readonly transformInbound: (raw: string) => string = (raw) => raw,
  ) {}

  start(handlers: AuthorityClientTransportHandlers): void {
    const socket = new WebSocket(
      this.endpoint.url,
      this.endpoint.protocols as string[] | undefined,
    );
    this.socket = socket;
    sockets.add(socket);
    socket.on('open', () => handlers.onOpen());
    socket.on('message', (data) => {
      const raw = this.transformInbound(String(data));
      this.inbound.push(raw);
      handlers.onMessage(raw);
    });
    socket.on('close', (code, reason) => {
      this.closes.push({ code, reason: String(reason) });
      handlers.onClose(code, String(reason));
    });
  }

  trySend(raw: string): boolean {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    this.outbound.push(raw);
    socket.send(raw);
    return true;
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
  }
}

function shape(id: string, audience?: string): SyncElement {
  return {
    id,
    type: 'shape',
    position: { x: 1, y: 2 },
    zIndex: 0,
    locked: false,
    layerId: 'default',
    shape: 'rectangle',
    size: { w: 20, h: 10 },
    strokeColor: '#111827',
    strokeWidth: 1,
    fillColor: '#38bdf8',
    ...(audience === undefined ? {} : { audience }),
  };
}

function startServer(
  options: {
    store?: AuthorityFixtureStore;
    roomDefinition?: AuthorityRoomDefinition;
    driver?: AuthorityDriver;
    authorize?: CreateSyncServerOptions['framePolicy'];
  } = {},
) {
  const store = options.store ?? new AuthorityFixtureStore();
  store.now = Date.now();
  if (!store.getRoom('table')) store.provision('table');
  const server = createSyncServer({
    port: 0,
    authenticate: ({ req }) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      return { userId: url.searchParams.get('identity') ?? 'actor' };
    },
    framePolicy: options.authorize ?? { authorize: () => true },
    authority: {
      driver: options.driver ?? new AuthorityFixtureDriver(store),
      resolveRoom: (room) => (room === 'table' ? (options.roomDefinition ?? definition) : null),
      resolveIdentity: (connection) => ({
        actorId: connection.userId ?? 'actor',
        ownershipId: connection.userId ?? 'actor',
      }),
    },
  });
  servers.push(server);
  return { store, server, port: (server.wss.address() as AddressInfo).port };
}

function connect(
  port: number,
  identity = 'actor',
  configure?: (transport: NodeSocketTransport, index: number) => void,
) {
  const transports: NodeSocketTransport[] = [];
  const manager = createManagedAuthorityConnection({
    scopeId: `${identity}/table`,
    clientId: identity,
    resolveUrl: () => ({ url: `ws://127.0.0.1:${port}?room=table&identity=${identity}` }),
    transportFactory: (endpoint) => {
      const transport = new NodeSocketTransport(endpoint);
      configure?.(transport, transports.length);
      transports.push(transport);
      return transport;
    },
  });
  managers.push(manager);
  return { manager, transports };
}

async function live(manager: ManagedAuthorityConnection): Promise<void> {
  await vi.waitFor(() => expect(manager.getState().status).toBe('live'), { timeout: 5_000 });
}

async function operationStatus(
  manager: ManagedAuthorityConnection,
  id: string,
  status: 'accepted' | 'rejected' | 'uncertain',
): Promise<void> {
  await vi.waitFor(
    () =>
      expect(
        manager.getState().operations.find((item) => item.clientOperationId === id)?.status,
      ).toBe(status),
    { timeout: 5_000 },
  );
}

describe('managed authority client over real createSyncServer sockets', () => {
  it('negotiates exact capabilities/generation/checkpoint before live and separates receipt from application', async () => {
    let releaseChanges: (() => void) | undefined;
    const { port } = startServer({
      authorize: {
        authorize: ({ direction, message }) => {
          if (direction === 'outbound' && message.includes('"kind":"changes"'))
            return new Promise<boolean>((resolve) => {
              releaseChanges = () => resolve(true);
            });
          return true;
        },
      },
    });
    const { manager, transports } = connect(port);
    await live(manager);
    const firstInbound = transports[0]?.inbound.map(
      (raw) => JSON.parse(raw).kind ?? 'capabilities',
    );
    expect(firstInbound).toContain('resync-required');
    expect(firstInbound).toContain('checkpoint-end');
    expect(manager.getState().document?.cursor.generation).toBe('g');

    const result = manager.submit({ kind: 'upsert', element: shape('receipt-before-change') });
    expect(result.status).toBe('admitted');
    if (result.status !== 'admitted') return;
    await operationStatus(manager, result.clientOperationId, 'accepted');
    expect(manager.getState().document?.elements).toEqual([]);
    expect(releaseChanges).toBeDefined();
    releaseChanges?.();
    await vi.waitFor(() =>
      expect(manager.getState().document?.elements.map((element) => element.id)).toEqual([
        'receipt-before-change',
      ]),
    );
    const operation = manager
      .getState()
      .operations.find((item) => item.clientOperationId === result.clientOperationId);
    expect(operation?.receipt).toBeDefined();
    expect(transports[0]?.outbound).toContain(operation?.originalWire);
  });

  it('resolves an uncertain exact-wire retry at most once and retains a definite rejection', async () => {
    const { store, port } = startServer();
    const { manager } = connect(port);
    await live(manager);
    store.loseCommitResponse = true;
    const uncertain = manager.submit({ kind: 'upsert', element: shape('deduped') });
    expect(uncertain.status).toBe('admitted');
    if (uncertain.status !== 'admitted') return;
    await operationStatus(manager, uncertain.clientOperationId, 'uncertain');
    store.loseCommitResponse = false;
    await live(manager);
    const before = manager
      .getState()
      .operations.find((item) => item.clientOperationId === uncertain.clientOperationId);
    expect(manager.retryOperation(uncertain.clientOperationId)).toEqual({ status: 'sent' });
    await operationStatus(manager, uncertain.clientOperationId, 'accepted');
    const after = manager
      .getState()
      .operations.find((item) => item.clientOperationId === uncertain.clientOperationId);
    expect(after?.originalWire).toBe(before?.originalWire);
    expect(
      store.getRoom('table')?.state.elements.filter((item) => item.id === 'deduped'),
    ).toHaveLength(1);

    store.policy.canWrite = () => false;
    const rejected = manager.submit({ kind: 'upsert', element: shape('rejected') });
    expect(rejected.status).toBe('admitted');
    if (rejected.status !== 'admitted') return;
    await operationStatus(manager, rejected.clientOperationId, 'rejected');
    expect(
      manager
        .getState()
        .operations.some((item) => item.clientOperationId === rejected.clientOperationId),
    ).toBe(true);
  });

  it('captures an acknowledged barrier before a later edit and returns a coherent checkpoint', async () => {
    const { store, port } = startServer();
    const { manager } = connect(port);
    await live(manager);
    const first = manager.submit({ kind: 'upsert', element: shape('inside-cut') });
    expect(first.status).toBe('admitted');
    if (first.status !== 'admitted') return;
    const barrier = manager.captureBarrier();
    expect(barrier).not.toBeNull();
    const later = manager.submit({ kind: 'upsert', element: shape('after-cut') });
    expect(later.status).toBe('admitted');
    if (!barrier || later.status !== 'admitted') return;
    expect(barrier.operationIds).toEqual([first.clientOperationId]);
    expect(barrier.operationIds).not.toContain(later.clientOperationId);
    expect((await manager.waitForAcknowledgements(barrier)).status).toBe('acknowledged');
    await operationStatus(manager, later.clientOperationId, 'accepted');
    await vi.waitFor(() =>
      expect(manager.getState().document?.elements.map((item) => item.id)).toEqual([
        'after-cut',
        'inside-cut',
      ]),
    );
    await live(manager);
    await new Promise((resolve) => setTimeout(resolve, 10_250));
    store.now = Date.now();
    const checkpoint = await manager.requestCheckpoint({ barrier });
    expect(checkpoint).toMatchObject({ status: 'complete' });
    if (checkpoint.status === 'complete') {
      expect(checkpoint.barrier).toBe(barrier);
      expect(checkpoint.checkpoint.cursor.generation).toBe('g');
    }
  }, 20_000);

  it('recovers two clients in order after one real fanout socket is disrupted', async () => {
    const { port } = startServer();
    const author = connect(port, 'author');
    const observer = connect(port, 'observer');
    await Promise.all([live(author.manager), live(observer.manager)]);
    const first = author.manager.submit({ kind: 'upsert', element: shape('one') });
    expect(first.status).toBe('admitted');
    if (first.status !== 'admitted') return;
    await vi.waitFor(() =>
      expect(observer.manager.getState().document?.elements.map((item) => item.id)).toEqual([
        'one',
      ]),
    );
    observer.transports.at(-1)?.socket?.close(1013);
    await vi.waitFor(() => expect(observer.manager.getState().status).not.toBe('live'));
    const second = author.manager.submit({ kind: 'upsert', element: shape('two') });
    expect(second.status).toBe('admitted');
    if (second.status !== 'admitted') return;
    await operationStatus(author.manager, second.clientOperationId, 'accepted');
    await vi.waitFor(() => expect(observer.transports.length).toBeGreaterThanOrEqual(2), {
      timeout: 5_000,
    });
    await live(observer.manager);
    await vi.waitFor(() =>
      expect(observer.manager.getState().document?.elements.map((item) => item.id)).toEqual([
        'one',
        'two',
      ]),
    );
  });

  it('retains old-generation uncertainty without replay when the authoritative generation changes', async () => {
    const { store, port } = startServer();
    const client = connect(port);
    await live(client.manager);
    store.loseCommitResponse = true;
    const old = client.manager.submit({ kind: 'upsert', element: shape('old-uncertain') });
    expect(old.status).toBe('admitted');
    if (old.status !== 'admitted') return;
    await operationStatus(client.manager, old.clientOperationId, 'uncertain');
    const before = client.manager
      .getState()
      .operations.find((item) => item.clientOperationId === old.clientOperationId);
    expect(before).toBeDefined();
    store.loseCommitResponse = false;
    store.replace('table', 'g-next');
    await vi.waitFor(() => expect(client.manager.getState().generation).toBe('g-next'), {
      timeout: 5_000,
    });
    await live(client.manager);
    const retained = client.manager
      .getState()
      .operations.find((item) => item.clientOperationId === old.clientOperationId);
    expect(retained?.generation).toBe('g');
    expect(retained?.status).toBe('uncertain');
    expect(retained?.clientOperationId).toBe(before?.clientOperationId);
    expect(retained?.proposal).toBe(before?.proposal);
    expect(retained?.originalWire).toBe(before?.originalWire);
    expect(client.manager.retryOperation(old.clientOperationId)).toEqual({
      status: 'refused',
      reason: 'generation-mismatch',
    });
    expect(client.manager.getState().document?.elements).toEqual([]);
    expect(store.getRoom('table')?.state.elements).toEqual([]);
    expect(
      client.transports
        .flatMap((transport) => transport.outbound)
        .filter((wire) => wire === before?.originalWire),
    ).toHaveLength(1);
  });

  it('keeps the public legacy client and transport synchronized in a non-authority room', async () => {
    const server = createSyncServer({ port: 0 });
    servers.push(server);
    const port = (server.wss.address() as AddressInfo).port;
    const sourceStore = new ElementStore();
    const targetStore = new ElementStore();
    const sourceTransport = new WebSocketTransport(`ws://127.0.0.1:${port}?room=legacy`, {
      WebSocket: WebSocket as unknown as typeof globalThis.WebSocket,
    });
    const targetTransport = new WebSocketTransport(`ws://127.0.0.1:${port}?room=legacy`, {
      WebSocket: WebSocket as unknown as typeof globalThis.WebSocket,
    });
    legacyTransports.push(sourceTransport, targetTransport);
    const source = new SyncClient({
      store: sourceStore,
      transport: sourceTransport,
      clientId: 'a',
    });
    const target = new SyncClient({
      store: targetStore,
      transport: targetTransport,
      clientId: 'b',
    });
    legacyClients.push(source, target);
    source.start();
    target.start();

    await vi.waitFor(() => expect(server.wss.clients.size).toBe(2));
    sourceStore.add(shape('legacy-shape'));
    await vi.waitFor(() =>
      expect(targetStore.getById('legacy-shape')).toEqual(shape('legacy-shape')),
    );
  });

  it('filters private bytes from a player document and all captured player frames', async () => {
    const filteredDefinition: AuthorityRoomDefinition = {
      ...definition,
      project: (context, state) => ({
        ...state,
        elements: state.elements.filter(
          (element) => element.audience !== 'private' || context.actorId === 'owner',
        ),
      }),
    };
    const { port } = startServer({ roomDefinition: filteredDefinition });
    const owner = connect(port, 'owner');
    await live(owner.manager);
    const privateEdit = owner.manager.submit({
      kind: 'upsert',
      element: shape('PRIVATE_SENTINEL_DO_NOT_SEND', 'private'),
    });
    expect(privateEdit.status).toBe('admitted');
    if (privateEdit.status !== 'admitted') return;
    await operationStatus(owner.manager, privateEdit.clientOperationId, 'accepted');
    const player = connect(port, 'player');
    await live(player.manager);
    expect(JSON.stringify(player.manager.getState().document)).not.toContain(
      'PRIVATE_SENTINEL_DO_NOT_SEND',
    );
    expect(player.transports.flatMap((transport) => transport.inbound).join('\n')).not.toContain(
      'PRIVATE_SENTINEL_DO_NOT_SEND',
    );
    expect(player.transports.flatMap((transport) => transport.outbound).join('\n')).not.toContain(
      '"kind":"presence"',
    );
  });

  it('never publishes live from a corrupted checkpoint and keeps legacy authority refusal', async () => {
    const { port } = startServer();
    let corrupted = false;
    const statuses: string[] = [];
    const transports: NodeSocketTransport[] = [];
    const manager = createManagedAuthorityConnection({
      scopeId: 'corrupt/table',
      clientId: 'corrupt',
      resolveUrl: () => ({ url: `ws://127.0.0.1:${port}?room=table&identity=corrupt` }),
      transportFactory: (endpoint) => {
        const transport = new NodeSocketTransport(endpoint, (raw) => {
          const parsed = JSON.parse(raw) as {
            kind?: string;
            manifest?: { sha256?: string };
          };
          if (
            !corrupted &&
            parsed.kind === 'checkpoint-begin' &&
            typeof parsed.manifest?.sha256 === 'string'
          ) {
            corrupted = true;
            return JSON.stringify({
              ...parsed,
              manifest: { ...parsed.manifest, sha256: '0'.repeat(64) },
            });
          }
          return raw;
        });
        transports.push(transport);
        return transport;
      },
    });
    managers.push(manager);
    const unsubscribe = manager.subscribe(() => statuses.push(manager.getState().status));
    await live(manager);
    unsubscribe();
    expect(corrupted).toBe(true);
    expect(transports.length).toBeGreaterThanOrEqual(2);
    expect(statuses.filter((status) => status === 'live')).toHaveLength(1);

    const legacy = new WebSocket(`ws://127.0.0.1:${port}?room=table&identity=legacy`);
    sockets.add(legacy);
    await new Promise<void>((resolve) => legacy.once('open', resolve));
    legacy.send(
      JSON.stringify({
        from: 'legacy',
        op: { kind: 'capabilities', capabilities: { protocolVersions: [3] } },
      }),
    );
    const code = await new Promise<number>((resolve) => legacy.once('close', resolve));
    expect(code).toBe(4406);
  });
});
