import { describe, it, expect } from 'vitest';
import { lineEndpoints, lineFromEndpoints } from './shape-geometry';
import { createShape } from './element-factory';

describe('lineEndpoints', () => {
  it('main diagonal when flip is absent/false', () => {
    const s = createShape({ position: { x: 10, y: 20 }, size: { w: 30, h: 40 }, shape: 'line' });
    expect(lineEndpoints(s)).toEqual([
      { x: 10, y: 20 },
      { x: 40, y: 60 },
    ]);
  });
  it('anti-diagonal when flip is true', () => {
    const s = createShape({
      position: { x: 10, y: 20 },
      size: { w: 30, h: 40 },
      shape: 'line',
      flip: true,
    });
    expect(lineEndpoints(s)).toEqual([
      { x: 10, y: 60 },
      { x: 40, y: 20 },
    ]);
  });
});

describe('lineFromEndpoints', () => {
  it('main diagonal (NW→SE) → no flip', () => {
    expect(lineFromEndpoints({ x: 10, y: 20 }, { x: 40, y: 60 })).toEqual({
      position: { x: 10, y: 20 }, size: { w: 30, h: 40 }, flip: false,
    });
  });
  it('anti-diagonal (SW→NE) → flip', () => {
    expect(lineFromEndpoints({ x: 10, y: 60 }, { x: 40, y: 20 })).toEqual({
      position: { x: 10, y: 20 }, size: { w: 30, h: 40 }, flip: true,
    });
  });
  it('is symmetric under endpoint swap', () => {
    const a = { x: 5, y: 7 }, b = { x: 50, y: 3 };
    expect(lineFromEndpoints(a, b)).toEqual(lineFromEndpoints(b, a));
  });
  it('round-trips with lineEndpoints (endpoints recovered as a set)', () => {
    const a = { x: 12, y: 80 }, b = { x: 90, y: 14 };
    const geo = lineFromEndpoints(a, b);
    const shape = createShape({ position: geo.position, size: geo.size, shape: 'line', flip: geo.flip });
    const [ra, rb] = lineEndpoints(shape);
    expect(new Set([`${ra.x},${ra.y}`, `${rb.x},${rb.y}`])).toEqual(new Set([`${a.x},${a.y}`, `${b.x},${b.y}`]));
  });
});
