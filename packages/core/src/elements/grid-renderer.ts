import type { HexOrientation } from './types';

export interface VisibleBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface SquareGridLines {
  verticals: number[];
  horizontals: number[];
}

export function getSquareGridLines(bounds: VisibleBounds, cellSize: number): SquareGridLines {
  if (cellSize <= 0) return { verticals: [], horizontals: [] };

  const verticals: number[] = [];
  const startX = Math.floor(bounds.minX / cellSize) * cellSize;
  const endX = Math.ceil(bounds.maxX / cellSize) * cellSize;
  for (let x = startX; x <= endX; x += cellSize) {
    verticals.push(x);
  }

  const horizontals: number[] = [];
  const startY = Math.floor(bounds.minY / cellSize) * cellSize;
  const endY = Math.ceil(bounds.maxY / cellSize) * cellSize;
  for (let y = startY; y <= endY; y += cellSize) {
    horizontals.push(y);
  }

  return { verticals, horizontals };
}

export interface HexVertex {
  x: number;
  y: number;
}

export function getHexVertices(
  cx: number,
  cy: number,
  circumradius: number,
  orientation: HexOrientation,
): HexVertex[] {
  const vertices: HexVertex[] = [];
  const angleOffset = orientation === 'pointy' ? -Math.PI / 2 : 0;
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i + angleOffset;
    vertices.push({
      x: cx + circumradius * Math.cos(angle),
      y: cy + circumradius * Math.sin(angle),
    });
  }
  return vertices;
}

export function getHexCenters(
  bounds: VisibleBounds,
  circumradius: number,
  orientation: HexOrientation,
): HexVertex[] {
  if (circumradius <= 0) return [];

  const centers: HexVertex[] = [];

  if (orientation === 'pointy') {
    const hexW = Math.sqrt(3) * circumradius;
    const hexH = 2 * circumradius;
    const rowH = hexH * 0.75;

    const startRow = Math.floor((bounds.minY - circumradius) / rowH);
    const endRow = Math.ceil((bounds.maxY + circumradius) / rowH);
    const startCol = Math.floor((bounds.minX - hexW) / hexW);
    const endCol = Math.ceil((bounds.maxX + hexW) / hexW);

    for (let row = startRow; row <= endRow; row++) {
      const offsetX = row % 2 !== 0 ? hexW / 2 : 0;
      for (let col = startCol; col <= endCol; col++) {
        centers.push({
          x: col * hexW + offsetX,
          y: row * rowH,
        });
      }
    }
  } else {
    const hexW = 2 * circumradius;
    const hexH = Math.sqrt(3) * circumradius;
    const colW = hexW * 0.75;

    const startCol = Math.floor((bounds.minX - circumradius) / colW);
    const endCol = Math.ceil((bounds.maxX + circumradius) / colW);
    const startRow = Math.floor((bounds.minY - hexH) / hexH);
    const endRow = Math.ceil((bounds.maxY + hexH) / hexH);

    for (let col = startCol; col <= endCol; col++) {
      const offsetY = col % 2 !== 0 ? hexH / 2 : 0;
      for (let row = startRow; row <= endRow; row++) {
        centers.push({
          x: col * colW,
          y: row * hexH + offsetY,
        });
      }
    }
  }

  return centers;
}

export function renderSquareGrid(
  ctx: CanvasRenderingContext2D,
  bounds: VisibleBounds,
  cellSize: number,
  strokeColor: string,
  strokeWidth: number,
  opacity: number,
): void {
  if (cellSize <= 0) return;

  const { verticals, horizontals } = getSquareGridLines(bounds, cellSize);

  ctx.save();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = strokeWidth;
  ctx.globalAlpha = opacity;
  ctx.beginPath();

  for (const x of verticals) {
    ctx.moveTo(x, bounds.minY);
    ctx.lineTo(x, bounds.maxY);
  }
  for (const y of horizontals) {
    ctx.moveTo(bounds.minX, y);
    ctx.lineTo(bounds.maxX, y);
  }

  ctx.stroke();
  ctx.restore();
}

