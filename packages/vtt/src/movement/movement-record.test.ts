import { describe, it, expect } from 'vitest';
import { ElementRegistry, ElementStore } from '@fieldnotes/core';
import type { CanvasElement, ExtensionElementEnvelope, Point } from '@fieldnotes/core';
import { registerVttElementTypes } from '../register';
import {
  appendTrail,
  createMovementRecord,
  getMovementVisibility,
  movementRecordTypeDefinition,
  resolveMovementVisibility,
} from './movement-record';

const token: CanvasElement = {
  id: 'tok-1',
  type: 'shape',
  position: { x: 50, y: 60 },
  index: 'a3',
  version: 4,
  locked: false,
  layerId: 'tokens',
  shape: 'ellipse',
  size: { w: 40, h: 40 },
  strokeColor: '#000',
  strokeWidth: 1,
  fillColor: '#fff',
};

const validData = {
  targetId: 'tok-1',
  epoch: 'round-3',
  feet: 15,
  diagonals: 1,
  visibility: 'dm',
  trail: [
    [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ],
    [{ x: 40, y: 0 }],
  ],
};

function envelope(data: Record<string, unknown> = validData): ExtensionElementEnvelope {
  return {
    id: 'vtt-movement:tok-1',
    type: 'extension',
    extensionType: 'vtt:movement',
    position: { x: 0, y: 0 },
    index: 'a1',
    version: 2,
    locked: true,
    layerId: 'tokens',
    data,
  };
}

function points(from: number, to: number): Point[] {
  const out: Point[] = [];
  for (let i = from; i < to; i++) out.push({ x: i, y: 0 });
  return out;
}

describe('createMovementRecord', () => {
  it('builds a locked empty record keyed and layered by its target', () => {
    expect(createMovementRecord({ target: token, epoch: 'e1', visibility: 'all' })).toEqual({
      id: 'vtt-movement:tok-1',
      type: 'movement',
      position: { x: 0, y: 0 },
      index: '',
      version: 0,
      locked: true,
      layerId: 'tokens',
      targetId: 'tok-1',
      epoch: 'e1',
      feet: 0,
      diagonals: 0,
      visibility: 'all',
      trail: [],
    });
  });
});

describe('movementRecordTypeDefinition', () => {
  it('accepts a well-formed record', () => {
    expect(movementRecordTypeDefinition.validateData(validData)).toBe(true);
  });

  it.each<[string, Record<string, unknown>]>([
    ['non-finite feet', { ...validData, feet: Infinity }],
    ['negative feet', { ...validData, feet: -5 }],
    ['negative diagonals', { ...validData, diagonals: -1 }],
    ['fractional diagonals', { ...validData, diagonals: 1.5 }],
    ['a bad visibility', { ...validData, visibility: 'everyone' }],
    ['a non-string targetId', { ...validData, targetId: 7 }],
    ['a non-string epoch', { ...validData, epoch: null }],
    ['a trail point with NaN', { ...validData, trail: [[{ x: NaN, y: 0 }]] }],
    ['a trail that is not runs of points', { ...validData, trail: [{ x: 0, y: 0 }] }],
    ['65 trail points', { ...validData, trail: [points(0, 40), points(40, 65)] }],
    ['an empty run', { ...validData, trail: [[{ x: 0, y: 0 }], []] }],
  ])('rejects %s', (_name, data) => {
    expect(movementRecordTypeDefinition.validateData(data)).toBe(false);
  });

  it('accepts exactly 64 trail points', () => {
    const data = { ...validData, trail: [points(0, 30), points(30, 64)] };
    expect(movementRecordTypeDefinition.validateData(data)).toBe(true);
  });

  it('wrap(unwrap(envelope)) round-trips', () => {
    const def = movementRecordTypeDefinition;
    const record = def.unwrap(envelope());
    expect(record).toMatchObject({ type: 'movement', targetId: 'tok-1', feet: 15, diagonals: 1 });
    expect(def.wrap(record)).toEqual(envelope());
  });

  it('has no bounds', () => {
    expect(
      movementRecordTypeDefinition.bounds(movementRecordTypeDefinition.unwrap(envelope())),
    ).toBeNull();
  });

  it('registerVttElementTypes validates it and the store keeps it out of the spatial index', () => {
    const registry = new ElementRegistry();
    registerVttElementTypes(registry);
    const adapter = registry.getAdapter('vtt:movement');
    expect(adapter?.validateEnvelope(envelope())).toBe(true);
    expect(adapter?.validateEnvelope(envelope({ ...validData, feet: 'far' }))).toBe(false);

    const store = new ElementStore(registry);
    store.add(envelope());
    expect(store.getById('vtt-movement:tok-1')).toMatchObject({ dataVersion: 1 });
    expect(store.queryRect({ x: -1e4, y: -1e4, w: 2e4, h: 2e4 })).toEqual([]);
  });
});

describe('getMovementVisibility', () => {
  it('reads the visibility of a movement record envelope', () => {
    expect(getMovementVisibility(envelope())).toBe('dm');
    expect(getMovementVisibility(envelope({ ...validData, visibility: 'all' }))).toBe('all');
  });

  it.each<[string, unknown]>([
    ['a grid element', { ...envelope(), extensionType: 'vtt:grid' }],
    ['a malformed record', envelope({ ...validData, trail: 'x' })],
    ['a non-extension element', token],
    ['null', null],
    ['a string', 'vtt:movement'],
    ['an envelope without data', { ...envelope(), data: undefined }],
  ])('returns undefined for %s', (_name, value) => {
    expect(getMovementVisibility(value)).toBeUndefined();
  });
});

describe('resolveMovementVisibility', () => {
  it.each<[Parameters<typeof resolveMovementVisibility>[0], 'all' | 'dm']>([
    [{ controller: 'player', shareDmDefault: false, override: 'hide' }, 'all'],
    [{ controller: 'player', shareDmDefault: false }, 'all'],
    [{ controller: 'dm', shareDmDefault: true }, 'all'],
    [{ controller: 'dm', shareDmDefault: true, override: 'hide' }, 'dm'],
    [{ controller: 'dm', shareDmDefault: false, override: 'share' }, 'all'],
    [{ controller: 'dm', shareDmDefault: false }, 'dm'],
  ])('%o resolves to %s', (input, expected) => {
    expect(resolveMovementVisibility(input)).toBe(expected);
  });
});

describe('appendTrail', () => {
  it('extends the last run or starts a new one', () => {
    const trail = [[{ x: 0, y: 0 }]];
    expect(appendTrail(trail, [{ x: 1, y: 0 }], false)).toEqual([
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
    ]);
    expect(appendTrail(trail, [{ x: 5, y: 5 }], true)).toEqual([
      [{ x: 0, y: 0 }],
      [{ x: 5, y: 5 }],
    ]);
    expect(appendTrail([], [{ x: 1, y: 0 }], false)).toEqual([[{ x: 1, y: 0 }]]);
  });

  it('keeps the newest 64 points across runs', () => {
    const trail = [points(0, 30), points(30, 50)];
    expect(appendTrail(trail, points(50, 80), true)).toEqual([
      points(16, 30),
      points(30, 50),
      points(50, 80),
    ]);
    expect(appendTrail(trail, points(50, 120), true)).toEqual([points(56, 120)]);
  });

  it('does not mutate its input', () => {
    const trail = [points(0, 64)];
    appendTrail(trail, points(64, 70), false);
    expect(trail).toEqual([points(0, 64)]);
  });
});
