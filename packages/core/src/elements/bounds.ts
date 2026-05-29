import type { Bounds } from '../core/types';
import type { CanvasElement } from './types';
import { getElementBounds } from './element-bounds';

export function getElementsBoundingBox(elements: CanvasElement[]): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let found = false;

  for (const el of elements) {
    const b = getElementBounds(el);
    if (!b) continue;
    found = true;
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x + b.w > maxX) maxX = b.x + b.w;
    if (b.y + b.h > maxY) maxY = b.y + b.h;
  }

  if (!found) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
