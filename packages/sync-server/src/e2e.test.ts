import { describe, it, expect, afterEach } from 'vitest';
import { WebSocket as WsClient } from 'ws';
import type { AddressInfo } from 'net';
import { SyncClient, WebSocketTransport } from '@fieldnotes/sync';
import type { WebSocketTransportOptions } from '@fieldnotes/sync';
import { ElementStore, createShape } from '@fieldnotes/core';
import { MemoryHubBackend } from './memory-hub-backend';
import { createSyncServer } from './create-sync-server';

type Server = ReturnType<typeof createSyncServer>;

interface ConnectedClient {
  store: ElementStore;
  client: SyncClient;
  transport: WebSocketTransport;
}

async function waitFor(cond: () => boolean | Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await cond()) return;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor: condition not met within ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

function shape() {
  return createShape({ position: { x: 0, y: 0 }, size: { width: 10, height: 10 } });
}

describe('sync-server WebSocket relay (end-to-end)', () => {
  const servers: Server[] = [];
  const transports: WebSocketTransport[] = [];
  const rawClients: WsClient[] = [];

  function startServer() {
    const backend = new MemoryHubBackend();
    const server = createSyncServer({ port: 0, backend });
    servers.push(server);
    const port = (server.wss.address() as AddressInfo).port;
    return { server, hub: server.hub, port, backend };
  }

  function connect(
    port: number,
    room: string,
    options: Partial<WebSocketTransportOptions> = {},
  ): ConnectedClient {
    const transport = new WebSocketTransport(`ws://127.0.0.1:${port}?room=${room}`, {
      WebSocket: WsClient as unknown as typeof WebSocket,
      ...options,
    });
    transports.push(transport);
    const store = new ElementStore();
    const client = new SyncClient({ store, transport });
    client.start();
    return { store, client, transport };
  }

  afterEach(async () => {
    for (const t of transports) t.close();
    transports.length = 0;
    for (const c of rawClients) c.close();
    rawClients.length = 0;
    for (const s of servers) await s.close();
    servers.length = 0;
  });

  it('rejects a connection with no ?room using close code 4400', async () => {
    const { port } = startServer();
    const c = new WsClient(`ws://127.0.0.1:${port}/`);
    rawClients.push(c);
    let code = 0;
    c.on('close', (cc) => {
      code = cc;
    });
    await waitFor(() => code !== 0);
    expect(code).toBe(4400);
  });

  it('forwards a live op from one client to another in the same room', async () => {
    const { port, backend } = startServer();
    const a = connect(port, 'R');

    // Seed an element from A. Waiting until the hub's canonical room state holds it
    // proves A's socket is open and its upsert reached the relay (deterministic gate).
    const seed = shape();
    a.store.add(seed);
    await waitFor(async () => (await backend.snapshot('R')).some((e) => e.id === seed.id));

    // B joins and requests a snapshot; receiving the seed proves B's socket is open and
    // B is a live member of room R — so any subsequent live op will be forwarded to it.
    const b = connect(port, 'R');
    await waitFor(() => b.store.getById(seed.id) !== undefined);

    // The real assertion: an op added AFTER B joined can only arrive via live forward.
    const live = shape();
    a.store.add(live);
    await waitFor(() => b.store.getById(live.id) !== undefined);

    expect(b.store.getById(live.id)).toBeDefined();
    expect(a.store.count).toBe(2); // seed + live, no duplicate echoed back to A
  }, 10000);

  it('sends the room snapshot to a freshly joined client', async () => {
    const { port, backend } = startServer();
    const a = connect(port, 'R');

    const el = shape();
    a.store.add(el);
    await waitFor(async () => (await backend.snapshot('R')).some((e) => e.id === el.id));

    // A fresh client joins an already-populated room; the hub answers its
    // request-snapshot with the canonical state.
    const b = connect(port, 'R');
    await waitFor(() => b.store.count >= 1);

    expect(b.store.getById(el.id)).toBeDefined();
  }, 10000);

  it('does not leak ops across rooms', async () => {
    const { hub, port, backend } = startServer();
    const a = connect(port, 'R');
    const c = connect(port, 'OTHER');

    // Seed R and confirm A + the OTHER-room client are both registered live members
    // (two distinct rooms exist in the hub → C's OTHER-room connection registered).
    const seed = shape();
    a.store.add(seed);
    await waitFor(async () => (await backend.snapshot('R')).some((e) => e.id === seed.id));
    await waitFor(() => hub.roomCount() === 2);

    // A co-room witness D anchors the negative: once D receives A's live op, the relay's
    // forward loop for room R has completed — so if C (room OTHER) were ever going to
    // receive it, it would have by now.
    const d = connect(port, 'R');
    await waitFor(() => d.store.getById(seed.id) !== undefined);

    const live = shape();
    a.store.add(live);
    await waitFor(() => d.store.getById(live.id) !== undefined);

    expect(c.store.count).toBe(0);
    expect(c.store.getById(seed.id)).toBeUndefined();
    expect(c.store.getById(live.id)).toBeUndefined();
  }, 10000);

  // Short reconnect delays keep the test fast; deterministic jitter via random: () => 0.5.
  const RECONNECT_OPTS: Partial<WebSocketTransportOptions> = {
    reconnectInitialDelayMs: 20,
    reconnectMaxDelayMs: 50,
    random: () => 0.5,
  };

  it('reconnects after an unexpected drop and resumes live sync', async () => {
    const { server, port } = startServer();

    // Capture server-side sockets in connection order so we can force a real network
    // drop by closing the server end (transport.close() would suppress reconnect).
    const sockets: WsClient[] = [];
    server.wss.on('connection', (ws) => sockets.push(ws));

    const a = connect(port, 'R', RECONNECT_OPTS);
    await waitFor(() => sockets.length === 1);
    const b = connect(port, 'R', RECONNECT_OPTS);
    await waitFor(() => sockets.length === 2);

    const shared = shape();
    a.store.add(shared);
    await waitFor(() => b.store.getById(shared.id) !== undefined);

    // Drop BOTH clients by closing their server-side sockets; each transport auto-reconnects.
    for (const ws of sockets) ws.close();
    await waitFor(() => sockets.length >= 4);

    // A live op can only reach B if the real sockets re-opened end-to-end after reconnect.
    const post = shape();
    a.store.add(post);
    await waitFor(() => b.store.getById(post.id) !== undefined);

    expect(b.store.getById(post.id)).toBeDefined();
  }, 10000);

  it('reconciles a deletion missed during the outage on reconnect', async () => {
    const { server, port, backend } = startServer();

    const sockets: WsClient[] = [];
    server.wss.on('connection', (ws) => sockets.push(ws));

    // A uses the default transport and stays connected; only B will be dropped.
    const a = connect(port, 'R');
    await waitFor(() => sockets.length === 1);
    const b = connect(port, 'R', RECONNECT_OPTS);
    await waitFor(() => sockets.length === 2);

    const shared = shape();
    a.store.add(shared);
    await waitFor(() => b.store.getById(shared.id) !== undefined);

    // Drop ONLY B (its server-side socket is sockets[1]); A remains live.
    sockets[1]?.close();

    // While B is away, A deletes the shared element — B never sees the live remove.
    a.store.remove(shared.id);
    await waitFor(async () => !(await backend.snapshot('R')).some((e) => e.id === shared.id));

    // B reconnects, resyncs against the authoritative snapshot, and the deletion is
    // reconciled away. A merge would have KEPT 'shared'; replace-reconcile removes it.
    await waitFor(() => sockets.length >= 3 && b.store.getById(shared.id) === undefined);

    expect(b.store.getById(shared.id)).toBeUndefined();
  }, 10000);

  it('reverts a denied optimistic edit to canonical without a reconnect', async () => {
    const backend = new MemoryHubBackend();
    const server = createSyncServer({
      port: 0,
      backend,
      authenticate: ({ req }) => {
        const role = new URL(req.url ?? '', 'http://x').searchParams.get('role') ?? 'player';
        return { userId: role === 'dm' ? 'dm1' : 'player1', role };
      },
      authorize: ({ role, op, currentElement, userId }) => {
        if (role === 'dm') return true;
        if (op.kind === 'upsert') return !currentElement || currentElement.ownerId === userId;
        return false;
      },
    });
    servers.push(server);
    const port = (server.wss.address() as AddressInfo).port;

    const roleConnect = (role: string): ConnectedClient => {
      const transport = new WebSocketTransport(`ws://127.0.0.1:${port}?room=R&role=${role}`, {
        WebSocket: WsClient as unknown as typeof WebSocket,
      });
      transports.push(transport);
      const store = new ElementStore();
      const client = new SyncClient({ store, transport });
      client.start();
      return { store, client, transport };
    };

    const dm = roleConnect('dm');
    const player = roleConnect('player');

    dm.store.add({
      ...createShape({ position: { x: 1, y: 2 }, size: { width: 3, height: 4 } }),
      id: 'X',
    });
    await waitFor(() => player.store.getById('X') !== undefined);
    const canonical = structuredClone(player.store.getById('X'));
    expect(canonical?.position).toEqual({ x: 1, y: 2 });

    // Player optimistically moves X (DM-owned) → hub denies → sends upsert(canonical).
    player.store.update('X', { position: { x: 999, y: 999 } });
    await waitFor(() => player.store.getById('X')?.position?.x === 1);

    expect(player.store.getById('X')?.position).toEqual({ x: 1, y: 2 });
    expect(player.store.getById('X')).toEqual(canonical);
  }, 10000);
});
