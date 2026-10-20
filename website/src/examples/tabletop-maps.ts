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
  type FogManager,
} from '@fieldnotes/vtt';
import { createFogServerPlugin } from '@fieldnotes/vtt/server';
import { createFogClientPlugin } from '@fieldnotes/vtt/sync';

// #region table
registerVttElementTypes();

export function createTable(container: HTMLElement): { viewport: Viewport; fog: FogManager } {
  const fogPlugin = createFogPlugin();
  const viewport = new Viewport(container, {
    plugins: [fogPlugin],
    tools: [
      new SelectTool(),
      new HandTool(),
      new MeasureTool({ feetPerCell: 5 }),
      new TemplateTool({ templateShape: 'cone', feetPerCell: 5 }),
      new FogTool(fogPlugin.manager, { operation: 'reveal', radius: 40 }),
    ],
  });
  return { viewport, fog: fogPlugin.manager };
}
// #endregion table

// #region grid
export function addHexGrid(viewport: Viewport): GridController {
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
  return grid;
}
// #endregion grid

// #region fog
export function coverMap(fog: FogManager, isGm: boolean): void {
  fog.initialize({ bounds: { x: 0, y: 0, w: 2400, h: 1600 }, base: 'covered', cellSize: 32 });
  fog.setViewMode(isGm ? 'editor' : 'player');
}
// #endregion fog

// #region fog-sync
export function joinWithFog(
  viewport: Viewport,
  fog: FogManager,
  transport: SyncTransport,
): SyncClient {
  const client = new SyncClient({
    store: viewport.store,
    transport,
    plugins: [createFogClientPlugin({ manager: fog })],
  });
  client.start();
  return client;
}

export function startFogRelay(authenticate: Authenticate): () => Promise<void> {
  const { close } = createSyncServer({
    port: 8080,
    authenticate,
    plugins: [createFogServerPlugin({ authorize: ({ role }) => role === 'gm' })],
  });
  return close;
}
// #endregion fog-sync
