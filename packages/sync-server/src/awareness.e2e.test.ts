import { describe, it, expect, afterEach } from 'vitest';
import { WebSocket as WsClient } from 'ws';
import type { AddressInfo } from 'net';
import {
  WebSocketTransport,
  createManagedSyncConnection,
  type ManagedSyncConnection,
} from '@fieldnotes/sync';
import { ElementStore, PeerRoster } from '@fieldnotes/core';
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
 * End-to-end coverage for awareness presence over a real WebSocket relay:
 * discovery through the join re-announce, leave, and per-kind throttle lane
 * isolation so an awareness cursor stream never swallows a ping or a
 * path-cleared frame.
 */
describe('awareness over the relay (end-to-end)', () => {
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

  it('a late joiner discovers an idle peer through the join re-announce, and leave drops it', async () => {
    const valid = new Set(['a-token', 'b-token']);
    const { port } = startServer(tokenAuthenticate(valid), { presenceThrottleMs: 0 });

    const a = startManaged({ port, userId: 'a', mint: () => 'a-token' });
    const rosterA = new PeerRoster();
    const frameA = { kind: 'awareness', id: 'ada', name: 'Ada', tool: 'select' };
    let announcesA = 0;
    a.onPresence((from, data) => rosterA.apply(from, data));
    a.onPresenceLeave((from) => rosterA.remove(from));
    rosterA.onDiscover(() => {
      announcesA++;
      a.sendPresence(frameA);
    });
    const rosterB = new PeerRoster();
    try {
      await waitFor(() => a.getStatus() === 'live');
      a.sendPresence(frameA);

      // B joins later; A has been idle since its only frame.
      const b = startManaged({ port, userId: 'b', mint: () => 'b-token' });
      b.onPresence((from, data) => rosterB.apply(from, data));
      b.onPresenceLeave((from) => rosterB.remove(from));
      await waitFor(() => b.getStatus() === 'live');
      b.sendPresence({ kind: 'awareness', id: 'bob', name: 'Bob' });

      await waitFor(() => rosterB.getPeers().some((p) => p.id === 'ada'));
      expect(rosterA.getPeers().map((p) => p.id)).toEqual(['bob']);
      expect(announcesA).toBe(1);

      // More frames from B never re-trigger A. The recreate frame below uses a
      // distinct name so this wait cannot be satisfied by B's earlier frame:
      // it forces the test to actually observe the post-`cleared` frame
      // before asserting that A stayed silent.
      b.sendPresence({ kind: 'awareness', id: 'bob', name: 'Bob', cursor: { x: 1, y: 1 } });
      b.sendPresence({ kind: 'awareness', id: 'bob', cleared: true });
      b.sendPresence({ kind: 'awareness', id: 'bob', name: 'Bob again' });
      await waitFor(() => rosterA.getPeers().some((p) => p.name === 'Bob again'));
      expect(announcesA).toBe(1);

      b.stop();
      await waitFor(() => rosterA.getPeers().length === 0);
    } finally {
      rosterA.dispose();
      rosterB.dispose();
    }
  }, 10000);

  it('a cursor stream through the real throttle never swallows a ping or a path cleared', async () => {
    const valid = new Set(['a-token', 'b-token']);
    const { port } = startServer(tokenAuthenticate(valid), { presenceThrottleMs: 50 });
    const a = startManaged({ port, userId: 'a', mint: () => 'a-token' });
    const b = startManaged({ port, userId: 'b', mint: () => 'b-token' });
    const frames: unknown[] = [];
    b.onPresence((_from, data) => frames.push(data));
    await waitFor(() => a.getStatus() === 'live' && b.getStatus() === 'live');

    const stop = setInterval(
      () => a.sendPresence({ kind: 'awareness', id: 'ada', cursor: { x: Math.random(), y: 0 } }),
      5,
    );
    await new Promise((r) => setTimeout(r, 30));
    a.sendPresence({ kind: 'ping', x: 1, y: 2 });
    a.sendPresence({ kind: 'path', points: [{ x: 0, y: 0 }], segmentColors: [], feet: 0 });
    a.sendPresence({ kind: 'path', cleared: true });
    await new Promise((r) => setTimeout(r, 150));
    clearInterval(stop);
    await new Promise((r) => setTimeout(r, 100));

    const kinds = frames.map((f) => (f as { kind: string }).kind);
    const pathFrames = frames.filter((f) => (f as { kind: string }).kind === 'path');
    expect(kinds.filter((k) => k === 'ping')).toHaveLength(1);
    expect(pathFrames).toHaveLength(2);
    expect(pathFrames.at(-1)).toEqual({ kind: 'path', cleared: true });
    expect(kinds.filter((k) => k === 'awareness').length).toBeGreaterThanOrEqual(3);
  }, 10000);
});
