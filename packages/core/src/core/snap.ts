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
