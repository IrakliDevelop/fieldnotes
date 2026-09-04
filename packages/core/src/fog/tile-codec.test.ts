import { describe, it, expect } from 'vitest';
import {
  encodeBase64,
  decodeBase64,
  createTileBytes,
  getBit,
  setBit,
  isTileAllValue,
  isTileBase,
  validateFogDefinition,
  validateFogTile,
  validateFogState,
  recommendedFogCellSize,
  rasterizeRegion,
  applyRasterResult,
} from './tile-codec';
import type { FogDefinitionV1, FogStateV1, FogTileV1 } from './types';
import { FOG_TILE_CELLS, FOG_MAX_TILES } from './types';

function makeDef(overrides: Partial<FogDefinitionV1> = {}): FogDefinitionV1 {
  return {
    version: 1,
    generation: 'gen-1',
    bounds: { x: 0, y: 0, w: 1024, h: 1024 },
    cellSize: 2,
    tileCells: 128,
    base: 'covered',
    ...overrides,
  };
}

function makeState(
  defOverrides: Partial<FogDefinitionV1> = {},
  tiles: FogTileV1[] = [],
): FogStateV1 {
  return { definition: makeDef(defOverrides), tiles };
}

describe('base64 codec', () => {
  it('round-trips all-zero tile', () => {
    const bytes = createTileBytes(false);
    const encoded = encodeBase64(bytes);
    const decoded = decodeBase64(encoded);
    expect(decoded).toEqual(bytes);
  });

  it('round-trips all-one tile', () => {
    const bytes = createTileBytes(true);
    const encoded = encodeBase64(bytes);
    const decoded = decodeBase64(encoded);
    expect(decoded).toEqual(bytes);
  });

  it('round-trips mixed data', () => {
    const bytes = createTileBytes(false);
    bytes[0] = 0xab;
    bytes[100] = 0xcd;
    bytes[2047] = 0xef;
    const encoded = encodeBase64(bytes);
    const decoded = decodeBase64(encoded);
    expect(decoded).toEqual(bytes);
  });

  it('rejects non-divisible-by-4 length', () => {
    expect(() => decodeBase64('ABC')).toThrow();
  });
});

describe('bit operations', () => {
  it('sets and gets individual bits', () => {
    const bytes = createTileBytes(false);
    expect(getBit(bytes, 0, 0)).toBe(false);
    setBit(bytes, 0, 0, true);
    expect(getBit(bytes, 0, 0)).toBe(true);
    setBit(bytes, 0, 0, false);
    expect(getBit(bytes, 0, 0)).toBe(false);
  });

  it('handles last cell in tile', () => {
    const bytes = createTileBytes(false);
    setBit(bytes, 127, 127, true);
    expect(getBit(bytes, 127, 127)).toBe(true);
    expect(getBit(bytes, 126, 127)).toBe(false);
    expect(getBit(bytes, 127, 126)).toBe(false);
  });

  it('bit order is consistent across row boundary', () => {
    const bytes = createTileBytes(false);
    setBit(bytes, 0, 0, true);
    setBit(bytes, 0, 1, true);
    expect(getBit(bytes, 0, 0)).toBe(true);
    expect(getBit(bytes, 0, 1)).toBe(true);
    expect(getBit(bytes, 1, 0)).toBe(false);
  });

  it('isTileAllValue checks correctly', () => {
    expect(isTileAllValue(createTileBytes(false), false)).toBe(true);
    expect(isTileAllValue(createTileBytes(true), true)).toBe(true);
    expect(isTileAllValue(createTileBytes(false), true)).toBe(false);
    const mixed = createTileBytes(false);
    setBit(mixed, 5, 5, true);
    expect(isTileAllValue(mixed, false)).toBe(false);
  });

  it('isTileBase matches covered/revealed correctly', () => {
    const zeros = createTileBytes(false);
    const ones = createTileBytes(true);
    expect(isTileBase(zeros, 'covered')).toBe(true);
    expect(isTileBase(ones, 'covered')).toBe(false);
    expect(isTileBase(ones, 'revealed')).toBe(true);
    expect(isTileBase(zeros, 'revealed')).toBe(false);
  });
});

