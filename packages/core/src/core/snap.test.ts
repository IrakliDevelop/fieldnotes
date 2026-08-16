import { describe, it, expect } from 'vitest';
import {
  snapPoint,
  snapToHexCenter,
  smartSnap,
  snapToCellCenter,
  snapFootprintCenter,
  footprintFromSize,
} from './snap';
import type { ToolContext } from '../tools/types';
import { Camera } from '../canvas/camera';
import { ElementStore } from '../elements/element-store';

function ctxWith(overrides: Partial<ToolContext>): ToolContext {
  return {
    camera: new Camera(),
    store: new ElementStore(),
    requestRender: () => undefined,
    ...overrides,
  };
}

describe('snapPoint', () => {
  it('snaps to nearest grid intersection', () => {
    expect(snapPoint({ x: 37, y: 55 }, 24)).toEqual({ x: 48, y: 48 });
  });

  it('snaps exactly on grid points', () => {
    expect(snapPoint({ x: 48, y: 72 }, 24)).toEqual({ x: 48, y: 72 });
  });

  it('snaps negative coordinates', () => {
    expect(snapPoint({ x: -10, y: -37 }, 24)).toEqual({ x: 0, y: -48 });
  });

  it('rounds to nearest (not floor)', () => {
    expect(snapPoint({ x: 13, y: 11 }, 24)).toEqual({ x: 24, y: 0 });
  });

  it('works with different grid sizes', () => {
    expect(snapPoint({ x: 17, y: 33 }, 10)).toEqual({ x: 20, y: 30 });
  });
});

describe('snapToHexCenter', () => {
  const cellSize = 24;

  describe('pointy-top', () => {
    const hexW = Math.sqrt(3) * cellSize;
    const rowH = 1.5 * cellSize;

    it('snaps to nearest hex center at origin', () => {
      const result = snapToHexCenter({ x: 2, y: 3 }, cellSize, 'pointy');
      expect(result.x).toBeCloseTo(0);
      expect(result.y).toBeCloseTo(0);
    });

    it('snaps to center of row 0, col 1', () => {
      const result = snapToHexCenter({ x: hexW + 1, y: 2 }, cellSize, 'pointy');
      expect(result.x).toBeCloseTo(hexW);
      expect(result.y).toBeCloseTo(0);
    });

    it('snaps to offset row center', () => {
      const result = snapToHexCenter({ x: hexW / 2 + 1, y: rowH + 1 }, cellSize, 'pointy');
      expect(result.x).toBeCloseTo(hexW / 2);
      expect(result.y).toBeCloseTo(rowH);
    });

    it('snaps negative coordinates', () => {
      const result = snapToHexCenter({ x: -hexW + 1, y: -rowH * 2 + 1 }, cellSize, 'pointy');
      expect(result.x).toBeCloseTo(-hexW);
      expect(result.y).toBeCloseTo(-rowH * 2);
    });
  });

  describe('flat-top', () => {
    const hexH = Math.sqrt(3) * cellSize;
    const colW = 1.5 * cellSize;

    it('snaps to nearest hex center at origin', () => {
      const result = snapToHexCenter({ x: 2, y: 3 }, cellSize, 'flat');
      expect(result.x).toBeCloseTo(0);
      expect(result.y).toBeCloseTo(0);
    });

    it('snaps to center of col 1 (offset column)', () => {
      const result = snapToHexCenter({ x: colW + 1, y: hexH / 2 + 1 }, cellSize, 'flat');
      expect(result.x).toBeCloseTo(colW);
      expect(result.y).toBeCloseTo(hexH / 2);
    });

    it('snaps to even column center', () => {
      const result = snapToHexCenter({ x: colW * 2 + 1, y: 2 }, cellSize, 'flat');
      expect(result.x).toBeCloseTo(colW * 2);
      expect(result.y).toBeCloseTo(0);
    });

    it('snaps negative coordinates', () => {
      const result = snapToHexCenter({ x: -colW * 2 + 1, y: -hexH + 1 }, cellSize, 'flat');
      expect(result.x).toBeCloseTo(-colW * 2);
      expect(result.y).toBeCloseTo(-hexH);
    });
  });
});

describe('smartSnap', () => {
  const baseCtx = {
    camera: {} as ToolContext['camera'],
    store: {} as ToolContext['store'],
    requestRender: () => undefined,
  };

  it('returns unchanged point when snapToGrid is false', () => {
    const ctx: ToolContext = { ...baseCtx, snapToGrid: false, gridSize: 24 };
    expect(smartSnap({ x: 37, y: 55 }, ctx)).toEqual({ x: 37, y: 55 });
  });

  it('returns unchanged point when gridSize is undefined', () => {
    const ctx: ToolContext = { ...baseCtx, snapToGrid: true };
    expect(smartSnap({ x: 37, y: 55 }, ctx)).toEqual({ x: 37, y: 55 });
  });

  it('snaps to square grid when gridType is square', () => {
    const ctx: ToolContext = { ...baseCtx, snapToGrid: true, gridSize: 24, gridType: 'square' };
    expect(smartSnap({ x: 37, y: 55 }, ctx)).toEqual({ x: 48, y: 48 });
  });

  it('snaps to hex grid when gridType is hex', () => {
    const ctx: ToolContext = {
      ...baseCtx,
      snapToGrid: true,
      gridSize: 24,
      gridType: 'hex',
      hexOrientation: 'pointy',
    };
    const result = smartSnap({ x: 2, y: 3 }, ctx);
    expect(result.x).toBeCloseTo(0);
    expect(result.y).toBeCloseTo(0);
  });

  it('falls back to square grid when gridType is undefined', () => {
    const ctx: ToolContext = { ...baseCtx, snapToGrid: true, gridSize: 24 };
    expect(smartSnap({ x: 37, y: 55 }, ctx)).toEqual({ x: 48, y: 48 });
  });

  it('falls back to square snap when gridType is hex but hexOrientation is absent', () => {
    const ctx: ToolContext = { ...baseCtx, snapToGrid: true, gridSize: 24, gridType: 'hex' };
    expect(smartSnap({ x: 37, y: 55 }, ctx)).toEqual({ x: 48, y: 48 });
  });
});

