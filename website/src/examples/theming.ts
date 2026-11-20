import {
  Viewport,
  createNote,
  createShape,
  createText,
  type ViewportOptions,
} from '@fieldnotes/core';

export function createBoard(container: HTMLElement, extra?: ViewportOptions): Viewport {
  return new Viewport(container, { tools: 'default', ...darkBoardOptions, ...extra });
}

// #region options
export const darkBoardOptions: ViewportOptions = { theme: 'dark' };
// #endregion options

export const paper = false;

export function setup(viewport: Viewport): void {
  viewport.store.add(
    createShape({
      position: { x: -170, y: -80 },
      size: { w: 150, h: 100 },
      fillColor: '#ffeb3b',
      strokeColor: '#1a1a1a',
    }),
  );
  viewport.store.add(
    createNote({
      position: { x: 20, y: -60 },
      size: { w: 150, h: 90 },
      text: 'Stored colours stay the same.',
      backgroundColor: '#e53935',
      textColor: '#ffffff',
    }),
  );
  viewport.store.add(createText({ position: { x: -150, y: 70 }, text: 'Dark board' }));
}

// #region set-theme
export function useDarkTheme(viewport: Viewport): void {
  viewport.setTheme('dark');
}
// #endregion set-theme

// #region system
export function followSystem(viewport: Viewport): void {
  viewport.setTheme('system');
  viewport.onThemeChange((theme) => {
    document.documentElement.dataset.boardTheme = theme.base;
  });
}
// #endregion system

// #region custom
export function customTheme(container: HTMLElement): Viewport {
  return new Viewport(container, {
    theme: { base: 'dark', tokens: { board: '#16191d', selection: '#f0b429' } },
  });
}
// #endregion custom

// #region export
export async function exportDarkBoard(viewport: Viewport): Promise<Blob | null> {
  return viewport.exportImage({ theme: 'dark' });
}
// #endregion export
