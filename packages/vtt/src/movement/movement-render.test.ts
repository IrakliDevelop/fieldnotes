import { describe, expect, it, vi } from 'vitest';
import type { Point } from '@fieldnotes/core';
import type { GridMetric } from '../grid/grid-metric';
import {
  buildMovementModel,
  drawMovement,
  formatMovementLabel,
  hexLineCells,
} from './movement-render';
import type { MovementRenderModel } from './movement-render';

const G = '#2E7D32';
const Y = '#F9A825';
const R = '#C62828';
const BANDS = [
  { feet: 30, color: G },
  { feet: 60, color: Y },
];
const SQUARE: GridMetric = { gridSize: 40, gridType: 'square', diagonalRule: 'chebyshev' };

function build(path: Point[], opts: { grid?: GridMetric; feet?: number; footprint?: number } = {}) {
  return buildMovementModel({
    path,
    trail: [],
    grid: opts.grid ?? SQUARE,
    feetPerCell: 5,
    start: { feet: opts.feet ?? 0, diagonals: 0 },
    bands: BANDS,
    overColor: R,
    footprint: opts.footprint,
  });
}

function sortedCells(model: MovementRenderModel): [number, number][] {
  return model.cells
    .map((c): [number, number] => [c.x, c.y])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

describe('formatMovementLabel', () => {
  it.each([
    [35, '35 ft · 25 left'],
    [30, '30 ft · 0 left'],
    [65, '65 ft'],
  ])('%d ft against bands 30/60 reads %s', (feet, label) => {
    expect(formatMovementLabel(feet, BANDS)).toBe(label);
  });
});

describe('buildMovementModel', () => {
  it('colors each cell by the cumulative feet on entering it, continuing from start', () => {
    const model = build(
      [
        { x: 20, y: 20 },
        { x: 140, y: 20 },
      ],
      { feet: 25 },
    );

    expect(model.cells).toEqual([
      { x: 60, y: 20, color: G },
      { x: 100, y: 20, color: Y },
      { x: 140, y: 20, color: Y },
    ]);
    expect(model.label).toBe('40 ft · 20 left');
  });

  it('walks a square move diagonally first, then straight', () => {
    const model = build([
      { x: 20, y: 20 },
      { x: 140, y: 60 },
    ]);

    expect(model.cells.map((c) => [(c.x - 20) / 40, (c.y - 20) / 40])).toEqual([
      [1, 1],
      [2, 1],
      [3, 1],
    ]);
  });

  it('tints a 2x2 footprint moving 2 cells as 6 distinct cells', () => {
    const model = build(
      [
        { x: 40, y: 40 },
        { x: 120, y: 40 },
      ],
      { footprint: 2 },
    );

    expect(sortedCells(model)).toEqual([
      [60, 20],
      [60, 60],
      [100, 20],
      [100, 60],
      [140, 20],
      [140, 60],
    ]);
  });

  it('tints a 2x2 footprint moving 1 cell at its new position', () => {
    const model = build(
      [
        { x: 40, y: 40 },
        { x: 80, y: 40 },
      ],
      { footprint: 2 },
    );

    expect(sortedCells(model)).toEqual([
      [60, 20],
      [60, 60],
      [100, 20],
      [100, 60],
    ]);
  });

  it('gridless: no cells, segment colors from bands', () => {
    const model = build(
      [
        { x: 0, y: 0 },
        { x: 120, y: 0 },
        { x: 240, y: 0 },
        { x: 360, y: 0 },
      ],
      { grid: { gridSize: 24 } },
    );

    expect(model.grid.type).toBe('none');
    expect(model.cells).toEqual([]);
    expect(model.segmentColors).toEqual([G, Y, R]);
    expect(model.label).toBe('75 ft');
  });
});

describe('hexLineCells', () => {
  const s3 = Math.sqrt(3);
  // Pointy, size 20, from cube (0,0,0); the nudged lerp at t=0.5 picks the middle cell.
  it.each([
    ['(2,-1,-1)', { x: 30 * s3, y: -30 }, { x: 20 * s3, y: 0 }],
    // An unnudged lerp would round this tie to (1,0,-1) instead of (0,1,-1).
    ['(1,1,-2)', { x: 30 * s3, y: 30 }, { x: 10 * s3, y: 30 }],
  ])(
    'walks cube delta %s as two ordered adjacent cells ending at the target',
    (_d, target, middle) => {
      const cells = hexLineCells({ x: 0, y: 0 }, target, 20, 'pointy');

      expect(cells).toHaveLength(2);
      expect(cells[0]?.x).toBeCloseTo(middle.x, 9);
      expect(cells[0]?.y).toBeCloseTo(middle.y, 9);
      expect(cells[1]?.x).toBeCloseTo(target.x, 9);
      expect(cells[1]?.y).toBeCloseTo(target.y, 9);
    },
  );
});

describe('drawMovement', () => {
  it('sizes the label in CSS pixels: zoom 0.5 gets a 28px font', () => {
    const fonts: string[] = [];
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      fillRect: vi.fn(),
      roundRect: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn(() => ({ width: 40 })),
      getTransform: () => ({ a: 0.5, b: 0, c: 0, d: 0.5 }),
      set font(v: string) {
        fonts.push(v);
      },
    } as unknown as CanvasRenderingContext2D;

    drawMovement(
      ctx,
      build([
        { x: 20, y: 20 },
        { x: 60, y: 20 },
      ]),
    );

    expect(fonts).toEqual(['bold 28px sans-serif']);
    expect(ctx.fillText).toHaveBeenCalledWith('5 ft · 25 left', 60, expect.any(Number));
  });
});
