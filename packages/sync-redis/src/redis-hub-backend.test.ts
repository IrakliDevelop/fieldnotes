import { describe, it, expect, vi } from 'vitest';
import { createServiceKey, createShape } from '@fieldnotes/core';
import { fogEncodeBase64, isValidFogMetaRecord } from '@fieldnotes/vtt';
import {
  createFogBackendPlugin,
  FogBackendServiceKey,
  FOG_META_LWW_SCRIPT,
  FOG_PATCH_LWW_SCRIPT,
  type FogBackendService,
} from '@fieldnotes/vtt/redis';
import type { CanvasElement } from '@fieldnotes/core';
import { RedisHubBackend, type RedisHashClient } from './index';
import type { FogMetaRecord, FogTileRecord, LayerRecord } from '@fieldnotes/sync';

interface MetaTileReplacement {
  field: string;
  expectedRaw: string;
  tile?: FogTileRecord;
}

class FakeRedis implements RedisHashClient {
  store = new Map<string, Map<string, string>>();
  beforeEval?: (tilesKey: string) => void;
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

  async eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown> {
    const [metaKey, tilesKey] = options.keys;
    if (!metaKey || !tilesKey) throw new Error('missing keys');
    this.beforeEval?.(tilesKey);
    // Dispatch on script identity, and hold each script to its ARGV arity.
    if (script === FOG_PATCH_LWW_SCRIPT) {
      if (options.arguments.length !== 1) throw new Error('fog patch takes one argument');
      const incoming = JSON.parse(options.arguments[0] ?? '') as FogTileRecord[];
      if (!Array.isArray(incoming)) throw new Error('fog patch takes a tile array');
      return this.applyFogPatch(metaKey, tilesKey, incoming);
    }
    if (script === FOG_META_LWW_SCRIPT) {
      if (options.arguments.length !== 2) throw new Error('fog meta takes two arguments');
      const incoming = JSON.parse(options.arguments[0] ?? '') as FogMetaRecord;
      return this.applyFogMeta(metaKey, tilesKey, incoming, options.arguments[1]);
    }
    throw new Error('FakeRedis was asked to evaluate an unknown script');
  }

  private applyFogMeta(
    metaKey: string,
    tilesKey: string,
    incoming: FogMetaRecord,
    replacementsRaw?: string,
  ): unknown[] {
    const currentRaw = this.store.get(metaKey)?.get('current');
    // Like the script: a corrupt or invalid stored record counts as absent and
    // is deleted rather than failing the call.
    let current: FogMetaRecord | undefined;
    if (currentRaw !== undefined) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(currentRaw);
      } catch {
        parsed = undefined;
      }
      if (isValidFogMetaRecord(parsed)) current = parsed;
      else this.store.get(metaKey)?.delete('current');
    }
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
      return [1];
    }
    // Same generation: each replacement applies only while its field is unchanged.
    const replacements = JSON.parse(replacementsRaw ?? '[]') as MetaTileReplacement[];
    for (const replacement of replacements) {
      const tiles = this.store.get(tilesKey);
      if (tiles?.get(replacement.field) !== replacement.expectedRaw) continue;
      if (replacement.tile) tiles.set(replacement.field, JSON.stringify(replacement.tile));
      else tiles.delete(replacement.field);
    }
    return [1];
  }

  private applyFogPatch(metaKey: string, tilesKey: string, incoming: FogTileRecord[]): unknown[] {
    const definition = patchDefinition(this.store.get(metaKey)?.get('current'));
    if (!definition) {
      const orphaned = incoming.map((tile) => tombstone(tile.generation, tile.x, tile.y));
      return [0, orphaned.length, ...orphaned];
    }
    const def = definition;
    const tiles = this.hash(tilesKey);
    // A stored record the current definition no longer admits counts as absent.
    const admitted = (field: string): FogTileRecord | undefined => {
      const raw = tiles.get(field);
      if (raw === undefined) return undefined;
      let tile: unknown;
      try {
        tile = JSON.parse(raw);
      } catch {
        return undefined;
      }
      if (!validFogTile(tile)) return undefined;
      if (field !== `${tile.x},${tile.y}`) return undefined;
      if (tile.generation !== def.generation) return undefined;
      return tileIntersects(tile, def) ? tile : undefined;
    };
    const accepted: string[] = [];
    const corrections: string[] = [];
    const currents: (string | undefined)[] = [];
    let newCount = 0;
    for (const tile of incoming) {
      const field = `${tile.x},${tile.y}`;
      const current = admitted(field);
      const currentRaw = current ? tiles.get(field) : undefined;
      currents.push(currentRaw);
      if (
        tile.generation !== def.generation ||
        !tileIntersects(tile, def) ||
        (current && !newer(tile, current))
      ) {
        corrections.push(currentRaw ?? tombstone(def.generation, tile.x, tile.y));
      } else {
        accepted.push(JSON.stringify(tile));
        if (!current) newCount += 1;
      }
    }
    let count = tiles.size;
    if (count + newCount > 256) {
      count = 0;
      for (const field of [...tiles.keys()]) {
        if (admitted(field)) count += 1;
        else tiles.delete(field);
      }
    }
    if (count + newCount > 256) {
      const overflow = incoming.map(
        (tile, index) => currents[index] ?? tombstone(def.generation, tile.x, tile.y),
      );
      return [0, overflow.length, ...overflow];
    }
    for (const raw of accepted) {
      const record = JSON.parse(raw) as FogTileRecord;
      tiles.set(`${record.x},${record.y}`, raw);
    }
    return [accepted.length, ...accepted, corrections.length, ...corrections];
  }
}

