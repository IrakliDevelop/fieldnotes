import type { Point } from '../core/types';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
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

export function getBendFromPoint(from: Point, to: Point, dragPoint: Point): number {
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.sqrt(dx * dx + dy * dy);

  if (len === 0) return 0;

  const perpX = -dy / len;
  const perpY = dx / len;

  return (dragPoint.x - midX) * perpX + (dragPoint.y - midY) * perpY;
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
  if (bend === 0) return isNearLine(point, from, to, threshold);

  const cp = getArrowControlPoint(from, to, bend);
  const segments = 20;

  for (let i = 0; i < segments; i++) {
    const t0 = i / segments;
    const t1 = (i + 1) / segments;
    const a = bezierPoint(from, cp, to, t0);
    const b = bezierPoint(from, cp, to, t1);
    if (isNearLine(point, a, b, threshold)) return true;
  }

  return false;
}

export function getArrowBounds(from: Point, to: Point, bend: number): Rect {
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
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    return Math.hypot(point.x - a.x, point.y - a.y) <= threshold;
  }

  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(point.x - projX, point.y - projY) <= threshold;
}
