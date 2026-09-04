import { describe, it, expect } from 'vitest';
import { createShape, fogEncodeBase64 } from '@fieldnotes/core';
import type { CanvasElement } from '@fieldnotes/core';
import { RedisHubBackend, type RedisHashClient } from './index';
import type { FogMetaRecord, FogTileRecord, LayerRecord } from '@fieldnotes/sync';

class FakeRedis implements RedisHashClient {
  store = new Map<string, Map<string, string>>();
  beforeFogPatchEval?: (tilesKey: string) => void;
  private hash(key: string): Map<string, string> {
    let m = this.store.get(key);
    if (!m) {
      m = new Map();
      this.store.set(key, m);
    }
    return m;
  }
  async hGetAll(key: string): Promise<Record<string, string>> {
    const m = this.store.get(key);
    return m ? Object.fromEntries(m) : {};
  }
  async hGet(key: string, field: string): Promise<string | null> {
    return this.store.get(key)?.get(field) ?? null;
  }
  async hSet(key: string, field: string, value: string): Promise<number> {
    this.hash(key).set(field, value);
    return 1;
  }
  async hDel(key: string, field: string): Promise<number> {
    this.store.get(key)?.delete(field);
    return 1;
  }
  async del(key: string): Promise<number> {
    this.store.delete(key);
    return 1;
  }

