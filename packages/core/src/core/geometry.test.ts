import { describe, it, expect } from 'vitest';
import { distSqToSegment, rotatePoint, rotatedAABB, normalizeAngle } from './geometry';

describe('distSqToSegment', () => {
  it('projects onto the segment interior', () => {
    expect(distSqToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(9);
  });
  it('clamps to the start endpoint', () => {
    expect(distSqToSegment({ x: -4, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(16);
  });
  it('clamps to the end endpoint', () => {
    expect(distSqToSegment({ x: 14, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(16);
  });
  it('handles a zero-length segment (point distance)', () => {
    expect(distSqToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(25);
  });
});

describe('rotatePoint', () => {
  it('is identity at angle 0', () => {
    expect(rotatePoint({ x: 5, y: 7 }, { x: 0, y: 0 }, 0)).toEqual({ x: 5, y: 7 });
  });
  it('rotates 90° clockwise about a center', () => {
    const r = rotatePoint({ x: 1, y: 0 }, { x: 0, y: 0 }, Math.PI / 2);
    expect(r.x).toBeCloseTo(0);
    expect(r.y).toBeCloseTo(1);
  });
});

describe('rotatedAABB', () => {
  it('is identity at angle 0', () => {
    expect(rotatedAABB({ x: 0, y: 0, w: 10, h: 4 }, 0)).toEqual({ x: 0, y: 0, w: 10, h: 4 });
  });
  it('grows a square by √2 at 45°', () => {
    const b = rotatedAABB({ x: 0, y: 0, w: 10, h: 10 }, Math.PI / 4);
    expect(b.w).toBeCloseTo(10 * Math.SQRT2);
    expect(b.h).toBeCloseTo(10 * Math.SQRT2);
    expect(b.x + b.w / 2).toBeCloseTo(5);
    expect(b.y + b.h / 2).toBeCloseTo(5);
  });
});

describe('normalizeAngle', () => {
  it('wraps into (-π, π]', () => {
    expect(normalizeAngle(Math.PI * 2)).toBeCloseTo(0);
    expect(normalizeAngle(Math.PI * 1.5)).toBeCloseTo(-Math.PI / 2);
    expect(normalizeAngle(-Math.PI * 1.5)).toBeCloseTo(Math.PI / 2);
  });
  it('keeps the closed upper bound: -π maps to π, π stays π', () => {
    expect(normalizeAngle(-Math.PI)).toBeCloseTo(Math.PI);
    expect(normalizeAngle(Math.PI)).toBeCloseTo(Math.PI);
  });
});
