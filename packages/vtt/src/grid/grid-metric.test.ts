import { describe, it, expect } from 'vitest';
import type { Point } from '@fieldnotes/core';
import { pathDistanceCells } from './grid-metric';
import type { GridMetric } from './grid-metric';

const alternate: GridMetric = { gridSize: 10, gridType: 'square', diagonalRule: 'alternate' };

function diagonal(from: number, to: number): Point[] {
  const points: Point[] = [];
  for (let i = from; i <= to; i++) points.push({ x: i * 10, y: i * 10 });
  return points;
}

describe('pathDistanceCells', () => {
  it('alternate parity continues across calls', () => {
    expect(pathDistanceCells(diagonal(0, 4), alternate)).toMatchObject({ total: 6, diagonals: 4 });

    const first = pathDistanceCells(diagonal(0, 2), alternate);
    const second = pathDistanceCells(diagonal(2, 4), alternate, {
      startDiagonals: first.diagonals,
    });
    expect(first.total + second.total).toBe(6);
    expect(second.diagonals).toBe(4);
  });

  it('an odd split carries the parity: 1 then 1+2+1+2 minus the first', () => {
    const first = pathDistanceCells(diagonal(0, 1), alternate);
    const second = pathDistanceCells(diagonal(1, 4), alternate, {
      startDiagonals: first.diagonals,
    });
    expect(first).toMatchObject({ total: 1, diagonals: 1 });
    expect(second).toMatchObject({ total: 5, cumulative: [0, 2, 3, 5], diagonals: 4 });
  });

  it('startDiagonals does not change chebyshev or manhattan costs', () => {
    const options = { startDiagonals: 1 };
    const chebyshev = { ...alternate, diagonalRule: 'chebyshev' } as const;
    const manhattan = { ...alternate, diagonalRule: 'manhattan' } as const;
    expect(pathDistanceCells(diagonal(0, 3), chebyshev, options)).toMatchObject({
      total: 3,
      diagonals: 4,
    });
    expect(pathDistanceCells(diagonal(0, 3), manhattan, options).total).toBe(6);
  });

  it.each([-1, 1.5, NaN, Infinity])('treats startDiagonals %s as 0', (startDiagonals) => {
    expect(pathDistanceCells(diagonal(0, 1), alternate, { startDiagonals })).toMatchObject({
      total: 1,
      diagonals: 1,
    });
  });

  it.each<[string, GridMetric]>([
    ['euclidean square', { gridSize: 10, gridType: 'square', diagonalRule: 'euclidean' }],
    ['hex', { gridSize: 10, gridType: 'hex', hexOrientation: 'pointy' }],
    ['gridless', { gridSize: 10 }],
  ])('reports zero diagonals for %s', (_name, grid) => {
    expect(pathDistanceCells(diagonal(0, 2), grid, { startDiagonals: 3 }).diagonals).toBe(0);
  });
});
