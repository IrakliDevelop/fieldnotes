import { describe, it, expect, afterEach } from 'vitest';
import { WebSocket as WsClient } from 'ws';
import type { AddressInfo } from 'net';
import { SyncClient, WebSocketTransport } from '@fieldnotes/sync';
import { ElementStore, createShape } from '@fieldnotes/core';
import { createSyncServer } from './create-sync-server';
import type { Authenticate } from './authenticate';

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

describe('sync-server authentication (end-to-end)', () => {
  const servers: Server[] = [];
  const transports: WebSocketTransport[] = [];
  const rawSockets: WsClient[] = [];

  function startServer(authenticate: Authenticate) {
    const server = createSyncServer({ port: 0, authenticate });
    servers.push(server);
    const port = (server.wss.address() as AddressInfo).port;
    return { server, port };
  }

  function connect(port: number, room: string, query = ''): ConnectedClient {
    const transport = new WebSocketTransport(`ws://127.0.0.1:${port}?room=${room}${query}`, {
      WebSocket: WsClient as unknown as typeof WebSocket,
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
    for (const c of rawSockets) c.close();
    rawSockets.length = 0;
    for (const s of servers) await s.close();
    servers.length = 0;
  });

  it('accepts an authenticated connection and syncs normally', async () => {
    const { port } = startServer(() => ({ userId: 'u1', role: 'dm' }));
    const a = connect(port, 'R');
    const b = connect(port, 'R');

    a.store.add({
      ...createShape({ position: { x: 1, y: 2 }, size: { width: 3, height: 4 } }),
      id: 'e1',
    });

    await waitFor(() => b.store.getById('e1') !== undefined);
    expect(b.store.getById('e1')).toBeDefined();
  }, 10000);

  it('rejects with close code 4401 and never admits (no snapshot served)', async () => {
    const { port } = startServer(() => null);

    let closeCode = 0;
    let gotMessage = false;
    const c = new WsClient(`ws://127.0.0.1:${port}?room=R`);
    rawSockets.push(c);
    c.on('close', (code) => {
      closeCode = code;
    });
    c.on('message', () => {
      gotMessage = true;
    });
    c.on('open', () => c.send(JSON.stringify({ from: 'x', op: { kind: 'request-snapshot' } })));

    await waitFor(() => closeCode !== 0);
    expect(closeCode).toBe(4401);
    // Discriminating: the connection is rejected BEFORE admission, so the queued
    // request-snapshot is dropped and no snapshot is ever sent. Without the
    // never-admit guarantee the hub would answer request-snapshot and gotMessage → true.
    expect(gotMessage).toBe(false);
  }, 10000);

  it('accepts a good token and rejects a bad token', async () => {
    const { port } = startServer(({ req }) => {
      const t = new URL(req.url ?? '', 'http://x').searchParams.get('token');
      return t === 'good' ? { userId: 'u1' } : null;
    });

    const a = connect(port, 'R', '&token=good');
    const b = connect(port, 'R', '&token=good');
    a.store.add({
      ...createShape({ position: { x: 0, y: 0 }, size: { width: 5, height: 5 } }),
      id: 'ok1',
    });
    await waitFor(() => b.store.getById('ok1') !== undefined);
    expect(b.store.getById('ok1')).toBeDefined();

    let closeCode = 0;
    const bad = new WsClient(`ws://127.0.0.1:${port}?room=R&token=bad`);
    rawSockets.push(bad);
    bad.on('close', (code) => {
      closeCode = code;
    });
    await waitFor(() => closeCode !== 0);
    expect(closeCode).toBe(4401);
  }, 10000);

  it('replays a request-snapshot queued during async auth (the race)', async () => {
    const { port } = startServer(async () => {
      await new Promise((r) => setTimeout(r, 40));
      return { userId: 'u1' };
    });

    const a = connect(port, 'R');
    a.store.add({
      ...createShape({ position: { x: 7, y: 8 }, size: { width: 9, height: 9 } }),
      id: 'e1',
    });
    await waitFor(() => a.store.getById('e1') !== undefined);

    // B's SyncClient fires request-snapshot on socket-open, BEFORE B's 40ms auth
    // resolves. That message is queued during the pending window and replayed after
    // admission. Without the queue/replay it would be dropped and B never gets e1.
    const b = connect(port, 'R');
    await waitFor(() => b.store.getById('e1') !== undefined);
    expect(b.store.getById('e1')).toBeDefined();
  }, 10000);
});