describe('snapToCellCenter', () => {
  it('odd footprint (default 1) centres in the nearest cell', () => {
    expect(snapToCellCenter({ x: 55, y: 70 }, 40)).toEqual({ x: 60, y: 60 });
    expect(snapToCellCenter({ x: 5, y: 5 }, 40)).toEqual({ x: 20, y: 20 });
  });
  it('even footprint lands on the nearest intersection', () => {
    expect(snapToCellCenter({ x: 55, y: 70 }, 40, 2)).toEqual({ x: 40, y: 80 });
  });
  it('rectangular footprints snap each axis independently (1×2 → centre X, intersection Y)', () => {
    expect(snapToCellCenter({ x: 55, y: 70 }, 40, { w: 1, h: 2 })).toEqual({ x: 60, y: 80 });
    expect(snapToCellCenter({ x: 55, y: 70 }, 40, { w: 2, h: 1 })).toEqual({ x: 40, y: 60 });
  });
  it('3×3 is odd (centre) and 4×4 even (intersection)', () => {
    expect(snapToCellCenter({ x: 55, y: 70 }, 40, 3)).toEqual({ x: 60, y: 60 });
    expect(snapToCellCenter({ x: 55, y: 70 }, 40, 4)).toEqual({ x: 40, y: 80 });
  });
  it('never returns -0', () => {
    const p = snapToCellCenter({ x: -1, y: -1 }, 40, 2);
    expect(Object.is(p.x, -0)).toBe(false);
    expect(Object.is(p.y, -0)).toBe(false);
  });
});

describe('snapFootprintCenter', () => {
  it('is identity when snapping is off or gridSize is missing', () => {
    expect(
      snapFootprintCenter(
        { x: 55, y: 70 },
        1,
        ctxWith({ snapToGrid: false, gridSize: 40, gridType: 'square' }),
      ),
    ).toEqual({ x: 55, y: 70 });
    expect(snapFootprintCenter({ x: 55, y: 70 }, 1, ctxWith({ snapToGrid: true }))).toEqual({
      x: 55,
      y: 70,
    });
  });
  it('routes hex to snapToHexCenter regardless of footprint', () => {
    const ctx = ctxWith({
      snapToGrid: true,
      gridSize: 40,
      gridType: 'hex',
      hexOrientation: 'pointy',
    });
    expect(snapFootprintCenter({ x: 55, y: 70 }, 2, ctx)).toEqual(
      snapToHexCenter({ x: 55, y: 70 }, 40, 'pointy'),
    );
  });
  it('routes square (and no-gridType) to snapToCellCenter with the footprint', () => {
    expect(
      snapFootprintCenter(
        { x: 55, y: 70 },
        { w: 1, h: 2 },
        ctxWith({ snapToGrid: true, gridSize: 40, gridType: 'square' }),
      ),
    ).toEqual({ x: 60, y: 80 });
    expect(
      snapFootprintCenter({ x: 55, y: 70 }, 1, ctxWith({ snapToGrid: true, gridSize: 40 })),
    ).toEqual({ x: 60, y: 60 });
  });
});

describe('footprintFromSize', () => {
  it('derives whole-cell footprints by rounding each axis', () => {
    expect(footprintFromSize({ w: 40, h: 40 }, 40)).toEqual({ w: 1, h: 1 });
    expect(footprintFromSize({ w: 80, h: 40 }, 40)).toEqual({ w: 2, h: 1 });
  });

  it('rounds to the nearest cell count, not the ceiling', () => {
    expect(footprintFromSize({ w: 50, h: 50 }, 40)).toEqual({ w: 1, h: 1 });
    expect(footprintFromSize({ w: 60, h: 60 }, 40)).toEqual({ w: 2, h: 2 });
  });

  it('never returns a zero axis for a sub-cell element', () => {
    expect(footprintFromSize({ w: 4, h: 4 }, 40)).toEqual({ w: 1, h: 1 });
  });

  it('falls back to a single cell without a usable grid size', () => {
    expect(footprintFromSize({ w: 80, h: 40 }, 0)).toBe(1);
    expect(footprintFromSize({ w: 80, h: 40 }, -40)).toBe(1);
  });

  it('falls back to a single cell for a NaN grid size', () => {
    expect(footprintFromSize({ w: 80, h: 40 }, NaN)).toBe(1);
  });
});
