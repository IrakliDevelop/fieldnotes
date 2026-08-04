import { describe, it, expect } from 'vitest';
import type { Layer } from '@fieldnotes/core';
import { LayerLedger } from './layer-ledger';
import type { LayerRecord } from './protocol';

function layerDef(overrides: Partial<Layer> = {}): Layer {
  return {
    id: 'layer-a',
    name: 'Layer A',
    visible: true,
    locked: false,
    order: 100,
    opacity: 1,
    ...overrides,
  };
}

describe('LayerLedger', () => {
  it('recordUpsert stamps monotonically increasing versions per layer', () => {
    const ledger = new LayerLedger();
    const first = ledger.recordUpsert(layerDef(), 'A');
    const second = ledger.recordUpsert(layerDef({ name: 'Renamed' }), 'A');
    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    expect(ledger.get('layer-a')?.definition?.name).toBe('Renamed');
  });

  it('recordRemove stores a tombstone that continues the version sequence', () => {
    const ledger = new LayerLedger();
    ledger.recordUpsert(layerDef(), 'A');
    const tombstone = ledger.recordRemove('layer-a', 'A');
    expect(tombstone.version).toBe(2);
    expect(tombstone.definition).toBeUndefined();
    expect(ledger.get('layer-a')).toEqual(tombstone);
  });

  it('recordRemove of a never-known layer starts a version-1 tombstone', () => {
    const ledger = new LayerLedger();
    const tombstone = ledger.recordRemove('ghost', 'A');
    expect(tombstone).toEqual({ id: 'ghost', version: 1, editor: 'A' });
  });

  it('applyRemote accepts strictly newer records and rejects stale or equal ones', () => {
    const ledger = new LayerLedger();
    const v2: LayerRecord = { id: 'l', version: 2, editor: 'B', definition: layerDef({ id: 'l' }) };
    expect(ledger.applyRemote(v2)).toBe(true);
    expect(ledger.applyRemote({ id: 'l', version: 1, editor: 'Z' })).toBe(false);
    expect(ledger.applyRemote(v2)).toBe(false); // identical record is not newer
    expect(ledger.get('l')).toEqual(v2);
  });

  it('resolves equal-version conflicts by lexicographic editor', () => {
    const ledger = new LayerLedger();
    const fromA: LayerRecord = {
      id: 'l',
      version: 3,
      editor: 'A',
      definition: layerDef({ id: 'l', name: 'from A' }),
    };
    const fromB: LayerRecord = {
      id: 'l',
      version: 3,
      editor: 'B',
      definition: layerDef({ id: 'l', name: 'from B' }),
    };
    expect(ledger.applyRemote(fromB)).toBe(true);
    expect(ledger.applyRemote(fromA)).toBe(false); // A < B loses the tie
    expect(ledger.get('l')?.definition?.name).toBe('from B');

    const other = new LayerLedger();
    expect(other.applyRemote(fromA)).toBe(true);
    expect(other.applyRemote(fromB)).toBe(true); // arrival order reversed, same winner
    expect(other.get('l')?.definition?.name).toBe('from B');
  });

  it('a tombstone blocks resurrection by a stale upsert', () => {
    const ledger = new LayerLedger();
    ledger.applyRemote({ id: 'l', version: 5, editor: 'B' }); // removal tombstone
    expect(
      ledger.applyRemote({ id: 'l', version: 4, editor: 'A', definition: layerDef({ id: 'l' }) }),
    ).toBe(false);
    expect(ledger.get('l')?.definition).toBeUndefined();
  });

  it('applyAuthoritative overwrites even a locally-newer record', () => {
    const ledger = new LayerLedger();
    ledger.recordUpsert(layerDef(), 'Z');
    ledger.recordUpsert(layerDef({ name: 'v2 local' }), 'Z');
    const correction: LayerRecord = { id: 'layer-a', version: 1, editor: 'A' };
    ledger.applyAuthoritative(correction);
    expect(ledger.get('layer-a')).toEqual(correction);
  });

  it('records() returns every record, tombstones included', () => {
    const ledger = new LayerLedger();
    ledger.recordUpsert(layerDef(), 'A');
    ledger.recordRemove('other', 'A');
    const ids = ledger
      .records()
      .map((r) => r.id)
      .sort();
    expect(ids).toEqual(['layer-a', 'other']);
  });
});