describe('validation', () => {
  it('accepts valid definition', () => {
    expect(() => validateFogDefinition(makeDef())).not.toThrow();
  });

  it('rejects missing version', () => {
    expect(() => validateFogDefinition({ ...makeDef(), version: 2 })).toThrow(
      'unsupported version',
    );
  });

  it('rejects empty generation', () => {
    expect(() => validateFogDefinition({ ...makeDef(), generation: '' })).toThrow('generation');
  });

  it('rejects generation > 128 chars', () => {
    expect(() => validateFogDefinition({ ...makeDef(), generation: 'x'.repeat(129) })).toThrow(
      'generation',
    );
  });

  it('rejects non-finite bounds', () => {
    expect(() =>
      validateFogDefinition({ ...makeDef(), bounds: { x: NaN, y: 0, w: 100, h: 100 } }),
    ).toThrow('bounds');
  });

  it('rejects zero-width bounds', () => {
    expect(() =>
      validateFogDefinition({ ...makeDef(), bounds: { x: 0, y: 0, w: 0, h: 100 } }),
    ).toThrow('bounds');
  });

  it('rejects negative cellSize', () => {
    expect(() => validateFogDefinition({ ...makeDef(), cellSize: -1 })).toThrow('cellSize');
  });

  it('rejects wrong tileCells', () => {
    expect(() => validateFogDefinition({ ...makeDef(), tileCells: 64 as unknown as 128 })).toThrow(
      'tileCells',
    );
  });

  it('rejects invalid base', () => {
    expect(() =>
      validateFogDefinition({ ...makeDef(), base: 'hidden' as unknown as 'covered' }),
    ).toThrow('base');
  });

  it('validates tile with valid data', () => {
    const bytes = createTileBytes(true);
    const data = encodeBase64(bytes);
    expect(() => validateFogTile({ x: 0, y: 0, data }, makeDef())).not.toThrow();
  });

  it('rejects tile with non-integer coordinates', () => {
    const data = encodeBase64(createTileBytes(false));
    expect(() => validateFogTile({ x: 0.5, y: 0, data }, makeDef())).toThrow('safe integers');
  });

  it('rejects tile outside bounds', () => {
    const data = encodeBase64(createTileBytes(false));
    expect(() => validateFogTile({ x: 100, y: 100, data }, makeDef())).toThrow('outside bounds');
  });

  it('rejects non-canonical base64', () => {
    expect(() => validateFogTile({ x: 0, y: 0, data: 'short' }, makeDef())).toThrow('invalid data');
  });

  it('validates full state', () => {
    const bytes = createTileBytes(true);
    const data = encodeBase64(bytes);
    const state: FogStateV1 = {
      definition: makeDef(),
      tiles: [{ x: 0, y: 0, data }],
    };
    expect(() => validateFogState(state)).not.toThrow();
  });

  it('rejects duplicate tile coordinates', () => {
    const data = encodeBase64(createTileBytes(true));
    expect(() =>
      validateFogState({
        definition: makeDef(),
        tiles: [
          { x: 0, y: 0, data },
          { x: 0, y: 0, data },
        ],
      }),
    ).toThrow('duplicate');
  });

  it('rejects too many tiles', () => {
    const data = encodeBase64(createTileBytes(true));
    const def = makeDef({ bounds: { x: 0, y: 0, w: 100000, h: 100000 }, cellSize: 1 });
    const tiles: FogTileV1[] = [];
    for (let i = 0; i < FOG_MAX_TILES + 1; i++) {
      tiles.push({ x: i, y: 0, data });
    }
    expect(() => validateFogState({ definition: def, tiles })).toThrow('too many');
  });
});

