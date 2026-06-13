import type { Point } from '../core/types';
import type { ArrowElement } from './types';
import { getArrowControlPoint, getArrowTangentAngle } from './arrow-geometry';

export interface ArrowRenderGeometry {
  controlPoint: Point | null;
  tangentStart: number;
  tangentEnd: number;
}

// Intrinsic geometry only (from/to/bend). Binding-resolved endpoints are deliberately
// NOT cached: bound targets can move without the arrow object being replaced.
const cache = new WeakMap<ArrowElement, ArrowRenderGeometry>();

export function getArrowRenderGeometry(arrow: ArrowElement): ArrowRenderGeometry {
  const hit = cache.get(arrow);
  if (hit) return hit;
  const geometry: ArrowRenderGeometry = {
    controlPoint:
      arrow.bend !== 0
        ? (arrow.cachedControlPoint ?? getArrowControlPoint(arrow.from, arrow.to, arrow.bend))
        : null,
    tangentStart: getArrowTangentAngle(arrow.from, arrow.to, arrow.bend, 0),
    tangentEnd: getArrowTangentAngle(arrow.from, arrow.to, arrow.bend, 1),
  };
  cache.set(arrow, geometry);
  return geometry;
}
