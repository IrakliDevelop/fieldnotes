import { Viewport } from '@fieldnotes/core';

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

// #region link-card
export function addLinkCard(viewport: Viewport, href: string, title: string): string {
  const link = document.createElement('a');
  link.href = href;
  link.textContent = title;
  const grip = document.createElement('span');
  grip.dataset.fnDrag = '';
  grip.textContent = 'Move';
  link.prepend(grip);

  return viewport.addHtmlElement(
    link,
    { x: 400, y: 200 },
    { w: 240, h: 80 },
    { interactive: true },
  );
}
// #endregion link-card

// #region renderer
function initiativeCard(title: string): HTMLElement {
  const card = document.createElement('div');
  card.style.padding = '16px';
  const heading = document.createElement('h3');
  heading.textContent = title;
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Next turn';
  card.append(heading, button);
  return card;
}

export function openInitiativeBoard(container: HTMLElement, saved: string | null): Viewport {
  const viewport = new Viewport(container, { tools: 'default' });
  viewport.registerHtmlRenderer('initiative', (element) => {
    const title = element.data?.title;
    return initiativeCard(typeof title === 'string' ? title : '');
  });
  if (saved) viewport.loadJSON(saved);
  return viewport;
}

export function addInitiativeCard(viewport: Viewport, title: string): string {
  return viewport.addHtmlElement(
    initiativeCard(title),
    { x: 100, y: 200 },
    { w: 250, h: 150 },
    { htmlType: 'initiative', data: { title }, interactive: true },
  );
}
// #endregion renderer

// #region embedded
export function createPageBoard(
  container: HTMLElement,
  toggle: HTMLButtonElement,
  hint: HTMLElement,
): Viewport {
  const viewport = new Viewport(container, { tools: 'default', embedded: true });
  viewport.shortcuts.disable('select.cycle');
  viewport.shortcuts.disable('select.cycle-reverse');

  toggle.addEventListener('click', () =>
    viewport.setEmbeddedEngaged(!viewport.isEmbeddedEngaged()),
  );
  viewport.onEmbeddedEngagedChange((engaged) => {
    toggle.textContent = engaged ? 'Done' : 'Draw on this board';
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  viewport.onWheelPassThrough(() => {
    hint.hidden = false;
    clearTimeout(timer);
    timer = setTimeout(() => (hint.hidden = true), 1500);
  });
  return viewport;
}
// #endregion embedded
