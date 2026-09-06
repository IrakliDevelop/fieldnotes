import { describe, it, expect } from 'vitest';
import { GridConstraintService } from './grid-constraint-service';
import type { GridInfo } from './grid-controller';

function squareGrid(cellSize = 50): () => GridInfo | null {
  return () => ({
    gridType: 'square',
    hexOrientation: 'pointy',
    cellSize,
    cellRadius: cellSize / 2,
  });
}

function hexGrid(
  cellSize = 50,
  hexOrientation: 'pointy' | 'flat' = 'pointy',
): () => GridInfo | null {
  return () => ({ gridType: 'hex', hexOrientation, cellSize, cellRadius: cellSize });
}

const noGrid = (): GridInfo | null => null;

describe('GridConstraintService', () => {
  describe('constrainPoint', () => {
    it('returns point unchanged when no grid', () => {
      const svc = new GridConstraintService(noGrid);
      expect(svc.constrainPoint({ x: 23, y: 47 })).toEqual({ x: 23, y: 47 });
    });

    it('snaps to square grid intersections by default', () => {
      const svc = new GridConstraintService(squareGrid(50));
      expect(svc.constrainPoint({ x: 23, y: 47 })).toEqual({ x: 0, y: 50 });
      expect(svc.constrainPoint({ x: 76, y: 12 })).toEqual({ x: 100, y: 0 });
    });

    it('snaps to hex centres on hex grid', () => {
      const svc = new GridConstraintService(hexGrid(50, 'pointy'));
      const result = svc.constrainPoint({ x: 10, y: 10 });
      const hexW = Math.sqrt(3) * 50;
      const rowH = 1.5 * 50;
      expect(result.x).toBeCloseTo(0, 5);
      expect(result.y).toBeCloseTo(0, 5);
      void hexW;
      void rowH;
    });

    it('snaps to cell centre with mode cell-center', () => {
      const svc = new GridConstraintService(squareGrid(50));
      const result = svc.constrainPoint({ x: 23, y: 47 }, { mode: 'cell-center' });
      expect(result).toEqual({ x: 25, y: 25 });
    });

    it('snaps to cell centre with footprint option', () => {
      const svc = new GridConstraintService(squareGrid(50));
      const result = svc.constrainPoint({ x: 23, y: 47 }, { footprint: { w: 2, h: 2 } });
      expect(result).toEqual({ x: 0, y: 50 });
    });

    it('snaps to cell centre with odd footprint landing on centre', () => {
      const svc = new GridConstraintService(squareGrid(50));
      const result = svc.constrainPoint({ x: 23, y: 47 }, { footprint: { w: 1, h: 1 } });
      expect(result).toEqual({ x: 25, y: 25 });
    });
  });

  describe('getConstraintInfo', () => {
    it('returns null when no grid', () => {
      const svc = new GridConstraintService(noGrid);
      expect(svc.getConstraintInfo()).toBeNull();
    });

    it('returns grid info for square grid', () => {
      const svc = new GridConstraintService(squareGrid(50));
      expect(svc.getConstraintInfo()).toEqual({
        type: 'square',
        gridType: 'square',
        cellSize: 50,
        hexOrientation: 'pointy',
      });
    });

    it('returns grid info for hex grid', () => {
      const svc = new GridConstraintService(hexGrid(30, 'flat'));
      expect(svc.getConstraintInfo()).toEqual({
        type: 'hex',
        gridType: 'hex',
        cellSize: 30,
        hexOrientation: 'flat',
      });
    });
  });

  describe('hasCapability', () => {
    it('returns false for all capabilities when no grid', () => {
      const svc = new GridConstraintService(noGrid);
      expect(svc.hasCapability('grid:snap')).toBe(false);
      expect(svc.hasCapability('grid:square')).toBe(false);
    });

    it('reports square grid capabilities', () => {
      const svc = new GridConstraintService(squareGrid());
      expect(svc.hasCapability('grid:snap')).toBe(true);
      expect(svc.hasCapability('grid:square')).toBe(true);
      expect(svc.hasCapability('grid:hex')).toBe(false);
      expect(svc.hasCapability('grid:cell-center')).toBe(true);
      expect(svc.hasCapability('grid:footprint')).toBe(true);
    });

    it('reports hex grid capabilities', () => {
      const svc = new GridConstraintService(hexGrid());
      expect(svc.hasCapability('grid:snap')).toBe(true);
      expect(svc.hasCapability('grid:square')).toBe(false);
      expect(svc.hasCapability('grid:hex')).toBe(true);
      expect(svc.hasCapability('grid:cell-center')).toBe(false);
    });

    it('returns false for unknown capability', () => {
      const svc = new GridConstraintService(squareGrid());
      expect(svc.hasCapability('unknown')).toBe(false);
    });
  });

  describe('dynamic grid changes', () => {
    it('reflects grid changes through the getter', () => {
      let info: GridInfo | null = null;
      const svc = new GridConstraintService(() => info);

      expect(svc.constrainPoint({ x: 23, y: 47 })).toEqual({ x: 23, y: 47 });

      info = { gridType: 'square', hexOrientation: 'pointy', cellSize: 50, cellRadius: 25 };
      expect(svc.constrainPoint({ x: 23, y: 47 })).toEqual({ x: 0, y: 50 });

      info = null;
      expect(svc.constrainPoint({ x: 23, y: 47 })).toEqual({ x: 23, y: 47 });
    });
  });
});
