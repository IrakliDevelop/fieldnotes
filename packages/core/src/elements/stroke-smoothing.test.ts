import { describe, it, expect } from 'vitest';
import { simplifyPoints, smoothToSegments, pressureToWidth } from './stroke-smoothing';
import type { StrokePoint } from '../core/types';

function sp(x: number, y: number, pressure = 0.5): StrokePoint {
  return { x, y, pressure };
}

describe('simplifyPoints (RDP)', () => {
  it('returns all points when fewer than 3', () => {
    const pts = [sp(0, 0), sp(10, 10)];
    expect(simplifyPoints(pts, 5)).toEqual(pts);
  });

  it('returns copy, not reference', () => {
    const pts = [sp(0, 0), sp(10, 10)];
    const result = simplifyPoints(pts, 5);
    expect(result).not.toBe(pts);
  });

  it('removes collinear interior points', () => {
    const pts = [sp(0, 0), sp(5, 5), sp(10, 10)];
    const result = simplifyPoints(pts, 1);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(sp(0, 0));
    expect(result[1]).toEqual(sp(10, 10));
  });

  it('preserves sharp corners', () => {
    const pts = [sp(0, 0), sp(10, 0), sp(10, 10)];
    const result = simplifyPoints(pts, 1);
    expect(result).toHaveLength(3);
  });

  it('preserves first and last points', () => {
    const pts = [sp(0, 0), sp(1, 0.1), sp(2, 0), sp(3, 0.1), sp(4, 0)];
    const result = simplifyPoints(pts, 5);
    expect(result[0]).toEqual(sp(0, 0));
    expect(result[result.length - 1]).toEqual(sp(4, 0));
  });

  it('keeps all points when tolerance is 0', () => {
    const pts = [sp(0, 0), sp(5, 1), sp(10, 0)];
    const result = simplifyPoints(pts, 0);
    expect(result).toHaveLength(3);
  });

  it('preserves pressure values on surviving points', () => {
    const pts = [sp(0, 0, 0.2), sp(5, 5, 0.8), sp(10, 10, 1.0)];
    const result = simplifyPoints(pts, 1);
    expect(result[0]?.pressure).toBe(0.2);
    expect(result[result.length - 1]?.pressure).toBe(1.0);
  });
});

describe('smoothToSegments (Catmull-Rom)', () => {
  it('returns empty for fewer than 2 points', () => {
    expect(smoothToSegments([sp(0, 0)])).toEqual([]);
    expect(smoothToSegments([])).toEqual([]);
  });

  it('returns 1 segment for 2 points', () => {
    const result = smoothToSegments([sp(0, 0), sp(10, 10)]);
    expect(result).toHaveLength(1);
    expect(result[0]?.start).toEqual(sp(0, 0));
    expect(result[0]?.end).toEqual(sp(10, 10));
  });

  it('returns N-1 segments for N points', () => {
    const pts = [sp(0, 0), sp(5, 5), sp(10, 0), sp(15, 5)];
    expect(smoothToSegments(pts)).toHaveLength(3);
  });

  it('produces finite control points', () => {
    const pts = [sp(0, 0), sp(10, 5), sp(20, 0)];
    const segments = smoothToSegments(pts);
    for (const seg of segments) {
      expect(Number.isFinite(seg.cp1.x)).toBe(true);
      expect(Number.isFinite(seg.cp1.y)).toBe(true);
      expect(Number.isFinite(seg.cp2.x)).toBe(true);
      expect(Number.isFinite(seg.cp2.y)).toBe(true);
    }
  });

  it('handles all identical points', () => {
    const pts = [sp(5, 5), sp(5, 5), sp(5, 5)];
    const segments = smoothToSegments(pts);
    expect(segments).toHaveLength(2);
    for (const seg of segments) {
      expect(Number.isFinite(seg.cp1.x)).toBe(true);
    }
  });
});

describe('pressureToWidth', () => {
  it('returns base width at full pressure', () => {
    expect(pressureToWidth(1.0, 4)).toBe(4);
  });

  it('returns minimum width at zero pressure', () => {
    expect(pressureToWidth(0, 4)).toBeCloseTo(0.8);
  });

  it('returns intermediate width at 0.5 pressure', () => {
    const w = pressureToWidth(0.5, 4);
    expect(w).toBeGreaterThan(0.8);
    expect(w).toBeLessThan(4);
  });

  it('scales linearly with base width', () => {
    const w1 = pressureToWidth(0.5, 2);
    const w2 = pressureToWidth(0.5, 4);
    expect(w2).toBeCloseTo(w1 * 2);
  });
});
