import type { Viewport } from '@fieldnotes/core';

export { createBoard } from './getting-started';

/** Adds a card whose button takes the first click; its padding drags it. */
export function setup(viewport: Viewport): void {
  // #region live-card
  const card = document.createElement('div');
  card.style.padding = '16px';
  card.innerHTML = '<h3>Initiative</h3><button type="button">Next turn</button>';

  viewport.addHtmlElement(card, { x: 100, y: 200 }, { w: 250, h: 150 }, { interactive: true });
  // #endregion live-card
}
