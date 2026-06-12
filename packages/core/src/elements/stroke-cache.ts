import type { StrokeElement } from './types';
import type { CurveSegment } from './stroke-smoothing';
import { smoothToSegments, pressureToWidth } from './stroke-smoothing';

export interface StrokeWidthBucket {
  width: number;
  path: Path2D;
}

export interface StrokeRenderData {
  segments: CurveSegment[];
  widths: number[];
  buckets: StrokeWidthBucket[] | null;
}

// Strokes are immutable after commit. If points ever become mutable,
// this cache must be invalidated on store.update().
const cache = new WeakMap<StrokeElement, StrokeRenderData>();

const WIDTH_QUANTUM = 0.25;

function buildWidthBuckets(segments: CurveSegment[], widths: number[]): StrokeWidthBucket[] | null {
  if (typeof Path2D === 'undefined') return null;
  const byWidth = new Map<number, Path2D>();
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const w = widths[i];
    if (!seg || w === undefined) continue;
    const q = Math.max(WIDTH_QUANTUM, Math.round(w / WIDTH_QUANTUM) * WIDTH_QUANTUM);
    let path = byWidth.get(q);
    if (!path) {
      path = new Path2D();
      byWidth.set(q, path);
    }
    path.moveTo(seg.start.x, seg.start.y);
    path.bezierCurveTo(seg.cp1.x, seg.cp1.y, seg.cp2.x, seg.cp2.y, seg.end.x, seg.end.y);
  }
  return [...byWidth.entries()].map(([width, path]) => ({ width, path }));
}

export function computeStrokeSegments(stroke: StrokeElement): StrokeRenderData {
  const segments = smoothToSegments(stroke.points);
  const widths: number[] = [];

  for (const seg of segments) {
    const w =
      (pressureToWidth(seg.start.pressure, stroke.width) +
        pressureToWidth(seg.end.pressure, stroke.width)) /
      2;
    widths.push(w);
  }

  const data: StrokeRenderData = { segments, widths, buckets: buildWidthBuckets(segments, widths) };
  cache.set(stroke, data);
  return data;
}

export function getStrokeRenderData(stroke: StrokeElement): StrokeRenderData {
  const cached = cache.get(stroke);
  if (cached) return cached;
  return computeStrokeSegments(stroke);
}
