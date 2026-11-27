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
import type { FogBase } from './types';

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
