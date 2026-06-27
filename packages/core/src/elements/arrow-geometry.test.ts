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

  it('returns 2x the perpendicular projection for point below horizontal line', () => {
    // The handle is at the curve midpoint (half the control-point offset), so the bend that lands
    // it at perpendicular distance 40 must be 2*40 = 80.
    const bend = getBendFromPoint({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 40 });
    expect(bend).toBeCloseTo(80);
  });

  it('returns 2x the perpendicular projection for point above horizontal line', () => {
    const bend = getBendFromPoint({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: -30 });
    expect(bend).toBeCloseTo(-60);
  });

  it('returns 2x the perpendicular projection for a diagonal arrow', () => {
    // from=(0,0) to=(100,100): perp = (-1/√2, 1/√2). Point offset perpendicular by 20
    // (i.e. (50,50) + 20*perp = (50 - 20/√2, 50 + 20/√2)) → projection 20 → bend 40.
    const offset = 20 / Math.SQRT2;
    const P = { x: 50 - offset, y: 50 + offset };
    const bend = getBendFromPoint({ x: 0, y: 0 }, { x: 100, y: 100 }, P);
    expect(bend).toBeCloseTo(40);
  });

  it('returns 0 for zero-length arrow', () => {
    const bend = getBendFromPoint({ x: 50, y: 50 }, { x: 50, y: 50 }, { x: 60, y: 60 });
    expect(bend).toBe(0);
  });

  // Round-trip: the curve midpoint (where the handle is drawn) lands on the drag point's
  // perpendicular projection. This is the exact behavior the user reported as broken — dragging the
  // handle to a point must put the handle (curve midpoint) at that point, not at half the distance.
  describe('handle round-trip (curve midpoint lands at drag point)', () => {
    it('horizontal arrow, positive bend', () => {
      const from = { x: 0, y: 0 };
      const to = { x: 100, y: 0 };
      const P = { x: 50, y: 30 };
      const bend = getBendFromPoint(from, to, P);
      expect(bend).toBeCloseTo(60);
      const mid = getArrowMidpoint(from, to, bend);
      expect(mid.x).toBeCloseTo(P.x);
      expect(mid.y).toBeCloseTo(P.y);
    });

    it('horizontal arrow, negative bend', () => {
      const from = { x: 0, y: 0 };
      const to = { x: 100, y: 0 };
      const P = { x: 50, y: -45 };
      const bend = getBendFromPoint(from, to, P);
      const mid = getArrowMidpoint(from, to, bend);
      expect(mid.x).toBeCloseTo(P.x);
      expect(mid.y).toBeCloseTo(P.y);
    });

    it('diagonal arrow: midpoint lands at the perpendicular projection of P', () => {
      const from = { x: 0, y: 0 };
      const to = { x: 100, y: 100 };
      const offset = 35 / Math.SQRT2;
      // P is exactly on the perpendicular through the chord midpoint, so its projection is itself.
      const P = { x: 50 - offset, y: 50 + offset };
      const bend = getBendFromPoint(from, to, P);
      const mid = getArrowMidpoint(from, to, bend);
      expect(mid.x).toBeCloseTo(P.x);
      expect(mid.y).toBeCloseTo(P.y);
    });

    it('straight arrow (bend starts at 0): dragging the mid handle to distance d lands it at d', () => {
      const from = { x: 0, y: 0 };
      const to = { x: 80, y: 0 };
      const d = 25;
      const P = { x: 40, y: d };
      const bend = getBendFromPoint(from, to, P);
      expect(bend).toBeCloseTo(2 * d);
      const mid = getArrowMidpoint(from, to, bend);
      expect(mid.x).toBeCloseTo(40);
      expect(mid.y).toBeCloseTo(d);
    });
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
