// #region ten-lines
// #region mount
import { Viewport } from '@fieldnotes/core';
// #endregion mount
// #endregion ten-lines
import type { ViewportOptions } from '@fieldnotes/core';

/** Mounts the docs board with the `mount` tools; `extra` holds the docs page's options. */
export function createBoard(container: HTMLElement, extra?: ViewportOptions): Viewport {
  return new Viewport(container, { tools: 'default', ...extra });
}

export function tenLines(): void {
  // #region ten-lines
  // #region mount
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- // #hide
  const viewport = new Viewport(document.getElementById('board')!, {
    background: { pattern: 'dots', spacing: 24 },
    tools: 'default',
  });
  // #endregion mount

  const saved = localStorage.getItem('board');
  if (saved) viewport.loadJSON(saved);
  viewport.onStateChange(() => localStorage.setItem('board', viewport.exportJSON()));
  // #endregion ten-lines
}

export function saveDebounced(viewport: Viewport): void {
  // #region save-debounced
  const saved = localStorage.getItem('board');
  if (saved) viewport.loadJSON(saved);

  let timer: ReturnType<typeof setTimeout> | undefined;
  viewport.onStateChange(() => {
    clearTimeout(timer);
    timer = setTimeout(() => localStorage.setItem('board', viewport.exportJSON()), 250);
  });
  // #endregion save-debounced
}

export function cleanup(viewport: Viewport): void {
  // #region cleanup
  viewport.destroy();
  // #endregion cleanup
}
