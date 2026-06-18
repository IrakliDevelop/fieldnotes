import type { Point, StrokePoint } from '../core/types';

function lerp(a: StrokePoint, b: StrokePoint, t: number): StrokePoint {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    pressure: a.pressure + (b.pressure - a.pressure) * t,
  };
}

/**
 * Split a stroke's points by an eraser circle (all in the stroke's local space).
 * Returns surviving runs (each ≥2 points), `[]` if fully erased, or `null` if nothing
 * was within the radius (no change).
 */
export function erasePoints(
  points: StrokePoint[],
  eraser: Point,
  radius: number,
): StrokePoint[][] | null {
  const r2 = radius * radius;

  if (points.length < 2) {
    const p = points[0];
    if (p && (p.x - eraser.x) ** 2 + (p.y - eraser.y) ** 2 <= r2) return [];
    return null;
  }

  const runs: StrokePoint[][] = [];
  let current: StrokePoint[] = [];
  let erased = false;

  const flush = (): void => {
    if (current.length >= 2) runs.push(current);
    current = [];
  };

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (!a || !b) continue;

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const fx = a.x - eraser.x;
    const fy = a.y - eraser.y;
    const A = dx * dx + dy * dy;
    const B = 2 * (fx * dx + fy * dy);
    const C = fx * fx + fy * fy - r2;

    let tLo = 1;
    let tHi = 0;
    if (A === 0) {
      if (C <= 0) {
        tLo = 0;
        tHi = 1;
      }
    } else {
      const disc = B * B - 4 * A * C;
      if (disc >= 0) {
        const sq = Math.sqrt(disc);
        const lo = Math.max(0, (-B - sq) / (2 * A));
        const hi = Math.min(1, (-B + sq) / (2 * A));
        if (lo <= hi) {
          tLo = lo;
          tHi = hi;
        }
      }
    }

    if (tLo > tHi) {
      if (current.length === 0) current.push(a);
      current.push(b);
      continue;
    }

    erased = true;
    if (tLo > 0) {
      if (current.length === 0) current.push(a);
      current.push(lerp(a, b, tLo));
      flush();
    } else {
      flush();
    }
    if (tHi < 1) {
      current = [lerp(a, b, tHi), b];
    }
  }

  flush();
  return erased ? runs : null;
}
