import {
  ArrowTool,
  HandTool,
  NoteTool,
  PencilTool,
  SelectTool,
  Viewport,
  createStroke,
  type CanvasState,
} from '@fieldnotes/core';
import { HERO_KEYS, boardOrigin, heroNode, measure, type HeroKey } from './layout';
import { lockdown } from './lockdown';
import { ruledPaper } from './ruled';
import { sampleSketch } from './seed';

/** The mounted hero board. */
export interface HeroHandle {
  viewport: Viewport;
  selectTool: SelectTool;
  seed: CanvasState;
  headlineId?: string;
  putBack(): void;
  destroy(): void;
}

const GRAPHITE = '#2A2D31';
const NARROW_KEYS: readonly HeroKey[] = ['sticky', 'checklist'];
const INTERACTIVE: readonly HeroKey[] = ['actions', 'checklist'];

function ignore(): void {
  // Replaces core's default paste and drop handling, which would add elements to the hero.
}

function required<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`hero is missing ${selector}`);
  return el;
}

/** Turns the server-rendered hero into a live board that adopts its own DOM nodes. */
export async function mountHero(root: HTMLElement): Promise<HeroHandle> {
  const board = required<HTMLElement>(root, '[data-hero-board]');
  const flow = required<HTMLElement>(root, '[data-hero-flow]');
  const sketch = required<SVGSVGElement>(root, '[data-hero-sketch]');
  const controls = required<HTMLElement>(root, '[data-hero-controls]');
  const reset = required<HTMLButtonElement>(root, '[data-hero-reset]');

  await document.fonts.ready;
  const { wide, rects } = measure(root, board);
  const strokes = sampleSketch(sketch, boardOrigin(board));

  // Pin the static flow so moving nodes onto the board shifts nothing.
  if (wide) flow.style.height = `${flow.offsetHeight}px`;
  else board.style.height = `${board.offsetHeight}px`;
  Object.assign(board.style, { padding: '0', backgroundImage: 'none' });
  required<HTMLElement>(board, '[data-hero-side]').hidden = true;
  root.querySelector('[data-hero-frame]')?.remove();

  const selectTool = new SelectTool();
  const viewport = new Viewport(board, {
    embedded: true,
    selectionColor: '#B8322A',
    contextMenu: false,
    background: { pattern: 'none' },
    onPaste: ignore,
    onDrop: ignore,
    tools: [
      selectTool,
      new PencilTool({ color: GRAPHITE, width: 2 }),
      new NoteTool({ backgroundColor: '#F2DE8A' }),
      new ArrowTool({ color: GRAPHITE }),
      new HandTool(),
    ],
  });

  let headlineId: string | undefined;
  for (const key of wide ? HERO_KEYS : NARROW_KEYS) {
    const node = heroNode(root, key);
    const { x, y, w, h } = rects[key];
    node.classList.add('adopted');
    viewport.registerHtmlRenderer(`hero-${key}`, () => node);
    const id = viewport.addHtmlElement(
      node,
      { x, y },
      { w, h },
      {
        htmlType: `hero-${key}`,
        interactive: INTERACTIVE.includes(key),
      },
    );
    if (key === 'headline') headlineId = id;
  }

  const layerId = viewport.layerManager.activeLayerId;
  for (const points of strokes) {
    viewport.store.add(createStroke({ points, color: GRAPHITE, width: 2, layerId }));
  }
  // Matches `--margin-x` on `.hero`, resolved against the board's width.
  ruledPaper(viewport, Math.max(24, board.clientWidth / 2 - 612));
  lockdown(viewport);

  const selectHeadline = (): void => {
    if (headlineId) selectTool.setSelection([headlineId]);
  };
  selectHeadline();
  const seed = viewport.exportState();
  viewport.history.clear();

  const putBack = (): void => {
    viewport.loadState(seed);
    for (const box of root.querySelectorAll<HTMLInputElement>(
      '[data-hero-node="checklist"] input',
    )) {
      box.checked = false;
    }
    selectHeadline();
  };
  reset.addEventListener('click', putBack);
  controls.hidden = false;

  const handle: HeroHandle = {
    viewport,
    selectTool,
    seed,
    headlineId,
    putBack,
    destroy: () => {
      reset.removeEventListener('click', putBack);
      viewport.destroy();
    },
  };
  root.dataset.heroReady = 'true';
  if (new URLSearchParams(location.search).has('debug-hero'))
    Object.assign(window, { __hero: handle });
  return handle;
}
