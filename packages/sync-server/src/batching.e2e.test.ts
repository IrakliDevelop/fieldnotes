import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket as WsClient } from 'ws';
import type { AddressInfo } from 'net';
import {
  SyncClient,
  WebSocketTransport,
  createCurrentCapabilities,
  createManagedAuthorityConnection,
  type ManagedAuthorityConnection,
  type SyncOp,
  type SyncTransport,
} from '@fieldnotes/sync';
import { ElementStore } from '@fieldnotes/core';
import { createSyncServer, type CreateSyncServerOptions } from './create-sync-server';
import { v2Shape } from './test-support/v2-ops';

type Server = ReturnType<typeof createSyncServer>;

const servers: Server[] = [];
const clients: SyncClient[] = [];
const transports: WebSocketTransport[] = [];
const sockets: WsClient[] = [];
const managers: ManagedAuthorityConnection[] = [];

afterEach(async () => {
  for (const manager of managers) manager.stop();
  managers.length = 0;
  for (const client of clients) client.stop();
  clients.length = 0;
  for (const transport of transports) transport.close();
  transports.length = 0;
  for (const socket of sockets) socket.close();
  sockets.length = 0;
  for (const server of servers) await server.close();
  servers.length = 0;
});

function startServer(options: Omit<CreateSyncServerOptions, 'port'> = {}): number {
  const server = createSyncServer({ port: 0, ...options });
  servers.push(server);
  return (server.wss.address() as AddressInfo).port;
}

/** Counts the element frames a client sends; `hideBatching` makes the hub look like 0.28. */
function connectClient(port: number, hideBatching = false) {
  const inner = new WebSocketTransport(`ws://127.0.0.1:${port}?room=R`, {
    WebSocket: WsClient as unknown as typeof WebSocket,
  });
  transports.push(inner);
  const sent: SyncOp['kind'][] = [];
  const transport: SyncTransport = {
    send(message) {
      const kind = (JSON.parse(message) as { op: SyncOp }).op.kind;
      if (kind === 'upsert' || kind === 'remove' || kind === 'batch') sent.push(kind);
      inner.send(message);
    },
    onMessage: (handler) =>
      inner.onMessage((message) => {
        if (!hideBatching) return handler(message);
        const env = JSON.parse(message) as { from: string; op: SyncOp };
        if (env.op.kind !== 'capabilities') return handler(message);
        const capabilities = { ...env.op.capabilities, opBatching: undefined };
        handler(JSON.stringify({ ...env, op: { kind: 'capabilities', capabilities } }));
      }),
    close: () => inner.close(),
  };
  const store = new ElementStore();
  const client = new SyncClient({ store, transport });
  client.start();
  clients.push(client);
  return { store, sent };
}

async function connectRaw(port: number): Promise<{ socket: WsClient; frames: string[] }> {
  const socket = new WsClient(`ws://127.0.0.1:${port}?room=R`);
  sockets.push(socket);
  const frames: string[] = [];
  socket.on('message', (data) => frames.push(String(data)));
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
  return { socket, frames };
}

function positions(store: ElementStore): string {
  return JSON.stringify(
    store
      .getAll()
      .map((element) => [element.id, element.position])
      .sort(),
  );
}

/** Every element dragged at 120 Hz for 1.5 s, then erased one per tick until 2 s have passed. */
async function dragAndErase(store: ElementStore): Promise<void> {
  const ids = store.getAll().map((element) => element.id);
  const start = Date.now();
  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      const elapsed = Date.now() - start;
      if (elapsed < 1500) {
        for (const id of ids) store.update(id, { position: { x: elapsed, y: elapsed } });
      } else {
        const id = ids.shift();
        if (id !== undefined) store.remove(id);
      }
      if (elapsed >= 2000) {
        clearInterval(timer);
        resolve();
      }
    }, 8);
  });
}

