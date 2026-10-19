import { LaserTool, PingTool } from '@fieldnotes/core';
import type { Viewport } from '@fieldnotes/core';
import { BroadcastChannelTransport, SyncClient } from '@fieldnotes/sync';
import type { ClientSyncPlugin, RemoteLayerUpdate } from '@fieldnotes/sync';
import { attachPresence } from './presence';
import type { Peer, Room, SceneId } from './scene';

const REMOTE = { origin: 'remote' };

const hostKey = (id: string): string => `fieldnotes-playground:host:${id}`;

const randomId = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) => (byte % 36).toString(36)).join(
    '',
  );

/** The room in `?room=`, or null when absent or malformed; host iff this tab started it. */
export function readRoom(): Room | null {
  const id = new URLSearchParams(location.search).get('room');
  if (id === null || !/^[a-z0-9]{4,12}$/.test(id)) return null;
  return { id, role: sessionStorage.getItem(hostKey(id)) === '1' ? 'host' : 'guest' };
}

const COLORS = [
  '#e03131',
  '#1971c2',
  '#2f9e44',
  '#f08c00',
  '#9c36b5',
  '#0c8599',
  '#c2255c',
  '#5f3dc4',
];

const colorFor = (id: string): string => {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return COLORS[hash % COLORS.length] ?? '#e03131';
};

/** Starts a new room hosted by this tab. */
export function createRoom(): Room {
  const id = randomId();
  sessionStorage.setItem(hostKey(id), '1');
  return { id, role: 'host' };
}

/** Forgets that this tab hosts `room`. */
export function leaveRoom(room: Room): void {
  sessionStorage.removeItem(hostKey(room.id));
}

/** Syncs the viewport's elements, layers and plugin state with the other tabs in `room`. */
export function connectRoom(
  viewport: Viewport,
  sceneId: SceneId,
  room: Room,
  opts: { plugins?: ClientSyncPlugin[]; onPeers: (peers: Peer[]) => void },
): { dispose(): void } {
  const { layerManager, store } = viewport;
  // A guest drops its own empty starter layer once the room's layers arrive.
  let adopted = room.role === 'host';
  const applyLayer = ({ record }: RemoteLayerUpdate): void => {
    const { id, definition } = record;
    if (!definition) {
      layerManager.removeLayerDirect(id, REMOTE);
      const [fallback] = layerManager.getLayers();
      if (fallback && layerManager.activeLayerId === id) layerManager.setActiveLayer(fallback.id);
      return;
    }
    const own = adopted ? [] : layerManager.getLayers();
    adopted = true;
    if (layerManager.getLayer(id)) layerManager.updateLayerDirect(id, definition, REMOTE);
    else layerManager.addLayerDirect(definition, REMOTE);
    const [starter] = own;
    if (
      own.length !== 1 ||
      !starter ||
      starter.id === id ||
      store.getAll().some((el) => el.layerId === starter.id)
    ) {
      return;
    }
    layerManager.removeLayerDirect(starter.id, REMOTE);
    layerManager.setActiveLayer(id);
  };

  const transport = new BroadcastChannelTransport(`fieldnotes-playground:${sceneId}:${room.id}`);
  const clientId = randomId();
  const client = new SyncClient({
    store,
    transport,
    clientId,
    firstSnapshot: 'reconcile',
    layers: { applyLayer },
    plugins: opts.plugins,
  });
  const unsubscribers = [
    layerManager.on('create', (layer, meta) => {
      if (meta.origin !== REMOTE.origin) client.publishLayerUpsert(layer);
    }),
    layerManager.on('update', ({ current }, meta) => {
      if (meta.origin !== REMOTE.origin) client.publishLayerUpsert(current);
    }),
    layerManager.on('remove', (layer, meta) => {
      if (meta.origin !== REMOTE.origin) client.publishLayerRemove(layer.id);
    }),
  ];
  client.start();
  if (room.role === 'host') {
    for (const layer of layerManager.getLayers()) client.publishLayerUpsert(layer);
  }
  const laser = viewport.toolManager.getTool('laser');
  const ping = viewport.toolManager.getTool('ping');
  const detachPresence = attachPresence(viewport, client, {
    identity: {
      id: clientId,
      name: room.role === 'host' ? 'Host' : `Guest ${clientId.slice(-2)}`,
      color: colorFor(clientId),
      role: room.role,
    },
    laser: laser instanceof LaserTool ? laser : undefined,
    ping: ping instanceof PingTool ? ping : undefined,
    onPeers: opts.onPeers,
  });
  return {
    dispose: () => {
      detachPresence();
      for (const unsubscribe of unsubscribers) unsubscribe();
      client.dispose();
      transport.close();
    },
  };
}