/**
 * Mirrors the patch script's acceptance test for the stored definition: anything
 * it rejects counts as no definition at all, so the patch degrades to
 * corrections instead of running arithmetic on a corrupt record.
 */
function patchDefinition(metaRaw: string | undefined): FogMetaRecord['definition'] {
  if (metaRaw === undefined) return undefined;
  let meta: unknown;
  try {
    meta = JSON.parse(metaRaw);
  } catch {
    return undefined;
  }
  if (typeof meta !== 'object' || meta === null) return undefined;
  const definition = (meta as { definition?: unknown }).definition;
  if (typeof definition !== 'object' || definition === null) return undefined;
  const def = definition as Record<string, unknown>;
  const bounds = def['bounds'];
  if (typeof def['generation'] !== 'string' || typeof def['cellSize'] !== 'number') {
    return undefined;
  }
  if (def['cellSize'] <= 0) return undefined;
  if (typeof bounds !== 'object' || bounds === null) return undefined;
  const box = bounds as Record<string, unknown>;
  if (typeof box['x'] !== 'number' || typeof box['y'] !== 'number') return undefined;
  if (typeof box['w'] !== 'number' || box['w'] <= 0) return undefined;
  if (typeof box['h'] !== 'number' || box['h'] <= 0) return undefined;
  return definition as FogMetaRecord['definition'];
}

function tombstone(generation: string, x: number, y: number): string {
  return JSON.stringify({ generation, x, y, version: 1, editor: 'hub' });
}

