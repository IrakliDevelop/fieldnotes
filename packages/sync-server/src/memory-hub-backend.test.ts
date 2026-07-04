import { describe, it, expect } from 'vitest';
import { createShape } from '@fieldnotes/core';
import { MemoryHubBackend } from './memory-hub-backend';

describe('MemoryHubBackend', () => {
  it('applies upsert and returns it in the snapshot', async () => {
    const backend = new MemoryHubBackend();
    const el = createShape({ position: { x: 0, y: 0 }, size: { width: 10, height: 10 } });
    await backend.apply('R', { kind: 'upsert', element: el });
    expect(await backend.snapshot('R')).toEqual([el]);
  });

  it('applies remove', async () => {
    const backend = new MemoryHubBackend();
    const el = createShape({ position: { x: 0, y: 0 }, size: { width: 10, height: 10 } });
    await backend.apply('R', { kind: 'upsert', element: el });
    await backend.apply('R', { kind: 'remove', id: el.id });
    expect(await backend.snapshot('R')).toEqual([]);
  });

  it('applies clear', async () => {
    const backend = new MemoryHubBackend();
    await backend.apply('R', {
      kind: 'upsert',
      element: createShape({ position: { x: 0, y: 0 }, size: { width: 10, height: 10 } }),
    });
    await backend.apply('R', { kind: 'clear' });
    expect(await backend.snapshot('R')).toEqual([]);
  });

  it('prunes the room entry on clear — reclaims memory', async () => {
    const backend = new MemoryHubBackend();
    await backend.apply('R', {
      kind: 'upsert',
      element: createShape({ position: { x: 0, y: 0 }, size: { width: 10, height: 10 } }),
    });
    await backend.apply('R', { kind: 'clear' });
    expect((backend as unknown as { rooms: Map<string, unknown> }).rooms.has('R')).toBe(false);
    expect(await backend.snapshot('R')).toEqual([]);
  });

  it('isolates rooms — applying to R does not affect R2', async () => {
    const backend = new MemoryHubBackend();
    const el = createShape({ position: { x: 0, y: 0 }, size: { width: 10, height: 10 } });
    await backend.apply('R', { kind: 'upsert', element: el });
    expect(await backend.snapshot('R2')).toEqual([]);
    expect(await backend.snapshot('R')).toEqual([el]);
  });

  it('get returns the stored element after apply', async () => {
    const backend = new MemoryHubBackend();
    const el = createShape({ position: { x: 0, y: 0 }, size: { width: 10, height: 10 } });
    await backend.apply('R', { kind: 'upsert', element: el });
    expect(await backend.get('R', el.id)).toEqual(el);
  });

  it('get returns undefined for an absent element', async () => {
    const backend = new MemoryHubBackend();
    expect(await backend.get('R', 'missing')).toBeUndefined();
  });
});