async function seed(port: number, hideBatching = false) {
  const dragger = connectClient(port, hideBatching);
  const watcher = connectClient(port);
  for (let i = 0; i < 50; i++) {
    dragger.store.add({
      ...v2Shape({ position: { x: 0, y: 0 }, size: { w: 1, h: 1 } }),
      id: `e${i}`,
    });
  }
  await vi.waitFor(() => expect(watcher.store.getAll()).toHaveLength(50), { timeout: 5_000 });
  dragger.sent.length = 0;
  return { dragger, watcher };
}

describe('element op batching (end-to-end)', () => {
  it('keeps a 120 Hz drag and eraser pass to at most 42 element frames over 2 s and converges', async () => {
    const port = startServer();
    const { dragger, watcher } = await seed(port);

    await dragAndErase(dragger.store);

    await vi.waitFor(() => expect(positions(watcher.store)).toBe(positions(dragger.store)), {
      timeout: 5_000,
    });
    expect(dragger.sent.length).toBeLessThanOrEqual(42);
    expect(dragger.sent).toContain('batch');
    expect(watcher.store.getAll()).toHaveLength(dragger.store.getAll().length);
  }, 15_000);

  it('sends individual ops to a hub that did not advertise opBatching and converges', async () => {
    const port = startServer();
    const { dragger, watcher } = await seed(port, true);

    for (let x = 1; x <= 5; x++) dragger.store.update('e0', { position: { x, y: x } });
    dragger.store.remove('e1');

    await vi.waitFor(() => expect(positions(watcher.store)).toBe(positions(dragger.store)));
    expect(dragger.sent.length).toBeGreaterThan(0);
    expect(dragger.sent).not.toContain('batch');
  });

  it('closes a connection over the configured op budget with 4408', async () => {
    const port = startServer({ opsPerSecond: 1, opBurst: 2 });
    const { socket } = await connectRaw(port);
    const ops = [1, 2, 3].map((i) => ({
      kind: 'upsert',
      element: { ...v2Shape({ position: { x: 0, y: 0 }, size: { w: 1, h: 1 } }), id: `o${i}` },
    }));
    const code = new Promise<number>((resolve) => socket.once('close', resolve));
    socket.send(JSON.stringify({ from: 'raw', op: { kind: 'batch', ops } }));
    expect(await code).toBe(4408);
  });
});

describe('unsupported reply (end-to-end)', () => {
  const v1 = JSON.stringify({
    from: 'old',
    op: {
      kind: 'capabilities',
      capabilities: { ...createCurrentCapabilities([]), protocolVersion: 1 },
    },
  });

  it.each([
    ['without a frame policy', {}],
    // A slow outbound authorize: the reply arrives only if the hub awaits the guarded send.
    [
      'with a slow frame policy',
      {
        framePolicy: {
          authorize: () => new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 200)),
        },
      },
    ],
  ])('arrives before the 4406 close %s', async (_name, options) => {
    const port = startServer(options);
    const { socket, frames } = await connectRaw(port);
    const code = new Promise<number>((resolve) => socket.once('close', resolve));
    socket.send(v1);
    expect(await code).toBe(4406);
    expect(frames.map((frame) => JSON.parse(frame) as unknown)).toEqual([
      {
        from: 'hub',
        op: {
          kind: 'unsupported',
          protocolVersion: 2,
          minProtocolVersion: 2,
          reason: 'protocol version 2 required',
        },
      },
    ]);
  });

  it('still reports upgrade-required to an authority client on a legacy room', async () => {
    const port = startServer();
    const manager = createManagedAuthorityConnection({
      scopeId: 'legacy/R',
      clientId: 'legacy',
      resolveUrl: () => ({ url: `ws://127.0.0.1:${port}?room=R` }),
    });
    managers.push(manager);
    await vi.waitFor(() => expect(manager.getState().status).toBe('upgrade-required'), {
      timeout: 5_000,
    });
  });
});
