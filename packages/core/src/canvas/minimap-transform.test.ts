import { describe, expect, it } from 'vitest';
import type { Bounds, Point } from '../core/types';
import {
  computeMinimapTransform,
  miniToWorld,
  unionBounds,
  worldToMini,
} from './minimap-transform';

describe('unionBounds', () => {
  it('unions disjoint boxes', () => {
    const a: Bounds = { x: 0, y: 0, w: 10, h: 10 };
    const b: Bounds = { x: 20, y: 20, w: 10, h: 10 };
    expect(unionBounds(a, b)).toEqual({ x: 0, y: 0, w: 30, h: 30 });
  });

  it('keeps the outer box when one is nested', () => {
    const outer: Bounds = { x: 0, y: 0, w: 100, h: 100 };
    const inner: Bounds = { x: 10, y: 10, w: 10, h: 10 };
    expect(unionBounds(outer, inner)).toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });

  it('returns the same box for identical inputs', () => {
    const a: Bounds = { x: 5, y: 7, w: 13, h: 17 };
    expect(unionBounds(a, a)).toEqual(a);
  });
});

describe('computeMinimapTransform', () => {
  it('fits a known mapping with the expected scale and centered offsets', () => {
    const t = computeMinimapTransform({ x: 0, y: 0, w: 100, h: 100 }, 200, 140, 8);
    // availW=184, availH=124 -> scale = min(1.84, 1.24) = 1.24
    expect(t.scale).toBeCloseTo(1.24);
    expect(t.offsetX).toBeCloseTo(38);
    expect(t.offsetY).toBeCloseTo(8);
  });

  it('is width-limited for a wide mapping', () => {
    const t = computeMinimapTransform({ x: 0, y: 0, w: 1000, h: 10 }, 200, 140, 8);
    expect(t.scale).toBeCloseTo(184 / 1000);
  });

  it('is height-limited for a tall mapping', () => {
    const t = computeMinimapTransform({ x: 0, y: 0, w: 10, h: 1000 }, 200, 140, 8);
    expect(t.scale).toBeCloseTo(124 / 1000);
  });

  it('guards against a zero-size mapping', () => {
    const t = computeMinimapTransform({ x: 5, y: 5, w: 0, h: 0 }, 200, 140, 8);
    expect(Number.isFinite(t.scale)).toBe(true);
    expect(t.scale).toBeCloseTo(124);
    expect(Number.isFinite(t.offsetX)).toBe(true);
    expect(Number.isFinite(t.offsetY)).toBe(true);
  });
});

describe('worldToMini', () => {
  it('maps known world coordinates onto the mini canvas', () => {
    const t = computeMinimapTransform({ x: 0, y: 0, w: 100, h: 100 }, 200, 140, 8);
    expect(worldToMini(t, { x: 0, y: 0 })).toEqual({
      x: expect.closeTo(38),
      y: expect.closeTo(8),
    });
    // mapping center maps to the mini-canvas center
    expect(worldToMini(t, { x: 50, y: 50 })).toEqual({
      x: expect.closeTo(100),
      y: expect.closeTo(70),
    });
  });
});

describe('round-trip miniToWorld(worldToMini)', () => {
  const cases: { mapping: Bounds; point: Point }[] = [
    { mapping: { x: 0, y: 0, w: 100, h: 100 }, point: { x: 12, y: 88 } },
    { mapping: { x: -50, y: 30, w: 200, h: 80 }, point: { x: 0, y: 0 } },
    { mapping: { x: 1000, y: -200, w: 640, h: 480 }, point: { x: 1234, y: 56 } },
  ];

  it.each(cases)('recovers the original point %#', ({ mapping, point }) => {
    const t = computeMinimapTransform(mapping, 200, 140, 8);
    const back = miniToWorld(t, worldToMini(t, point));
    expect(back.x).toBeCloseTo(point.x);
    expect(back.y).toBeCloseTo(point.y);
  });
});
