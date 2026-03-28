import type { StrokeElement } from './types';
import type { CurveSegment } from './stroke-smoothing';
import { smoothToSegments, pressureToWidth } from './stroke-smoothing';

export interface StrokeRenderData {
  segments: CurveSegment[];
  widths: number[];
}

// Strokes are immutable after commit. If points ever become mutable,
// this cache must be invalidated on store.update().
const cache = new WeakMap<StrokeElement, StrokeRenderData>();

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

  const data: StrokeRenderData = { segments, widths };
  cache.set(stroke, data);
  return data;
}

export function getStrokeRenderData(stroke: StrokeElement): StrokeRenderData {
  const cached = cache.get(stroke);
  if (cached) return cached;
  return computeStrokeSegments(stroke);
}
