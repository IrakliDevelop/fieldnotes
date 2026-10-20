import type { Viewport } from '@fieldnotes/core';
import { ruledPaper } from '../hero/ruled';
import { boardExamples } from './registry';

const debugBoards: Record<string, Viewport> = {};

function part<T extends HTMLElement>(figure: Element, selector: string): T {
  const el = figure.querySelector<T>(selector);
  if (!el) throw new Error(`live board is missing ${selector}`);
  return el;
}

async function mountBoard(figure: Element): Promise<void> {
  const name = figure.getAttribute('data-live-board') ?? '';
  const load = boardExamples[name];
  if (!load) throw new Error(`no live board example named "${name}"`);
  const host = part(figure, '[data-live-board-mount]');
  const engage = part<HTMLButtonElement>(figure, '.live-board-engage');
  const reset = part<HTMLButtonElement>(figure, '.live-board-reset');
  const example = await load();

  const start = (): Viewport => {
    // The example shows app options; only the docs mount adds `embedded`, so a wheel scrolls the page.
    const viewport = example.createBoard(host, { embedded: true, background: { pattern: 'none' } });
    example.setup?.(viewport);
    viewport.shortcuts.disable('select.cycle');
    viewport.shortcuts.disable('select.cycle-reverse');
    viewport.setTool('pencil');
    ruledPaper(viewport);
    engage.textContent = 'Draw on this board';
    // Core's own Escape disengages too, so the site adds no Escape handler.
    viewport.onEmbeddedEngagedChange((engaged) => {
      engage.textContent = engaged ? 'Done' : 'Draw on this board';
    });
    debugBoards[name] = viewport;
    return viewport;
  };

  let viewport = start();
  part(figure, '.board-placeholder').hidden = true;
  engage.addEventListener('click', () =>
    viewport.setEmbeddedEngaged(!viewport.isEmbeddedEngaged()),
  );
  reset.addEventListener('click', () => {
    viewport.destroy();
    viewport = start();
  });
  engage.hidden = !matchMedia('(any-pointer: coarse)').matches;
  reset.hidden = false;
}

/** Mounts each `[data-live-board]` on the page the first time it scrolls into view. */
export function mountBoards(): void {
  const observer = new IntersectionObserver((entries) => {
    for (const { isIntersecting, target } of entries) {
      if (!isIntersecting) continue;
      observer.unobserve(target);
      void mountBoard(target);
    }
  });
  for (const figure of document.querySelectorAll('[data-live-board]')) observer.observe(figure);
  if (new URLSearchParams(location.search).has('debug-boards')) {
    Object.assign(window, { __docsBoards: debugBoards });
  }
}
