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
