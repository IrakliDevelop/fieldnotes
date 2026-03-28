import type { Bounds } from '../core/types';
import type { CanvasElement } from './types';
import { getArrowControlPoint } from './arrow-geometry';

// Cache stroke bounds via WeakMap.
// May miss after ElementStore.update() creates new object via spread,
// acceptable since stroke points never change after commit.
const strokeBoundsCache = new WeakMap<CanvasElement, Bounds>();

export function getElementBounds(element: CanvasElement): Bounds | null {
  if (element.type === 'grid') return null;

  if ('size' in element) {
    return {
      x: element.position.x,
      y: element.position.y,
      w: element.size.w,
      h: element.size.h,
    };
  }

  if (element.type === 'stroke') {
    if (element.points.length === 0) return null;

    const cached = strokeBoundsCache.get(element);
    if (cached) return cached;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const p of element.points) {
      const px = p.x + element.position.x;
      const py = p.y + element.position.y;
      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
    }

    const bounds: Bounds = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    strokeBoundsCache.set(element, bounds);
    return bounds;
  }

  if (element.type === 'arrow') {
    return getArrowBoundsAnalytical(element.from, element.to, element.bend);
  }

  return null;
}

function getArrowBoundsAnalytical(
  from: { x: number; y: number },
  to: { x: number; y: number },
  bend: number,
): Bounds {
  if (bend === 0) {
    const minX = Math.min(from.x, to.x);
    const minY = Math.min(from.y, to.y);
    return {
      x: minX,
      y: minY,
      w: Math.abs(to.x - from.x),
      h: Math.abs(to.y - from.y),
    };
  }

  const cp = getArrowControlPoint(from, to, bend);

  let minX = Math.min(from.x, to.x);
  let maxX = Math.max(from.x, to.x);
  let minY = Math.min(from.y, to.y);
  let maxY = Math.max(from.y, to.y);

  // Analytical extrema for quadratic bezier: t = (P0 - P1) / (P0 - 2*P1 + P2)
  const tx = from.x - 2 * cp.x + to.x;
  if (tx !== 0) {
    const t = (from.x - cp.x) / tx;
    if (t > 0 && t < 1) {
      const mt = 1 - t;
      const x = mt * mt * from.x + 2 * mt * t * cp.x + t * t * to.x;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
  }

  const ty = from.y - 2 * cp.y + to.y;
  if (ty !== 0) {
    const t = (from.y - cp.y) / ty;
    if (t > 0 && t < 1) {
      const mt = 1 - t;
      const y = mt * mt * from.y + 2 * mt * t * cp.y + t * t * to.y;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}
