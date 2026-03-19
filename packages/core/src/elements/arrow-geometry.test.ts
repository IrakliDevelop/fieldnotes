import { describe, it, expect } from 'vitest';
import {
  getArrowControlPoint,
  getArrowMidpoint,
  getBendFromPoint,
  getArrowTangentAngle,
  isNearBezier,
  getArrowBounds,
} from './arrow-geometry';

describe('getArrowControlPoint', () => {
  it('returns midpoint when bend is 0', () => {
    const cp = getArrowControlPoint({ x: 0, y: 0 }, { x: 100, y: 0 }, 0);
    expect(cp).toEqual({ x: 50, y: 0 });
  });

  it('offsets perpendicular to the line', () => {
    const cp = getArrowControlPoint({ x: 0, y: 0 }, { x: 100, y: 0 }, 50);
    expect(cp.x).toBeCloseTo(50);
    expect(cp.y).toBeCloseTo(50);
  });

  it('negative bend offsets the other direction', () => {
    const cp = getArrowControlPoint({ x: 0, y: 0 }, { x: 100, y: 0 }, -30);
    expect(cp.x).toBeCloseTo(50);
    expect(cp.y).toBeCloseTo(-30);
  });

  it('handles zero-length arrow', () => {
    const cp = getArrowControlPoint({ x: 50, y: 50 }, { x: 50, y: 50 }, 10);
    expect(cp).toEqual({ x: 50, y: 50 });
  });

  it('works with diagonal arrows', () => {
    const cp = getArrowControlPoint({ x: 0, y: 0 }, { x: 100, y: 100 }, 0);
    expect(cp.x).toBeCloseTo(50);
    expect(cp.y).toBeCloseTo(50);
  });
});

describe('getArrowMidpoint', () => {
  it('returns midpoint when bend is 0', () => {
    const mid = getArrowMidpoint({ x: 0, y: 0 }, { x: 100, y: 0 }, 0);
    expect(mid.x).toBeCloseTo(50);
    expect(mid.y).toBeCloseTo(0);
  });

  it('returns a point on the curve when bent', () => {
    const mid = getArrowMidpoint({ x: 0, y: 0 }, { x: 100, y: 0 }, 50);
    expect(mid.x).toBeCloseTo(50);
    expect(mid.y).toBeCloseTo(25);
  });
});

describe('getBendFromPoint', () => {
  it('returns 0 when point is on the midpoint', () => {
    const bend = getBendFromPoint({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 0 });
    expect(bend).toBeCloseTo(0);
  });

  it('returns positive bend for point below horizontal line', () => {
    const bend = getBendFromPoint({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 40 });
    expect(bend).toBeCloseTo(40);
  });

  it('returns negative bend for point above horizontal line', () => {
    const bend = getBendFromPoint({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: -30 });
    expect(bend).toBeCloseTo(-30);
  });

  it('is inverse of getArrowControlPoint', () => {
    const from = { x: 10, y: 20 };
    const to = { x: 150, y: 80 };
    const originalBend = 42;
    const cp = getArrowControlPoint(from, to, originalBend);
    const recovered = getBendFromPoint(from, to, cp);
    expect(recovered).toBeCloseTo(originalBend);
  });

  it('returns 0 for zero-length arrow', () => {
    const bend = getBendFromPoint({ x: 50, y: 50 }, { x: 50, y: 50 }, { x: 60, y: 60 });
    expect(bend).toBe(0);
  });
});

describe('getArrowTangentAngle', () => {
  it('returns straight angle for bend 0', () => {
    const angle = getArrowTangentAngle({ x: 0, y: 0 }, { x: 100, y: 0 }, 0, 1);
    expect(angle).toBeCloseTo(0);
  });

  it('tangent at t=0 points away from start', () => {
    const angle = getArrowTangentAngle({ x: 0, y: 0 }, { x: 100, y: 0 }, 0, 0);
    expect(angle).toBeCloseTo(0);
  });

  it('tangent at endpoint follows curve direction', () => {
    const angle = getArrowTangentAngle({ x: 0, y: 0 }, { x: 100, y: 0 }, 50, 1);
    expect(angle).not.toBeCloseTo(0);
  });

  it('matches atan2 for straight arrows', () => {
    const from = { x: 10, y: 20 };
    const to = { x: 80, y: 90 };
    const angle = getArrowTangentAngle(from, to, 0, 1);
    const expected = Math.atan2(to.y - from.y, to.x - from.x);
    expect(angle).toBeCloseTo(expected);
  });
});

describe('isNearBezier', () => {
  it('detects point near a straight arrow', () => {
    expect(isNearBezier({ x: 50, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 }, 0, 10)).toBe(true);
  });

  it('rejects distant point on straight arrow', () => {
    expect(isNearBezier({ x: 50, y: 50 }, { x: 0, y: 0 }, { x: 100, y: 0 }, 0, 10)).toBe(false);
  });

  it('detects point near a curved arrow', () => {
    const mid = getArrowMidpoint({ x: 0, y: 0 }, { x: 100, y: 0 }, 50);
    expect(isNearBezier(mid, { x: 0, y: 0 }, { x: 100, y: 0 }, 50, 5)).toBe(true);
  });

  it('rejects point on straight path when arrow is curved', () => {
    expect(isNearBezier({ x: 50, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 }, 80, 5)).toBe(false);
  });

  it('detects point near endpoints', () => {
    expect(isNearBezier({ x: 2, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 }, 50, 5)).toBe(true);
    expect(isNearBezier({ x: 98, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 }, 50, 5)).toBe(true);
  });
});

describe('getArrowBounds', () => {
  it('returns simple bounds for straight arrow', () => {
    const bounds = getArrowBounds({ x: 10, y: 20 }, { x: 110, y: 80 }, 0);
    expect(bounds).toEqual({ x: 10, y: 20, w: 100, h: 60 });
  });

  it('expands bounds to include curve bulge', () => {
    const bounds = getArrowBounds({ x: 0, y: 0 }, { x: 100, y: 0 }, 50);
    expect(bounds.y).toBe(0);
    expect(bounds.h).toBeGreaterThan(0);
  });

  it('handles negative bend', () => {
    const bounds = getArrowBounds({ x: 0, y: 0 }, { x: 100, y: 0 }, -50);
    expect(bounds.y).toBeLessThan(0);
    expect(bounds.h).toBeGreaterThan(0);
  });
});