export function renderHexGrid(
  ctx: CanvasRenderingContext2D,
  bounds: VisibleBounds,
  cellSize: number,
  orientation: HexOrientation,
  strokeColor: string,
  strokeWidth: number,
  opacity: number,
): void {
  if (cellSize <= 0) return;

  // Precompute 6 vertex offsets once (12 trig calls total, not 12 per hex)
  const angleOffset = orientation === 'pointy' ? -Math.PI / 2 : 0;
  const ox0 = cellSize * Math.cos(angleOffset);
  const oy0 = cellSize * Math.sin(angleOffset);
  const ox1 = cellSize * Math.cos(Math.PI / 3 + angleOffset);
  const oy1 = cellSize * Math.sin(Math.PI / 3 + angleOffset);
  const ox2 = cellSize * Math.cos((2 * Math.PI) / 3 + angleOffset);
  const oy2 = cellSize * Math.sin((2 * Math.PI) / 3 + angleOffset);
  const ox3 = cellSize * Math.cos(Math.PI + angleOffset);
  const oy3 = cellSize * Math.sin(Math.PI + angleOffset);
  const ox4 = cellSize * Math.cos((4 * Math.PI) / 3 + angleOffset);
  const oy4 = cellSize * Math.sin((4 * Math.PI) / 3 + angleOffset);
  const ox5 = cellSize * Math.cos((5 * Math.PI) / 3 + angleOffset);
  const oy5 = cellSize * Math.sin((5 * Math.PI) / 3 + angleOffset);

  ctx.save();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = strokeWidth;
  ctx.globalAlpha = opacity;
  ctx.beginPath();

  // Inline center iteration — zero allocations per hex
  if (orientation === 'pointy') {
    const hexW = Math.sqrt(3) * cellSize;
    const rowH = 1.5 * cellSize;

    const startRow = Math.floor((bounds.minY - cellSize) / rowH);
    const endRow = Math.ceil((bounds.maxY + cellSize) / rowH);
    const startCol = Math.floor((bounds.minX - hexW) / hexW);
    const endCol = Math.ceil((bounds.maxX + hexW) / hexW);

    for (let row = startRow; row <= endRow; row++) {
      const offX = row % 2 !== 0 ? hexW / 2 : 0;
      for (let col = startCol; col <= endCol; col++) {
        const cx = col * hexW + offX;
        const cy = row * rowH;
        ctx.moveTo(cx + ox0, cy + oy0);
        ctx.lineTo(cx + ox1, cy + oy1);
        ctx.lineTo(cx + ox2, cy + oy2);
        ctx.lineTo(cx + ox3, cy + oy3);
        ctx.lineTo(cx + ox4, cy + oy4);
        ctx.lineTo(cx + ox5, cy + oy5);
        ctx.closePath();
      }
    }
  } else {
    const hexH = Math.sqrt(3) * cellSize;
    const colW = 1.5 * cellSize;

    const startCol = Math.floor((bounds.minX - cellSize) / colW);
    const endCol = Math.ceil((bounds.maxX + cellSize) / colW);
    const startRow = Math.floor((bounds.minY - hexH) / hexH);
    const endRow = Math.ceil((bounds.maxY + hexH) / hexH);

    for (let col = startCol; col <= endCol; col++) {
      const offY = col % 2 !== 0 ? hexH / 2 : 0;
      for (let row = startRow; row <= endRow; row++) {
        const cx = col * colW;
        const cy = row * hexH + offY;
        ctx.moveTo(cx + ox0, cy + oy0);
        ctx.lineTo(cx + ox1, cy + oy1);
        ctx.lineTo(cx + ox2, cy + oy2);
        ctx.lineTo(cx + ox3, cy + oy3);
        ctx.lineTo(cx + ox4, cy + oy4);
        ctx.lineTo(cx + ox5, cy + oy5);
        ctx.closePath();
      }
    }
  }

  ctx.stroke();
  ctx.restore();
}
