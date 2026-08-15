// packages/core/src/core/grid-metric.test.ts
import { describe, it, expect } from 'vitest';
import { pathDistanceCells, gridDistanceCells } from './grid-metric';
import { getHexDistance } from '../elements/hex-fill';
import type { Point } from './types';

const G = 40;
/** Cell-centre coordinates on a 40px square grid. */
const c = (col: number, row: number): Point => ({ x: (col + 0.5) * G, y: (row + 0.5) * G });

describe('pathDistanceCells — square rules', () => {
  it('chebyshev: a diagonal step costs one cell', () => {
    const r = pathDistanceCells([c(0, 0), c(3, 2)], {
      gridSize: G,
      gridType: 'square',
      diagonalRule: 'chebyshev',
    });
    expect(r.total).toBe(3);
    expect(r.cumulative).toEqual([0, 3]);
  });

  it('manhattan: a diagonal step costs two cells', () => {
    expect(
      gridDistanceCells(c(0, 0), c(1, 1), {
        gridSize: G,
        gridType: 'square',
        diagonalRule: 'manhattan',
      }),
    ).toBe(2);
    expect(
      gridDistanceCells(c(0, 0), c(3, 2), {
        gridSize: G,
        gridType: 'square',
        diagonalRule: 'manhattan',
      }),
    ).toBe(5);
  });

  it('alternate (5-10-5): the second diagonal is the expensive one, even across a waypoint', () => {
    const r = pathDistanceCells([c(0, 0), c(1, 1), c(2, 2)], {
      gridSize: G,
      gridType: 'square',
      diagonalRule: 'alternate',
    });
    expect(r.cumulative).toEqual([0, 1, 3]);
    expect(r.total).toBe(3);
  });

  it('alternate: diagonal count accumulates across straight segments in between', () => {
    // (0,0)→(1,1) diag#1 = 1; →(1,2) straight = 2; →(2,3) diag#2 = 4
    const r = pathDistanceCells([c(0, 0), c(1, 1), c(1, 2), c(2, 3)], {
      gridSize: G,
      gridType: 'square',
      diagonalRule: 'alternate',
    });
    expect(r.cumulative).toEqual([0, 1, 2, 4]);
  });

  it('alternate: a single long diagonal run of 3 costs 4 (1 + 2 + 1)', () => {
    expect(
      gridDistanceCells(c(0, 0), c(3, 3), {
        gridSize: G,
        gridType: 'square',
        diagonalRule: 'alternate',
      }),
    ).toBe(4);
  });

  it('euclidean is the default and matches the ruler (hypot / gridSize)', () => {
    expect(gridDistanceCells(c(0, 0), c(3, 4), { gridSize: G, gridType: 'square' })).toBeCloseTo(5);
    expect(
      gridDistanceCells(c(0, 0), c(3, 4), {
        gridSize: G,
        gridType: 'square',
        diagonalRule: 'euclidean',
      }),
    ).toBeCloseTo(5);
  });

  it('a square rule with NO grid type falls back to euclidean', () => {
    expect(
      gridDistanceCells(c(0, 0), c(1, 1), { gridSize: G, diagonalRule: 'chebyshev' }),
    ).toBeCloseTo(Math.SQRT2);
  });

  it('tolerates float noise in centre coordinates (rounds cell deltas)', () => {
    expect(
      gridDistanceCells(
        { x: 20.0000001, y: 20 },
        { x: 59.9999999, y: 60 },
        { gridSize: G, gridType: 'square', diagonalRule: 'chebyshev' },
      ),
    ).toBe(1);
  });
});

describe('pathDistanceCells — hex and degenerate input', () => {
  it('hex delegates to getHexDistance per segment and ignores the diagonal rule', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 200, y: 120 };
    const d = { x: 350, y: 300 };
    const expected = getHexDistance(a, b, G, 'pointy') + getHexDistance(b, d, G, 'pointy');
    for (const rule of ['chebyshev', 'alternate', 'manhattan', 'euclidean'] as const) {
      const r = pathDistanceCells([a, b, d], {
        gridSize: G,
        gridType: 'hex',
        hexOrientation: 'pointy',
        diagonalRule: rule,
      });
      expect(r.total).toBe(expected);
      expect(r.cumulative[1]).toBe(getHexDistance(a, b, G, 'pointy'));
    }
  });

  it('empty and single-point paths are zero', () => {
    expect(pathDistanceCells([], { gridSize: G })).toEqual({ total: 0, cumulative: [] });
    expect(
      pathDistanceCells([c(0, 0)], { gridSize: G, gridType: 'square', diagonalRule: 'chebyshev' }),
    ).toEqual({ total: 0, cumulative: [0] });
  });

  it('a non-positive gridSize is treated as 1', () => {
    expect(gridDistanceCells({ x: 0, y: 0 }, { x: 3, y: 4 }, { gridSize: 0 })).toBeCloseTo(5);
  });
});
