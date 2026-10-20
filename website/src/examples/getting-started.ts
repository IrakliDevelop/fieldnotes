// #region ten-lines
// #region mount
import { Viewport, type ViewportOptions } from '@fieldnotes/core';

export function createBoard(container: HTMLElement, extra?: ViewportOptions): Viewport {
  return new Viewport(container, { tools: 'default', ...extra });
}
// #endregion mount

// #region save
export function persist(viewport: Viewport, storage: Storage, key = 'board'): () => void {
  const saved = storage.getItem(key);
  if (saved) viewport.loadJSON(saved);
  return viewport.onStateChange(() => storage.setItem(key, viewport.exportJSON()));
}
// #endregion save
// #endregion ten-lines

// #region cleanup
export function mountSavedBoard(container: HTMLElement): () => void {
  const viewport = createBoard(container);
  persist(viewport, localStorage);
  return () => viewport.destroy();
}
// #endregion cleanup
