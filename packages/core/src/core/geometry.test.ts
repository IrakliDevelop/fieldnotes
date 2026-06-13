import { describe, it, expect } from 'vitest';
import { distSqToSegment } from './geometry';

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
