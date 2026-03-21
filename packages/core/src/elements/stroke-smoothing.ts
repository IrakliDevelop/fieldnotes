import type { Point, StrokePoint } from '../core/types';

export interface CurveSegment {
  start: StrokePoint;
  cp1: Point;
  cp2: Point;
  end: StrokePoint;
}

const MIN_PRESSURE_SCALE = 0.2;

export function pressureToWidth(pressure: number, baseWidth: number): number {
  return baseWidth * (MIN_PRESSURE_SCALE + (1 - MIN_PRESSURE_SCALE) * pressure);
}

export function simplifyPoints(points: StrokePoint[], tolerance: number): StrokePoint[] {
  if (points.length <= 2) return points.slice();
  return rdp(points, 0, points.length - 1, tolerance);
}

function rdp(points: StrokePoint[], start: number, end: number, tolerance: number): StrokePoint[] {
  const first = points[start];
  const last = points[end];
  if (!first || !last) return [];

  if (end - start <= 1) return [first, last];

  let maxDist = 0;
  let maxIndex = start;

  for (let i = start + 1; i < end; i++) {
    const pt = points[i];
    if (!pt) continue;
    const dist = perpendicularDistance(pt, first, last);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }

  if (maxDist <= tolerance) return [first, last];

  const left = rdp(points, start, maxIndex, tolerance);
  const right = rdp(points, maxIndex, end, tolerance);

  return left.concat(right.slice(1));
}

function perpendicularDistance(pt: Point, lineStart: Point, lineEnd: Point): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    const ex = pt.x - lineStart.x;
    const ey = pt.y - lineStart.y;
    return Math.sqrt(ex * ex + ey * ey);
  }

  const num = Math.abs(dy * pt.x - dx * pt.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x);
  return num / Math.sqrt(lenSq);
}

export function smoothToSegments(points: StrokePoint[]): CurveSegment[] {
  if (points.length < 2) return [];

  if (points.length === 2) {
    const p0 = points[0];
    const p1 = points[1];
    if (!p0 || !p1) return [];
    const mx = (p0.x + p1.x) / 2;
    const my = (p0.y + p1.y) / 2;
    return [{ start: p0, cp1: { x: mx, y: my }, cp2: { x: mx, y: my }, end: p1 }];
  }

  const segments: CurveSegment[] = [];
  const n = points.length;

  for (let i = 0; i < n - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(n - 1, i + 2)];
    if (!p0 || !p1 || !p2 || !p3) continue;

    const cp1: Point = {
      x: p1.x + (p2.x - p0.x) / 6,
      y: p1.y + (p2.y - p0.y) / 6,
    };
    const cp2: Point = {
      x: p2.x - (p3.x - p1.x) / 6,
      y: p2.y - (p3.y - p1.y) / 6,
    };

    segments.push({ start: p1, cp1, cp2, end: p2 });
  }

  return segments;
}
