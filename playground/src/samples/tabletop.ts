import type { Viewport } from '@fieldnotes/core';
import {
  createGrid,
  createTemplate,
  gridElementTypeDefinition,
  templateElementTypeDefinition,
} from '@fieldnotes/vtt';
import type { FogManager, GridController } from '@fieldnotes/vtt';
import { insertWidget, WIDGETS } from '../widgets';

const TOKENS = [
  { x: 200, name: 'Aria', initials: 'A', color: '#1971c2', hp: 18, maxHp: 24 },
  { x: 420, name: 'Brom', initials: 'B', color: '#2f9e44', hp: 30, maxHp: 30 },
  { x: 760, name: 'Goblin', initials: 'G', color: '#e03131', hp: 7, maxHp: 7 },
];

/** Replaces the board with a hex map, three tokens and a fireball, under fog revealed along the party's row. */
export function buildTabletopSample(
  viewport: Viewport,
  gridController: GridController,
  fog: FogManager,
): void {
  const { store } = viewport;
  const tokenDef = WIDGETS.find((def) => def.htmlType === 'pg:token');
  if (!tokenDef) throw new Error('Token widget is not registered');
  const layerId = viewport.layerManager.activeLayerId;
  viewport.transaction(() => {
    for (const el of store.getAll()) store.remove(el.id);
    const { layerManager } = viewport;
    layerManager.setLayerVisible(layerId, true);
    layerManager.setLayerLocked(layerId, false);
    layerManager.setLayerOpacity(layerId, 1);
    // GridController.add would open its own history step inside this transaction.
    store.add(
      gridElementTypeDefinition.wrap(
        createGrid({ gridType: 'hex', hexOrientation: 'pointy', cellSize: 48, layerId }),
      ),
    );
    for (const { x, ...data } of TOKENS) insertWidget(viewport, tokenDef, { x, y: 300 }, data);
    store.add(
      templateElementTypeDefinition.wrap(
        createTemplate({
          position: { x: 1000, y: 390 },
          templateShape: 'circle',
          radius: 96,
          layerId,
        }),
      ),
    );
    gridController.syncContext();
  });
  fog.initialize({ bounds: { x: -200, y: -200, w: 1600, h: 1000 }, base: 'covered', cellSize: 32 });
  fog.applyRegion(
    { kind: 'rectangle', from: { x: 100, y: 240 }, to: { x: 1240, y: 520 } },
    'reveal',
  );
  fog.setViewMode('editor');
  viewport.fitToContent();
}
