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

// #region save-debounced
export function saveToLocalStorage(viewport: Viewport): () => void {
  const saved = localStorage.getItem('board');
  if (saved) viewport.loadJSON(saved);
  let timer: ReturnType<typeof setTimeout> | undefined;
  return viewport.onStateChange(() => {
    clearTimeout(timer);
    timer = setTimeout(() => localStorage.setItem('board', viewport.exportJSON()), 250);
  });
}
// #endregion save-debounced

// #region cleanup
export function mountSavedBoard(container: HTMLElement): () => void {
  const viewport = createBoard(container);
  saveToLocalStorage(viewport);
  return () => viewport.destroy();
}
// #endregion cleanup
