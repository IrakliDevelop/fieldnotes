import { describe, it, expect } from 'vitest';
import { lineEndpoints } from './shape-geometry';
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
