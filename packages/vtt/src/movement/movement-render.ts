import type { Point } from '@fieldnotes/core';
import type { HexOrientation } from '../elements/types';
import type { GridMetric } from '../grid/grid-metric';
import { drawHexPath } from '../grid/hex-fill';
import type { Footprint } from '../grid/snap';
import type { PathRangeBand } from '../path-tool';
import { drawLabelPill, worldUnitsPerCssPx } from '../screen-scale';
import { measureMove } from './movement-path';

/** Default band colors for a walk budget and its dash: green, then yellow. */
export const DEFAULT_MOVEMENT_BANDS_COLORS = ['#2E7D32', '#F9A825'] as const;

/** Color beyond the last band. */
export const MOVEMENT_OVER_COLOR = '#C62828';

const CELL_ALPHA = 0.35;
const TRAIL_ALPHA = 0.35;
const SQRT3 = Math.sqrt(3);

/** A tinted cell: its center in world units and band color. */
export interface MovementCell {
  readonly x: number;
  readonly y: number;
  readonly color: string;
}

/** Plain-data picture of one live tracked drag; safe to send as presence. */
export interface MovementRenderModel {
  readonly grid: {
    readonly type: 'square' | 'hex' | 'none';
    readonly cellSize: number;
    readonly orientation?: HexOrientation;
  };
  /** Earlier runs this epoch, drawn faded. */
  readonly trail: readonly (readonly Point[])[];
  /** The current drag. */
  readonly path: readonly Point[];
  /** One per path segment. */
  readonly segmentColors: readonly string[];
  /** Empty when the grid type is 'none'. */
  readonly cells: readonly MovementCell[];
  readonly label: string;
}

function bandFor(feet: number, bands: readonly PathRangeBand[]): PathRangeBand | undefined {
  return [...bands].sort((a, b) => a.feet - b.feet).find((b) => b.feet >= feet);
}

/** `35 ft · 25 left` within a band; the total alone beyond the last. */
export function formatMovementLabel(feet: number, bands: readonly PathRangeBand[]): string {
  const total = `${Math.round(feet)} ft`;
  const band = bandFor(feet, bands);
  return band ? `${total} · ${Math.round(band.feet - feet)} left` : total;
}

interface Axial {
  q: number;
  r: number;
}

function cubeRound({ q, r }: Axial): Axial {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq, r: rr };
}

// Axial math matches hex-fill's odd-offset layout, whose cell (0, 0) is centred on the origin.
function toAxial(p: Point, size: number, orientation: HexOrientation): Axial {
  return orientation === 'pointy'
    ? { q: ((SQRT3 / 3) * p.x - p.y / 3) / size, r: ((2 / 3) * p.y) / size }
    : { q: ((2 / 3) * p.x) / size, r: (-p.x / 3 + (SQRT3 / 3) * p.y) / size };
}

function toPixel(q: number, r: number, size: number, orientation: HexOrientation): Point {
  return orientation === 'pointy'
    ? { x: size * SQRT3 * (q + r / 2), y: size * 1.5 * r }
    : { x: size * 1.5 * q, y: size * SQRT3 * (r + q / 2) };
}

/** Ordered hex cell centers from `a` to `b` by cube lerp, start excluded. */
export function hexLineCells(
  a: Point,
  b: Point,
  cellSize: number,
  orientation: HexOrientation,
): Point[] {
  const from = cubeRound(toAxial(a, cellSize, orientation));
  const to = cubeRound(toAxial(b, cellSize, orientation));
  const n = Math.max(
    Math.abs(to.q - from.q),
    Math.abs(to.r - from.r),
    Math.abs(to.q + to.r - from.q - from.r),
  );
  // The nudge breaks lerp ties on cell edges the same way every time.
  const q0 = from.q + 1e-6;
  const r0 = from.r + 2e-6;
  const cells: Point[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const c = cubeRound({ q: q0 + (to.q - q0) * t, r: r0 + (to.r - r0) * t });
    cells.push(toPixel(c.q, c.r, cellSize, orientation));
  }
  return cells;
}

// Chebyshev walk: diagonal steps while both axes remain, then straight; start excluded.
function squareLineCells(a: Point, b: Point, cellSize: number): Point[] {
  let dx = Math.round((b.x - a.x) / cellSize);
  let dy = Math.round((b.y - a.y) / cellSize);
  let { x, y } = a;
  const cells: Point[] = [];
  while (dx !== 0 || dy !== 0) {
    const sx = Math.sign(dx);
    const sy = Math.sign(dy);
    x += sx * cellSize;
    y += sy * cellSize;
    dx -= sx;
    dy -= sy;
    cells.push({ x, y });
  }
  return cells;
}

