import { describe, it, expect } from 'vitest';
import { BufferedBackend, createMemoryBackend } from './buffered-backend';
import type { WireElement, WireSyncOp } from './types';

function makeNote(id: string): WireElement {
  return {
    id,
    type: 'note',
    position: { x: 0, y: 0 },
    zIndex: 0,
    locked: false,
    layerId: 'default',
    size: { w: 100, h: 100 },
    text: 'test',
    backgroundColor: '#fff',
    textColor: '#000',
  };
}

describe('BufferedBackend', () => {
  it('buffers base element ops locally', async () => {
    const inner = createMemoryBackend();
    const buffered = new BufferedBackend(inner);

    const op: WireSyncOp = { kind: 'upsert', element: makeNote('note-1') };
    const result = await buffered.apply('room-1', op);

    expect(result.accepted).toEqual(op);
    expect(result.locality).toBe('local');
    expect(buffered.getBufferedCount('room-1')).toBe(1);

    const innerSnapshot = await inner.snapshot('room-1');
    expect(innerSnapshot).toHaveLength(0);
  });

  it('delegates fog ops to inner backend', async () => {
    const inner = createMemoryBackend();
    const buffered = new BufferedBackend(inner);

    const fogOp: WireSyncOp = { kind: 'fog-meta', record: { version: 1 } };
    const result = await buffered.apply('room-1', fogOp);

    expect(result.locality).toBe('shared');
    expect(buffered.getBufferedCount('room-1')).toBe(0);
  });

  it('snapshot merges buffered + inner elements', async () => {
    const inner = createMemoryBackend();
    await inner.apply('room-1', { kind: 'upsert', element: makeNote('inner-note') });

    const buffered = new BufferedBackend(inner);
    await buffered.apply('room-1', { kind: 'upsert', element: makeNote('buffered-note') });

    const snapshot = await buffered.snapshot('room-1');
    expect(snapshot).toHaveLength(2);
    const ids = snapshot.map((e) => e.id);
    expect(ids).toContain('inner-note');
    expect(ids).toContain('buffered-note');
  });

  it('get checks buffer before inner', async () => {
    const inner = createMemoryBackend();
    await inner.apply('room-1', { kind: 'upsert', element: makeNote('el-1') });

    const buffered = new BufferedBackend(inner);
    const updated = makeNote('el-1');
    (updated as unknown as Record<string, unknown>)['text'] = 'updated';
    await buffered.apply('room-1', { kind: 'upsert', element: updated });

    const result = await buffered.get('room-1', 'el-1');
    expect(result).toBeDefined();
    expect((result as unknown as Record<string, unknown>)['text']).toBe('updated');
  });

  it('flush persists buffered ops to inner', async () => {
    const inner = createMemoryBackend();
    const buffered = new BufferedBackend(inner);

    await buffered.apply('room-1', { kind: 'upsert', element: makeNote('b-1') });
    await buffered.apply('room-1', { kind: 'upsert', element: makeNote('b-2') });

    expect(buffered.getBufferedCount('room-1')).toBe(2);

    const flushed = await buffered.flush('room-1');
    expect(flushed).toHaveLength(2);
    expect(buffered.getBufferedCount('room-1')).toBe(0);

    const innerSnapshot = await inner.snapshot('room-1');
    expect(innerSnapshot).toHaveLength(2);
  });

  it('buffered element overrides inner on snapshot merge', async () => {
    const inner = createMemoryBackend();
    const original = makeNote('el-1');
    await inner.apply('room-1', { kind: 'upsert', element: original });

    const buffered = new BufferedBackend(inner);
    const modified = makeNote('el-1');
    (modified as unknown as Record<string, unknown>)['text'] = 'modified';
    await buffered.apply('room-1', { kind: 'upsert', element: modified });

    const snapshot = await buffered.snapshot('room-1');
    expect(snapshot).toHaveLength(1);
    expect((snapshot[0] as unknown as Record<string, unknown>)['text']).toBe('modified');
  });
});
