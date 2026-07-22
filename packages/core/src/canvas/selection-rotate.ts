import type { Bounds, Point } from '../core/types';
import type { CanvasElement } from '../elements/types';
import { normalizeAngle, rotatePoint, rotatedAABB } from '../core/geometry';

export type RotateDirection = 'cw' | 'ccw';

export interface BoundedElement {
  id: string;
  el: CanvasElement;
  bounds: Bounds;
}

export function unionBounds(list: Bounds[]): Bounds {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const b of list) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function rotationPivot(items: readonly BoundedElement[]): Point {
  const first = items[0];
  if (items.length === 1 && first) {
    return { x: first.bounds.x + first.bounds.w / 2, y: first.bounds.y + first.bounds.h / 2 };
  }
  const u = unionBounds(items.map((it) => rotatedAABB(it.bounds, it.el.rotation ?? 0)));
  return { x: u.x + u.w / 2, y: u.y + u.h / 2 };
}

export function rotateElementPatch(
  el: CanvasElement,
  bounds: Bounds,
  pivot: Point,
  delta: number,
): Partial<CanvasElement> {
  if (el.type === 'arrow') {
    const center = { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
    const moved = rotatePoint(center, pivot, delta);
    return {
      position: { x: el.position.x + moved.x - center.x, y: el.position.y + moved.y - center.y },
      from: rotatePoint(el.from, pivot, delta),
      to: rotatePoint(el.to, pivot, delta),
    };
  }
  if (el.type === 'template') {
    return {
      position: rotatePoint(el.position, pivot, delta),
      angle: normalizeAngle(el.angle + delta),
    };
  }
  const center = { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
  const moved = rotatePoint(center, pivot, delta);
  return {
    position: { x: el.position.x + moved.x - center.x, y: el.position.y + moved.y - center.y },
    rotation: normalizeAngle((el.rotation ?? 0) + delta),
  };
}
