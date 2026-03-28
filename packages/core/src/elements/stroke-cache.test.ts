import { describe, it, expect } from 'vitest';
import { computeStrokeSegments, getStrokeRenderData } from './stroke-cache';
import { createStroke } from './element-factory';

function makeStroke(pointCount = 5) {
  const points = [];
  for (let i = 0; i < pointCount; i++) {
    points.push({ x: i * 10, y: i * 5, pressure: 0.5 });
  }
  return createStroke({ points, width: 3 });
}

describe('stroke-cache', () => {
  describe('computeStrokeSegments', () => {
    it('returns segments and widths arrays of equal length', () => {
      const stroke = makeStroke();
      const data = computeStrokeSegments(stroke);
      expect(data.segments.length).toBeGreaterThan(0);
      expect(data.widths.length).toBe(data.segments.length);
    });

    it('computes widths from pressure and stroke width', () => {
      const stroke = makeStroke();
      const data = computeStrokeSegments(stroke);
      for (const w of data.widths) {
        expect(w).toBeGreaterThan(0);
      }
    });

    it('returns empty arrays for strokes with fewer than 2 points', () => {
      const stroke = createStroke({ points: [{ x: 0, y: 0, pressure: 0.5 }] });
      const data = computeStrokeSegments(stroke);
      expect(data.segments).toEqual([]);
      expect(data.widths).toEqual([]);
    });
  });

  describe('getStrokeRenderData', () => {
    it('returns same reference on repeated calls (WeakMap cache hit)', () => {
      const stroke = makeStroke();
      const data1 = getStrokeRenderData(stroke);
      const data2 = getStrokeRenderData(stroke);
      expect(data1).toBe(data2);
    });

    it('returns different reference for different stroke objects', () => {
      const stroke1 = makeStroke();
      const stroke2 = makeStroke();
      const data1 = getStrokeRenderData(stroke1);
      const data2 = getStrokeRenderData(stroke2);
      expect(data1).not.toBe(data2);
    });

    it('warms cache when computeStrokeSegments is called first', () => {
      const stroke = makeStroke();
      const warmed = computeStrokeSegments(stroke);
      const fetched = getStrokeRenderData(stroke);
      expect(fetched).toBe(warmed);
    });
  });
});
