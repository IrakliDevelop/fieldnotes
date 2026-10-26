import { describe, it, expect, afterEach } from 'vitest';
import { WebSocket as WsClient } from 'ws';
import type { AddressInfo } from 'net';
import { SyncClient, WebSocketTransport, createCurrentCapabilities } from '@fieldnotes/sync';
import { ElementStore, createShape } from '@fieldnotes/core';
import { createSyncServer, type CreateSyncServerOptions } from './create-sync-server';
import { MemoryHubBackend } from './memory-hub-backend';
import { InMemoryHubFanout, type HubFanout } from './hub-fanout';
import type { Authenticate } from './authenticate';
import type { Authorize, CanRead } from './authorize';

type Server = ReturnType<typeof createSyncServer>;

async function waitFor(cond: () => boolean | Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!(await cond())) {
    if (Date.now() - start > timeoutMs) throw new Error(`waitFor: not met within ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** Holds fanned-out clears until released, so a later upsert overtakes them on other instances. */
class ClearHoldingFanout implements HubFanout {
  private readonly bus = new InMemoryHubFanout();
  private held: string[] = [];

  publish(payload: string): void {
    if (payload.includes('"kind":"clear"')) this.held.push(payload);
    else this.bus.publish(payload);
  }

  subscribe(handler: (payload: string) => void): () => void {
    return this.bus.subscribe(handler);
  }

  get holding(): number {
    return this.held.length;
  }

  release(): void {
    for (const payload of this.held) this.bus.publish(payload);
    this.held = [];
  }
}

const shape = (id: string, x: number): ReturnType<typeof createShape> => ({
  ...createShape({ index: 'a0', position: { x, y: x }, size: { w: 1, h: 1 } }),
  id,
});

const authenticate: Authenticate = ({ token }) =>
  token ? { userId: token, role: token === 'gm' ? 'gm' : 'player' } : null;
const authorize: Authorize = ({ role, op, currentElement, userId }) =>
  role === 'gm' || (op.kind !== 'clear' && (!currentElement || currentElement.ownerId === userId));
const canRead: CanRead = ({ role, audience }) => audience !== 'gm' || role === 'gm';

describe('element versioning (end-to-end)', () => {
  const servers: Server[] = [];
  const clients: SyncClient[] = [];
  const transports: WebSocketTransport[] = [];
  const sockets: WsClient[] = [];

  function startServer(options: Omit<CreateSyncServerOptions, 'port'>): number {
    const server = createSyncServer({ port: 0, authenticate, authorize, canRead, ...options });
    servers.push(server);
    return (server.wss.address() as AddressInfo).port;
  }

  function connectClient(port: number, user: string): ElementStore {
    const transport = new WebSocketTransport(`ws://127.0.0.1:${port}?room=R&token=${user}`, {
      WebSocket: WsClient as unknown as typeof WebSocket,
    });
    transports.push(transport);
    const store = new ElementStore();
    const client = new SyncClient({ store, transport, clientId: `${user}-peer` });
    client.start();
    clients.push(client);
    return store;
  }

  async function connectRaw(
    port: number,
    user: string,
  ): Promise<{ socket: WsClient; frames: string[] }> {
    const socket = new WsClient(`ws://127.0.0.1:${port}?room=R&token=${user}`);
    sockets.push(socket);
    const frames: string[] = [];
    socket.on('message', (data) => frames.push(String(data)));
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });
    socket.send(
      JSON.stringify({
        from: `${user}-peer`,
        op: { kind: 'capabilities', capabilities: createCurrentCapabilities([]) },
      }),
    );
    await waitFor(() => frames.some((frame) => frame.includes('"kind":"capabilities"')));
    frames.length = 0;
    return { socket, frames };
  }

  afterEach(async () => {
    for (const client of clients) client.stop();
    clients.length = 0;
    for (const transport of transports) transport.close();
    transports.length = 0;
    for (const socket of sockets) socket.close();
    sockets.length = 0;
    for (const server of servers) await server.close();
    servers.length = 0;
  });

  it('a filtered clear never names a GM-only id to a player, and a newer upsert that overtakes it survives', async () => {
    const backend = new MemoryHubBackend();
    const fanout = new ClearHoldingFanout();
    const gmPort = startServer({ backend, fanout });
    const playerPort = startServer({ backend, fanout });
    const gm = connectClient(gmPort, 'gm');
    const player = connectClient(playerPort, 'p1');
    const watcher = await connectRaw(playerPort, 'p2');

    gm.add(shape('open', 0));
    const secret = { ...shape('secret', 0), audience: 'gm' };
    gm.add(secret);
    await waitFor(() => player.getById('open') !== undefined);
    await waitFor(async () => (await backend.getRecord('R', 'secret')) !== undefined);

    gm.clear();
    await waitFor(() => fanout.holding === 1);
    gm.add(shape('open', 5));
    await waitFor(() => player.getById('open')?.version === 3);
    fanout.release();
    await waitFor(() => watcher.frames.some((frame) => frame.includes('"kind":"clear"')));

    expect(player.getById('open')).toMatchObject({ version: 3, position: { x: 5, y: 5 } });
    const clear = watcher.frames.find((frame) => frame.includes('"kind":"clear"'));
    expect(JSON.parse(clear ?? '').op.tombstones).toEqual([
      { id: 'open', version: 2, editor: expect.any(String) },
    ]);
    expect(watcher.frames.join('')).not.toContain('secret');

    watcher.socket.send(JSON.stringify({ from: 'p2-peer', op: { kind: 'request-snapshot' } }));
    await waitFor(() => watcher.frames.some((frame) => frame.includes('"kind":"snapshot"')));
    const snapshot = watcher.frames.find((frame) => frame.includes('"kind":"snapshot"')) ?? '';
    expect(snapshot).not.toMatch(/secret|ownerId|removedBy|removedAt/);
  });
});
