import type { Bounds } from '../core/types';

export interface SnapGuide {
  axis: 'x' | 'y';
  position: number;
}
export interface SnapResult {
  dx: number;
  dy: number;
  guides: SnapGuide[];
}

interface AxisAnchors {
  lo: number;
  mid: number;
  hi: number;
}

function xAnchors(b: Bounds): AxisAnchors {
  return { lo: b.x, mid: b.x + b.w / 2, hi: b.x + b.w };
}

function yAnchors(b: Bounds): AxisAnchors {
  return { lo: b.y, mid: b.y + b.h / 2, hi: b.y + b.h };
}

function bestAxisSnap(
  moving: AxisAnchors,
  targets: Bounds[],
  anchorsFn: (b: Bounds) => AxisAnchors,
  threshold: number,
): { delta: number; position: number } | null {
  let best: { delta: number; position: number } | null = null;

  for (const t of targets) {
    const ta = anchorsFn(t);
    const pairs: [number, number][] = [
      // colinear alignment: same-type edges/centers line up
      [ta.lo - moving.lo, ta.lo],
      [ta.mid - moving.mid, ta.mid],
      [ta.hi - moving.hi, ta.hi],
      // abutment: the moving box sits flush against the target's opposite edge
      [ta.lo - moving.hi, ta.lo],
      [ta.hi - moving.lo, ta.hi],
    ];

    for (const [delta, position] of pairs) {
      const abs = Math.abs(delta);
      if (abs <= threshold && (best === null || abs < Math.abs(best.delta))) {
        best = { delta, position };
      }
    }
  }

  return best;
}

export function computeSnapGuides(
  moving: Bounds,
  targets: Bounds[],
  threshold: number,
): SnapResult {
  const xSnap = bestAxisSnap(xAnchors(moving), targets, xAnchors, threshold);
  const ySnap = bestAxisSnap(yAnchors(moving), targets, yAnchors, threshold);

  const guides: SnapGuide[] = [];
  if (xSnap) guides.push({ axis: 'x', position: xSnap.position });
  if (ySnap) guides.push({ axis: 'y', position: ySnap.position });

  return { dx: xSnap?.delta ?? 0, dy: ySnap?.delta ?? 0, guides };
}
