import type { Viewport } from '@fieldnotes/core';
import { BroadcastChannelTransport, SyncClient } from '@fieldnotes/sync';
import type { ClientSyncPlugin, RemoteLayerUpdate } from '@fieldnotes/sync';
import type { Room, SceneId } from './scene';

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
  opts: { plugins?: ClientSyncPlugin[] },
): { client: SyncClient; dispose(): void } {
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
  const client = new SyncClient({
    store,
    transport,
    clientId: randomId(),
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
  return {
    client,
    dispose: () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
      client.dispose();
      transport.close();
    },
  };
}
