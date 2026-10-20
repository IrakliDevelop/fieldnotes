import {
  ArrowTool,
  HandTool,
  NoteTool,
  PencilTool,
  SelectTool,
  Viewport,
  createStroke,
  type CanvasState,
  type PeerRoster,
} from '@fieldnotes/core';
import { wireControls } from './controls';
import { HERO_KEYS, boardOrigin, heroNode, measure, required, type HeroKey } from './layout';
import { lockdown } from './lockdown';
import { startMira } from './mira';
import { ruledPaper } from './ruled';
import { sampleSketch } from './seed';
import './hero.css';
import '../styles/floating.css';

/** The mounted hero board. */
export interface HeroHandle {
  viewport: Viewport;
  selectTool: SelectTool;
  seed: CanvasState;
  headlineId?: string;
  roster: PeerRoster;
  putBack(): void;
  stopMira(): void;
  restartMira(): void;
  destroy(): void;
}

const GRAPHITE = '#2A2D31';
const NARROW_KEYS: readonly HeroKey[] = ['sticky', 'checklist'];
const INTERACTIVE: readonly HeroKey[] = ['actions', 'checklist'];

function ignore(): void {
  // Replaces core's default paste and drop handling, which would add elements to the hero.
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
  const origin = boardOrigin(board);
  const strokes = sampleSketch(sketch, origin);
  // The static arrow's tip is 2px into its 18px box; core draws the cursor tip at the point.
  const miraBox = required(root, '[data-hero-mira]').getBoundingClientRect();
  const miraHome = { x: miraBox.left + 2 - origin.x, y: miraBox.top + 2 - origin.y };
  const pinned = wide ? flow.offsetHeight : board.offsetHeight;

  // Test switch: a failure here must leave the static hero untouched.
  if (new URLSearchParams(location.search).has('hero-fail')) throw new Error('hero-fail');
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

  // DOM changes wait for the viewport so a failed mount leaves the static hero; pins stop shifts.
  if (wide) flow.style.height = `${pinned}px`;
  else board.style.height = `${pinned}px`;
  Object.assign(board.style, { padding: '0', backgroundImage: 'none' });
  required<HTMLElement>(board, '[data-hero-side]').hidden = true;
  root.querySelector('[data-hero-frame]')?.remove();

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
    if (key === 'headline') {
      headlineId = id;
      // Its clamp() size follows the window; a later resize would re-wrap it in a fixed box.
      const h1 = required<HTMLElement>(node, 'h1');
      h1.style.fontSize = getComputedStyle(h1).fontSize;
    }
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

  const mira = startMira(viewport, miraHome, root);
  const putBack = (): void => {
    viewport.loadState(seed);
    for (const box of root.querySelectorAll<HTMLInputElement>(
      '[data-hero-node="checklist"] input',
    )) {
      box.checked = false;
    }
    selectHeadline();
    mira.restart();
  };
  reset.addEventListener('click', putBack);
  const disposeControls = wireControls(root, viewport);
  controls.hidden = false;

  const handle: HeroHandle = {
    viewport,
    selectTool,
    seed,
    headlineId,
    roster: mira.roster,
    putBack,
    stopMira: mira.stop,
    restartMira: mira.restart,
    destroy: () => {
      reset.removeEventListener('click', putBack);
      disposeControls();
      mira.dispose();
      viewport.destroy();
    },
  };
  root.dataset.heroReady = 'true';
  if (new URLSearchParams(location.search).has('debug-hero'))
    Object.assign(window, { __hero: handle });
  return handle;
}
