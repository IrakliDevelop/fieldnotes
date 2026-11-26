import { describe, it, expect, afterEach } from 'vitest';
import { WebSocket as WsClient } from 'ws';
import type { AddressInfo } from 'net';
import {
  SyncClient,
  WebSocketTransport,
  createManagedSyncConnection,
  type ManagedSyncConnection,
  type RemoteLayerUpdate,
} from '@fieldnotes/sync';
import { ElementStore, createShape, type Layer } from '@fieldnotes/core';
import { createSyncServer, type CreateSyncServerOptions } from './create-sync-server';
import { MemoryHubBackend } from './memory-hub-backend';
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

function layerDef(id: string, overrides: Partial<Layer> = {}): Layer {
  return {
    id,
    name: id,
    visible: true,
    locked: false,
    order: 0,
    opacity: 1,
    ...overrides,
  };
}

/**
 * End-to-end layer-definition sync over a real WebSocket relay: live
 * propagation, late-join and reconnect convergence on identical records,
 * layer-before-element ordering, and mixed rooms with clients that never
 * opted in.
 */
describe('layer-definition sync (end-to-end)', () => {
  const servers: Server[] = [];
  const connections: ManagedSyncConnection[] = [];
  const transports: WebSocketTransport[] = [];
  const clients: SyncClient[] = [];

  function startServer(options: Omit<CreateSyncServerOptions, 'port'> = {}) {
    const server = createSyncServer({ port: 0, allowAnonymous: !options.authenticate, ...options });
    servers.push(server);
    const port = (server.wss.address() as AddressInfo).port;
    return { server, port };
  }

  function connectPeer(
    port: number,
    userId: string,
    options: { layers?: boolean; token?: string; role?: string } = {},
  ) {
    const token = options.token ? `&token=${encodeURIComponent(options.token)}` : '';
    const role = options.role ? `&role=${options.role}` : '';
    const transport = new WebSocketTransport(
      `ws://127.0.0.1:${port}?room=R&user=${userId}${token}${role}`,
      {
        WebSocket: WsClient as unknown as typeof WebSocket,
        reconnectInitialDelayMs: 20,
        reconnectMaxDelayMs: 50,
      },
    );
    transports.push(transport);
    const received: string[] = [];
    transport.onMessage((m) => received.push(m));
    const store = new ElementStore();
    const events: string[] = [];
    const applied = new Map<string, RemoteLayerUpdate>();
    store.on('add', (el) => events.push(`element:${el.id}`));
    const client = new SyncClient({
      store,
      transport,
      clientId: userId,
      ...(options.layers === false
        ? {}
        : {
            layers: {
              applyLayer: (update) => {
                events.push(`layer:${update.record.id}`);
                applied.set(update.record.id, update);
              },
            },
          }),
    });
    client.start();
    clients.push(client);
    return { store, client, transport, events, applied, received };
  }

  afterEach(async () => {
    for (const c of connections) c.stop();
    connections.length = 0;
    for (const c of clients) c.stop();
    clients.length = 0;
    for (const t of transports) t.close();
    transports.length = 0;
    for (const s of servers) await s.close();
    servers.length = 0;
  });

  it('propagates definitions live, and a late joiner converges with layers applied before elements', async () => {
    const backend = new MemoryHubBackend();
    const { port } = startServer({ backend });

    const dm = connectPeer(port, 'dm');
    const live = connectPeer(port, 'p1');

    dm.client.publishLayerUpsert(layerDef('layer-map', { order: 0, locked: true }));
    dm.client.publishLayerUpsert(layerDef('layer-annotations', { order: 100 }));
    await waitFor(() => live.applied.size === 2);
    expect(live.applied.get('layer-map')?.record.definition?.locked).toBe(true);

    // An element referencing a synced layer, then a late joiner: the join
    // snapshot must apply the referenced layer before the element lands.
    dm.store.add({
      ...createShape({ position: { x: 1, y: 1 }, size: { w: 2, h: 2 } }),
      id: 'token-1',
      layerId: 'layer-annotations',
    });
    await waitFor(async () => (await backend.getRecord('R', 'token-1'))?.kind === 'element');

    const late = connectPeer(port, 'p2');
    await waitFor(() => late.store.getById('token-1') !== undefined);
    expect(late.applied.size).toBe(2);
    const layerIndex = late.events.indexOf('layer:layer-annotations');
    const elementIndex = late.events.indexOf('element:token-1');
    expect(layerIndex).toBeGreaterThanOrEqual(0);
    expect(layerIndex).toBeLessThan(elementIndex);

    // Both connected clients hold identical records for every layer.
    for (const id of ['layer-map', 'layer-annotations']) {
      expect(late.applied.get(id)?.record).toEqual(live.applied.get(id)?.record);
    }
  }, 10000);

  it('a client that never opted in keeps element sync working amid layer traffic', async () => {
    const { port } = startServer();

    const dm = connectPeer(port, 'dm');
    const old = connectPeer(port, 'legacy', { layers: false });
    dm.client.publishLayerUpsert(layerDef('layer-x'));
    dm.store.add({
      ...createShape({ position: { x: 3, y: 3 }, size: { w: 1, h: 1 } }),
      id: 'el-1',
    });

    await waitFor(() => old.store.getById('el-1') !== undefined);
    expect(old.events.filter((e) => e.startsWith('layer:'))).toEqual([]);

    // The non-opted client still writes elements back into the room.
    old.store.add({
      ...createShape({ position: { x: 4, y: 4 }, size: { w: 1, h: 1 } }),
      id: 'el-2',
    });
    await waitFor(() => dm.store.getById('el-2') !== undefined);
  }, 10000);

  it('a reconnecting managed client re-pushes offline layer edits and the room converges', async () => {
    const valid = new Set<string>(['peer-token']);
    const backend = new MemoryHubBackend();
    const authenticate: Authenticate = ({ req }) => {
      const url = new URL(req.url ?? '', 'http://x');
      const token = url.searchParams.get('token');
      const user = url.searchParams.get('user');
      if (!token || !user || !valid.has(token)) return null;
      return { userId: user };
    };
    const { server, port } = startServer({ backend, authenticate });

    let allowMint = true;
    let mintAttempts = 0;
    let mints = 0;
    const dmApplied: RemoteLayerUpdate[] = [];
    const dmStore = new ElementStore();
    const managed = createManagedSyncConnection({
      store: dmStore,
      clientId: 'dm',
      resolveUrl: () => {
        mintAttempts += 1;
        if (!allowMint) return null;
        mints += 1;
        const token = `dm-t-${mints}`;
        valid.add(token);
        return `ws://127.0.0.1:${port}?room=R&user=dm&token=${encodeURIComponent(token)}`;
      },
      layers: { applyLayer: (update) => dmApplied.push(update) },
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
    connections.push(managed);

    await waitFor(() => managed.getStatus() === 'live');
    managed.publishLayerUpsert(layerDef('layer-x', { name: 'v1' }));
    await waitFor(async () => (await backend.getLayerRecord('R', 'layer-x')) !== undefined);

    const peer = connectPeer(port, 'p1', { token: 'peer-token' });
    await waitFor(() => peer.applied.has('layer-x'));

    // The DM drops with an expired token and edits the layer while away.
    allowMint = false;
    valid.delete('dm-t-1');
    const attemptsBefore = mintAttempts;
    for (const ws of server.wss.clients) ws.terminate();
    await waitFor(() => mintAttempts > attemptsBefore);

    managed.publishLayerUpsert(layerDef('layer-x', { name: 'renamed offline' }));

    allowMint = true;
    await waitFor(() => managed.getStatus() === 'live');

    // The offline edit (version 2) reaches the hub ledger and the peer.
    await waitFor(async () => (await backend.getLayerRecord('R', 'layer-x'))?.version === 2);
    await waitFor(() => peer.applied.get('layer-x')?.record.version === 2);
    expect(peer.applied.get('layer-x')?.record.definition?.name).toBe('renamed offline');
    expect((await backend.getLayerRecord('R', 'layer-x'))?.definition?.name).toBe(
      'renamed offline',
    );

    // The reconnecting DM and the surviving peer hold identical records.
    const hubRecord = await backend.getLayerRecord('R', 'layer-x');
    expect(peer.applied.get('layer-x')?.record).toEqual(hubRecord);
  }, 10000);

  it('never sends a hidden layer to a player, and its reconnect re-push changes nothing', async () => {
    const backend = new MemoryHubBackend();
    const authenticate: Authenticate = ({ req }) => {
      const url = new URL(req.url ?? '', 'http://x');
      return {
        userId: url.searchParams.get('user') ?? '',
        role: url.searchParams.get('role') ?? '',
      };
    };
    const { server, port } = startServer({
      backend,
      authenticate,
      canReadLayer: ({ role, layer }) => role === 'dm' || layer.name !== 'DM Secret',
    });
    const dm = connectPeer(port, 'dm', { role: 'dm' });
    const dm2 = connectPeer(port, 'dm2', { role: 'dm' });
    const player = connectPeer(port, 'pl', { role: 'player' });

    dm.client.publishLayerUpsert(layerDef('layer-s', { name: 'Open' }));
    await waitFor(() => player.applied.has('layer-s') && dm2.applied.has('layer-s'));
    dm.client.publishLayerUpsert(layerDef('layer-s', { name: 'DM Secret' }));
    dm.client.publishLayerUpsert(layerDef('layer-h', { name: 'DM Secret' }));
    await waitFor(() => dm2.applied.has('layer-h'));
    await waitFor(() => player.applied.get('layer-s')?.record.version === 2);
    expect(player.applied.get('layer-s')?.record).toEqual({
      id: 'layer-s',
      version: 2,
      editor: 'dm',
    });

    const late = connectPeer(port, 'late', { role: 'player' });
    await waitFor(() => late.received.some((m) => m.includes('"kind":"snapshot"')));
    const dmFramesBefore = dm.received.length;
    const snapshots = (peer: { received: string[] }): number =>
      peer.received.filter((m) => m.includes('"kind":"snapshot"')).length;
    const playerSnapshots = snapshots(player);
    const lateSnapshots = snapshots(late);
    for (const ws of server.wss.clients) ws.terminate();
    // The player's ledger tombstone is newer than its snapshot, so it re-pushes the remove.
    await waitFor(() =>
      player.received.some((m) => m.includes('"from":"hub","op":{"kind":"layer-remove"')),
    );
    // Fence: the player's next op reaches dm after anything its remove re-push caused.
    player.client.publishLayerUpsert(layerDef('layer-fence', { name: 'Fence' }));
    await waitFor(
      () =>
        dm.received.slice(dmFramesBefore).some((m) => m.includes('layer-fence')) &&
        snapshots(player) > playerSnapshots &&
        snapshots(late) > lateSnapshots,
    );

    for (const peer of [player, late]) {
      expect(peer.received.some((m) => m.includes('DM Secret'))).toBe(false);
    }
    expect(dm2.received.some((m) => m.includes('DM Secret'))).toBe(true);
    expect((await backend.getLayerRecord('R', 'layer-s'))?.definition?.name).toBe('DM Secret');
    expect(dm.received.slice(dmFramesBefore).some((m) => m.includes('"kind":"layer-remove"'))).toBe(
      false,
    );
  }, 10000);
});