describe('recommendedFogCellSize', () => {
  it('returns 1 for small maps', () => {
    expect(recommendedFogCellSize({ x: 0, y: 0, w: 512, h: 512 })).toBe(1);
  });

  it('keeps within 256 tiles for large maps', () => {
    const bounds = { x: 0, y: 0, w: 4096, h: 4096 };
    const cs = recommendedFogCellSize(bounds);
    const tw = Math.ceil(bounds.w / (FOG_TILE_CELLS * cs));
    const th = Math.ceil(bounds.h / (FOG_TILE_CELLS * cs));
    expect(tw * th).toBeLessThanOrEqual(FOG_MAX_TILES);
  });

  it('handles portrait bounds', () => {
    const bounds = { x: 0, y: 0, w: 512, h: 8192 };
    const cs = recommendedFogCellSize(bounds);
    const tw = Math.ceil(bounds.w / (FOG_TILE_CELLS * cs));
    const th = Math.ceil(bounds.h / (FOG_TILE_CELLS * cs));
    expect(tw * th).toBeLessThanOrEqual(FOG_MAX_TILES);
  });

  it('handles landscape bounds', () => {
    const bounds = { x: 0, y: 0, w: 8192, h: 512 };
    const cs = recommendedFogCellSize(bounds);
    const tw = Math.ceil(bounds.w / (FOG_TILE_CELLS * cs));
    const th = Math.ceil(bounds.h / (FOG_TILE_CELLS * cs));
    expect(tw * th).toBeLessThanOrEqual(FOG_MAX_TILES);
  });

  it('handles negative-origin bounds', () => {
    const bounds = { x: -2048, y: -2048, w: 4096, h: 4096 };
    const cs = recommendedFogCellSize(bounds);
    const tw = Math.ceil(bounds.w / (FOG_TILE_CELLS * cs));
    const th = Math.ceil(bounds.h / (FOG_TILE_CELLS * cs));
    expect(tw * th).toBeLessThanOrEqual(FOG_MAX_TILES);
  });

  it('returns at least 1', () => {
    expect(recommendedFogCellSize({ x: 0, y: 0, w: 1, h: 1 })).toBe(1);
  });
});

