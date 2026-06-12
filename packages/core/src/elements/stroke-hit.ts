import type { Point } from '../core/types';
import type { StrokeElement } from './types';
import { getElementBounds } from './element-bounds';
import { getStrokeRenderData } from './stroke-cache';

function distSqToSegment(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const lenSq = abx * abx + aby * aby;
  if (lenSq === 0) {
    return apx * apx + apy * apy;
  }
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / lenSq));
  const dx = p.x - (a.x + t * abx);
  const dy = p.y - (a.y + t * aby);
  return dx * dx + dy * dy;
}

export function hitTestStroke(stroke: StrokeElement, point: Point, radius: number): boolean {
  const bounds = getElementBounds(stroke);
  if (!bounds) return false;
  if (
    point.x < bounds.x - radius ||
    point.x > bounds.x + bounds.w + radius ||
    point.y < bounds.y - radius ||
    point.y > bounds.y + bounds.h + radius
  ) {
    return false;
  }

  const radiusSq = radius * radius;
  const local: Point = { x: point.x - stroke.position.x, y: point.y - stroke.position.y };
  const { segments } = getStrokeRenderData(stroke);

  if (segments.length === 0) {
    const p = stroke.points[0];
    if (!p) return false;
    const dx = p.x - local.x;
    const dy = p.y - local.y;
    return dx * dx + dy * dy <= radiusSq;
  }

  for (const seg of segments) {
    if (distSqToSegment(local, seg.start, seg.end) <= radiusSq) return true;
  }
  return false;
}
