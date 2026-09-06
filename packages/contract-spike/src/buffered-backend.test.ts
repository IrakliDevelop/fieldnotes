/* eslint-disable @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-empty-function */
import { describe, it, expect, vi } from 'vitest';
import { BufferedBackend, createMemoryBackend } from './buffered-backend';
import type { HubBackend, WireElement, WireSyncOp } from './types';

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

function makeExtension(id: string): WireElement {
  return {
    id,
    type: 'extension',
    extensionType: 'vtt:token',
    position: { x: 0, y: 0 },
    zIndex: 0,
    locked: false,
    layerId: 'default',
    data: { label: 'Goblin' },
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

  it('buffers extension element ops under the same durability policy', async () => {
    const inner = createMemoryBackend();
    const buffered = new BufferedBackend(inner);
    const extension = makeExtension('token-1');

    const result = await buffered.apply('room-1', { kind: 'upsert', element: extension });

    expect(result.locality).toBe('local');
    expect(await buffered.get('room-1', extension.id)).toEqual(extension);
    expect(await inner.get('room-1', extension.id)).toBeUndefined();
  });

  it('delegates fog ops to inner backend', async () => {
    const inner = createMemoryBackend();
    const buffered = new BufferedBackend(inner);

    const fogOp: WireSyncOp = { kind: 'fog-meta', record: { version: 1, editor: 'client-1' } };
    const result = await buffered.apply('room-1', fogOp);

    expect(result.locality).toBe('shared');
    expect(buffered.getBufferedCount('room-1')).toBe(0);
  });

  it('preserves optional backend capabilities without inventing unsupported ones', async () => {
    const withoutFog = new BufferedBackend(createMemoryBackend());
    expect(withoutFog.fogSnapshot).toBeUndefined();

    const fogSnapshot = vi.fn(async () => undefined);
    const inner: HubBackend = { ...createMemoryBackend(), fogSnapshot };
    const withFog = new BufferedBackend(inner);
    await withFog.fogSnapshot?.('room-1');

    expect(fogSnapshot).toHaveBeenCalledWith('room-1');
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

  it('hydrates a room from the inner backend only once', async () => {
    const inner = createMemoryBackend();
    await inner.apply('room-1', { kind: 'upsert', element: makeNote('persisted') });
    const snapshotSpy = vi.spyOn(inner, 'snapshot');
    const buffered = new BufferedBackend(inner);

    await Promise.all([buffered.snapshot('room-1'), buffered.get('room-1', 'persisted')]);
    await buffered.snapshot('room-1');

    expect(snapshotSpy).toHaveBeenCalledOnce();
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

  it('buffers remove ops for base elements', async () => {
    const inner = createMemoryBackend();
    const buffered = new BufferedBackend(inner);

    // Upsert then remove — both should be buffered, inner stays empty
    await buffered.apply('room-1', { kind: 'upsert', element: makeNote('note-1') });
    await buffered.apply('room-1', { kind: 'remove', id: 'note-1' });

    const innerSnapshot = await inner.snapshot('room-1');
    expect(innerSnapshot).toHaveLength(0);

    const snapshot = await buffered.snapshot('room-1');
    expect(snapshot).toHaveLength(0);
  });

  it('buffers clear ops', async () => {
    const inner = createMemoryBackend();
    await inner.apply('room-1', { kind: 'upsert', element: makeNote('pre-existing') });

    const buffered = new BufferedBackend(inner);
    await buffered.apply('room-1', { kind: 'upsert', element: makeNote('note-1') });
    await buffered.apply('room-1', { kind: 'clear' });

    // Inner should not have received the clear
    const innerSnapshot = await inner.snapshot('room-1');
    expect(innerSnapshot.map((e) => e.id)).toContain('pre-existing');

    // Buffered snapshot should be empty (cleared, no subsequent upserts)
    const snapshot = await buffered.snapshot('room-1');
    expect(snapshot).toHaveLength(0);
  });

  it('flush persists remove to inner', async () => {
    const inner = createMemoryBackend();
    const buffered = new BufferedBackend(inner);

    await buffered.apply('room-1', { kind: 'upsert', element: makeNote('note-1') });
    await buffered.apply('room-1', { kind: 'remove', id: 'note-1' });

    await buffered.flush('room-1');

    const innerSnapshot = await inner.snapshot('room-1');
    expect(innerSnapshot).toHaveLength(0);
  });

  it('flush failure preserves buffer', async () => {
    const failingInner: HubBackend = {
      async snapshot() {
        return [];
      },
      async get() {
        return undefined;
      },
      async apply() {
        throw new Error('persist failed');
      },
      async dispose() {},
    };

    const buffered = new BufferedBackend(failingInner);
    await buffered.apply('room-1', { kind: 'upsert', element: makeNote('note-1') });

    await expect(buffered.flush('room-1')).rejects.toThrow('persist failed');

    // Buffer should be preserved after failed flush
    expect(buffered.getBufferedCount('room-1')).toBe(1);
  });

  it('keeps a newer concurrent mutation pending while an older flush completes', async () => {
    let releaseFlush: () => void = () => {};
    let reportFlushStarted: () => void = () => {};
    const flushGate = new Promise<void>((resolve) => {
      releaseFlush = resolve;
    });
    const flushStarted = new Promise<void>((resolve) => {
      reportFlushStarted = resolve;
    });
    const persisted = new Map<string, WireElement>();
    let upserts = 0;
    const inner: HubBackend = {
      async snapshot() {
        return [];
      },
      async get(_room, id) {
        return persisted.get(id);
      },
      async apply(_room, op) {
        if (op.kind === 'upsert') {
          upserts += 1;
          if (upserts === 1) {
            reportFlushStarted();
            await flushGate;
          }
          persisted.set(op.element.id, op.element);
        }
        return { accepted: op, corrections: [], locality: 'shared' };
      },
    };
    const buffered = new BufferedBackend(inner);
    const original = makeNote('note-1');
    await buffered.apply('room-1', { kind: 'upsert', element: original });

    const flushing = buffered.flush('room-1');
    await flushStarted;
    const updated = { ...original, text: 'newer' };
    await buffered.apply('room-1', { kind: 'upsert', element: updated });
    releaseFlush();
    await flushing;

    expect(buffered.getBufferedCount('room-1')).toBe(1);
    expect(await buffered.get('room-1', 'note-1')).toEqual(updated);
    await buffered.flush('room-1');
    expect(await inner.get('room-1', 'note-1')).toEqual(updated);
  });

  it('does not discard pending data or dispose inner storage when shutdown flush fails', async () => {
    const dispose = vi.fn(async () => {});
    const inner: HubBackend = {
      async snapshot() {
        return [];
      },
      async get() {
        return undefined;
      },
      async apply() {
        throw new Error('persist failed');
      },
      dispose,
    };
    const buffered = new BufferedBackend(inner);
    await buffered.apply('room-1', { kind: 'upsert', element: makeNote('note-1') });

    await expect(buffered.dispose()).rejects.toThrow('persist failed');

    expect(buffered.getBufferedCount('room-1')).toBe(1);
    expect(dispose).not.toHaveBeenCalled();
  });

  it('dispose flushes pending writes', async () => {
    // Use a backend that preserves data after dispose (realistic: persist to
    // disk, dispose closes the connection — data survives).
    const store = new Map<string, Map<string, WireElement>>();
    const inner: HubBackend = {
      async snapshot(room: string) {
        return [...(store.get(room)?.values() ?? [])];
      },
      async get(room: string, id: string) {
        return store.get(room)?.get(id);
      },
      async apply(room: string, op: WireSyncOp) {
        if (!store.has(room)) store.set(room, new Map());
        const s = store.get(room)!;
        if (op.kind === 'upsert') s.set(op.element.id, op.element);
        if (op.kind === 'remove') s.delete(op.id);
        if (op.kind === 'clear') s.clear();
        return { accepted: op, corrections: [], locality: 'shared' };
      },
      async dispose() {
        // intentionally does NOT clear store — simulates persistent backend
      },
    };

    const buffered = new BufferedBackend(inner);
    await buffered.apply('room-1', { kind: 'upsert', element: makeNote('note-1') });
    await buffered.apply('room-1', { kind: 'upsert', element: makeNote('note-2') });

    await buffered.dispose();

    const innerSnapshot = await inner.snapshot('room-1');
    expect(innerSnapshot).toHaveLength(2);
  });
});
