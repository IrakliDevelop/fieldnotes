import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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

  describe('width buckets', () => {
    class FakePath2D {
      ops: string[] = [];
      moveTo(x: number, y: number): void {
        this.ops.push(`M${x},${y}`);
      }
      bezierCurveTo(): void {
        this.ops.push('C');
      }
    }

    beforeEach(() => {
      (globalThis as Record<string, unknown>).Path2D = FakePath2D;
    });
    afterEach(() => {
      delete (globalThis as Record<string, unknown>).Path2D;
    });

    function variedStroke() {
      return createStroke({
        points: [
          { x: 0, y: 0, pressure: 0.2 },
          { x: 10, y: 5, pressure: 0.5 },
          { x: 20, y: 0, pressure: 0.9 },
          { x: 30, y: 5, pressure: 0.4 },
          { x: 40, y: 0, pressure: 0.7 },
        ],
        width: 4,
      });
    }

    it('groups segments into quantized width buckets covering all segments', () => {
      const data = computeStrokeSegments(variedStroke());
      expect(data.buckets).not.toBeNull();
      const totalCurves = (data.buckets ?? []).reduce(
        (sum, b) => sum + (b.path as unknown as FakePath2D).ops.filter((o) => o === 'C').length,
        0,
      );
      expect(totalCurves).toBe(data.segments.length);
      for (const b of data.buckets ?? []) {
        expect((b.width * 4) % 1).toBeCloseTo(0); // multiples of 0.25
      }
    });

    it('every segment width quantizes to an existing bucket within half a quantum', () => {
      const data = computeStrokeSegments(variedStroke());
      for (const w of data.widths) {
        const q = Math.max(0.25, Math.round(w / 0.25) * 0.25);
        expect(Math.abs(q - w)).toBeLessThanOrEqual(0.125 + 1e-9);
        expect((data.buckets ?? []).some((b) => Math.abs(b.width - q) < 1e-9)).toBe(true);
      }
    });

    it('buckets is null when Path2D is unavailable', () => {
      delete (globalThis as Record<string, unknown>).Path2D;
      expect(computeStrokeSegments(variedStroke()).buckets).toBeNull();
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
