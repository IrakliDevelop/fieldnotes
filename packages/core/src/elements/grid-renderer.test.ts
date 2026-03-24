import { describe, it, expect } from 'vitest';
import { getSquareGridLines, getHexVertices, getHexCenters } from './grid-renderer';

describe('getSquareGridLines', () => {
  it('returns vertical and horizontal lines within bounds', () => {
    const lines = getSquareGridLines({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, 40);
    // cellSize=40: verticals at 0, 40, 80, 120; horizontals at 0, 40, 80, 120
    expect(lines.verticals).toEqual([0, 40, 80, 120]);
    expect(lines.horizontals).toEqual([0, 40, 80, 120]);
  });

  it('handles negative bounds', () => {
    const lines = getSquareGridLines({ minX: -50, minY: -50, maxX: 50, maxY: 50 }, 40);
    // Verticals: snap -50 down to -80, then -80, -40, 0, 40, 80
    expect(lines.verticals).toEqual([-80, -40, 0, 40, 80]);
    expect(lines.horizontals).toEqual([-80, -40, 0, 40, 80]);
  });

  it('returns empty for zero cellSize', () => {
    const lines = getSquareGridLines({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, 0);
    expect(lines.verticals).toEqual([]);
    expect(lines.horizontals).toEqual([]);
  });
});

describe('getHexVertices', () => {
  it('returns 6 vertices for pointy-top hex', () => {
    const verts = getHexVertices(0, 0, 10, 'pointy');
    expect(verts).toHaveLength(6);
    // Top vertex for pointy-top is at angle -90° → (0, -10)
    expect(verts[0]?.x).toBeCloseTo(0);
    expect(verts[0]?.y).toBeCloseTo(-10);
  });

  it('returns 6 vertices for flat-top hex', () => {
    const verts = getHexVertices(0, 0, 10, 'flat');
    expect(verts).toHaveLength(6);
    // Right vertex for flat-top is at angle 0° → (10, 0)
    expect(verts[0]?.x).toBeCloseTo(10);
    expect(verts[0]?.y).toBeCloseTo(0);
  });
});

describe('getHexCenters', () => {
  it('returns centers within bounds for pointy-top', () => {
    const centers = getHexCenters({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, 20, 'pointy');
    expect(centers.length).toBeGreaterThan(0);
    for (const c of centers) {
      expect(c.x).toBeGreaterThanOrEqual(-40);
      expect(c.y).toBeGreaterThanOrEqual(-40);
    }
  });

  it('returns centers within bounds for flat-top', () => {
    const centers = getHexCenters({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, 20, 'flat');
    expect(centers.length).toBeGreaterThan(0);
  });

  it('returns empty for zero cellSize', () => {
    const centers = getHexCenters({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, 0, 'pointy');
    expect(centers).toEqual([]);
  });
});
