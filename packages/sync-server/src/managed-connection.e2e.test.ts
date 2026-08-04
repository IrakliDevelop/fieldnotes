import { describe, it, expect, afterEach } from 'vitest';
import { WebSocket as WsClient } from 'ws';
import type { AddressInfo } from 'net';
import {
  SyncClient,
  WebSocketTransport,
  createManagedSyncConnection,
  type ManagedSyncConnection,
  type ManagedSyncStatus,
} from '@fieldnotes/sync';
import { ElementStore, createShape } from '@fieldnotes/core';
import { createSyncServer, type CreateSyncServerOptions } from './create-sync-server';
import type { Authenticate } from './authenticate';

type Server = ReturnType<typeof createSyncServer>;

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

/**
 * End-to-end coverage for `createManagedSyncConnection` against a real
 * WebSocket relay: authenticated connect, transient-drop reconnect,
 * expired-token refresh after 4401, and bounded denial.
 */
describe('managed sync connection (end-to-end)', () => {
  const servers: Server[] = [];
  const connections: ManagedSyncConnection[] = [];
  const transports: WebSocketTransport[] = [];

  function startServer(
    authenticate: Authenticate,
    options: Omit<CreateSyncServerOptions, 'port' | 'authenticate'> = {},
  ) {
    const server = createSyncServer({ port: 0, authenticate, ...options });
    servers.push(server);
    const port = (server.wss.address() as AddressInfo).port;
    return { server, port };
  }

  function tokenAuthenticate(validTokens: Set<string>): Authenticate {
    return ({ req }) => {
      const url = new URL(req.url ?? '', 'http://x');
      const token = url.searchParams.get('token');
      const user = url.searchParams.get('user');
      if (!token || !user || !validTokens.has(token)) return null;
      return { userId: user };
    };
  }

  function fastTransportFactory(url: string): WebSocketTransport {
    const transport = new WebSocketTransport(url, {
      WebSocket: WsClient as unknown as typeof WebSocket,
      reconnectInitialDelayMs: 20,
      reconnectMaxDelayMs: 50,
    });
    transports.push(transport);
    return transport;
  }

  function startManaged(opts: {
    port: number;
    userId: string;
    store: ElementStore;
    mint: () => string | null | Promise<string | null>;
    statuses: ManagedSyncStatus[];
    maxAuthFailures?: number;
  }): ManagedSyncConnection {
    const connection = createManagedSyncConnection({
      store: opts.store,
      clientId: opts.userId, // stable identity: clientId === authenticated userId
      resolveUrl: async () => {
        const token = await opts.mint();
        if (token === null) return null;
        const user = encodeURIComponent(opts.userId);
        return `ws://127.0.0.1:${opts.port}?room=R&user=${user}&token=${encodeURIComponent(token)}`;
      },
      onStatus: (s) => opts.statuses.push(s),
      transportFactory: fastTransportFactory,
      retryInitialDelayMs: 10,
      retryMaxDelayMs: 50,
      maxAuthFailures: opts.maxAuthFailures,
    });
    connections.push(connection);
    return connection;
  }

  function connectPeer(port: number, userId: string, token: string) {
    const transport = new WebSocketTransport(
      `ws://127.0.0.1:${port}?room=R&user=${userId}&token=${token}`,
      { WebSocket: WsClient as unknown as typeof WebSocket },
    );
    transports.push(transport);
    const store = new ElementStore();
    const client = new SyncClient({ store, transport, clientId: userId });
    client.start();
    return { store, client, transport };
  }

  afterEach(async () => {
    for (const c of connections) c.stop();
    connections.length = 0;
    for (const t of transports) t.close();
    transports.length = 0;
    for (const s of servers) await s.close();
    servers.length = 0;
  });

  it('authenticates, receives the authoritative snapshot, and goes live', async () => {
    const valid = new Set(['peer-token', 'managed-token']);
    const { server, port } = startServer(tokenAuthenticate(valid));

    const peer = connectPeer(port, 'u-peer', 'peer-token');
    peer.store.add({
      ...createShape({ position: { x: 1, y: 2 }, size: { w: 3, h: 4 } }),
      id: 'seed-1',
    });
    await waitFor(() => server.hub.roomCount() === 1);

    const store = new ElementStore();
    const statuses: ManagedSyncStatus[] = [];
    const managed = startManaged({
      port,
      userId: 'u-managed',
      store,
      mint: () => 'managed-token',
      statuses,
    });

    await waitFor(() => managed.getStatus() === 'live');
    expect(statuses).toEqual(['connecting', 'live']);
    // Live arrived with the authoritative snapshot, so the seed element is present.
    await waitFor(() => store.getById('seed-1') !== undefined);
  }, 10000);

  it('survives a transient server drop through transport reconnect without re-minting', async () => {
    const valid = new Set(['t-1', 'peer-token']);
    let mints = 0;
    const { server, port } = startServer(tokenAuthenticate(valid));

    const store = new ElementStore();
    const statuses: ManagedSyncStatus[] = [];
    const managed = startManaged({
      port,
      userId: 'u1',
      store,
      mint: () => {
        mints += 1;
        return 't-1';
      },
      statuses,
    });
    await waitFor(() => managed.getStatus() === 'live');

    // Ungraceful server-side drop (1006): the transport owns this reconnect.
    for (const ws of server.wss.clients) ws.terminate();
    await waitFor(() => statuses.includes('offline'));
    await waitFor(() => managed.getStatus() === 'live');

    expect(statuses).toEqual(['connecting', 'live', 'offline', 'connecting', 'live']);
    expect(mints).toBe(1); // frozen URL reused; no credential refresh for a transient drop

    // The surviving connection still pushes local ops to other room members.
    const peer = connectPeer(port, 'u-peer', 'peer-token');
    store.add({
      ...createShape({ position: { x: 5, y: 5 }, size: { w: 2, h: 2 } }),
      id: 'after-reconnect',
    });
    await waitFor(() => peer.store.getById('after-reconnect') !== undefined);
  }, 10000);

  it('refreshes an expired token after 4401 and returns to live', async () => {
    const valid = new Set<string>();
    let mints = 0;
    const { server, port } = startServer(tokenAuthenticate(valid));

    const store = new ElementStore();
    const statuses: ManagedSyncStatus[] = [];
    const managed = startManaged({
      port,
      userId: 'u1',
      store,
      mint: () => {
        mints += 1;
        const token = `t-${mints}`;
        valid.add(token);
        return token;
      },
      statuses,
    });
    await waitFor(() => managed.getStatus() === 'live');
    expect(mints).toBe(1);

    // Expire the current token, then drop the socket. The transport reconnects
    // with the frozen expired URL, the server closes 4401, and the manager
    // must mint a fresh token and rebuild.
    valid.delete('t-1');
    for (const ws of server.wss.clients) ws.terminate();

    await waitFor(() => mints === 2);
    await waitFor(() => managed.getStatus() === 'live');
    expect(statuses).toContain('offline');
    expect(statuses[statuses.length - 1]).toBe('live');
  }, 10000);

  it('settles on denied after bounded consecutive authentication failures', async () => {
    let mints = 0;
    const { port } = startServer(() => null);

    const store = new ElementStore();
    const statuses: ManagedSyncStatus[] = [];
    const managed = startManaged({
      port,
      userId: 'u1',
      store,
      mint: () => {
        mints += 1;
        return `t-${mints}`;
      },
      statuses,
      maxAuthFailures: 2,
    });

    await waitFor(() => managed.getStatus() === 'denied');
    expect(mints).toBe(2);

    // Denied is terminal: no further mint or reconnect activity.
    await new Promise((r) => setTimeout(r, 150));
    expect(mints).toBe(2);
    expect(statuses[statuses.length - 1]).toBe('denied');
  }, 10000);
});
