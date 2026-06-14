import type { Point } from '../core/types';
import type { StrokeElement } from './types';
import { getElementBounds } from './element-bounds';
import { getStrokeRenderData } from './stroke-cache';
import { distSqToSegment } from '../core/geometry';

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