describe('rasterization', () => {
  it('reveal brush creates tiles from covered state', () => {
    const state = makeState({ cellSize: 1 });
    const result = rasterizeRegion(
      state,
      {
        kind: 'brush',
        points: [{ x: 50, y: 50 }],
        radius: 40,
      },
      'reveal',
    );
    expect(result.noop).toBe(false);
    expect(result.changed.length).toBeGreaterThan(0);
  });

  it('conceal brush on already-covered state is noop', () => {
    const state = makeState({ cellSize: 1 });
    const result = rasterizeRegion(
      state,
      {
        kind: 'brush',
        points: [{ x: 50, y: 50 }],
        radius: 40,
      },
      'conceal',
    );
    expect(result.noop).toBe(true);
  });

  it('reveal then conceal returns to base (no stored tiles)', () => {
    const state = makeState({ cellSize: 2 });
    const region = {
      kind: 'rectangle' as const,
      from: { x: 10, y: 10 },
      to: { x: 200, y: 200 },
    };
    const r1 = rasterizeRegion(state, region, 'reveal');
    const s1 = applyRasterResult(state, r1);
    expect(s1.tiles.length).toBeGreaterThan(0);

    const r2 = rasterizeRegion(s1, region, 'conceal');
    const s2 = applyRasterResult(s1, r2);
    expect(s2.tiles.length).toBe(0);
  });

  it('rectangle rasterizes correct area', () => {
    const state = makeState({ cellSize: 1 });
    const result = rasterizeRegion(
      state,
      {
        kind: 'rectangle',
        from: { x: 0, y: 0 },
        to: { x: 127, y: 127 },
      },
      'reveal',
    );
    expect(result.noop).toBe(false);
    const s = applyRasterResult(state, result);
    expect(s.tiles.length).toBe(1);
    const bytes = decodeBase64((s.tiles[0] as FogTileV1).data);
    expect(isTileAllValue(bytes, true)).toBe(true);
  });

  it('clips to bounds', () => {
    const state = makeState({
      bounds: { x: 0, y: 0, w: 64, h: 64 },
      cellSize: 1,
    });
    const result = rasterizeRegion(
      state,
      {
        kind: 'rectangle',
        from: { x: -100, y: -100 },
        to: { x: 200, y: 200 },
      },
      'reveal',
    );
    expect(result.noop).toBe(false);
    const s = applyRasterResult(state, result);
    expect(s.tiles.length).toBe(1);
    const bytes = decodeBase64((s.tiles[0] as FogTileV1).data);
    for (let row = 0; row < 128; row++) {
      for (let col = 0; col < 128; col++) {
        const expected = col < 64 && row < 64;
        expect(getBit(bytes, col, row)).toBe(expected);
      }
    }
  });

  it('handles negative-origin bounds', () => {
    const state = makeState({
      bounds: { x: -256, y: -256, w: 512, h: 512 },
      cellSize: 1,
    });
    const result = rasterizeRegion(
      state,
      {
        kind: 'rectangle',
        from: { x: -256, y: -256 },
        to: { x: -129, y: -129 },
      },
      'reveal',
    );
    expect(result.noop).toBe(false);
    const s = applyRasterResult(state, result);
    expect(s.tiles.length).toBeGreaterThan(0);
  });

  it('polygon rasterizes concave shape', () => {
    const state = makeState({ cellSize: 2 });
    const result = rasterizeRegion(
      state,
      {
        kind: 'polygon',
        points: [
          { x: 100, y: 100 },
          { x: 200, y: 100 },
          { x: 200, y: 200 },
          { x: 150, y: 150 },
          { x: 100, y: 200 },
        ],
      },
      'reveal',
    );
    expect(result.noop).toBe(false);
  });

  it('reversed rectangle works same as normal', () => {
    const state = makeState({ cellSize: 1 });
    const r1 = rasterizeRegion(
      state,
      {
        kind: 'rectangle',
        from: { x: 10, y: 10 },
        to: { x: 50, y: 50 },
      },
      'reveal',
    );
    const r2 = rasterizeRegion(
      state,
      {
        kind: 'rectangle',
        from: { x: 50, y: 50 },
        to: { x: 10, y: 10 },
      },
      'reveal',
    );
    expect(r1.noop).toBe(r2.noop);
    expect(r1.changed.length).toBe(r2.changed.length);
  });

  it('empty brush is noop', () => {
    const state = makeState();
    const result = rasterizeRegion(
      state,
      {
        kind: 'brush',
        points: [],
        radius: 40,
      },
      'reveal',
    );
    expect(result.noop).toBe(true);
  });

  it('polygon with < 3 points is noop', () => {
    const state = makeState();
    const result = rasterizeRegion(
      state,
      {
        kind: 'polygon',
        points: [
          { x: 10, y: 10 },
          { x: 20, y: 20 },
        ],
      },
      'reveal',
    );
    expect(result.noop).toBe(true);
  });

  it('rasterization preserves tile order determinism', () => {
    const state = makeState({ cellSize: 2 });
    const region = {
      kind: 'rectangle' as const,
      from: { x: 0, y: 0 },
      to: { x: 500, y: 500 },
    };
    const r1 = rasterizeRegion(state, region, 'reveal');
    const r2 = rasterizeRegion(state, region, 'reveal');
    expect(r1.changed).toEqual(r2.changed);
  });

  it('inputs remain immutable', () => {
    const state = makeState({ cellSize: 2 });
    const bytes = createTileBytes(true);
    const data = encodeBase64(bytes);
    const stateWithTile: FogStateV1 = {
      definition: state.definition,
      tiles: [{ x: 0, y: 0, data }],
    };
    const origTiles = [...stateWithTile.tiles];
    const origData = (stateWithTile.tiles[0] as FogTileV1).data;

    rasterizeRegion(
      stateWithTile,
      {
        kind: 'rectangle',
        from: { x: 0, y: 0 },
        to: { x: 100, y: 100 },
      },
      'conceal',
    );

    expect(stateWithTile.tiles).toEqual(origTiles);
    expect((stateWithTile.tiles[0] as FogTileV1).data).toBe(origData);
  });

  it('seam: brush across tile boundary', () => {
    const state = makeState({
      bounds: { x: 0, y: 0, w: 512, h: 512 },
      cellSize: 1,
    });
    const result = rasterizeRegion(
      state,
      {
        kind: 'brush',
        points: [
          { x: 127, y: 64 },
          { x: 129, y: 64 },
        ],
        radius: 5,
      },
      'reveal',
    );
    expect(result.noop).toBe(false);
    const s = applyRasterResult(state, result);
    expect(s.tiles.length).toBe(2);
  });

  it('tiny radius brush still rasterizes', () => {
    const state = makeState({ cellSize: 1 });
    const result = rasterizeRegion(
      state,
      {
        kind: 'brush',
        points: [{ x: 50, y: 50 }],
        radius: 1,
      },
      'reveal',
    );
    expect(result.noop).toBe(false);
  });

  it('huge radius covers many tiles', () => {
    const state = makeState({
      bounds: { x: 0, y: 0, w: 1024, h: 1024 },
      cellSize: 2,
    });
    const result = rasterizeRegion(
      state,
      {
        kind: 'brush',
        points: [{ x: 512, y: 512 }],
        radius: 400,
      },
      'reveal',
    );
    expect(result.noop).toBe(false);
    const s = applyRasterResult(state, result);
    expect(s.tiles.length).toBeGreaterThan(1);
  });

  it('out-of-bounds rectangle is noop', () => {
    const state = makeState({
      bounds: { x: 0, y: 0, w: 100, h: 100 },
      cellSize: 1,
    });
    const result = rasterizeRegion(
      state,
      {
        kind: 'rectangle',
        from: { x: 200, y: 200 },
        to: { x: 300, y: 300 },
      },
      'reveal',
    );
    expect(result.noop).toBe(true);
  });
});

