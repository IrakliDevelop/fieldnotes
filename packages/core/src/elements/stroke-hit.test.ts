// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { hitTestStroke } from './stroke-hit';
import { createStroke } from './element-factory';
import * as strokeCache from './stroke-cache';

function stroke(points: { x: number; y: number }[], position = { x: 0, y: 0 }) {
  return createStroke({
    position,
    points: points.map((p) => ({ ...p, pressure: 0.5 })),
  });
}

describe('hitTestStroke', () => {
  it('hits BETWEEN sparse sample points (the raw-point-scan miss case)', () => {
    const s = stroke([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    expect(hitTestStroke(s, { x: 50, y: 8 }, 10)).toBe(true);
  });

  it('respects the radius around the segment chord', () => {
    const s = stroke([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    expect(hitTestStroke(s, { x: 50, y: 9 }, 10)).toBe(true);
    expect(hitTestStroke(s, { x: 50, y: 11 }, 10)).toBe(false);
  });

  it('applies the stroke position offset', () => {
    const s = stroke(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      { x: 200, y: 300 },
    );
    expect(hitTestStroke(s, { x: 250, y: 305 }, 10)).toBe(true);
    expect(hitTestStroke(s, { x: 50, y: 5 }, 10)).toBe(false);
  });

  it('handles single-point strokes', () => {
    const s = stroke([{ x: 0, y: 0 }], { x: 10, y: 10 });
    expect(hitTestStroke(s, { x: 12, y: 12 }, 5)).toBe(true);
    expect(hitTestStroke(s, { x: 20, y: 20 }, 5)).toBe(false);
  });

  it('hits along a multi-point curve', () => {
    const s = stroke([
      { x: 0, y: 0 },
      { x: 50, y: 40 },
      { x: 100, y: 0 },
    ]);
    expect(hitTestStroke(s, { x: 50, y: 40 }, 5)).toBe(true);
    expect(hitTestStroke(s, { x: 50, y: 100 }, 5)).toBe(false);
  });

  it('bounds early-out skips segment computation for far probes', () => {
    const spy = vi.spyOn(strokeCache, 'getStrokeRenderData');
    const s = stroke([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    expect(hitTestStroke(s, { x: 500, y: 500 }, 10)).toBe(false);
    expect(spy).not.toHaveBeenCalled();

    expect(hitTestStroke(s, { x: 50, y: 5 }, 10)).toBe(true);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
