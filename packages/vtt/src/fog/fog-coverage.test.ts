import { createShape } from '@fieldnotes/core';
import type { Bounds, ExtensionElementEnvelope, Point } from '@fieldnotes/core';
import type { SyncElement } from '@fieldnotes/sync';
import { describe, expect, it } from 'vitest';
import { createGrid, createTemplate } from '../elements/element-factory';
import { gridElementTypeDefinition } from '../grid/grid-definition';
import { createMovementRecord, movementRecordTypeDefinition } from '../movement/movement-record';
import { templateElementTypeDefinition } from '../template/template-definition';
import { isCoveredByFog, isElementCoveredByFog } from './fog-coverage';
import type { FogSnapshot, FogTileRecord } from './fog-sync-types';
import { createTileBytes, encodeBase64, setBit } from './tile-codec';
import type { FogBase, FogDefinitionV1 } from './types';

function snap(base: FogBase, tiles: readonly FogTileRecord[] = []): FogSnapshot {
  return {
    meta: {
      version: 1,
      editor: 'gm',
      definition: {
        version: 1,
        generation: 'g1',
        bounds: { x: 0, y: 0, w: 2000, h: 2000 },
        cellSize: 10,
        tileCells: 128,
        base,
      },
    },
    tiles,
  };
}

/** A tile with every cell covered except `revealed` (col, row pairs). */
function tile(x: number, y: number, revealed: readonly (readonly [number, number])[] = []) {
  const bytes = createTileBytes(false);
  for (const [col, row] of revealed) setBit(bytes, col, row, true);
  return { generation: 'g1', x, y, version: 1, editor: 'gm', data: encodeBase64(bytes) };
}

const holeAt12 = (): FogSnapshot => snap('covered', [tile(0, 0, [[12, 12]])]);

describe('isCoveredByFog', () => {
  it.each<[string, FogSnapshot, Bounds, boolean]>([
    ['base covered without tiles', snap('covered'), { x: 100, y: 100, w: 40, h: 40 }, true],
    ['base revealed without tiles', snap('revealed'), { x: 100, y: 100, w: 40, h: 40 }, false],
    ['bounds over the revealed cell', holeAt12(), { x: 115, y: 115, w: 10, h: 10 }, false],
    ['bounds exactly on the revealed cell', holeAt12(), { x: 120, y: 120, w: 10, h: 10 }, false],
    ['bounds right of the revealed cell', holeAt12(), { x: 130, y: 120, w: 10, h: 10 }, true],
    ['bounds ending at the revealed cell edge', holeAt12(), { x: 110, y: 120, w: 10, h: 10 }, true],
    [
      'a dataless tile on base covered',
      snap('covered', [{ generation: 'g1', x: 0, y: 0, version: 2, editor: 'gm' }]),
      { x: 100, y: 100, w: 40, h: 40 },
      true,
    ],
    [
      'a dataless tile on base revealed',
      snap('revealed', [{ generation: 'g1', x: 0, y: 0, version: 2, editor: 'gm' }]),
      { x: 100, y: 100, w: 40, h: 40 },
      false,
    ],
    [
      'a tile edge with both sides covered',
      snap('revealed', [tile(0, 0), tile(1, 0)]),
      { x: 1270, y: 100, w: 30, h: 10 },
      true,
    ],
    [
      'a tile edge with the right tile missing',
      snap('revealed', [tile(0, 0)]),
      { x: 1270, y: 100, w: 30, h: 10 },
      false,
    ],
    [
      'a tile edge with the left tile missing',
      snap('revealed', [tile(1, 0)]),
      { x: 1270, y: 100, w: 30, h: 10 },
      false,
    ],
    [
      'a tile edge with one cell revealed in the right tile',
      snap('covered', [tile(1, 0, [[1, 10]])]),
      { x: 1270, y: 100, w: 30, h: 10 },
      false,
    ],
    ['bounds partly right of the fog', snap('covered'), { x: 1990, y: 100, w: 20, h: 10 }, false],
    ['bounds partly left of the fog', snap('covered'), { x: -5, y: 100, w: 20, h: 10 }, false],
    ['bounds fully outside the fog', snap('covered'), { x: 3000, y: 3000, w: 10, h: 10 }, false],
    ['a point on the revealed cell', holeAt12(), { x: 120, y: 120, w: 0, h: 0 }, false],
    ['a point inside the revealed cell', holeAt12(), { x: 125, y: 129, w: 0, h: 0 }, false],
    ['a point next to the revealed cell', holeAt12(), { x: 130, y: 125, w: 0, h: 0 }, true],
    [
      'no fog definition',
      { meta: { version: 1, editor: 'hub' }, tiles: [] },
      { x: 100, y: 100, w: 40, h: 40 },
      false,
    ],
  ])('%s', (_, snapshot, bounds, covered) => {
    expect(isCoveredByFog(snapshot, bounds)).toBe(covered);
  });
});

