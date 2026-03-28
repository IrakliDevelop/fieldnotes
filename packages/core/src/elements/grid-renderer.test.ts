import { describe, it, expect, vi } from 'vitest';
import {
  getSquareGridLines,
  getHexVertices,
  getHexCenters,
  renderHexGrid,
  createHexGridTile,
} from './grid-renderer';

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

function mockCtx() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    strokeStyle: '',
    lineWidth: 0,
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D;
}

describe('renderHexGrid', () => {
  it('produces same vertex positions as getHexVertices for each center', () => {
    const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    const cellSize = 20;
    const ctx = mockCtx();

    renderHexGrid(ctx, bounds, cellSize, 'pointy', '#000', 1, 1);

    const centers = getHexCenters(bounds, cellSize, 'pointy');
    const moveToMock = ctx.moveTo as ReturnType<typeof vi.fn>;
    const lineToMock = ctx.lineTo as ReturnType<typeof vi.fn>;

    // Each hex = 1 moveTo + 5 lineTo
    expect(moveToMock.mock.calls.length).toBe(centers.length);
    expect(lineToMock.mock.calls.length).toBe(centers.length * 5);

    for (let i = 0; i < centers.length; i++) {
      const c = centers[i];
      if (!c) continue;
      const verts = getHexVertices(c.x, c.y, cellSize, 'pointy');
      const v0 = verts[0];
      if (!v0) continue;

      const moveCall = moveToMock.mock.calls[i] as [number, number];
      expect(moveCall[0]).toBeCloseTo(v0.x, 5);
      expect(moveCall[1]).toBeCloseTo(v0.y, 5);

      for (let j = 1; j < 6; j++) {
        const v = verts[j];
        if (!v) continue;
        const lineCall = lineToMock.mock.calls[i * 5 + (j - 1)] as [number, number];
        expect(lineCall[0]).toBeCloseTo(v.x, 5);
        expect(lineCall[1]).toBeCloseTo(v.y, 5);
      }
    }
  });

  it('works for flat-top orientation', () => {
    const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    const ctx = mockCtx();

    renderHexGrid(ctx, bounds, 20, 'flat', '#000', 1, 1);

    const centers = getHexCenters(bounds, 20, 'flat');
    const moveToMock = ctx.moveTo as ReturnType<typeof vi.fn>;
    expect(moveToMock.mock.calls.length).toBe(centers.length);
  });

  it('does nothing for zero cellSize', () => {
    const ctx = mockCtx();
    renderHexGrid(ctx, { minX: 0, minY: 0, maxX: 100, maxY: 100 }, 0, 'pointy', '#000', 1, 1);
    expect(ctx.beginPath).not.toHaveBeenCalled();
  });
});

describe('createHexGridTile', () => {
  it('returns correct tile dimensions for pointy-top', () => {
    const tile = createHexGridTile(20, 'pointy', '#000', 1, 0.3, 1);
    if (!tile) return; // null in jsdom without canvas support
    expect(tile.tileW).toBeCloseTo(Math.sqrt(3) * 20);
    expect(tile.tileH).toBeCloseTo(3 * 20);
  });

  it('returns correct tile dimensions for flat-top', () => {
    const tile = createHexGridTile(20, 'flat', '#000', 1, 0.3, 1);
    if (!tile) return;
    expect(tile.tileW).toBeCloseTo(3 * 20);
    expect(tile.tileH).toBeCloseTo(Math.sqrt(3) * 20);
  });

  it('returns null for zero cellSize', () => {
    const tile = createHexGridTile(0, 'pointy', '#000', 1, 0.3, 1);
    expect(tile).toBeNull();
  });

  it('scales tile canvas by the given scale factor', () => {
    const tile = createHexGridTile(20, 'pointy', '#000', 1, 0.3, 2);
    if (!tile) return;
    expect(tile.canvas.width).toBe(Math.ceil(tile.tileW * 2));
    expect(tile.canvas.height).toBe(Math.ceil(tile.tileH * 2));
  });
});
