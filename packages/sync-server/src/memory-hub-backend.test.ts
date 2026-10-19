import { describe, it, expect } from 'vitest';
import { createShape } from '@fieldnotes/core';
import { MemoryHubBackend } from './memory-hub-backend';

describe('MemoryHubBackend', () => {
  it('applies upsert and returns it in the snapshot', async () => {
    const backend = new MemoryHubBackend();
    const el = createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } });
    await backend.apply('R', { kind: 'upsert', element: el });
    expect(await backend.snapshot('R')).toEqual([el]);
  });

  it('applies remove', async () => {
    const backend = new MemoryHubBackend();
    const el = createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } });
    await backend.apply('R', { kind: 'upsert', element: el });
    await backend.apply('R', { kind: 'remove', id: el.id });
    expect(await backend.snapshot('R')).toEqual([]);
  });

  it('applies clear', async () => {
    const backend = new MemoryHubBackend();
    await backend.apply('R', {
      kind: 'upsert',
      element: createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } }),
    });
    await backend.apply('R', { kind: 'clear' });
    expect(await backend.snapshot('R')).toEqual([]);
  });

  it('prunes the room entry on clear — reclaims memory', async () => {
    const backend = new MemoryHubBackend();
    await backend.apply('R', {
      kind: 'upsert',
      element: createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } }),
    });
    await backend.apply('R', { kind: 'clear' });
    expect((backend as unknown as { rooms: Map<string, unknown> }).rooms.has('R')).toBe(false);
    expect(await backend.snapshot('R')).toEqual([]);
  });

  it('isolates rooms — applying to R does not affect R2', async () => {
    const backend = new MemoryHubBackend();
    const el = createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } });
    await backend.apply('R', { kind: 'upsert', element: el });
    expect(await backend.snapshot('R2')).toEqual([]);
    expect(await backend.snapshot('R')).toEqual([el]);
  });

  it('get returns the stored element after apply', async () => {
    const backend = new MemoryHubBackend();
    const el = createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } });
    await backend.apply('R', { kind: 'upsert', element: el });
    expect(await backend.get('R', el.id)).toEqual(el);
  });

  it('get returns undefined for an absent element', async () => {
    const backend = new MemoryHubBackend();
    expect(await backend.get('R', 'missing')).toBeUndefined();
  });

  it('evictRoom drops elements and layer records of that room only', async () => {
    const backend = new MemoryHubBackend();
    const el = createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } });
    const layer = {
      id: 'L1',
      version: 1,
      editor: 'c',
      definition: { id: 'L1', name: 'L', visible: true, locked: false, order: 1, opacity: 1 },
    };
    for (const room of ['R', 'R2']) {
      await backend.apply(room, { kind: 'upsert', element: el });
      await backend.applyLayerRecord(room, layer);
    }

    await backend.evictRoom('R');

    expect(await backend.snapshot('R')).toEqual([]);
    expect(await backend.layerRecords('R')).toEqual([]);
    expect(await backend.snapshot('R2')).toEqual([el]);
    expect(await backend.layerRecords('R2')).toEqual([layer]);
  });
});