/** Mulberry32: a deterministic PRNG so the property run is reproducible. */
function prng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Mask {
  readonly snapshot: FogSnapshot;
  readonly bytes: ReadonlyMap<string, Uint8Array>;
}

function randomMask(random: () => number): Mask {
  const cellSize = random() < 0.5 ? 4 : 10;
  const base: FogBase = random() < 0.5 ? 'covered' : 'revealed';
  const fog = { x: -700 - Math.floor(random() * 600), y: -300, w: 1700, h: 1400 };
  const span = 128 * cellSize;
  const bytes = new Map<string, Uint8Array>();
  const tiles: FogTileRecord[] = [];
  for (let ty = Math.floor(fog.y / span); ty <= Math.floor((fog.y + fog.h) / span); ty++) {
    for (let tx = Math.floor(fog.x / span); tx <= Math.floor((fog.x + fog.w) / span); tx++) {
      const roll = random();
      if (roll < 0.2) continue;
      if (roll < 0.3) {
        tiles.push({ generation: 'g1', x: tx, y: ty, version: 1, editor: 'gm' });
        continue;
      }
      const data = new Uint8Array(2048);
      for (let i = Math.floor(random() * 4); i > 0; i--) {
        const cell = Math.floor(random() * 128 * 128);
        data[cell >> 3] = (data[cell >> 3] ?? 0) | (0x80 >> (cell & 7));
      }
      bytes.set(`${tx},${ty}`, data);
      tiles.push({
        generation: 'g1',
        x: tx,
        y: ty,
        version: 1,
        editor: 'gm',
        data: encodeBase64(data),
      });
    }
  }
  const definition: FogDefinitionV1 = {
    version: 1,
    generation: 'g1',
    bounds: fog,
    cellSize,
    tileCells: 128,
    base,
  };
  return { snapshot: { meta: { version: 1, editor: 'gm', definition }, tiles }, bytes };
}

/** Walks every touched cell and reads its bit straight from the raw tile bytes. */
function naiveCovered({ snapshot, bytes }: Mask, b: Bounds): boolean {
  const def = snapshot.meta.definition;
  if (!def) return false;
  const f = def.bounds;
  if (!(b.x >= f.x && b.y >= f.y && b.x + b.w <= f.x + f.w && b.y + b.h <= f.y + f.h)) return false;
  const cs = def.cellSize;
  const lastCell = (start: number, size: number) =>
    size === 0 ? Math.floor(start / cs) : Math.ceil((start + size) / cs) - 1;
  for (let cy = Math.floor(b.y / cs); cy <= lastCell(b.y, b.h); cy++) {
    for (let cx = Math.floor(b.x / cs); cx <= lastCell(b.x, b.w); cx++) {
      const tx = Math.floor(cx / 128);
      const ty = Math.floor(cy / 128);
      const data = bytes.get(`${tx},${ty}`);
      const cell = (cy - ty * 128) * 128 + (cx - tx * 128);
      const revealed = data
        ? ((data[cell >> 3] ?? 0) & (0x80 >> (cell & 7))) !== 0
        : def.base === 'revealed';
      if (revealed) return false;
    }
  }
  return true;
}

function randomBounds(random: () => number, mask: Mask): Bounds {
  const def = mask.snapshot.meta.definition;
  if (!def) throw new Error('mask without definition');
  const f = def.bounds;
  const coordinate = (start: number, size: number) => {
    const value = start - 20 + random() * (size + 40);
    return random() < 0.4 ? Math.round(value / def.cellSize) * def.cellSize : value;
  };
  const x = coordinate(f.x, f.w);
  const y = coordinate(f.y, f.h);
  const roll = random();
  if (roll < 0.15) return { x, y, w: 0, h: 0 };
  if (roll < 0.2) return { x, y, w: 1e-16, h: 1e-16 };
  const size = () => (random() < 0.4 ? Math.ceil(random() * 40) * def.cellSize : random() * 300);
  return { x, y, w: size(), h: size() };
}

