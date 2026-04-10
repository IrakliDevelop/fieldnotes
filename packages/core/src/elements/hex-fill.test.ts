import { describe, it, expect } from 'vitest';
import {
  getHexDistance,
  getHexCellsInRadius,
  getHexCellsInCone,
  getHexCellsInLine,
  getHexCellsInSquare,
} from './hex-fill';

const CELL_SIZE = 40;

describe('getHexDistance', () => {
  const W = Math.sqrt(3) * CELL_SIZE;
  const rowH = 1.5 * CELL_SIZE;

  it('returns 0 for same hex', () => {
    expect(getHexDistance({ x: 0, y: 0 }, { x: 0, y: 0 }, CELL_SIZE, 'pointy')).toBe(0);
  });

  it('returns 1 for adjacent hex horizontally', () => {
    expect(getHexDistance({ x: 0, y: 0 }, { x: W, y: 0 }, CELL_SIZE, 'pointy')).toBe(1);
  });

  it('returns 1 for adjacent hex diagonally', () => {
    expect(getHexDistance({ x: 0, y: 0 }, { x: W / 2, y: rowH }, CELL_SIZE, 'pointy')).toBe(1);
  });

  it('returns 2 for two steps diagonally', () => {
    expect(getHexDistance({ x: 0, y: 0 }, { x: W, y: 2 * rowH }, CELL_SIZE, 'pointy')).toBe(2);
  });

  it('returns correct distance for longer path', () => {
    expect(getHexDistance({ x: 0, y: 0 }, { x: 3 * W, y: 0 }, CELL_SIZE, 'pointy')).toBe(3);
  });
});

describe('hex-fill', () => {
  describe('getHexCellsInRadius', () => {
    it('returns 1 cell for radius 0', () => {
      const cells = getHexCellsInRadius({ x: 0, y: 0 }, 0, CELL_SIZE, 'pointy');
      expect(cells).toHaveLength(1);
    });

    it('returns 7 cells for radius 1 (center + 6 neighbors)', () => {
      const cells = getHexCellsInRadius({ x: 0, y: 0 }, 1, CELL_SIZE, 'pointy');
      expect(cells).toHaveLength(7);
    });

    it('returns 19 cells for radius 2', () => {
      const cells = getHexCellsInRadius({ x: 0, y: 0 }, 2, CELL_SIZE, 'pointy');
      expect(cells).toHaveLength(19);
    });

    it('works with flat-top orientation', () => {
      const cells = getHexCellsInRadius({ x: 0, y: 0 }, 1, CELL_SIZE, 'flat');
      expect(cells).toHaveLength(7);
    });

    it('works with non-origin center', () => {
      const hexW = Math.sqrt(3) * CELL_SIZE;
      const cells = getHexCellsInRadius({ x: hexW, y: 0 }, 1, CELL_SIZE, 'pointy');
      expect(cells).toHaveLength(7);
      const hasCenter = cells.some((c) => Math.abs(c.x - hexW) < 0.01 && Math.abs(c.y) < 0.01);
      expect(hasCenter).toBe(true);
    });
  });

  describe('getHexCellsInCone', () => {
    it('returns origin for radius 0', () => {
      const cells = getHexCellsInCone({ x: 0, y: 0 }, 0, 0, CELL_SIZE, 'pointy');
      expect(cells).toHaveLength(1);
    });

    it('returns fewer cells than a full circle', () => {
      const cone = getHexCellsInCone({ x: 0, y: 0 }, 0, 3, CELL_SIZE, 'pointy');
      const circle = getHexCellsInRadius({ x: 0, y: 0 }, 3, CELL_SIZE, 'pointy');
      expect(cone.length).toBeLessThan(circle.length);
      expect(cone.length).toBeGreaterThan(0);
    });

    it('includes the origin hex as the cone tip', () => {
      const cells = getHexCellsInCone({ x: 0, y: 0 }, 0, 3, CELL_SIZE, 'pointy');
      const hasOrigin = cells.some((c) => Math.abs(c.x) < 0.01 && Math.abs(c.y) < 0.01);
      expect(hasOrigin).toBe(true);
    });

    it('follows 1-2-3 triangular D&D pattern (snaps to hex vertex)', () => {
      const cells = getHexCellsInCone({ x: 0, y: 0 }, Math.PI / 6, 2, CELL_SIZE, 'pointy');
      expect(cells).toHaveLength(1 + 2 + 3);
    });
  });

  describe('getHexCellsInLine', () => {
    it('returns cells along a direction', () => {
      const cells = getHexCellsInLine({ x: 0, y: 0 }, 0, 3, CELL_SIZE, 'pointy');
      expect(cells.length).toBeGreaterThan(0);
      expect(cells.length).toBeLessThan(19);
    });
  });

  describe('getHexCellsInSquare', () => {
    it('returns cells within a square region', () => {
      const cells = getHexCellsInSquare({ x: 0, y: 0 }, 2, CELL_SIZE, 'pointy');
      expect(cells.length).toBeGreaterThan(0);
      expect(cells.length).toBeLessThan(19);
    });
  });
});
