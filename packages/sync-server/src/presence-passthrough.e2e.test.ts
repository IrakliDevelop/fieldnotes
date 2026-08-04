import { describe, it, expect, afterEach } from 'vitest';
import { WebSocket as WsClient } from 'ws';
import type { AddressInfo } from 'net';
import {
  WebSocketTransport,
  createManagedSyncConnection,
  type ManagedSyncConnection,
} from '@fieldnotes/sync';
import { ElementStore, isLaserTrailPresence } from '@fieldnotes/core';
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
 * End-to-end coverage for managed-connection presence passthrough over a real
 * WebSocket relay: the laser-pointer transport path. One client draws (sends
 * laser presence), another receives and can drop the sender on
 * presence-leave; handlers survive a credential rebuild.
 */
describe('managed presence passthrough (end-to-end)', () => {
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

  function startManaged(opts: {
    port: number;
    userId: string;
    mint: () => string | null;
  }): ManagedSyncConnection {
    const connection = createManagedSyncConnection({
      store: new ElementStore(),
      clientId: opts.userId,
      resolveUrl: () => {
        const token = opts.mint();
        if (token === null) return null;
        const user = encodeURIComponent(opts.userId);
        return `ws://127.0.0.1:${opts.port}?room=R&user=${user}&token=${encodeURIComponent(token)}`;
      },
      transportFactory: (url) => {
        const transport = new WebSocketTransport(url, {
          WebSocket: WsClient as unknown as typeof WebSocket,
          reconnectInitialDelayMs: 20,
          reconnectMaxDelayMs: 50,
        });
        transports.push(transport);
        return transport;
      },
      retryInitialDelayMs: 10,
      retryMaxDelayMs: 50,
    });
    connections.push(connection);
    return connection;
  }

  afterEach(async () => {
    for (const c of connections) c.stop();
    connections.length = 0;
    for (const t of transports) t.close();
    transports.length = 0;
    for (const s of servers) await s.close();
    servers.length = 0;
  });

  it('one client draws, the other receives typed laser presence and a leave on disconnect', async () => {
    const valid = new Set(['dm-token', 'player-token']);
    // Throttle off so every sent frame relays deterministically in the test.
    const { port } = startServer(tokenAuthenticate(valid), { presenceThrottleMs: 0 });

    const dm = startManaged({ port, userId: 'dm', mint: () => 'dm-token' });
    const player = startManaged({ port, userId: 'player', mint: () => 'player-token' });

    const received: { from: string; data: unknown }[] = [];
    const leaves: string[] = [];
    player.onPresence((from, data) => received.push({ from, data }));
    player.onPresenceLeave((from) => leaves.push(from));

    await waitFor(() => dm.getStatus() === 'live' && player.getStatus() === 'live');

    const payload = {
      kind: 'laser',
      points: [
        { x: 10, y: 20 },
        { x: 30, y: 40 },
      ],
      color: '#ff3b30',
      width: 4,
      fadeMs: 1200,
    };
    dm.sendPresence(payload);

    await waitFor(() => received.length === 1);
    const frame = received[0];
    expect(frame?.data).toEqual(payload);
    expect(isLaserTrailPresence(frame?.data)).toBe(true);
    // The relay stamps its server-owned connection id, not the clientId —
    // an opaque per-sender trail key.
    expect(frame?.from).not.toBe('dm');
    expect(frame?.from).not.toBe('player');

    // The DM disconnects: the player learns the same sender key left, so a
    // remote trail keyed by `from` can be removed immediately.
    dm.stop();
    await waitFor(() => leaves.length === 1);
    expect(leaves[0]).toBe(frame?.from);
  }, 10000);

  it('presence handlers survive a 4401 credential rebuild without re-subscribing', async () => {
    const valid = new Set(['peer-token']);
    let mints = 0;
    const { server, port } = startServer(tokenAuthenticate(valid), { presenceThrottleMs: 0 });

    const receiver = startManaged({
      port,
      userId: 'receiver',
      mint: () => {
        mints += 1;
        const token = `r-t-${mints}`;
        valid.add(token);
        return token;
      },
    });
    const sender = startManaged({ port, userId: 'sender', mint: () => 'peer-token' });

    const received: unknown[] = [];
    receiver.onPresence((_from, data) => received.push(data));
    await waitFor(() => receiver.getStatus() === 'live' && sender.getStatus() === 'live');

    // Expire the receiver's token and drop every socket: the receiver's
    // transport reconnect gets 4401 and the manager rebuilds with a fresh
    // token; the sender reconnects transiently.
    valid.delete('r-t-1');
    for (const ws of server.wss.clients) ws.terminate();
    await waitFor(() => mints === 2);
    await waitFor(() => receiver.getStatus() === 'live' && sender.getStatus() === 'live');

    sender.sendPresence({ kind: 'laser', points: [{ x: 1, y: 2 }] });
    await waitFor(() => received.length >= 1);
    expect(received).toContainEqual({ kind: 'laser', points: [{ x: 1, y: 2 }] });
  }, 10000);
});