describe('isCoveredByFog against the per-cell rule', () => {
  it('matches a naive per-cell walk on random masks and bounds', () => {
    const random = prng(278);
    const outcomes = new Set<boolean>();
    for (let m = 0; m < 60; m++) {
      const mask = randomMask(random);
      for (let i = 0; i < 100; i++) {
        const bounds = randomBounds(random, mask);
        const expected = naiveCovered(mask, bounds);
        outcomes.add(expected);
        expect(isCoveredByFog(mask.snapshot, bounds), JSON.stringify(bounds)).toBe(expected);
      }
    }
    expect([...outcomes].sort()).toEqual([false, true]);
  });

  it('judges a map-sized covered element within the tile budget', () => {
    const data = encodeBase64(createTileBytes(false));
    const tiles: FogTileRecord[] = [];
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++)
        tiles.push({ generation: 'g1', x, y, version: 1, editor: 'gm', data });
    }
    const bounds = { x: 0, y: 0, w: 20480, h: 20480 };
    const definition: FogDefinitionV1 = {
      version: 1,
      generation: 'g1',
      bounds,
      cellSize: 10,
      tileCells: 128,
      base: 'revealed',
    };
    const fresh: FogSnapshot = { meta: { version: 1, editor: 'gm', definition }, tiles };
    const start = performance.now();
    const covered = isCoveredByFog(fresh, bounds);
    const elapsed = performance.now() - start;
    expect(covered).toBe(true);
    expect(elapsed).toBeLessThan(50);
  });
});

function shape(x: number, y: number): SyncElement {
  return createShape({ index: 'a0', position: { x, y }, size: { w: 40, h: 40 } });
}

function template(x: number, y: number, radius: number): ExtensionElementEnvelope {
  return templateElementTypeDefinition.wrap(
    createTemplate({ position: { x, y }, templateShape: 'circle', radius }),
  );
}

function movement(trail: Point[][]): SyncElement {
  const record = createMovementRecord({ target: shape(0, 0), epoch: 'e1', visibility: 'all' });
  return movementRecordTypeDefinition.wrap({ ...record, trail });
}

describe('isElementCoveredByFog', () => {
  const brokenTemplate: SyncElement = {
    ...template(500, 500, 20),
    data: { templateShape: 'blob' },
  };
  const acme: SyncElement = {
    id: 'a1',
    type: 'extension',
    extensionType: 'acme:thing',
    data: {},
    position: { x: 500, y: 500 },
    index: 'a0',
    version: 1,
    locked: false,
    layerId: '',
  };

  it.each<[string, FogSnapshot, SyncElement, boolean]>([
    ['a shape under base covered', snap('covered'), shape(100, 100), true],
    ['a shape under base revealed', snap('revealed'), shape(100, 100), false],
    ['a shape over the revealed cell', holeAt12(), shape(100, 100), false],
    ['a template away from the revealed cell', holeAt12(), template(100, 100, 20), true],
    ['a template whose bounds reach the revealed cell', holeAt12(), template(100, 100, 25), false],
    ['a template with invalid data', snap('covered'), brokenTemplate, false],
    [
      'a grid under base covered',
      snap('covered'),
      gridElementTypeDefinition.wrap(createGrid({ position: { x: 500, y: 500 } })),
      false,
    ],
    [
      'a movement record ending on the revealed cell',
      holeAt12(),
      movement([
        [{ x: 500, y: 500 }],
        [
          { x: 600, y: 600 },
          { x: 125, y: 125 },
        ],
      ]),
      false,
    ],
    [
      'a movement record ending under fog after starting in the open',
      holeAt12(),
      movement([[{ x: 125, y: 125 }], [{ x: 500, y: 500 }]]),
      true,
    ],
    ['a movement record with an empty trail', holeAt12(), movement([]), true],
    [
      'a movement record with an empty trail and no fog',
      { meta: { version: 1, editor: 'hub' }, tiles: [] },
      movement([]),
      false,
    ],
    ['an unknown extension type under base covered', snap('covered'), acme, false],
  ])('%s', (_, snapshot, element, covered) => {
    expect(isElementCoveredByFog(snapshot, element)).toBe(covered);
  });
});
