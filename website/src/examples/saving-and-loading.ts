import {
  AutoSave,
  IndexedDBAdapter,
  Viewport,
  type ImportableCanvasState,
  type StrokePoint,
  type ViewportOptions,
} from '@fieldnotes/core';

export async function saveBoard(viewport: Viewport): Promise<void> {
  // #region export
  await fetch('/api/board', { method: 'PUT', body: viewport.exportJSON() });
  // #endregion export
}

export function openBoard(): void {
  // #region load
  const saved = localStorage.getItem('board');
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- // #hide
  const viewport = new Viewport(document.getElementById('board')!, { tools: 'default' });
  if (saved) viewport.loadJSON(saved);
  // #endregion load
}

export async function startAutoSave(viewport: Viewport): Promise<void> {
  // #region autosave
  const autoSave = new AutoSave(viewport.store, viewport.camera, {
    key: 'board',
    adapter: new IndexedDBAdapter(),
    layerManager: viewport.layerManager,
  });
  const saved = await autoSave.load();
  if (saved) viewport.loadState(saved);
  autoSave.start();
  // #endregion autosave
}

const wave = (length: number): StrokePoint[] =>
  Array.from({ length: length / 10 + 1 }, (_, i) => ({
    x: i * 10,
    y: i % 2 ? 8 : 0,
    pressure: 0.5,
  }));
const base = { version: 1, locked: false, layerId: 'sample-layer' };
const ink = { type: 'stroke', color: '#2F55A4', width: 3, opacity: 1 } as const;

// The docs board opens this instead of reading storage, so it persists nothing.
const SAMPLE_BOARD = JSON.stringify({
  version: 5,
  camera: { position: { x: 0, y: 0 }, zoom: 1 },
  layers: [
    { id: 'sample-layer', name: 'Layer 1', visible: true, locked: false, order: 0, opacity: 1 },
  ],
  activeLayerId: 'sample-layer',
  elements: [
    {
      ...base,
      id: 'sample-note',
      type: 'note',
      index: 'a0',
      position: { x: 48, y: 40 },
      size: { w: 220, h: 110 },
      text: 'Loaded with loadJSON',
      backgroundColor: '#F2DE8A',
      textColor: '#2A2D31',
    },
    {
      ...base,
      ...ink,
      id: 'sample-wave',
      index: 'a1',
      position: { x: 320, y: 70 },
      points: wave(160),
    },
    {
      ...base,
      ...ink,
      id: 'sample-line',
      index: 'a2',
      position: { x: 320, y: 120 },
      points: wave(80),
    },
  ],
} satisfies ImportableCanvasState);

/** Opens the sample board as the `load` region opens a saved one. */
export function createBoard(container: HTMLElement, extra?: ViewportOptions): Viewport {
  const viewport = new Viewport(container, { tools: 'default', ...extra });
  viewport.loadJSON(SAMPLE_BOARD);
  return viewport;
}