  async eval(_script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown> {
    const [metaKey, tilesKey] = options.keys;
    const incoming = JSON.parse(options.arguments[0] ?? '') as
      | FogMetaRecord
      | FogTileRecord
      | FogTileRecord[];
    if (!metaKey || !tilesKey) throw new Error('missing keys');
    if (Array.isArray(incoming)) {
      this.beforeFogPatchEval?.(tilesKey);
      const invalidStored = JSON.parse(options.arguments[2] ?? '{}') as Record<string, string>;
      for (const [field, raw] of Object.entries(invalidStored)) {
        const tiles = this.store.get(tilesKey);
        if (tiles?.get(field) === raw) tiles.delete(field);
      }
      return this.applyFogPatch(metaKey, tilesKey, incoming);
    }
    if ('x' in incoming) return this.applyFogTile(metaKey, tilesKey, incoming);
    return this.applyFogMeta(metaKey, tilesKey, incoming, options.arguments[3]);
  }

  private applyFogMeta(
    metaKey: string,
    tilesKey: string,
    incoming: FogMetaRecord,
    replacementsRaw?: string,
  ): unknown[] {
    const currentRaw = this.store.get(metaKey)?.get('current');
    const current = currentRaw ? (JSON.parse(currentRaw) as FogMetaRecord) : undefined;
    if (current && !newer(incoming, current)) return [0, currentRaw];
    if (
      current?.definition &&
      incoming.definition &&
      current.definition.generation === incoming.definition.generation &&
      (current.definition.cellSize !== incoming.definition.cellSize ||
        current.definition.base !== incoming.definition.base ||
        incoming.definition.bounds.x > current.definition.bounds.x ||
        incoming.definition.bounds.y > current.definition.bounds.y ||
        incoming.definition.bounds.x + incoming.definition.bounds.w <
          current.definition.bounds.x + current.definition.bounds.w ||
        incoming.definition.bounds.y + incoming.definition.bounds.h <
          current.definition.bounds.y + current.definition.bounds.h)
    ) {
      return [0, currentRaw];
    }
    this.hash(metaKey).set('current', JSON.stringify(incoming));
    if (
      !incoming.definition ||
      !current?.definition ||
      current.definition.generation !== incoming.definition.generation
    ) {
      this.store.delete(tilesKey);
    } else if (replacementsRaw) {
      this.store.delete(tilesKey);
      for (const tile of JSON.parse(replacementsRaw) as FogTileRecord[]) {
        this.hash(tilesKey).set(`${tile.x},${tile.y}`, JSON.stringify(tile));
      }
    }
    return [1];
  }

  private applyFogTile(metaKey: string, tilesKey: string, incoming: FogTileRecord): unknown[] {
    const metaRaw = this.store.get(metaKey)?.get('current');
    const meta = metaRaw ? (JSON.parse(metaRaw) as FogMetaRecord) : undefined;
    if (!meta?.definition) return [0];
    const key = `${incoming.x},${incoming.y}`;
    const currentRaw = this.store.get(tilesKey)?.get(key);
    const current = currentRaw ? (JSON.parse(currentRaw) as FogTileRecord) : undefined;
    const correction =
      currentRaw ??
      JSON.stringify({
        generation: meta.definition.generation,
        x: incoming.x,
        y: incoming.y,
        version: 1,
        editor: 'hub',
      });
    if (incoming.generation !== meta.definition.generation) return [0, correction];
    if (!tileIntersects(incoming, meta.definition)) return [0, correction];
    if (current && !newer(incoming, current)) return [0, currentRaw];
    if (!current && (this.store.get(tilesKey)?.size ?? 0) >= 256) return [0, correction];
    this.hash(tilesKey).set(key, JSON.stringify(incoming));
    return [1];
  }

  private applyFogPatch(metaKey: string, tilesKey: string, incoming: FogTileRecord[]): unknown[] {
    const before = new Map(this.store.get(tilesKey) ?? []);
    const newCoordinates = incoming.filter((tile) => !before.has(`${tile.x},${tile.y}`)).length;
    if (before.size + newCoordinates > 256) {
      const meta = JSON.parse(this.store.get(metaKey)?.get('current') ?? '{}') as FogMetaRecord;
      const corrections = incoming.map((tile) =>
        before.has(`${tile.x},${tile.y}`)
          ? (JSON.parse(before.get(`${tile.x},${tile.y}`) ?? '') as FogTileRecord)
          : {
              generation: meta.definition?.generation ?? tile.generation,
              x: tile.x,
              y: tile.y,
              version: 1,
              editor: 'hub',
            },
      );
      return [0, corrections.length, ...corrections.map(JSON.stringify)];
    }
    const accepted: FogTileRecord[] = [];
    const corrections: FogTileRecord[] = [];
    for (const tile of incoming) {
      const result = this.applyFogTile(metaKey, tilesKey, tile);
      if (result[0] === 1) accepted.push(tile);
      else if (typeof result[1] === 'string') corrections.push(JSON.parse(result[1]));
    }
    return [
      accepted.length,
      ...accepted.map(JSON.stringify),
      corrections.length,
      ...corrections.map(JSON.stringify),
    ];
  }
}

function newer(a: { version: number; editor: string }, b: { version: number; editor: string }) {
  return a.version > b.version || (a.version === b.version && a.editor > b.editor);
}

function tileIntersects(
  tile: Pick<FogTileRecord, 'x' | 'y'>,
  definition: NonNullable<FogMetaRecord['definition']>,
) {
  const size = 128 * definition.cellSize;
  const x = tile.x * size;
  const y = tile.y * size;
  return !(
    x + size <= definition.bounds.x ||
    y + size <= definition.bounds.y ||
    x >= definition.bounds.x + definition.bounds.w ||
    y >= definition.bounds.y + definition.bounds.h
  );
}

function element(id: string, x = 0): CanvasElement {
  return { ...createShape({ position: { x, y: 0 }, size: { w: 10, h: 10 } }), id };
}

describe('RedisHubBackend', () => {
  it('round-trips upsert/update/remove/clear', async () => {
    const fake = new FakeRedis();
    const b = new RedisHubBackend(fake);

    await b.apply('R', { kind: 'upsert', element: element('e1', 1) });
    let snap = await b.snapshot('R');
    expect(snap).toHaveLength(1);
    expect(snap[0]?.id).toBe('e1');
    expect(snap[0]?.position.x).toBe(1);

    await b.apply('R', { kind: 'upsert', element: element('e1', 99) });
    snap = await b.snapshot('R');
    expect(snap).toHaveLength(1);
    expect(snap[0]?.position.x).toBe(99);

    await b.apply('R', { kind: 'remove', id: 'e1' });
    expect(await b.snapshot('R')).toHaveLength(0);

    await b.apply('R', { kind: 'upsert', element: element('e1') });
    await b.apply('R', { kind: 'upsert', element: element('e2') });
    await b.apply('R', { kind: 'clear' });
    expect(await b.snapshot('R')).toHaveLength(0);
  });

  it('persists room state across backend instances (restart)', async () => {
    const fake = new FakeRedis();
    const b1 = new RedisHubBackend(fake);
    await b1.apply('R', { kind: 'upsert', element: element('e1') });
    await b1.apply('R', { kind: 'upsert', element: element('e2') });

    const b2 = new RedisHubBackend(fake);
    const snap = await b2.snapshot('R');
    expect(snap.map((e) => e.id).sort()).toEqual(['e1', 'e2']);
  });

  it('isolates state by keyPrefix', async () => {
    const fake = new FakeRedis();
    const a = new RedisHubBackend(fake, { keyPrefix: 'a:' });
    const b = new RedisHubBackend(fake, { keyPrefix: 'b:' });
    await a.apply('R', { kind: 'upsert', element: element('e1') });
    expect(await b.snapshot('R')).toHaveLength(0);
    expect(await a.snapshot('R')).toHaveLength(1);
  });

  it('isolates state by room', async () => {
    const fake = new FakeRedis();
    const b = new RedisHubBackend(fake);
    await b.apply('R', { kind: 'upsert', element: element('e1') });
    expect(await b.snapshot('R2')).toHaveLength(0);
  });

  describe('get', () => {
    it('returns the stored element after apply', async () => {
      const fake = new FakeRedis();
      const b = new RedisHubBackend(fake);
      await b.apply('R', { kind: 'upsert', element: element('e1', 5) });
      const got = await b.get('R', 'e1');
      expect(got?.id).toBe('e1');
      expect(got?.position.x).toBe(5);
    });

    it('returns undefined for an absent element', async () => {
      const fake = new FakeRedis();
      const b = new RedisHubBackend(fake);
      expect(await b.get('R', 'missing')).toBeUndefined();
    });

    it('returns undefined for a corrupt stored value without throwing', async () => {
      const fake = new FakeRedis();
      const b = new RedisHubBackend(fake);
      await fake.hSet('fieldnotes:room:R', 'bad', 'not json{');
      expect(await b.get('R', 'bad')).toBeUndefined();
    });
  });

  it('filters malformed stored values without throwing', async () => {
    const fake = new FakeRedis();
    const b = new RedisHubBackend(fake);
    await b.apply('R', { kind: 'upsert', element: element('good') });
    await fake.hSet('fieldnotes:room:R', 'bad', 'not json{');
    await fake.hSet('fieldnotes:room:R', 'noid', JSON.stringify({ type: 'shape' }));
    await fake.hSet(
      'fieldnotes:room:R',
      'malformed',
      JSON.stringify({ ...element('malformed'), size: { w: 'wide', h: 10 } }),
    );

    const snap = await b.snapshot('R');
    expect(snap).toHaveLength(1);
    expect(snap[0]?.id).toBe('good');
  });
});

describe('RedisHubBackend layer records', () => {
  function record(id: string, version: number, editor = 'A'): LayerRecord {
    return {
      id,
      version,
      editor,
      definition: { id, name: id, visible: true, locked: false, order: 0, opacity: 1 },
    };
  }

  it('round-trips layer records, tombstones included, in a separate hash', async () => {
    const fake = new FakeRedis();
    const b = new RedisHubBackend(fake);

    await b.applyLayerRecord('R', record('layer-a', 1));
    await b.applyLayerRecord('R', { id: 'layer-b', version: 4, editor: 'B' }); // tombstone
    expect(await b.getLayerRecord('R', 'layer-a')).toEqual(record('layer-a', 1));
    expect(await b.getLayerRecord('R', 'layer-b')).toEqual({
      id: 'layer-b',
      version: 4,
      editor: 'B',
    });
    const all = await b.layerRecords('R');
    expect(all.map((r) => r.id).sort()).toEqual(['layer-a', 'layer-b']);

    // Rooms are isolated and layers live outside the element hash.
    expect(await b.layerRecords('other')).toEqual([]);
    expect(await b.snapshot('R')).toEqual([]);
  });

  it('an element clear leaves the layer hash intact', async () => {
    const fake = new FakeRedis();
    const b = new RedisHubBackend(fake);
    await b.apply('R', { kind: 'upsert', element: element('e1') });
    await b.applyLayerRecord('R', record('layer-a', 2));

    await b.apply('R', { kind: 'clear' });
    expect(await b.snapshot('R')).toEqual([]);
    expect(await b.layerRecords('R')).toEqual([record('layer-a', 2)]);
  });

  it('skips corrupt or invalid stored layer values instead of throwing', async () => {
    const fake = new FakeRedis();
    const b = new RedisHubBackend(fake, { keyPrefix: 'p:' });
    await b.applyLayerRecord('R', record('layer-a', 1));
    await fake.hSet('p:R:layers', 'bad-json', '{nope');
    await fake.hSet('p:R:layers', 'bad-shape', JSON.stringify({ id: 'bad-shape', version: 0 }));

    expect(await b.layerRecords('R')).toEqual([record('layer-a', 1)]);
    expect(await b.getLayerRecord('R', 'bad-json')).toBeUndefined();
    expect(await b.getLayerRecord('R', 'bad-shape')).toBeUndefined();
  });
});

describe('RedisHubBackend fog records', () => {
  const definition = {
    version: 1 as const,
    generation: 'gen-1',
    bounds: { x: 0, y: 0, w: 256, h: 128 },
    cellSize: 1,
    tileCells: 128 as const,
    base: 'covered' as const,
  };
  const data = fogEncodeBase64(new Uint8Array(2048).fill(0xff));

  it('makes the LWW decision against shared state, not a process-local cache', async () => {
    const fake = new FakeRedis();
    const first = new RedisHubBackend(fake);
    const second = new RedisHubBackend(fake);
    expect(await first.applyFogMeta('R', { version: 10, editor: 'Z', definition })).toEqual({
      accepted: true,
    });

    expect(await second.applyFogMeta('R', { version: 6, editor: 'A', definition })).toEqual({
      accepted: false,
      correction: { version: 10, editor: 'Z', definition },
    });
    expect((await second.fogSnapshot('R'))?.meta.version).toBe(10);
  });

  it('stores tombstones and rejects a same-generation bounds shrink', async () => {
    const fake = new FakeRedis();
    const backend = new RedisHubBackend(fake);
    await backend.applyFogMeta('R', { version: 1, editor: 'A', definition });
    await backend.applyFogTile('R', {
      generation: 'gen-1',
      x: 0,
      y: 0,
      version: 1,
      editor: 'A',
    });
    await backend.applyFogTile('R', {
      generation: 'gen-1',
      x: 1,
      y: 0,
      version: 1,
      editor: 'A',
      data,
    });

    expect(
      await backend.applyFogMeta('R', {
        version: 2,
        editor: 'A',
        definition: { ...definition, bounds: { x: 0, y: 0, w: 128, h: 128 } },
      }),
    ).toEqual({ accepted: false, correction: { version: 1, editor: 'A', definition } });
    expect(await backend.fogSnapshot('R')).toEqual({
      meta: { version: 1, editor: 'A', definition },
      tiles: [
        { generation: 'gen-1', x: 0, y: 0, version: 1, editor: 'A' },
        { generation: 'gen-1', x: 1, y: 0, version: 1, editor: 'A', data },
      ],
    });
  });

  it('rejects a capacity-overflowing patch atomically', async () => {
    const fake = new FakeRedis();
    const backend = new RedisHubBackend(fake);
    const wide = { ...definition, bounds: { x: 0, y: 0, w: 258 * 128, h: 128 } };
    await backend.applyFogMeta('R', { version: 1, editor: 'A', definition: wide });
    await backend.applyFogPatch(
      'R',
      Array.from({ length: 255 }, (_, x) => ({
        generation: 'gen-1',
        x,
        y: 0,
        version: 1,
        editor: 'A',
      })),
    );
    const result = await backend.applyFogPatch('R', [
      { generation: 'gen-1', x: 255, y: 0, version: 1, editor: 'A' },
      { generation: 'gen-1', x: 256, y: 0, version: 1, editor: 'A' },
    ]);
    expect(result.accepted).toEqual([]);
    expect(result.corrections).toHaveLength(2);
    expect((await backend.fogSnapshot('R'))?.tiles).toHaveLength(255);
  });

  it('accepts a new-generation shrink and drops old records atomically', async () => {
    const fake = new FakeRedis();
    const backend = new RedisHubBackend(fake);
    await backend.applyFogMeta('R', { version: 1, editor: 'A', definition });
    await backend.applyFogTile('R', {
      generation: 'gen-1',
      x: 0,
      y: 0,
      version: 1,
      editor: 'A',
    });
    await backend.applyFogMeta('R', {
      version: 2,
      editor: 'A',
      definition: {
        ...definition,
        generation: 'gen-2',
        bounds: { x: 0, y: 0, w: 128, h: 128 },
      },
    });
    expect(await backend.fogSnapshot('R')).toEqual({
      meta: {
        version: 2,
        editor: 'A',
        definition: {
          ...definition,
          generation: 'gen-2',
          bounds: { x: 0, y: 0, w: 128, h: 128 },
        },
      },
      tiles: [],
    });
  });

  it('removes a semantically invalid stored tile while applying a valid patch', async () => {
    const fake = new FakeRedis();
    const backend = new RedisHubBackend(fake);
    const tilesKey = 'fieldnotes:room:R:fog:tiles';
    await backend.applyFogMeta('R', { version: 1, editor: 'A', definition });
    await fake.hSet(
      tilesKey,
      '0,0',
      JSON.stringify({
        generation: 'gen-1',
        x: 0,
        y: 0,
        version: 1,
        editor: 'A',
        data: fogEncodeBase64(new Uint8Array(2048)),
      }),
    );
    const valid = {
      generation: 'gen-1',
      x: 1,
      y: 0,
      version: 1,
      editor: 'A',
      data,
    };

    expect(await backend.applyFogPatch('R', [valid])).toEqual({
      accepted: [valid],
      corrections: [],
    });
    expect(fake.store.get(tilesKey)?.has('0,0')).toBe(false);
    expect((await backend.fogSnapshot('R'))?.tiles).toEqual([valid]);
  });

  it('does not delete a tile repaired after the invalid-state read', async () => {
    const fake = new FakeRedis();
    const backend = new RedisHubBackend(fake);
    const tilesKey = 'fieldnotes:room:R:fog:tiles';
    await backend.applyFogMeta('R', { version: 1, editor: 'A', definition });
    await fake.hSet(
      tilesKey,
      '0,0',
      JSON.stringify({
        generation: 'gen-1',
        x: 0,
        y: 0,
        version: 1,
        editor: 'A',
        data: fogEncodeBase64(new Uint8Array(2048)),
      }),
    );
    const repaired = {
      generation: 'gen-1',
      x: 0,
      y: 0,
      version: 2,
      editor: 'B',
      data,
    };
    fake.beforeFogPatchEval = (key) => {
      fake.beforeFogPatchEval = undefined;
      fake.store.get(key)?.set('0,0', JSON.stringify(repaired));
    };
    const incoming = {
      generation: 'gen-1',
      x: 1,
      y: 0,
      version: 1,
      editor: 'A',
      data,
    };

    expect(await backend.applyFogPatch('R', [incoming])).toEqual({
      accepted: [incoming],
      corrections: [],
    });
    expect((await backend.fogSnapshot('R'))?.tiles).toEqual([repaired, incoming]);
  });
});
