/** Server-rendered hero nodes the board can adopt. */
export const HERO_KEYS = [
  'headline',
  'annotation',
  'intro',
  'actions',
  'sticky',
  'checklist',
] as const;

/** Key of a `[data-hero-node]` element. */
export type HeroKey = (typeof HERO_KEYS)[number];

/** A box in board CSS px, which is world space at zoom 1. */
export interface HeroRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Returns the element matching `selector` under `root`, or throws. */
export function required<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`hero is missing ${selector}`);
  return el;
}

/** Returns the `[data-hero-node]` element for `key`. */
export function heroNode(root: HTMLElement, key: HeroKey): HTMLElement {
  const node = root.querySelector<HTMLElement>(`[data-hero-node="${key}"]`);
  if (!node) throw new Error(`hero node ${key} is missing`);
  return node;
}

/** Origin of the board's padding box, where the viewport wrapper starts. */
export function boardOrigin(board: HTMLElement): { x: number; y: number } {
  const rect = board.getBoundingClientRect();
  return { x: rect.left + board.clientLeft, y: rect.top + board.clientTop };
}

/** Measures every hero node relative to the board; `wide` is decided once, here. */
export function measure(
  root: HTMLElement,
  board: HTMLElement,
): { wide: boolean; rects: Record<HeroKey, HeroRect> } {
  const origin = boardOrigin(board);
  const rect = (key: HeroKey): HeroRect => {
    const node = heroNode(root, key);
    const box = node.getBoundingClientRect();
    // Offset sizes ignore the sticky note's rotation; the rotated box shares its centre.
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    return {
      x: box.left + box.width / 2 - w / 2 - origin.x,
      y: box.top + box.height / 2 - h / 2 - origin.y,
      w,
      // Descenders past a tight line-height would be clipped by core's overflow-hidden box.
      h: Math.max(h, node.scrollHeight),
    };
  };
  return {
    wide: !matchMedia('(max-width: 820px)').matches,
    rects: {
      headline: rect('headline'),
      annotation: rect('annotation'),
      intro: rect('intro'),
      actions: rect('actions'),
      sticky: rect('sticky'),
      checklist: rect('checklist'),
    },
  };
}
