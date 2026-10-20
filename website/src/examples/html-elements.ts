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

export function linkCard(viewport: Viewport): void {
  // #region link-card
  const link = document.createElement('a');
  link.href = 'https://example.com/session-notes';
  link.textContent = 'Session notes';
  const grip = document.createElement('span');
  grip.dataset.fnDrag = '';
  grip.textContent = 'Move';
  link.prepend(grip);

  viewport.addHtmlElement(link, { x: 400, y: 200 }, { w: 240, h: 80 }, { interactive: true });
  // #endregion link-card
}

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
// #endregion renderer

export function renderer(): void {
  // #region renderer
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- // #hide
  const viewport = new Viewport(document.getElementById('board')!, { tools: 'default' });
  viewport.registerHtmlRenderer('initiative', (element) => {
    const title = element.data?.title;
    return initiativeCard(typeof title === 'string' ? title : '');
  });
  const saved = localStorage.getItem('board');
  if (saved) viewport.loadJSON(saved);

  viewport.addHtmlElement(
    initiativeCard('Initiative'),
    { x: 100, y: 200 },
    { w: 250, h: 150 },
    { htmlType: 'initiative', data: { title: 'Initiative' }, interactive: true },
  );
  // #endregion renderer
}

export function embedded(): void {
  // #region embedded
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- // #hide
  const viewport = new Viewport(document.getElementById('board')!, {
    tools: 'default',
    embedded: true,
  });
  viewport.shortcuts.disable('select.cycle');
  viewport.shortcuts.disable('select.cycle-reverse');

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- // #hide
  const toggle = document.getElementById('draw-toggle')!;
  toggle.addEventListener('click', () =>
    viewport.setEmbeddedEngaged(!viewport.isEmbeddedEngaged()),
  );
  viewport.onEmbeddedEngagedChange((engaged) => {
    toggle.textContent = engaged ? 'Done' : 'Draw on this board';
  });

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- // #hide
  const hint = document.getElementById('zoom-hint')!;
  let timer: ReturnType<typeof setTimeout> | undefined;
  viewport.onWheelPassThrough(() => {
    hint.hidden = false;
    clearTimeout(timer);
    timer = setTimeout(() => (hint.hidden = true), 1500);
  });
  // #endregion embedded
}
