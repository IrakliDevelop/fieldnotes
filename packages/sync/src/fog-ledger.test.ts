import { describe, it, expect } from 'vitest';
import { FogLedger } from './fog-ledger';
import type { FogMetaRecord, FogTileRecord, FogSnapshot } from './protocol';
import { FOG_MAX_TILES, fogEncodeBase64 } from '@fieldnotes/core';

const NON_BASE_TILE = fogEncodeBase64(new Uint8Array(2048).fill(0xff));

function makeDef(gen = 'gen-1') {
  return {
    version: 1 as const,
    generation: gen,
    bounds: { x: 0, y: 0, w: 1024, h: 1024 },
    cellSize: 2,
    tileCells: 128 as const,
    base: 'covered' as const,
  };
}

function metaRecord(version: number, editor: string, gen = 'gen-1'): FogMetaRecord {
  return { version, editor, definition: makeDef(gen) };
}

function tileRecord(
  x: number,
  y: number,
  version: number,
  editor: string,
  gen = 'gen-1',
  data = NON_BASE_TILE,
): FogTileRecord {
  return { generation: gen, x, y, version, editor, data };
}

describe('FogLedger', () => {
  it('starts empty', () => {
    const ledger = new FogLedger();
    expect(ledger.getMeta()).toBeNull();
    expect(ledger.snapshot()).toBeUndefined();
  });

  it('accepts first meta record', () => {
    const ledger = new FogLedger();
    const result = ledger.applyMeta(metaRecord(1, 'alice'));
    expect(result.accepted).toBe(true);
    expect(ledger.getMeta()?.version).toBe(1);
  });

  it('accepts newer meta, rejects older', () => {
    const ledger = new FogLedger();
    ledger.applyMeta(metaRecord(2, 'alice'));
    const r1 = ledger.applyMeta(metaRecord(3, 'bob'));
    expect(r1.accepted).toBe(true);
    const r2 = ledger.applyMeta(metaRecord(1, 'charlie'));
    expect(r2.accepted).toBe(false);
    expect(r2.correction?.version).toBe(3);
  });

  it('equal version: higher editor wins', () => {
    const ledger = new FogLedger();
    ledger.applyMeta(metaRecord(1, 'alice'));
    const r = ledger.applyMeta(metaRecord(1, 'bob'));
    expect(r.accepted).toBe(true);
    expect(ledger.getMeta()?.editor).toBe('bob');
  });

  it('new generation clears old tiles', () => {
    const ledger = new FogLedger();
    ledger.applyMeta(metaRecord(1, 'alice', 'gen-1'));
    ledger.applyTile(tileRecord(0, 0, 1, 'alice', 'gen-1'));
    expect(ledger.snapshot()?.tiles).toHaveLength(1);

    ledger.applyMeta(metaRecord(2, 'alice', 'gen-2'));
    expect(ledger.snapshot()?.tiles).toHaveLength(0);
  });

  it('accepts tile with matching generation', () => {
    const ledger = new FogLedger();
    ledger.applyMeta(metaRecord(1, 'alice'));
    const r = ledger.applyTile(tileRecord(0, 0, 1, 'alice'));
    expect(r.accepted).toBe(true);
    expect(ledger.getTile(0, 0)?.data).toBe(NON_BASE_TILE);
  });

  it('rejects tile with wrong generation', () => {
    const ledger = new FogLedger();
    ledger.applyMeta(metaRecord(1, 'alice', 'gen-1'));
    const r = ledger.applyTile(tileRecord(0, 0, 1, 'alice', 'gen-old'));
    expect(r.accepted).toBe(false);
  });

  it('rejects stale tile', () => {
    const ledger = new FogLedger();
    ledger.applyMeta(metaRecord(1, 'alice'));
    ledger.applyTile(tileRecord(0, 0, 2, 'alice'));
    const r = ledger.applyTile(tileRecord(0, 0, 1, 'bob'));
    expect(r.accepted).toBe(false);
    expect(r.correction?.version).toBe(2);
  });

  it('tombstone removes tile', () => {
    const ledger = new FogLedger();
    ledger.applyMeta(metaRecord(1, 'alice'));
    ledger.applyTile(tileRecord(0, 0, 1, 'alice'));
    expect(ledger.getTile(0, 0)).toBeDefined();

    const tombstone: FogTileRecord = {
      generation: 'gen-1',
      x: 0,
      y: 0,
      version: 2,
      editor: 'alice',
    };
    ledger.applyTile(tombstone);
    expect(ledger.getTile(0, 0)).toBeUndefined();
  });

  it('snapshot round-trips through loadSnapshot', () => {
    const ledger = new FogLedger();
    ledger.applyMeta(metaRecord(1, 'alice'));
    ledger.applyTile(tileRecord(0, 0, 1, 'alice'));
    ledger.applyTile(tileRecord(1, 0, 1, 'alice'));
    const snap = ledger.snapshot();
    expect(snap).toBeDefined();

    const ledger2 = new FogLedger();
    ledger2.loadSnapshot(snap as FogSnapshot);
    expect(ledger2.getMeta()?.version).toBe(1);
    expect(ledger2.snapshot()?.tiles).toHaveLength(2);
  });

  it('tile record immutability', () => {
    const ledger = new FogLedger();
    ledger.applyMeta(metaRecord(1, 'alice'));
    const record = tileRecord(0, 0, 1, 'alice');
    ledger.applyTile(record);
    const retrieved = ledger.getTile(0, 0);
    expect(retrieved).toBe(record);
  });

  it('clear resets everything', () => {
    const ledger = new FogLedger();
    ledger.applyMeta(metaRecord(1, 'alice'));
    ledger.applyTile(tileRecord(0, 0, 1, 'alice'));
    ledger.clear();
    expect(ledger.getMeta()).toBeNull();
    expect(ledger.snapshot()).toBeUndefined();
  });

  it('disabled meta (no definition) clears tiles', () => {
    const ledger = new FogLedger();
    ledger.applyMeta(metaRecord(1, 'alice'));
    ledger.applyTile(tileRecord(0, 0, 1, 'alice'));
    ledger.applyMeta({ version: 2, editor: 'alice' });
    expect(ledger.snapshot()?.tiles).toHaveLength(0);
  });

  it('tile rejected when no meta exists', () => {
    const ledger = new FogLedger();
    const r = ledger.applyTile(tileRecord(0, 0, 1, 'alice'));
    expect(r.accepted).toBe(false);
  });

  it('caps all stored records, including tombstones, without truncating snapshots', () => {
    const ledger = new FogLedger();
    ledger.applyMeta({
      version: 1,
      editor: 'alice',
      definition: {
        ...makeDef(),
        bounds: { x: 0, y: 0, w: FOG_MAX_TILES * 128 * 2 + 256, h: 256 },
      },
    });
    for (let x = 0; x < FOG_MAX_TILES; x++) {
      expect(
        ledger.applyTile({
          generation: 'gen-1',
          x,
          y: 0,
          version: 1,
          editor: 'alice',
        }).accepted,
      ).toBe(true);
    }

    expect(
      ledger.applyTile({
        generation: 'gen-1',
        x: FOG_MAX_TILES,
        y: 0,
        version: 1,
        editor: 'alice',
      }).accepted,
    ).toBe(false);
    expect(ledger.snapshot()?.tiles).toHaveLength(FOG_MAX_TILES);
  });

  it('rejects an overflowing patch atomically and returns corrections for every coordinate', () => {
    const ledger = new FogLedger();
    ledger.applyMeta({
      version: 1,
      editor: 'alice',
      definition: {
        ...makeDef(),
        bounds: { x: 0, y: 0, w: (FOG_MAX_TILES + 2) * 256, h: 256 },
      },
    });
    for (let x = 0; x < FOG_MAX_TILES - 1; x++) {
      ledger.applyTile({ generation: 'gen-1', x, y: 0, version: 1, editor: 'alice' });
    }
    const result = ledger.applyPatch([
      { generation: 'gen-1', x: FOG_MAX_TILES - 1, y: 0, version: 1, editor: 'alice' },
      { generation: 'gen-1', x: FOG_MAX_TILES, y: 0, version: 1, editor: 'alice' },
    ]);
    expect(result.accepted).toEqual([]);
    expect(result.corrections).toHaveLength(2);
    expect(ledger.snapshot()?.tiles).toHaveLength(FOG_MAX_TILES - 1);
  });

  it('requires a new generation for shrinking bounds or changing the grid/base', () => {
    const ledger = new FogLedger();
    const original = metaRecord(1, 'alice');
    ledger.applyMeta(original);
    for (const definition of [
      { ...makeDef(), bounds: { x: 0, y: 0, w: 512, h: 1024 } },
      { ...makeDef(), cellSize: 4 },
      { ...makeDef(), base: 'revealed' as const },
    ]) {
      expect(ledger.applyMeta({ version: 2, editor: 'bob', definition }).accepted).toBe(false);
      expect(ledger.getMeta()).toBe(original);
    }
  });

  it('authoritative records replace newer local records but still enforce generation and bounds', () => {
    const ledger = new FogLedger();
    ledger.applyMeta(metaRecord(9, 'local'));
    ledger.applyTile(tileRecord(0, 0, 9, 'local'));

    ledger.applyMetaAuthoritative(metaRecord(1, 'hub'));
    expect(ledger.getMeta()?.version).toBe(1);
    expect(ledger.applyAuthoritative(tileRecord(0, 0, 1, 'hub'))).toBe(true);
    expect(ledger.getRecord(0, 0)?.version).toBe(1);
    expect(ledger.applyAuthoritative(tileRecord(5, 0, 1, 'hub'))).toBe(false);
    expect(ledger.applyAuthoritative(tileRecord(0, 0, 2, 'hub', 'other'))).toBe(false);
  });

  it('rejects a semantically invalid authoritative tile', () => {
    const ledger = new FogLedger();
    ledger.applyMetaAuthoritative(metaRecord(1, 'hub'));
    const baseOnly = fogEncodeBase64(new Uint8Array(2048));

    expect(ledger.applyAuthoritative(tileRecord(0, 0, 1, 'hub', 'gen-1', baseOnly))).toBe(false);
    expect(ledger.snapshot()?.tiles).toEqual([]);
  });
});
