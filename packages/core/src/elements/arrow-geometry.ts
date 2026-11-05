import type { Bounds, Point } from '../core/types';
import { distSqToSegment } from '../core/geometry';
import type { ArrowElement } from './types';

export interface ArrowCurve {
  from: Point;
  control: Point;
  to: Point;
  t0: number;
  t1: number;
}

export function getArrowControlPoint(from: Point, to: Point, bend: number): Point {
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;

  if (bend === 0) return { x: midX, y: midY };

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.sqrt(dx * dx + dy * dy);

  if (len === 0) return { x: midX, y: midY };

  const perpX = -dy / len;
  const perpY = dx / len;

  return {
    x: midX + perpX * bend,
    y: midY + perpY * bend,
  };
}

export function getArrowMidpoint(from: Point, to: Point, bend: number): Point {
  const cp = getArrowControlPoint(from, to, bend);
  return {
    x: 0.25 * from.x + 0.5 * cp.x + 0.25 * to.x,
    y: 0.25 * from.y + 0.5 * cp.y + 0.25 * to.y,
  };
}

export function getArrowCurve(
  arrow: ArrowElement,
  resolveBounds: (id: string) => Bounds | null,
): ArrowCurve {
  const control = getArrowControlPoint(arrow.from, arrow.to, arrow.bend);
  const fromBounds = arrow.fromBinding ? resolveBounds(arrow.fromBinding.elementId) : null;
  const toBounds = arrow.toBinding ? resolveBounds(arrow.toBinding.elementId) : null;
  const t0 = fromBounds ? getExitT(arrow.from, control, arrow.to, fromBounds, true) : 0;
  const t1 = toBounds ? getExitT(arrow.from, control, arrow.to, toBounds, false) : 1;
  if (t0 >= t1) return { from: arrow.from, control, to: arrow.to, t0: 0, t1: 1 };

  return {
    from: bezierPoint(arrow.from, control, arrow.to, t0),
    control: {
      x:
        (1 - t0) * (1 - t1) * arrow.from.x +
        ((1 - t0) * t1 + t0 * (1 - t1)) * control.x +
        t0 * t1 * arrow.to.x,
      y:
        (1 - t0) * (1 - t1) * arrow.from.y +
        ((1 - t0) * t1 + t0 * (1 - t1)) * control.y +
        t0 * t1 * arrow.to.y,
    },
    to: bezierPoint(arrow.from, control, arrow.to, t1),
    t0,
    t1,
  };
}

export function getArrowLabelAnchor(
  arrow: ArrowElement,
  resolveBounds: (id: string) => Bounds | null,
): Point {
  const curve = getArrowCurve(arrow, resolveBounds);
  return bezierPoint(
    arrow.from,
    getArrowControlPoint(arrow.from, arrow.to, arrow.bend),
    arrow.to,
    (curve.t0 + curve.t1) / 2,
  );
}

export function getBendFromPoint(from: Point, to: Point, dragPoint: Point): number {
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.sqrt(dx * dx + dy * dy);

  if (len === 0) return 0;

  const perpX = -dy / len;
  const perpY = dx / len;

  // The bend handle sits at the curve midpoint (getArrowMidpoint), which is HALF the control-point
  // offset. Double the projection so the handle tracks the pointer 1:1 (bend is the control-point offset).
  return 2 * ((dragPoint.x - midX) * perpX + (dragPoint.y - midY) * perpY);
}

export function getArrowTangentAngle(from: Point, to: Point, bend: number, t: number): number {
  const cp = getArrowControlPoint(from, to, bend);

  const tangentX = 2 * (1 - t) * (cp.x - from.x) + 2 * t * (to.x - cp.x);
  const tangentY = 2 * (1 - t) * (cp.y - from.y) + 2 * t * (to.y - cp.y);

  return Math.atan2(tangentY, tangentX);
}

export function isNearBezier(
  point: Point,
  from: Point,
  to: Point,
  bend: number,
  threshold: number,
): boolean {
  return isNearBezierRange(point, from, to, bend, threshold, 0, 1);
}

export function isNearArrowCurve(
  point: Point,
  arrow: ArrowElement,
  threshold: number,
  resolveBounds: (id: string) => Bounds | null,
): boolean {
  const curve = getArrowCurve(arrow, resolveBounds);
  return isNearBezierRange(point, arrow.from, arrow.to, arrow.bend, threshold, curve.t0, curve.t1);
}

function isNearBezierRange(
  point: Point,
  from: Point,
  to: Point,
  bend: number,
  threshold: number,
  t0: number,
  t1: number,
): boolean {
  if (bend === 0) {
    return isNearLine(
      point,
      bezierPoint(from, getArrowControlPoint(from, to, bend), to, t0),
      bezierPoint(from, getArrowControlPoint(from, to, bend), to, t1),
      threshold,
    );
  }

  const cp = getArrowControlPoint(from, to, bend);
  const segments = 20;

  for (let i = 0; i < segments; i++) {
    const start = t0 + ((t1 - t0) * i) / segments;
    const end = t0 + ((t1 - t0) * (i + 1)) / segments;
    const a = bezierPoint(from, cp, to, start);
    const b = bezierPoint(from, cp, to, end);
    if (isNearLine(point, a, b, threshold)) return true;
  }

  return false;
}

function getExitT(
  from: Point,
  control: Point,
  to: Point,
  bounds: Bounds,
  fromStart: boolean,
): number {
  const endpoint = fromStart ? from : to;
  if (!isInsideBounds(endpoint, bounds)) return fromStart ? 0 : 1;

  let inside = fromStart ? 0 : 1;
  for (let i = 1; i <= 32; i++) {
    const sample = fromStart ? i / 32 : 1 - i / 32;
    if (isInsideBounds(bezierPoint(from, control, to, sample), bounds)) {
      inside = sample;
      continue;
    }

    let outside = sample;
    for (let j = 0; j < 12; j++) {
      const mid = (inside + outside) / 2;
      if (isInsideBounds(bezierPoint(from, control, to, mid), bounds)) inside = mid;
      else outside = mid;
    }
    return fromStart ? outside : outside;
  }
  return fromStart ? 1 : 0;
}

function isInsideBounds(point: Point, bounds: Bounds): boolean {
  return (
    point.x >= bounds.x &&
    point.x <= bounds.x + bounds.w &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.h
  );
}

export function getArrowBounds(from: Point, to: Point, bend: number): Bounds {
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
  const steps = 20;
  let minX = Math.min(from.x, to.x);
  let minY = Math.min(from.y, to.y);
  let maxX = Math.max(from.x, to.x);
  let maxY = Math.max(from.y, to.y);

  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const p = bezierPoint(from, cp, to, t);
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function bezierPoint(from: Point, cp: Point, to: Point, t: number): Point {
  const mt = 1 - t;
  return {
    x: mt * mt * from.x + 2 * mt * t * cp.x + t * t * to.x,
    y: mt * mt * from.y + 2 * mt * t * cp.y + t * t * to.y,
  };
}

function isNearLine(point: Point, a: Point, b: Point, threshold: number): boolean {
  return distSqToSegment(point, a, b) <= threshold * threshold;
}
