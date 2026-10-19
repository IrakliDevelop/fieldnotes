import { describe, it, expect } from 'vitest';
import { createShape } from '@fieldnotes/core';
import type { SyncElement } from '@fieldnotes/sync';
import { MemoryHubBackend } from './memory-hub-backend';
import type { StoredTombstone } from './hub-backend';
import { createSyncServer } from './create-sync-server';

const base = createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } });
const shape = (id: string, version: number): SyncElement => ({ ...base, id, version });
const tomb = (id: string, version: number, removedAt = 0): StoredTombstone => ({
  id,
  version,
  editor: 'c1',
  removedAt,
  ownerId: 'u1',
  audience: 'gm',
});

describe('MemoryHubBackend', () => {
  it('upserts with a null expected version and returns the element from getRecord and snapshot', async () => {
    const backend = new MemoryHubBackend();
    const el = shape('a', 1);
    expect(await backend.applyElement('R', { kind: 'upsert', element: el }, null)).toEqual({
      ok: true,
    });
    expect(await backend.getRecord('R', 'a')).toEqual({ kind: 'element', element: el });
    expect(await backend.snapshot('R')).toEqual({ elements: [el], tombstones: [] });
  });

  it('rejects a null expected version when a record exists and reports it', async () => {
    const backend = new MemoryHubBackend();
    const el = shape('a', 1);
    await backend.applyElement('R', { kind: 'upsert', element: el }, null);
    expect(
      await backend.applyElement('R', { kind: 'upsert', element: shape('a', 5) }, null),
    ).toEqual({ ok: false, current: { kind: 'element', element: el } });
  });

  it('upsert succeeds on a matching expected version and conflicts on a stale one', async () => {
    const backend = new MemoryHubBackend();
    await backend.applyElement('R', { kind: 'upsert', element: shape('a', 1) }, null);
    const v2 = shape('a', 2);
    expect(await backend.applyElement('R', { kind: 'upsert', element: v2 }, 1)).toEqual({
      ok: true,
    });
    expect(await backend.applyElement('R', { kind: 'upsert', element: shape('a', 3) }, 1)).toEqual({
      ok: false,
      current: { kind: 'element', element: v2 },
    });
    expect(await backend.getRecord('R', 'a')).toEqual({ kind: 'element', element: v2 });
  });

  it('a numeric expected version conflicts when no record exists', async () => {
    const backend = new MemoryHubBackend();
    expect(await backend.applyElement('R', { kind: 'upsert', element: shape('a', 2) }, 1)).toEqual({
      ok: false,
      current: undefined,
    });
    expect(await backend.getRecord('R', 'a')).toBeUndefined();
  });

  it('remove replaces the element with a tombstone; a stale remove conflicts', async () => {
    const backend = new MemoryHubBackend({ now: () => 0 });
    await backend.applyElement('R', { kind: 'upsert', element: shape('a', 3) }, null);
    expect(await backend.applyElement('R', { kind: 'remove', tombstone: tomb('a', 4) }, 2)).toEqual(
      { ok: false, current: { kind: 'element', element: shape('a', 3) } },
    );
    expect(await backend.applyElement('R', { kind: 'remove', tombstone: tomb('a', 4) }, 3)).toEqual(
      { ok: true },
    );
    expect(await backend.getRecord('R', 'a')).toEqual({
      kind: 'tombstone',
      tombstone: tomb('a', 4),
    });
    expect(await backend.snapshot('R')).toEqual({ elements: [], tombstones: [tomb('a', 4)] });
  });

  it('an upsert expecting the tombstone version replaces the tombstone', async () => {
    const backend = new MemoryHubBackend();
    await backend.applyElement('R', { kind: 'remove', tombstone: tomb('a', 4) }, null);
    expect(
      await backend.applyElement('R', { kind: 'upsert', element: shape('a', 5) }, null),
    ).toEqual({ ok: false, current: { kind: 'tombstone', tombstone: tomb('a', 4) } });
    expect(await backend.applyElement('R', { kind: 'upsert', element: shape('a', 5) }, 4)).toEqual({
      ok: true,
    });
    expect(await backend.snapshot('R')).toEqual({ elements: [shape('a', 5)], tombstones: [] });
  });

  it('clear tombstones every element when the expected map matches', async () => {
    const backend = new MemoryHubBackend({ now: () => 0 });
    await backend.applyElement('R', { kind: 'upsert', element: shape('a', 1) }, null);
    await backend.applyElement('R', { kind: 'upsert', element: shape('b', 7) }, null);
    const write = {
      kind: 'clear' as const,
      tombstones: [tomb('a', 2), tomb('b', 8)],
      expected: new Map([
        ['a', 1],
        ['b', 7],
      ]),
    };
    expect(await backend.applyElement('R', write, null)).toEqual({ ok: true });
    expect(await backend.snapshot('R')).toEqual({
      elements: [],
      tombstones: [tomb('a', 2), tomb('b', 8)],
    });
  });

  it.each([
    [
      'a stale version',
      [
        ['a', 1],
        ['b', 6],
      ],
    ],
    ['a missing element', [['a', 1]]],
    [
      'an extra id',
      [
        ['a', 1],
        ['b', 7],
        ['c', 1],
      ],
    ],
  ] as const)('clear with %s writes nothing', async (_name, entries) => {
    const backend = new MemoryHubBackend();
    await backend.applyElement('R', { kind: 'upsert', element: shape('a', 1) }, null);
    await backend.applyElement('R', { kind: 'upsert', element: shape('b', 7) }, null);
    const result = await backend.applyElement(
      'R',
      {
        kind: 'clear',
        tombstones: entries.map(([id, v]) => tomb(id, v + 1)),
        expected: new Map(entries),
      },
      null,
    );
    expect(result.ok).toBe(false);
    expect(await backend.snapshot('R')).toEqual({
      elements: [shape('a', 1), shape('b', 7)],
      tombstones: [],
    });
  });

  it('snapshot omits tombstones older than the retention', async () => {
    let now = 10_000;
    const backend = new MemoryHubBackend({ tombstoneRetentionMs: 1_000, now: () => now });
    await backend.applyElement('R', { kind: 'remove', tombstone: tomb('old', 1, 8_000) }, null);
    await backend.applyElement('R', { kind: 'remove', tombstone: tomb('new', 1, 9_500) }, null);
    expect(await backend.snapshot('R')).toEqual({
      elements: [],
      tombstones: [tomb('new', 1, 9_500)],
    });
    now = 20_000;
    expect(await backend.snapshot('R')).toEqual({ elements: [], tombstones: [] });
  });

  it('isolates rooms', async () => {
    const backend = new MemoryHubBackend();
    await backend.applyElement('R', { kind: 'upsert', element: shape('a', 1) }, null);
    expect(await backend.snapshot('R2')).toEqual({ elements: [], tombstones: [] });
    expect(await backend.getRecord('R2', 'a')).toBeUndefined();
  });

  it('evictRoom drops elements, tombstones and layer records of that room only', async () => {
    const backend = new MemoryHubBackend({ now: () => 0 });
    const layer = {
      id: 'L1',
      version: 1,
      editor: 'c',
      definition: { id: 'L1', name: 'L', visible: true, locked: false, order: 1, opacity: 1 },
    };
    for (const room of ['R', 'R2']) {
      await backend.applyElement(room, { kind: 'upsert', element: shape('a', 1) }, null);
      await backend.applyElement(room, { kind: 'remove', tombstone: tomb('t', 2) }, null);
      await backend.applyLayerRecord(room, layer);
    }

    await backend.evictRoom('R');

    expect(await backend.snapshot('R')).toEqual({ elements: [], tombstones: [] });
    expect(await backend.layerRecords('R')).toEqual([]);
    expect(await backend.snapshot('R2')).toEqual({
      elements: [shape('a', 1)],
      tombstones: [tomb('t', 2)],
    });
    expect(await backend.layerRecords('R2')).toEqual([layer]);
  });

  it.each([0, Number.NaN, -1, Infinity])('rejects tombstoneRetentionMs %s', (value) => {
    expect(() => new MemoryHubBackend({ tombstoneRetentionMs: value })).toThrow(
      new RangeError('tombstoneRetentionMs must be a positive finite number'),
    );
  });
});

describe('createSyncServer tombstoneRetentionMs', () => {
  it('throws when both a backend and tombstoneRetentionMs are given', () => {
    expect(() =>
      createSyncServer({ backend: new MemoryHubBackend(), tombstoneRetentionMs: 1_000 }),
    ).toThrow('tombstoneRetentionMs applies only to the default backend');
  });
});