function validFogTile(tile: unknown): tile is FogTileRecord {
  if (typeof tile !== 'object' || tile === null) return false;
  const record = tile as Record<string, unknown>;
  const data = record['data'];
  const dataOk =
    data === undefined ||
    (typeof data === 'string' &&
      data.length === 2732 &&
      /^[A-Za-z0-9+/]+[AEIMQUYcgkosw048]=$/.test(data));
  return (
    typeof record['generation'] === 'string' &&
    Number.isSafeInteger(record['x']) &&
    Number.isSafeInteger(record['y']) &&
    Number.isSafeInteger(record['version']) &&
    (record['version'] as number) >= 1 &&
    typeof record['editor'] === 'string' &&
    dataOk
  );
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
  it('rolls back current and prior backend plugins when start fails', () => {
    const fake = new FakeRedis();
    const serviceKey = createServiceKey<{ ready: true }>('temporary');
    const currentDispose = vi.fn();
    const priorDispose = vi.fn();

    expect(
      () =>
        new RedisHubBackend(fake, {
          plugins: [
            {
              name: 'prior',
              keyPrefix: 'prior',
              start(context) {
                context.registerService(serviceKey, { ready: true });
                context.addDisposer(priorDispose);
              },
            },
            {
              name: 'broken',
              keyPrefix: 'broken',
              start(context) {
                context.addDisposer(currentDispose);
                throw new Error('backend start failed');
              },
            },
          ],
        }),
    ).toThrow('backend start failed');
    expect(currentDispose).toHaveBeenCalledOnce();
    expect(priorDispose).toHaveBeenCalledOnce();
  });
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

  it("escapes room names so a room cannot alias another room's sub-key hashes", async () => {
    const fake = new FakeRedis();
    const b = new RedisHubBackend(fake, { plugins: [createFogBackendPlugin()] });
    const fog = b.getService(FogBackendServiceKey);
    if (!fog) throw new Error('fog backend plugin did not register its service');
    await b.applyLayerRecord('foo', {
      id: 'layer-a',
      version: 1,
      editor: 'A',
      definition: { id: 'layer-a', name: 'a', visible: true, locked: false, order: 0, opacity: 1 },
    });

    // Element writes addressed to the aliasing rooms must land in their own hashes.
    await b.apply('foo:layers', { kind: 'upsert', element: element('layer-a') });
    await b.apply('foo:fog:meta', { kind: 'upsert', element: element('current') });

    expect(await b.getLayerRecord('foo', 'layer-a')).toMatchObject({ version: 1, editor: 'A' });
    expect(await fog.snapshot('foo')).toBeUndefined();
    expect(await b.snapshot('foo')).toHaveLength(0);
    expect(await b.snapshot('foo:layers')).toHaveLength(1);

    // A clear on the aliasing room must not delete the real room's layer ledger.
    await b.apply('foo:layers', { kind: 'clear' });
    expect(await b.layerRecords('foo')).toHaveLength(1);
    expect(fake.store.has('fieldnotes:room:foo:layers')).toBe(true);
  });

  it('keeps the historical key layout for valid room names', async () => {
    const fake = new FakeRedis();
    const b = new RedisHubBackend(fake, { plugins: [createFogBackendPlugin()] });
    await b.apply('Room_1-x', { kind: 'upsert', element: element('e1') });
    await b.applyLayerRecord('Room_1-x', { id: 'l', version: 1, editor: 'A' });
    expect([...fake.store.keys()]).toEqual([
      'fieldnotes:room:Room_1-x',
      'fieldnotes:room:Room_1-x:layers',
    ]);
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

  function fogBackend(fake: FakeRedis): FogBackendService {
    const backend = new RedisHubBackend(fake, { plugins: [createFogBackendPlugin()] });
    const fog = backend.getService(FogBackendServiceKey);
    if (!fog) throw new Error('fog backend plugin did not register its service');
    return fog;
  }

  it('makes the LWW decision against shared state, not a process-local cache', async () => {
    const fake = new FakeRedis();
    const first = fogBackend(fake);
    const second = fogBackend(fake);
    expect(await first.applyMeta('R', { version: 10, editor: 'Z', definition })).toEqual({
      accepted: true,
    });

    expect(await second.applyMeta('R', { version: 6, editor: 'A', definition })).toEqual({
      accepted: false,
      correction: { version: 10, editor: 'Z', definition },
    });
    expect((await second.snapshot('R'))?.meta.version).toBe(10);
  });

  it('stores tombstones and rejects a same-generation bounds shrink', async () => {
    const fake = new FakeRedis();
    const backend = fogBackend(fake);
    await backend.applyMeta('R', { version: 1, editor: 'A', definition });
    await backend.applyTile('R', {
      generation: 'gen-1',
      x: 0,
      y: 0,
      version: 1,
      editor: 'A',
    });
    await backend.applyTile('R', {
      generation: 'gen-1',
      x: 1,
      y: 0,
      version: 1,
      editor: 'A',
      data,
    });

    expect(
      await backend.applyMeta('R', {
        version: 2,
        editor: 'A',
        definition: { ...definition, bounds: { x: 0, y: 0, w: 128, h: 128 } },
      }),
    ).toEqual({ accepted: false, correction: { version: 1, editor: 'A', definition } });
    expect(await backend.snapshot('R')).toEqual({
      meta: { version: 1, editor: 'A', definition },
      tiles: [
        { generation: 'gen-1', x: 0, y: 0, version: 1, editor: 'A' },
        { generation: 'gen-1', x: 1, y: 0, version: 1, editor: 'A', data },
      ],
    });
  });

  it('rejects a capacity-overflowing patch atomically', async () => {
    const fake = new FakeRedis();
    const backend = fogBackend(fake);
    const wide = { ...definition, bounds: { x: 0, y: 0, w: 258 * 128, h: 128 } };
    await backend.applyMeta('R', { version: 1, editor: 'A', definition: wide });
    await backend.applyPatch(
      'R',
      Array.from({ length: 255 }, (_, x) => ({
        generation: 'gen-1',
        x,
        y: 0,
        version: 1,
        editor: 'A',
      })),
    );
    const result = await backend.applyPatch('R', [
      { generation: 'gen-1', x: 255, y: 0, version: 1, editor: 'A' },
      { generation: 'gen-1', x: 256, y: 0, version: 1, editor: 'A' },
    ]);
    expect(result.accepted).toEqual([]);
    expect(result.corrections).toHaveLength(2);
    expect((await backend.snapshot('R'))?.tiles).toHaveLength(255);
  });

  it('accepts a new-generation shrink and drops old records atomically', async () => {
    const fake = new FakeRedis();
    const backend = fogBackend(fake);
    await backend.applyMeta('R', { version: 1, editor: 'A', definition });
    await backend.applyTile('R', {
      generation: 'gen-1',
      x: 0,
      y: 0,
      version: 1,
      editor: 'A',
    });
    await backend.applyMeta('R', {
      version: 2,
      editor: 'A',
      definition: {
        ...definition,
        generation: 'gen-2',
        bounds: { x: 0, y: 0, w: 128, h: 128 },
      },
    });
    expect(await backend.snapshot('R')).toEqual({
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

  it('applies a newer meta while a concurrent paint changes the tiles hash', async () => {
    const fake = new FakeRedis();
    const backend = fogBackend(fake);
    const tilesKey = 'fieldnotes:room:R:fog:tiles';
    await backend.applyMeta('R', { version: 1, editor: 'A', definition });
    const painted = { generation: 'gen-1', x: 0, y: 0, version: 1, editor: 'A', data };
    await backend.applyTile('R', painted);

    // Every attempt sees a different tiles hash: a painter keeps working during the update.
    let concurrent = 0;
    fake.beforeEval = (key) => {
      concurrent += 1;
      const tile = { generation: 'gen-1', x: concurrent, y: 0, version: 1, editor: 'B', data };
      fake.store.get(key)?.set(`${tile.x},${tile.y}`, JSON.stringify(tile));
    };
    const grown = { ...definition, bounds: { x: 0, y: 0, w: 384, h: 128 } };

    expect(await backend.applyMeta('R', { version: 2, editor: 'A', definition: grown })).toEqual({
      accepted: true,
    });
    expect(concurrent).toBe(1);
    expect((await backend.snapshot('R'))?.tiles).toEqual([
      painted,
      { generation: 'gen-1', x: 1, y: 0, version: 1, editor: 'B', data },
    ]);
    expect(fake.store.get(tilesKey)?.size).toBe(2);
  });

  it('applies a patch while the meta record is rewritten concurrently', async () => {
    const fake = new FakeRedis();
    const backend = fogBackend(fake);
    const metaKey = 'fieldnotes:room:R:fog:meta';
    await backend.applyMeta('R', { version: 1, editor: 'A', definition });
    const tile = { generation: 'gen-1', x: 0, y: 0, version: 1, editor: 'A', data };

    // A second hub rewrites the meta record between the caller's read and every script call.
    let rewrites = 0;
    fake.beforeEval = () => {
      rewrites += 1;
      fake.store
        .get(metaKey)
        ?.set('current', JSON.stringify({ version: 1 + rewrites, editor: 'B', definition }));
    };

    expect(await backend.applyPatch('R', [tile])).toEqual({ accepted: [tile], corrections: [] });
    expect(rewrites).toBe(1);
    expect((await backend.snapshot('R'))?.tiles).toEqual([tile]);
  });

  it('does not read the tiles hash on the accepted patch path', async () => {
    const fake = new FakeRedis();
    const backend = fogBackend(fake);
    await backend.applyMeta('R', { version: 1, editor: 'A', definition });
    const tile = { generation: 'gen-1', x: 0, y: 0, version: 1, editor: 'A', data };
    const hGetAll = vi.spyOn(fake, 'hGetAll');

    expect(await backend.applyPatch('R', [tile])).toEqual({ accepted: [tile], corrections: [] });
    expect(hGetAll).not.toHaveBeenCalled();
  });

  it('corrects an invalid incoming tile with the stored record, not a tombstone', async () => {
    const fake = new FakeRedis();
    const backend = fogBackend(fake);
    const tilesKey = 'fieldnotes:room:R:fog:tiles';
    await backend.applyMeta('R', { version: 1, editor: 'A', definition });
    const stored = { generation: 'gen-1', x: 0, y: 0, version: 2, editor: 'A', data };
    const hGet = vi.spyOn(fake, 'hGet');

    expect(await backend.applyPatch('R', [stored])).toEqual({
      accepted: [stored],
      corrections: [],
    });
    expect(hGet.mock.calls.filter(([key]) => key === tilesKey)).toEqual([]);
    const storedRaw = fake.store.get(tilesKey)?.get('0,0');

    // Base-fill data must be omitted, so this tile fails the JS validity gate.
    const invalid = {
      generation: 'gen-1',
      x: 0,
      y: 0,
      version: 3,
      editor: 'B',
      data: fogEncodeBase64(new Uint8Array(2048)),
    };

    expect(await backend.applyPatch('R', [invalid])).toEqual({
      accepted: [],
      corrections: [stored],
    });
    expect(fake.store.get(tilesKey)?.get('0,0')).toBe(storedRaw);
  });

  it('replaces a corrupt stored meta record instead of failing the script', async () => {
    const fake = new FakeRedis();
    const backend = fogBackend(fake);
    const metaKey = 'fieldnotes:room:R:fog:meta';
    const tilesKey = 'fieldnotes:room:R:fog:tiles';
    await backend.applyMeta('R', { version: 1, editor: 'A', definition });
    await backend.applyTile('R', {
      generation: 'gen-1',
      x: 0,
      y: 0,
      version: 1,
      editor: 'A',
      data,
    });

    // A concurrent writer corrupts the meta field between the read and the call.
    fake.beforeEval = () => {
      fake.beforeEval = undefined;
      fake.store.get(metaKey)?.set('current', 'not json{');
    };
    const next = { version: 2, editor: 'A', definition };

    // Corrupt metadata counts as absent, so the incoming record wins outright
    // and the tiles hash is dropped with the generation it belonged to.
    expect(await backend.applyMeta('R', next)).toEqual({ accepted: true });
    expect(fake.store.get(metaKey)?.get('current')).toBe(JSON.stringify(next));
    expect(fake.store.get(tilesKey)).toBeUndefined();
  });

  it('degrades a patch to corrections when the stored fog definition is corrupt', async () => {
    const fake = new FakeRedis();
    const backend = fogBackend(fake);
    const metaKey = 'fieldnotes:room:R:fog:meta';
    const tilesKey = 'fieldnotes:room:R:fog:tiles';
    await backend.applyMeta('R', { version: 1, editor: 'A', definition });
    const tile = { generation: 'gen-1', x: 0, y: 0, version: 1, editor: 'A', data };

    // A concurrent writer replaces the definition with one whose bounds are not numeric.
    fake.beforeEval = () => {
      fake.beforeEval = undefined;
      fake.store.get(metaKey)?.set(
        'current',
        JSON.stringify({
          version: 2,
          editor: 'B',
          definition: {
            ...definition,
            generation: 'gen-2',
            bounds: { x: 0, y: 0, w: 'wide', h: 128 },
          },
        }),
      );
    };

    // A definition the script cannot compute with counts as absent, so the
    // corrections carry the incoming generation instead of the corrupt one.
    expect(await backend.applyPatch('R', [tile])).toEqual({
      accepted: [],
      corrections: [{ generation: 'gen-1', x: 0, y: 0, version: 1, editor: 'hub' }],
    });
    expect(fake.store.get(tilesKey)?.size ?? 0).toBe(0);
  });

  it('does not answer a correction with a stored record misfiled under another field', async () => {
    const fake = new FakeRedis();
    const backend = fogBackend(fake);
    const tilesKey = 'fieldnotes:room:R:fog:tiles';
    await backend.applyMeta('R', { version: 1, editor: 'A', definition });
    // Valid on its own terms, but filed under the wrong coordinate.
    const misfiled = { generation: 'gen-1', x: 1, y: 0, version: 5, editor: 'A', data };
    await fake.hSet(tilesKey, '0,0', JSON.stringify(misfiled));
    const invalid = {
      generation: 'gen-1',
      x: 0,
      y: 0,
      version: 3,
      editor: 'B',
      data: fogEncodeBase64(new Uint8Array(2048)),
    };

    expect(await backend.applyPatch('R', [invalid])).toEqual({
      accepted: [],
      corrections: [{ generation: 'gen-1', x: 0, y: 0, version: 1, editor: 'hub' }],
    });
  });

  it('overwrites an invalid stored tile a patch targets and leaves untargeted ones to snapshot filtering', async () => {
    const fake = new FakeRedis();
    const backend = fogBackend(fake);
    const tilesKey = 'fieldnotes:room:R:fog:tiles';
    await backend.applyMeta('R', { version: 1, editor: 'A', definition });
    // Field '0,0' is unparseable; field '1,0' holds a base-fill record the
    // snapshot filter rejects. The patch targets only '0,0'.
    await fake.hSet(tilesKey, '0,0', 'not json{');
    const untargeted = JSON.stringify({
      generation: 'gen-1',
      x: 1,
      y: 0,
      version: 1,
      editor: 'A',
      data: fogEncodeBase64(new Uint8Array(2048)),
    });
    await fake.hSet(tilesKey, '1,0', untargeted);
    const targeted = { generation: 'gen-1', x: 0, y: 0, version: 1, editor: 'A', data };

    expect(await backend.applyPatch('R', [targeted])).toEqual({
      accepted: [targeted],
      corrections: [],
    });
    expect(fake.store.get(tilesKey)?.get('0,0')).toBe(JSON.stringify(targeted));
    // The patch repairs nothing it does not target; snapshot() filters it out.
    expect(fake.store.get(tilesKey)?.get('1,0')).toBe(untargeted);
    expect((await backend.snapshot('R'))?.tiles).toEqual([targeted]);
  });

  it('a capacity-blocked patch sweeps invalid and foreign-generation fields before deciding', async () => {
    const fake = new FakeRedis();
    const backend = fogBackend(fake);
    const tilesKey = 'fieldnotes:room:R:fog:tiles';
    const wide = { ...definition, bounds: { x: 0, y: 0, w: 258 * 128, h: 128 } };
    await backend.applyMeta('R', { version: 1, editor: 'A', definition: wide });
    await backend.applyPatch(
      'R',
      Array.from({ length: 255 }, (_, x) => ({
        generation: 'gen-1',
        x,
        y: 0,
        version: 1,
        editor: 'A',
      })),
    );
    // Two fields the definition no longer admits push HLEN over capacity.
    await fake.hSet(tilesKey, '255,0', 'not json{');
    await fake.hSet(
      tilesKey,
      '256,0',
      JSON.stringify({ generation: 'gen-0', x: 256, y: 0, version: 9, editor: 'A' }),
    );
    expect(fake.store.get(tilesKey)?.size).toBe(257);

    const overwrite = [
      { generation: 'gen-1', x: 0, y: 0, version: 2, editor: 'A' },
      { generation: 'gen-1', x: 1, y: 0, version: 2, editor: 'A' },
    ];
    expect(await backend.applyPatch('R', overwrite)).toEqual({
      accepted: overwrite,
      corrections: [],
    });
    expect(fake.store.get(tilesKey)?.has('255,0')).toBe(false);
    expect(fake.store.get(tilesKey)?.has('256,0')).toBe(false);
    expect(fake.store.get(tilesKey)?.size).toBe(255);

    // With 256 admitted records and nothing left to reclaim, the next new tile
    // is still rejected atomically.
    await backend.applyPatch('R', [{ generation: 'gen-1', x: 255, y: 0, version: 1, editor: 'A' }]);
    expect(fake.store.get(tilesKey)?.size).toBe(256);
    const blocked = await backend.applyPatch('R', [
      { generation: 'gen-1', x: 256, y: 0, version: 1, editor: 'A' },
    ]);
    expect(blocked).toEqual({
      accepted: [],
      corrections: [{ generation: 'gen-1', x: 256, y: 0, version: 1, editor: 'hub' }],
    });
    expect(fake.store.get(tilesKey)?.size).toBe(256);
  });

  it('reclaims foreign-generation fields so a capacity-blocked patch can store a new tile', async () => {
    const fake = new FakeRedis();
    const backend = fogBackend(fake);
    const tilesKey = 'fieldnotes:room:R:fog:tiles';
    const wide = { ...definition, bounds: { x: 0, y: 0, w: 258 * 128, h: 128 } };
    await backend.applyMeta('R', { version: 1, editor: 'A', definition: wide });
    await backend.applyPatch(
      'R',
      Array.from({ length: 255 }, (_, x) => ({
        generation: 'gen-1',
        x,
        y: 0,
        version: 1,
        editor: 'A',
      })),
    );
    for (const x of [255, 256]) {
      await fake.hSet(
        tilesKey,
        `${x},0`,
        JSON.stringify({ generation: 'gen-0', x, y: 0, version: 3, editor: 'A' }),
      );
    }

    // One overwrite plus one brand-new coordinate: only the sweep leaves room.
    const patch = [
      { generation: 'gen-1', x: 0, y: 0, version: 2, editor: 'A' },
      { generation: 'gen-1', x: 257, y: 0, version: 1, editor: 'A' },
    ];
    expect(await backend.applyPatch('R', patch)).toEqual({ accepted: patch, corrections: [] });
    expect(fake.store.get(tilesKey)?.has('255,0')).toBe(false);
    expect(fake.store.get(tilesKey)?.has('256,0')).toBe(false);
    expect(fake.store.get(tilesKey)?.get('257,0')).toBe(JSON.stringify(patch[1]));
    expect(fake.store.get(tilesKey)?.size).toBe(256);
  });

  it('meta replacement is skipped when the tile changed concurrently', async () => {
    const fake = new FakeRedis();
    const backend = fogBackend(fake);
    const tilesKey = 'fieldnotes:room:R:fog:tiles';
    await backend.applyMeta('R', { version: 1, editor: 'A', definition });
    // Invalid stored data: the meta apply would drop this field.
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
    const repaired = { generation: 'gen-1', x: 0, y: 0, version: 2, editor: 'B', data };

    // A painter repairs the field after the caller read it: expectedRaw no
    // longer matches, so the replacement must be skipped, not applied.
    fake.beforeEval = (key) => {
      fake.beforeEval = undefined;
      fake.store.get(key)?.set('0,0', JSON.stringify(repaired));
    };
    const grown = { ...definition, bounds: { x: 0, y: 0, w: 384, h: 128 } };

    expect(await backend.applyMeta('R', { version: 2, editor: 'A', definition: grown })).toEqual({
      accepted: true,
    });
    expect(fake.store.get(tilesKey)?.get('0,0')).toBe(JSON.stringify(repaired));
    expect(await backend.snapshot('R')).toEqual({
      meta: { version: 2, editor: 'A', definition: grown },
      tiles: [repaired],
    });
  });

  it('rewrites a stored tile canonically when a same-generation meta change applies', async () => {
    const fake = new FakeRedis();
    const backend = fogBackend(fake);
    const tilesKey = 'fieldnotes:room:R:fog:tiles';
    await backend.applyMeta('R', { version: 1, editor: 'A', definition });
    const record = { generation: 'gen-1', x: 0, y: 0, version: 2, editor: 'A', data };
    // Valid, but not stored in the canonical encoding the replacement writes.
    const storedRaw = JSON.stringify(record, null, 2);
    await fake.hSet(tilesKey, '0,0', storedRaw);
    const grown = { ...definition, bounds: { x: 0, y: 0, w: 384, h: 128 } };

    expect(await backend.applyMeta('R', { version: 2, editor: 'A', definition: grown })).toEqual({
      accepted: true,
    });
    const rewritten = fake.store.get(tilesKey)?.get('0,0');
    expect(rewritten).not.toBe(storedRaw);
    expect(rewritten).toBe(JSON.stringify(record));
    expect(rewritten === undefined ? undefined : JSON.parse(rewritten)).toEqual(record);
  });

  it('drops a stored tile a same-generation meta change no longer admits', async () => {
    const fake = new FakeRedis();
    const backend = fogBackend(fake);
    const tilesKey = 'fieldnotes:room:R:fog:tiles';
    await backend.applyMeta('R', { version: 1, editor: 'A', definition });
    // Semantically invalid data, and a record outside the definition bounds.
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
    await fake.hSet(
      tilesKey,
      '2,0',
      JSON.stringify({ generation: 'gen-1', x: 2, y: 0, version: 1, editor: 'A' }),
    );

    expect(await backend.applyMeta('R', { version: 2, editor: 'A', definition })).toEqual({
      accepted: true,
    });
    expect(fake.store.get(tilesKey)?.has('0,0')).toBe(false);
    expect(fake.store.get(tilesKey)?.has('2,0')).toBe(false);
    expect((await backend.snapshot('R'))?.tiles).toEqual([]);
  });
});
