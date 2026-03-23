import { describe, it, expect } from 'vitest';
import { getSquareGridLines } from './grid-renderer';

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
