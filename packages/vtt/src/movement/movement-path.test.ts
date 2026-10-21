import { describe, it, expect } from 'vitest';
import type { DiagonalRule } from '../grid/grid-metric';
import { measureMove } from './movement-path';

const square = (diagonalRule: DiagonalRule) => ({
  gridSize: 40,
  gridType: 'square' as const,
  diagonalRule,
});

describe('measureMove', () => {
  it.each([
    [
      'chebyshev',
      { feet: 0, diagonals: 0 },
      { feet: 10, diagonals: 2, cumulativeFeet: [0, 5, 10] },
    ],
    [
      'alternate',
      { feet: 0, diagonals: 0 },
      { feet: 15, diagonals: 2, cumulativeFeet: [0, 5, 15] },
    ],
    [
      'alternate',
      { feet: 5, diagonals: 1 },
      { feet: 20, diagonals: 3, cumulativeFeet: [5, 15, 20] },
    ],
    [
      'manhattan',
      { feet: 20, diagonals: 0 },
      { feet: 40, diagonals: 2, cumulativeFeet: [20, 30, 40] },
    ],
  ] as const)('%s from %o continues the running total', (rule, start, expected) => {
    const path = [
      { x: 20, y: 20 },
      { x: 60, y: 60 },
      { x: 100, y: 100 },
    ];
    expect(measureMove({ path, grid: square(rule), feetPerCell: 5, start })).toEqual(expected);
  });

  it('gridless paths measure euclidean distance in cells of the grid size', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 30, y: 40 },
    ];
    const move = measureMove({
      path,
      grid: { gridSize: 25 },
      feetPerCell: 5,
      start: { feet: 7, diagonals: 3 },
    });
    expect(move).toEqual({ feet: 17, diagonals: 0, cumulativeFeet: [7, 17] });
  });
});
