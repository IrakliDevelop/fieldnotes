import { HandTool, SelectTool, Viewport } from '@fieldnotes/core';
import { SyncClient, type SyncTransport } from '@fieldnotes/sync';
import { createSyncServer, type Authenticate } from '@fieldnotes/sync-server';
import {
  createFogPlugin,
  FogTool,
  GridController,
  MeasureTool,
  registerVttElementTypes,
  TemplateTool,
} from '@fieldnotes/vtt';
import { createFogServerPlugin } from '@fieldnotes/vtt/server';
import { createFogClientPlugin } from '@fieldnotes/vtt/sync';

export function table(isGm: boolean, transport: SyncTransport): void {
  // #region table
  registerVttElementTypes();

  const fogPlugin = createFogPlugin();
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- // #hide
  const viewport = new Viewport(document.getElementById('board')!, {
    plugins: [fogPlugin],
    tools: [
      new SelectTool(),
      new HandTool(),
      new MeasureTool({ feetPerCell: 5 }),
      new TemplateTool({ templateShape: 'cone', feetPerCell: 5 }),
      new FogTool(fogPlugin.manager, { operation: 'reveal', radius: 40 }),
    ],
  });
  // #endregion table

  // #region grid
  const grid = new GridController({
    store: viewport.store,
    recorder: viewport.historyRecorder,
    requestRender: () => viewport.requestRender(),
    getActiveLayerId: () => viewport.layerManager.activeLayerId,
    toolContext: viewport.toolContext,
    defaultGridSize: 48,
    elementRegistry: viewport.elementRegistry,
    constraintService: viewport.constraintProxy,
  });
  grid.add({ gridType: 'hex', hexOrientation: 'pointy', cellSize: 48 });
  // #endregion grid

  // #region fog
  const fog = fogPlugin.manager;
  if (isGm)
    fog.initialize({ bounds: { x: 0, y: 0, w: 2400, h: 1600 }, base: 'covered', cellSize: 32 });
  fog.setViewMode(isGm ? 'editor' : 'player');
  // #endregion fog

  // #region fog-sync
  const client = new SyncClient({
    store: viewport.store,
    transport,
    plugins: [createFogClientPlugin({ manager: fog })],
  });
  client.start();
  // #endregion fog-sync
}

export function fogRelay(authenticate: Authenticate): () => Promise<void> {
  // #region fog-sync
  // On the relay:
  const { close } = createSyncServer({
    port: 8080,
    authenticate,
    plugins: [createFogServerPlugin({ authorize: ({ role }) => role === 'gm' })],
  });
  // #endregion fog-sync
  return close;
}
