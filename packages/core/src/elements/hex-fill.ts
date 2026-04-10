import type { Point } from '../core/types';
import type { HexOrientation } from './types';

interface HexCoord {
  col: number;
  row: number;
}

function offsetToCube(
  col: number,
  row: number,
  orientation: HexOrientation,
): { q: number; r: number } {
  if (orientation === 'pointy') {
    return { q: col - (row - (row & 1)) / 2, r: row };
  }
  return { q: col, r: row - (col - (col & 1)) / 2 };
}

function cubeToOffset(q: number, r: number, orientation: HexOrientation): HexCoord {
  if (orientation === 'pointy') {
    return { col: q + (r - (r & 1)) / 2, row: r };
  }
  return { col: q, row: r + (q - (q & 1)) / 2 };
}

function offsetToPixel(
  col: number,
  row: number,
  cellSize: number,
  orientation: HexOrientation,
): Point {
  if (orientation === 'pointy') {
    const hexW = Math.sqrt(3) * cellSize;
    const rowH = 1.5 * cellSize;
    const offsetX = row % 2 !== 0 ? hexW / 2 : 0;
    return { x: col * hexW + offsetX, y: row * rowH };
  }
  const hexH = Math.sqrt(3) * cellSize;
  const colW = 1.5 * cellSize;
  const offsetY = col % 2 !== 0 ? hexH / 2 : 0;
  return { x: col * colW, y: row * hexH + offsetY };
}

function pixelToOffset(
  x: number,
  y: number,
  cellSize: number,
  orientation: HexOrientation,
): HexCoord {
  if (orientation === 'pointy') {
    const hexW = Math.sqrt(3) * cellSize;
    const rowH = 1.5 * cellSize;
    const row = Math.round(y / rowH);
    const offsetX = row % 2 !== 0 ? hexW / 2 : 0;
    return { col: Math.round((x - offsetX) / hexW), row };
  }
  const hexH = Math.sqrt(3) * cellSize;
  const colW = 1.5 * cellSize;
  const col = Math.round(x / colW);
  const offsetY = col % 2 !== 0 ? hexH / 2 : 0;
  return { col, row: Math.round((y - offsetY) / hexH) };
}

function enumerateHexRing(
  centerQ: number,
  centerR: number,
  n: number,
  orientation: HexOrientation,
  cellSize: number,
): Point[] {
  const cells: Point[] = [];
  for (let dq = -n; dq <= n; dq++) {
    const rMin = Math.max(-n, -dq - n);
    const rMax = Math.min(n, -dq + n);
    for (let dr = rMin; dr <= rMax; dr++) {
      const absQ = centerQ + dq;
      const absR = centerR + dr;
      const off = cubeToOffset(absQ, absR, orientation);
      cells.push(offsetToPixel(off.col, off.row, cellSize, orientation));
    }
  }
  return cells;
}

export function getHexDistance(
  a: Point,
  b: Point,
  cellSize: number,
  orientation: HexOrientation,
): number {
  const offA = pixelToOffset(a.x, a.y, cellSize, orientation);
  const offB = pixelToOffset(b.x, b.y, cellSize, orientation);
  const cubeA = offsetToCube(offA.col, offA.row, orientation);
  const cubeB = offsetToCube(offB.col, offB.row, orientation);
  const dq = cubeA.q - cubeB.q;
  const dr = cubeA.r - cubeB.r;
  const ds = -dq - dr;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(ds));
}

export function getHexCellsInRadius(
  center: Point,
  radiusCells: number,
  cellSize: number,
  orientation: HexOrientation,
): Point[] {
  const n = Math.round(radiusCells);
  const off = pixelToOffset(center.x, center.y, cellSize, orientation);
  const cube = offsetToCube(off.col, off.row, orientation);
  if (n <= 0) {
    return [offsetToPixel(off.col, off.row, cellSize, orientation)];
  }
  return enumerateHexRing(cube.q, cube.r, n, orientation, cellSize);
}

