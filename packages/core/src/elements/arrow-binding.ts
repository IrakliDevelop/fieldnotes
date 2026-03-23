import type { Point } from '../core/types';
import type { ArrowElement, CanvasElement } from './types';
import type { ElementStore } from './element-store';
import { getArrowTangentAngle } from './arrow-geometry';
import type { Rect } from './arrow-geometry';

const BINDABLE_TYPES = new Set(['note', 'text', 'image', 'html', 'shape']);

export function isBindable(element: CanvasElement): boolean {
  return BINDABLE_TYPES.has(element.type);
}

export function getElementCenter(element: CanvasElement): Point {
  if (!('size' in element)) {
    throw new Error(`getElementCenter: element type "${element.type}" has no size`);
  }
  return {
    x: element.position.x + element.size.w / 2,
    y: element.position.y + element.size.h / 2,
  };
}

export function getElementBounds(element: CanvasElement): Rect | null {
  if (!('size' in element)) return null;
  return {
    x: element.position.x,
    y: element.position.y,
    w: element.size.w,
    h: element.size.h,
  };
}

export function getEdgeIntersection(bounds: Rect, outsidePoint: Point): Point {
  const cx = bounds.x + bounds.w / 2;
  const cy = bounds.y + bounds.h / 2;
  const dx = outsidePoint.x - cx;
  const dy = outsidePoint.y - cy;

  if (dx === 0 && dy === 0) return { x: cx, y: cy };

  const halfW = bounds.w / 2;
  const halfH = bounds.h / 2;

  const scaleX = dx !== 0 ? halfW / Math.abs(dx) : Infinity;
  const scaleY = dy !== 0 ? halfH / Math.abs(dy) : Infinity;
  const scale = Math.min(scaleX, scaleY);

  return {
    x: cx + dx * scale,
    y: cy + dy * scale,
  };
}

export function findBindTarget(
  point: Point,
  store: ElementStore,
  threshold: number,
  excludeId?: string,
  filter?: (el: CanvasElement) => boolean,
): CanvasElement | null {
  let closest: CanvasElement | null = null;
  let closestDist = Infinity;

  for (const el of store.getAll()) {
    if (!isBindable(el)) continue;
    if (excludeId && el.id === excludeId) continue;
    if (filter && !filter(el)) continue;

    const bounds = getElementBounds(el);
    if (!bounds) continue;

    const dist = distToBounds(point, bounds);
    if (dist <= threshold && dist < closestDist) {
      closest = el;
      closestDist = dist;
    }
  }

  return closest;
}

function distToBounds(point: Point, bounds: Rect): number {
  const clampedX = Math.max(bounds.x, Math.min(point.x, bounds.x + bounds.w));
  const clampedY = Math.max(bounds.y, Math.min(point.y, bounds.y + bounds.h));
  return Math.hypot(point.x - clampedX, point.y - clampedY);
}

export function findBoundArrows(elementId: string, store: ElementStore): ArrowElement[] {
  return store
    .getElementsByType('arrow')
    .filter((a) => a.fromBinding?.elementId === elementId || a.toBinding?.elementId === elementId);
}

export function updateBoundArrow(
  arrow: ArrowElement,
  store: ElementStore,
): Partial<ArrowElement> | null {
  if (!arrow.fromBinding && !arrow.toBinding) return null;

  const updates: Partial<ArrowElement> = {};

  if (arrow.fromBinding) {
    const el = store.getById(arrow.fromBinding.elementId);
    if (el) {
      const center = getElementCenter(el);
      updates.from = center;
      updates.position = center;
    }
  }

  if (arrow.toBinding) {
    const el = store.getById(arrow.toBinding.elementId);
    if (el) {
      updates.to = getElementCenter(el);
    }
  }

  return Object.keys(updates).length > 0 ? updates : null;
}

export function clearStaleBindings(
  arrow: ArrowElement,
  store: ElementStore,
): Partial<ArrowElement> | null {
  const updates: Partial<ArrowElement> = {};
  let hasUpdates = false;

  if (arrow.fromBinding && !store.getById(arrow.fromBinding.elementId)) {
    updates.fromBinding = undefined;
    hasUpdates = true;
  }

  if (arrow.toBinding && !store.getById(arrow.toBinding.elementId)) {
    updates.toBinding = undefined;
    hasUpdates = true;
  }

  return hasUpdates ? updates : null;
}

export function unbindArrow(arrow: ArrowElement, store: ElementStore): Partial<ArrowElement> {
  const updates: Partial<ArrowElement> = {};

  if (arrow.fromBinding) {
    const el = store.getById(arrow.fromBinding.elementId);
    const bounds = el ? getElementBounds(el) : null;
    if (bounds) {
      const angle = getArrowTangentAngle(arrow.from, arrow.to, arrow.bend, 0);
      const rayTarget = {
        x: arrow.from.x + Math.cos(angle) * 1000,
        y: arrow.from.y + Math.sin(angle) * 1000,
      };
      const edge = getEdgeIntersection(bounds, rayTarget);
      updates.from = edge;
      updates.position = edge;
    }
    updates.fromBinding = undefined;
  }

  if (arrow.toBinding) {
    const el = store.getById(arrow.toBinding.elementId);
    const bounds = el ? getElementBounds(el) : null;
    if (bounds) {
      const angle = getArrowTangentAngle(arrow.from, arrow.to, arrow.bend, 1);
      // Reverse tangent direction — tangent at t=1 points away from curve body
      const rayTarget = {
        x: arrow.to.x - Math.cos(angle) * 1000,
        y: arrow.to.y - Math.sin(angle) * 1000,
      };
      updates.to = getEdgeIntersection(bounds, rayTarget);
    }
    updates.toBinding = undefined;
  }

  return updates;
}
