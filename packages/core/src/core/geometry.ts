import type { Point } from './types';

export function distSqToSegment(p: Point, a: Point, b: Point): number {
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