export function getHexCellsInCone(
  center: Point,
  angle: number,
  radiusCells: number,
  cellSize: number,
  orientation: HexOrientation,
): Point[] {
  const n = Math.round(radiusCells);
  const off = pixelToOffset(center.x, center.y, cellSize, orientation);
  const cube = offsetToCube(off.col, off.row, orientation);
  const centerPixel = offsetToPixel(off.col, off.row, cellSize, orientation);

  if (n <= 0) return [centerPixel];

  const vertexOffset = orientation === 'pointy' ? Math.PI / 6 : 0;
  const step = Math.PI / 3;
  const snappedAngle = Math.round((angle - vertexOffset) / step) * step + vertexOffset;

  const halfAngle = Math.PI / 6 + 1e-6;
  const cells: Point[] = [centerPixel];

  for (let dq = -n; dq <= n; dq++) {
    const rMin = Math.max(-n, -dq - n);
    const rMax = Math.min(n, -dq + n);
    for (let dr = rMin; dr <= rMax; dr++) {
      if (dq === 0 && dr === 0) continue;
      const absQ = cube.q + dq;
      const absR = cube.r + dr;
      const pixel = offsetToPixel(
        cubeToOffset(absQ, absR, orientation).col,
        cubeToOffset(absQ, absR, orientation).row,
        cellSize,
        orientation,
      );

      const dx = pixel.x - centerPixel.x;
      const dy = pixel.y - centerPixel.y;
      let diff = Math.atan2(dy, dx) - snappedAngle;
      if (diff > Math.PI) diff -= 2 * Math.PI;
      if (diff < -Math.PI) diff += 2 * Math.PI;

      if (Math.abs(diff) <= halfAngle) {
        cells.push(pixel);
      }
    }
  }
  return cells;
}

export function getHexCellsInLine(
  center: Point,
  angle: number,
  radiusCells: number,
  cellSize: number,
  orientation: HexOrientation,
): Point[] {
  const n = Math.round(radiusCells);
  const off = pixelToOffset(center.x, center.y, cellSize, orientation);
  const cube = offsetToCube(off.col, off.row, orientation);
  const centerPixel = offsetToPixel(off.col, off.row, cellSize, orientation);

  if (n <= 0) return [centerPixel];

  const vertexOffset = orientation === 'pointy' ? Math.PI / 6 : 0;
  const step = Math.PI / 3;
  const snappedAngle = Math.round((angle - vertexOffset) / step) * step + vertexOffset;

  const cos = Math.cos(snappedAngle);
  const sin = Math.sin(snappedAngle);
  const snapUnit = Math.sqrt(3) * cellSize;
  const lineLength = n * snapUnit;
  const halfWidth = snapUnit * 0.5 + 1e-6;
  const cells: Point[] = [];

  for (let dq = -n; dq <= n; dq++) {
    const rMin = Math.max(-n, -dq - n);
    const rMax = Math.min(n, -dq + n);
    for (let dr = rMin; dr <= rMax; dr++) {
      const absQ = cube.q + dq;
      const absR = cube.r + dr;
      const pixel = offsetToPixel(
        cubeToOffset(absQ, absR, orientation).col,
        cubeToOffset(absQ, absR, orientation).row,
        cellSize,
        orientation,
      );

      const dx = pixel.x - centerPixel.x;
      const dy = pixel.y - centerPixel.y;
      const along = dx * cos + dy * sin;
      const perp = Math.abs(-dx * sin + dy * cos);

      if (along >= -snapUnit * 0.1 && along <= lineLength + snapUnit * 0.1 && perp <= halfWidth) {
        cells.push(pixel);
      }
    }
  }
  return cells;
}

export function getHexCellsInSquare(
  center: Point,
  radiusCells: number,
  cellSize: number,
  orientation: HexOrientation,
): Point[] {
  const n = Math.round(radiusCells);
  const off = pixelToOffset(center.x, center.y, cellSize, orientation);
  const cube = offsetToCube(off.col, off.row, orientation);
  const centerPixel = offsetToPixel(off.col, off.row, cellSize, orientation);

  if (n <= 0) return [centerPixel];

  const snapUnit = Math.sqrt(3) * cellSize;
  const halfSide = (n * snapUnit) / 2;
  const cells: Point[] = [];

  for (let dq = -n; dq <= n; dq++) {
    const rMin = Math.max(-n, -dq - n);
    const rMax = Math.min(n, -dq + n);
    for (let dr = rMin; dr <= rMax; dr++) {
      const absQ = cube.q + dq;
      const absR = cube.r + dr;
      const pixel = offsetToPixel(
        cubeToOffset(absQ, absR, orientation).col,
        cubeToOffset(absQ, absR, orientation).row,
        cellSize,
        orientation,
      );

      if (
        Math.abs(pixel.x - centerPixel.x) <= halfSide &&
        Math.abs(pixel.y - centerPixel.y) <= halfSide
      ) {
        cells.push(pixel);
      }
    }
  }
  return cells;
}

export function drawHexPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  cellSize: number,
  orientation: HexOrientation,
): void {
  const angleOffset = orientation === 'pointy' ? Math.PI / 6 : 0;
  ctx.moveTo(cx + cellSize * Math.cos(angleOffset), cy + cellSize * Math.sin(angleOffset));
  for (let i = 1; i < 6; i++) {
    const a = angleOffset + (Math.PI / 3) * i;
    ctx.lineTo(cx + cellSize * Math.cos(a), cy + cellSize * Math.sin(a));
  }
  ctx.closePath();
}
