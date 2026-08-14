import { getElementBounds } from '../elements/element-bounds';

import type { ElementStore } from '../elements/element-store';
import type { CanvasElement } from '../elements/types';

/** World-space rect of a tracked element, plus the host key it matched under. */
export interface ElementRect {
  id: string;
  /** Opaque host key echoed back from `match`. Core never interprets it. */
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Radians, clockwise, about the rect centre. 0 when the element has none. */
  rotation: number;
}

/** Returns an opaque key to track the element, or `null` to skip it. */
export type ElementRectMatch = (element: CanvasElement) => string | null;

export type ElementRectMatchError = (error: unknown, element: CanvasElement) => void;

/**
 * The tracker's per-frame computation, exported so consumers that need a
 * snapshot without a live tracker (e.g. a React `getSnapshot` before
 * subscription) cannot drift from these rules.
 */
export function computeElementRects(
  store: ElementStore,
  match: ElementRectMatch,
  onError?: ElementRectMatchError,
): ElementRect[] {
  const rects: ElementRect[] = [];
  for (const element of store.getAll()) {
    let key: string | null;
    try {
      key = match(element);
    } catch (error) {
      onError?.(error, element);
      continue;
    }
    if (typeof key !== 'string') continue;
    const bounds = getElementBounds(element);
    if (!bounds) continue;
    rects.push({
      id: element.id,
      key,
      x: bounds.x,
      y: bounds.y,
      w: bounds.w,
      h: bounds.h,
      rotation: element.rotation ?? 0,
    });
  }
  return rects;
}

/** Field-for-field comparison; `key` participates so identity changes emit. */
export function elementRectsEqual(a: readonly ElementRect[], b: readonly ElementRect[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const p = a[i];
    const q = b[i];
    if (!p || !q) return false;
    if (
      p.id !== q.id ||
      p.key !== q.key ||
      p.x !== q.x ||
      p.y !== q.y ||
      p.w !== q.w ||
      p.h !== q.h ||
      p.rotation !== q.rotation
    ) {
      return false;
    }
  }
  return true;
}
