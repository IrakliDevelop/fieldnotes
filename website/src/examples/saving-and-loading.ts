import { AutoSave, IndexedDBAdapter, Viewport, type ViewportOptions } from '@fieldnotes/core';

// #region export
export function saveBoard(viewport: Viewport, url: string): Promise<Response> {
  return fetch(url, { method: 'PUT', body: viewport.exportJSON() });
}
// #endregion export

// #region load
export function createBoard(
  container: HTMLElement,
  extra?: ViewportOptions,
  saved?: string,
): Viewport {
  const viewport = new Viewport(container, { tools: 'default', ...extra });
  if (saved) viewport.loadJSON(saved);
  return viewport;
}
// #endregion load

// #region autosave
export async function startAutoSave(viewport: Viewport): Promise<AutoSave> {
  const autoSave = new AutoSave(viewport.store, viewport.camera, {
    key: 'board',
    adapter: new IndexedDBAdapter(),
    layerManager: viewport.layerManager,
  });
  const saved = await autoSave.load();
  if (saved) viewport.loadState(saved);
  autoSave.start();
  return autoSave;
}
// #endregion autosave
