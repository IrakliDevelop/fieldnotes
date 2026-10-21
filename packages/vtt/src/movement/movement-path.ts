import type { Point } from '@fieldnotes/core';
import { pathDistanceCells } from '../grid/grid-metric';
import type { GridMetric } from '../grid/grid-metric';

/** Feet and diagonals after walking `path`, continuing from `start`; cumulative feet per point. */
export function measureMove(input: {
  path: readonly Point[];
  grid: GridMetric;
  feetPerCell: number;
  start: { feet: number; diagonals: number };
}): { feet: number; diagonals: number; cumulativeFeet: number[] } {
  const { path, grid, feetPerCell, start } = input;
  const { total, cumulative, diagonals } = pathDistanceCells(path, grid, {
    startDiagonals: start.diagonals,
  });
  return {
    feet: start.feet + total * feetPerCell,
    diagonals,
    cumulativeFeet: cumulative.map((cells) => start.feet + cells * feetPerCell),
  };
}
