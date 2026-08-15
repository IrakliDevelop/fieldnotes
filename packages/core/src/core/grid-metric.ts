// packages/core/src/core/grid-metric.ts
import type { Point } from './types';
import type { HexOrientation } from '../elements/types';
import { getHexDistance } from '../elements/hex-fill';

/**
 * How diagonal steps are costed on a SQUARE grid, in cells.
 * - `euclidean` — straight-line distance over the cell size (the ruler's behaviour; default).
 * - `chebyshev` — a diagonal step costs one cell.
 * - `alternate` — diagonals alternate 1, 2, 1, 2 … cells ("5-10-5"), counted over the WHOLE path.
 * - `manhattan` — a diagonal step costs two cells.
 * Ignored on hex grids (hex distance is the cube metric).
 */
export type DiagonalRule = 'euclidean' | 'chebyshev' | 'alternate' | 'manhattan';

export interface GridMetric {
  gridSize: number;
  gridType?: 'square' | 'hex';
  hexOrientation?: HexOrientation;
  diagonalRule?: DiagonalRule;
}

export interface PathDistance {
  /** Cost of the whole path in cells. */
  total: number;
  /** Cost after each waypoint; `cumulative[0] === 0`, one entry per point. */
  cumulative: number[];
}

function squareCost(rule: DiagonalRule, straight: number, diag: number): number {
  switch (rule) {
    case 'alternate':
      return straight + diag + Math.floor(diag / 2);
    case 'manhattan':
      return straight + 2 * diag;
    case 'chebyshev':
    case 'euclidean':
    default:
      return straight + diag;
  }
}

/**
 * Distance of a polyline in grid cells. Stateful rules (`alternate`) accumulate
 * over the whole path, so the unit of computation is the path, not a segment;
 * a segment's own cost is `cumulative[i] - cumulative[i - 1]`.
 */
export function pathDistanceCells(points: readonly Point[], grid: GridMetric): PathDistance {
  const cumulative: number[] = [];
  const first = points[0];
  if (first === undefined) return { total: 0, cumulative };
  const gridSize = grid.gridSize > 0 ? grid.gridSize : 1;
  const rule = grid.diagonalRule ?? 'euclidean';
  const orientation = grid.hexOrientation;
  const hex = grid.gridType === 'hex' && orientation !== undefined;
  const squareRule = grid.gridType === 'square' && rule !== 'euclidean';

  let straight = 0;
  let diag = 0;
  let euclid = 0;
  let hexCells = 0;
  cumulative.push(0);
  let prev = first;
  for (let i = 1; i < points.length; i++) {
    const next = points[i];
    if (next === undefined) break;
    if (hex && orientation !== undefined) {
      hexCells += getHexDistance(prev, next, gridSize, orientation);
      cumulative.push(hexCells);
    } else if (squareRule) {
      const dx = Math.abs(Math.round((next.x - prev.x) / gridSize));
      const dy = Math.abs(Math.round((next.y - prev.y) / gridSize));
      const d = Math.min(dx, dy);
      diag += d;
      straight += Math.max(dx, dy) - d;
      cumulative.push(squareCost(rule, straight, diag));
    } else {
      euclid += Math.hypot(next.x - prev.x, next.y - prev.y) / gridSize;
      cumulative.push(euclid);
    }
    prev = next;
  }
  const total = cumulative[cumulative.length - 1] ?? 0;
  return { total, cumulative };
}

/** Two-point convenience over `pathDistanceCells`. */
export function gridDistanceCells(a: Point, b: Point, grid: GridMetric): number {
  return pathDistanceCells([a, b], grid).total;
}