/** Cells, segment colors, and label for a drag along `path`, continuing from `start`. */
export function buildMovementModel(input: {
  path: readonly Point[];
  trail: readonly (readonly Point[])[];
  grid: GridMetric;
  feetPerCell: number;
  start: { feet: number; diagonals: number };
  bands: readonly PathRangeBand[];
  overColor: string;
  /** Square-grid cells the element covers; every step tints all of them. */
  footprint?: Footprint;
}): MovementRenderModel {
  const { path, grid, feetPerCell, bands, overColor } = input;
  const cellSize = grid.gridSize;
  const orientation = grid.hexOrientation;
  const type =
    grid.gridType === 'square' ? 'square' : grid.gridType === 'hex' && orientation ? 'hex' : 'none';
  const fp = input.footprint ?? 1;
  const { w, h } = typeof fp === 'number' ? { w: fp, h: fp } : fp;
  const colorAt = (feet: number): string => bandFor(feet, bands)?.color ?? overColor;

  const cells: MovementCell[] = [];
  const seen = new Set<string>();
  const tint = (x: number, y: number, color: string): void => {
    const key = `${x},${y}`;
    if (seen.has(key)) return;
    seen.add(key);
    cells.push({ x, y, color });
  };
  const segmentColors: string[] = [];
  let start = input.start;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (a === undefined || b === undefined) break;
    const walk =
      type === 'square'
        ? squareLineCells(a, b, cellSize)
        : type === 'hex' && orientation
          ? hexLineCells(a, b, cellSize, orientation)
          : [];
    for (const center of walk) {
      const color = colorAt(measureMove({ path: [a, center], grid, feetPerCell, start }).feet);
      if (type === 'hex') {
        tint(center.x, center.y, color);
        continue;
      }
      for (let col = 0; col < w; col++) {
        for (let row = 0; row < h; row++) {
          tint(
            center.x + (col - (w - 1) / 2) * cellSize,
            center.y + (row - (h - 1) / 2) * cellSize,
            color,
          );
        }
      }
    }
    start = measureMove({ path: [a, b], grid, feetPerCell, start });
    segmentColors.push(colorAt(start.feet));
  }

  return {
    grid: orientation && type === 'hex' ? { type, cellSize, orientation } : { type, cellSize },
    trail: input.trail,
    path,
    segmentColors,
    cells,
    label: formatMovementLabel(start.feet, bands),
  };
}

/** Tinted cells, the faded trail, the current path, and the label (when non-empty). */
export function drawMovement(
  ctx: CanvasRenderingContext2D,
  model: MovementRenderModel,
  opts: { alpha?: number } = {},
): void {
  const alpha = opts.alpha ?? 1;
  const { type, cellSize, orientation } = model.grid;
  const k = worldUnitsPerCssPx(ctx);
  ctx.save();
  ctx.globalAlpha = alpha * CELL_ALPHA;
  for (const cell of model.cells) {
    ctx.fillStyle = cell.color;
    if (type === 'hex' && orientation) {
      ctx.beginPath();
      drawHexPath(ctx, cell.x, cell.y, cellSize, orientation);
      ctx.fill();
    } else {
      ctx.fillRect(cell.x - cellSize / 2, cell.y - cellSize / 2, cellSize, cellSize);
    }
  }
  ctx.lineWidth = 3 * k;
  ctx.globalAlpha = alpha * TRAIL_ALPHA;
  ctx.strokeStyle = model.segmentColors[0] ?? MOVEMENT_OVER_COLOR;
  for (const run of model.trail) {
    ctx.beginPath();
    for (const p of run) ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }
  ctx.globalAlpha = alpha;
  for (let i = 1; i < model.path.length; i++) {
    const a = model.path[i - 1];
    const b = model.path[i];
    if (a === undefined || b === undefined) break;
    ctx.strokeStyle = model.segmentColors[i - 1] ?? MOVEMENT_OVER_COLOR;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  const end = model.path.at(-1);
  if (model.label && end) {
    drawLabelPill(ctx, model.label, end, { textColor: model.segmentColors.at(-1) });
  }
  ctx.restore();
}
