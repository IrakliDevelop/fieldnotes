import type { Point } from '@fieldnotes/core';
import type { HexOrientation } from '../elements/types';
import { snapPoint } from '@fieldnotes/core';
import type { ToolContext } from '@fieldnotes/core';

export { snapPoint };

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

/** Cell footprint of a snapped thing: a scalar N means N×N cells. */
export type Footprint = number | { w: number; h: number };

function footprintOf(footprint: Footprint): { w: number; h: number } {
  return typeof footprint === 'number' ? { w: footprint, h: footprint } : footprint;
}

/**
 * The cell footprint an element of `size` occupies on a square grid: each axis
 * rounds to the NEAREST whole cell (a 1.25-cell token is one cell wide), never
 * below one. Without a usable grid size the footprint is a single cell.
 */
export function footprintFromSize(size: { w: number; h: number }, gridSize: number): Footprint {
  if (!(gridSize > 0)) return 1;
  return {
    w: Math.max(1, Math.round(size.w / gridSize)),
    h: Math.max(1, Math.round(size.h / gridSize)),
  };
}

function snapAxisToCell(value: number, gridSize: number, cells: number): number {
  const n = Math.max(1, Math.round(cells));
  if (n % 2 === 0) return Math.round(value / gridSize) * gridSize || 0;
  return (Math.round((value - gridSize / 2) / gridSize) + 0.5) * gridSize || 0;
}

/**
 * Snaps a CENTRE point so a footprint of `w`×`h` cells fills whole cells on a
 * square grid: an odd axis lands on a cell centre, an even axis on an
 * intersection.
 */
export function snapToCellCenter(point: Point, gridSize: number, footprint: Footprint = 1): Point {
  const { w, h } = footprintOf(footprint);
  return { x: snapAxisToCell(point.x, gridSize, w), y: snapAxisToCell(point.y, gridSize, h) };
}

/**
 * Constraint-service-aware snap: delegates to the constraint service when
 * active, otherwise falls back to hex/cell snapping via direct grid fields.
 */
export function smartSnap(point: Point, ctx: ToolContext): Point {
  const cs = ctx.constraintService;
  if (cs) {
    return cs.isActive ? cs.constrainPoint(point) : point;
  }
  return point;
}

/**
 * `smartSnap` for centres: delegates to the constraint service when active,
 * with footprint-aware cell centres as fallback.
 */
export function snapFootprintCenter(point: Point, footprint: Footprint, ctx: ToolContext): Point {
  const cs = ctx.constraintService;
  if (cs) {
    if (!cs.isActive) return point;
    const fp = typeof footprint === 'number' ? { w: footprint, h: footprint } : footprint;
    return cs.constrainPoint(point, { footprint: { width: fp.w, height: fp.h } });
  }
  return point;
}
