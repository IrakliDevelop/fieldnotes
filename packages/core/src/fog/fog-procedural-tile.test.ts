import { afterEach, describe, expect, it } from 'vitest';
import type { ResolvedProceduralStyle } from './fog-style';
import {
  PROCEDURAL_TILE_PX,
  clearProceduralTileCache,
  generateProceduralTile,
  getCachedProceduralTile,
} from './fog-procedural-tile';

function makeStyle(overrides: Partial<ResolvedProceduralStyle> = {}): ResolvedProceduralStyle {
  return {
    kind: 'procedural',
    backdrop: '#1a1a2e',
    tint: '#2a3050',
    opacity: 0.6,
    scale: 256,
    seed: 0,
    detail: 2,
    ...overrides,
  };
}

afterEach(() => {
  clearProceduralTileCache();
});

describe('generateProceduralTile', () => {
  it('produces tile data of correct dimensions', () => {
    const tile = generateProceduralTile(makeStyle());
    expect(tile.width).toBe(PROCEDURAL_TILE_PX);
    expect(tile.height).toBe(PROCEDURAL_TILE_PX);
    expect(tile.data.length).toBe(PROCEDURAL_TILE_PX * PROCEDURAL_TILE_PX * 4);
  });

  it('same seed produces identical output', () => {
    const a = generateProceduralTile(makeStyle({ seed: 42 }));
    const b = generateProceduralTile(makeStyle({ seed: 42 }));
    expect(a.data).toEqual(b.data);
  });

  it('different seed produces different output', () => {
    const a = generateProceduralTile(makeStyle({ seed: 0 }));
    const b = generateProceduralTile(makeStyle({ seed: 1 }));
    let same = true;
    for (let i = 0; i < a.data.length; i++) {
      if (a.data[i] !== b.data[i]) {
        same = false;
        break;
      }
    }
    expect(same).toBe(false);
  });

  it('produces seamless tiling (edge continuity)', () => {
    const tile = generateProceduralTile(makeStyle({ detail: 1 }));
    const w = PROCEDURAL_TILE_PX;
    const tolerance = 30;

    for (let i = 0; i < w; i++) {
      const leftIdx = (i * w + 0) * 4 + 3;
      const rightIdx = (i * w + (w - 1)) * 4 + 3;
      expect(
        Math.abs((tile.data[leftIdx] as number) - (tile.data[rightIdx] as number)),
      ).toBeLessThanOrEqual(tolerance);

      const topIdx = (0 * w + i) * 4 + 3;
      const bottomIdx = ((w - 1) * w + i) * 4 + 3;
      expect(
        Math.abs((tile.data[topIdx] as number) - (tile.data[bottomIdx] as number)),
      ).toBeLessThanOrEqual(tolerance);
    }
  });

  it('alpha values are bounded by opacity', () => {
    const style = makeStyle({ opacity: 0.5 });
    const tile = generateProceduralTile(style);
    const maxAlpha = Math.round(0.5 * 255);
    for (let i = 3; i < tile.data.length; i += 4) {
      expect(tile.data[i]).toBeLessThanOrEqual(maxAlpha + 1);
    }
  });

  it('rgb channels match tint color', () => {
    const style = makeStyle({ tint: '#ff8040' });
    const tile = generateProceduralTile(style);
    for (let i = 0; i < tile.data.length; i += 4) {
      expect(tile.data[i]).toBe(0xff);
      expect(tile.data[i + 1]).toBe(0x80);
      expect(tile.data[i + 2]).toBe(0x40);
    }
  });
});

describe('getCachedProceduralTile', () => {
  it('returns cached tile for same style', () => {
    const style = makeStyle();
    const a = getCachedProceduralTile(style);
    const b = getCachedProceduralTile(style);
    expect(a).toBe(b);
  });

  it('returns different tile for different style', () => {
    const a = getCachedProceduralTile(makeStyle({ seed: 0 }));
    const b = getCachedProceduralTile(makeStyle({ seed: 1 }));
    expect(a).not.toBe(b);
  });
});
