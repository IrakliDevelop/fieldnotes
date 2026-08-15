import type { Point } from './types';
import type { HexOrientation } from '../elements/types';
import type { ToolContext } from '../tools/types';

export function snapPoint(point: Point, gridSize: number): Point {
  return {
    x: Math.round(point.x / gridSize) * gridSize || 0,
    y: Math.round(point.y / gridSize) * gridSize || 0,
  };
}

export function snapToHexCenter(
  point: Point,
  cellSize: number,
  orientation: HexOrientation,
): Point {
  if (orientation === 'pointy') {
    const hexW = Math.sqrt(3) * cellSize;
    const rowH = 1.5 * cellSize;
    const row = Math.round(point.y / rowH);
    const offsetX = row % 2 !== 0 ? hexW / 2 : 0;
    const col = Math.round((point.x - offsetX) / hexW);
    return { x: col * hexW + offsetX || 0, y: row * rowH || 0 };
  } else {
    const hexH = Math.sqrt(3) * cellSize;
    const colW = 1.5 * cellSize;
    const col = Math.round(point.x / colW);
    const offsetY = col % 2 !== 0 ? hexH / 2 : 0;
    const row = Math.round((point.y - offsetY) / hexH);
    return { x: col * colW || 0, y: row * hexH + offsetY || 0 };
  }
}

export function smartSnap(point: Point, ctx: ToolContext): Point {
  if (!ctx.snapToGrid || !ctx.gridSize) return point;
  if (ctx.gridType === 'hex' && ctx.hexOrientation) {
    return snapToHexCenter(point, ctx.gridSize, ctx.hexOrientation);
  }
  return snapPoint(point, ctx.gridSize);
}

/** Cell footprint of a snapped thing: a scalar N means N×N cells. */
export type Footprint = number | { w: number; h: number };

function footprintOf(footprint: Footprint): { w: number; h: number } {
  return typeof footprint === 'number' ? { w: footprint, h: footprint } : footprint;
}

function snapAxisToCell(value: number, gridSize: number, cells: number): number {
  const n = Math.max(1, Math.round(cells));
  if (n % 2 === 0) return Math.round(value / gridSize) * gridSize || 0;
  return (Math.round((value - gridSize / 2) / gridSize) + 0.5) * gridSize || 0;
}

/**
 * Snaps a CENTRE point so a footprint of `w`×`h` cells fills whole cells on a
 * square grid: an odd axis lands on a cell centre, an even axis on an
 * intersection. Each axis is independent (a 1×2 footprint centres on X and
 * sits on an intersection on Y). Compare `snapPoint`, which snaps to
 * intersections only.
 */
export function snapToCellCenter(point: Point, gridSize: number, footprint: Footprint = 1): Point {
  const { w, h } = footprintOf(footprint);
  return { x: snapAxisToCell(point.x, gridSize, w), y: snapAxisToCell(point.y, gridSize, h) };
}

/**
 * `smartSnap` for centres: identity when snapping is off, hex centres on hex
 * grids, footprint-aware cell centres otherwise.
 */
export function snapFootprintCenter(point: Point, footprint: Footprint, ctx: ToolContext): Point {
  if (!ctx.snapToGrid || !ctx.gridSize) return point;
  if (ctx.gridType === 'hex' && ctx.hexOrientation) {
    return snapToHexCenter(point, ctx.gridSize, ctx.hexOrientation);
  }
  return snapToCellCenter(point, ctx.gridSize, footprint);
}
