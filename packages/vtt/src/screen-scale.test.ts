import { afterEach, describe, expect, it, vi } from 'vitest';
import { worldUnitsPerCssPx } from './screen-scale';

function ctxWithTransform(a: number, b: number): CanvasRenderingContext2D {
  return {
    getTransform: () => ({ a, b, c: -b, d: a, e: 0, f: 0 }),
  } as unknown as CanvasRenderingContext2D;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('worldUnitsPerCssPx', () => {
  it('divides dpr by the scale of a layer-cache transform scale(dpr)·scale(zoom)', () => {
    vi.stubGlobal('devicePixelRatio', 2);
    expect(worldUnitsPerCssPx(ctxWithTransform(2 * 0.5, 0))).toBe(2);
  });

  it('reads the scale of a rotated transform', () => {
    vi.stubGlobal('devicePixelRatio', 1);
    const angle = Math.PI / 6;
    expect(
      worldUnitsPerCssPx(ctxWithTransform(2 * Math.cos(angle), 2 * Math.sin(angle))),
    ).toBeCloseTo(0.5, 10);
  });

  it('returns 1 when getTransform is missing', () => {
    vi.stubGlobal('devicePixelRatio', 2);
    expect(worldUnitsPerCssPx({} as CanvasRenderingContext2D)).toBe(1);
  });

  it('returns 1 for a degenerate transform', () => {
    vi.stubGlobal('devicePixelRatio', 2);
    expect(worldUnitsPerCssPx(ctxWithTransform(0, 0))).toBe(1);
  });
});