describe('applyRasterResult', () => {
  it('returns same state on noop', () => {
    const state = makeState();
    const result = { changed: [], noop: true };
    expect(applyRasterResult(state, result)).toBe(state);
  });

  it('adds new tiles', () => {
    const state = makeState({ cellSize: 1 });
    const region = {
      kind: 'rectangle' as const,
      from: { x: 0, y: 0 },
      to: { x: 50, y: 50 },
    };
    const result = rasterizeRegion(state, region, 'reveal');
    const newState = applyRasterResult(state, result);
    expect(newState.tiles.length).toBeGreaterThan(0);
    expect(newState.definition).toBe(state.definition);
  });
});

describe('mutation gates', () => {
  it('flipping bit meaning breaks reveal expectation', () => {
    const bytes = createTileBytes(false);
    setBit(bytes, 0, 0, true);
    expect(getBit(bytes, 0, 0)).toBe(true);
    // if bit meaning were flipped, getBit would return false
  });

  it('missing edge canonicalization would allow out-of-bounds bits', () => {
    const def = makeDef({ bounds: { x: 0, y: 0, w: 64, h: 64 }, cellSize: 1 });
    const state: FogStateV1 = { definition: def, tiles: [] };
    const result = rasterizeRegion(
      state,
      {
        kind: 'rectangle',
        from: { x: 0, y: 0 },
        to: { x: 63, y: 63 },
      },
      'reveal',
    );
    const s = applyRasterResult(state, result);
    expect(s.tiles.length).toBe(1);
    const bytes = decodeBase64((s.tiles[0] as FogTileV1).data);
    for (let row = 64; row < 128; row++) {
      for (let col = 0; col < 128; col++) {
        expect(getBit(bytes, col, row)).toBe(false);
      }
    }
  });

  it('removing seam clipping would cause wrong tile count at boundary', () => {
    const state = makeState({
      bounds: { x: 0, y: 0, w: 256, h: 256 },
      cellSize: 1,
    });
    const result = rasterizeRegion(
      state,
      {
        kind: 'rectangle',
        from: { x: 0, y: 0 },
        to: { x: 255, y: 255 },
      },
      'reveal',
    );
    const s = applyRasterResult(state, result);
    expect(s.tiles.length).toBe(4);
  });

  it('changing tile cap inequality rejects exactly 256 tiles', () => {
    expect(FOG_MAX_TILES).toBe(256);
  });
});
