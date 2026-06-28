// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AutoSave } from './auto-save';
import { ElementStore } from '../elements/element-store';
import { Camera } from '../canvas/camera';
import { createNote } from '../elements/element-factory';
import { MemoryAdapter } from './storage/memory-adapter';
import type { StorageAdapter } from './storage/storage-adapter';

function makeNote(text = 'test') {
  return createNote({
    position: { x: 0, y: 0 },
    size: { w: 100, h: 100 },
    text,
  });
}

function readSaved(key: string): Record<string, unknown> {
  const json = localStorage.getItem(key);
  if (!json) throw new Error(`No saved state at key "${key}"`);
  return JSON.parse(json) as Record<string, unknown>;
}

describe('AutoSave', () => {
  let store: ElementStore;
  let camera: Camera;
  let autoSave: AutoSave;

  beforeEach(() => {
    store = new ElementStore();
    camera = new Camera();
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    autoSave?.stop();
    vi.useRealTimers();
  });

  it('saves state after debounce on store add', async () => {
    autoSave = new AutoSave(store, camera, { key: 'test-save' });
    autoSave.start();

    store.add(makeNote());

    expect(localStorage.getItem('test-save')).toBeNull();

    await vi.advanceTimersByTimeAsync(1000);

    const saved = readSaved('test-save');
    expect(saved.elements).toHaveLength(1);
  });

  it('debounces multiple rapid changes into one save', async () => {
    autoSave = new AutoSave(store, camera, { key: 'test-save' });
    autoSave.start();

    const spy = vi.spyOn(Storage.prototype, 'setItem');

    store.add(makeNote('a'));
    vi.advanceTimersByTime(200);
    store.add(makeNote('b'));
    vi.advanceTimersByTime(200);
    store.add(makeNote('c'));
    await vi.advanceTimersByTimeAsync(1000);

    expect(spy).toHaveBeenCalledTimes(1);
    const saved = readSaved('test-save');
    expect(saved.elements).toHaveLength(3);

    spy.mockRestore();
  });

  it('saves on store remove', async () => {
    autoSave = new AutoSave(store, camera, { key: 'test-save' });
    const note = makeNote();
    store.add(note);

    autoSave.start();
    store.remove(note.id);
    await vi.advanceTimersByTimeAsync(1000);

    const saved = readSaved('test-save');
    expect(saved.elements).toHaveLength(0);
  });

  it('saves on store update', async () => {
    autoSave = new AutoSave(store, camera, { key: 'test-save' });
    const note = makeNote('before');
    store.add(note);

    autoSave.start();
    store.update(note.id, { text: 'after' });
    await vi.advanceTimersByTimeAsync(1000);

    const saved = readSaved('test-save');
    const elements = saved.elements as Record<string, unknown>[];
    const first = elements[0];
    expect(first).toBeDefined();
    expect(first?.text).toBe('after');
  });

  it('saves on camera change', async () => {
    autoSave = new AutoSave(store, camera, { key: 'test-save' });
    autoSave.start();

    camera.pan(100, 200);
    await vi.advanceTimersByTimeAsync(1000);

    const saved = readSaved('test-save');
    const cam = saved.camera as Record<string, unknown>;
    const pos = cam.position as Record<string, number>;
    expect(pos.x).toBe(100);
    expect(pos.y).toBe(200);
  });

  it('loads saved state', async () => {
    autoSave = new AutoSave(store, camera, { key: 'test-save' });
    autoSave.start();

    store.add(makeNote('persisted'));
    camera.pan(50, 75);
    await vi.advanceTimersByTimeAsync(1000);

    const loaded = await autoSave.load();
    expect(loaded).not.toBeNull();
    expect(loaded?.elements).toHaveLength(1);
    expect(loaded?.camera.position.x).toBe(50);
  });

  it('returns null when no saved state exists', async () => {
    autoSave = new AutoSave(store, camera, { key: 'test-save' });
    expect(await autoSave.load()).toBeNull();
  });

  it('clears saved state', async () => {
    autoSave = new AutoSave(store, camera, { key: 'test-save' });
    autoSave.start();
    store.add(makeNote());
    await vi.advanceTimersByTimeAsync(1000);

    await autoSave.clear();
    expect(localStorage.getItem('test-save')).toBeNull();
  });

  it('stops listening after stop()', async () => {
    autoSave = new AutoSave(store, camera, { key: 'test-save' });
    autoSave.start();
    autoSave.stop();

    store.add(makeNote());
    await vi.advanceTimersByTimeAsync(1000);

    expect(localStorage.getItem('test-save')).toBeNull();
  });

  it('respects custom debounce time', async () => {
    autoSave = new AutoSave(store, camera, {
      key: 'test-save',
      debounceMs: 500,
    });
    autoSave.start();

    store.add(makeNote());
    await vi.advanceTimersByTimeAsync(400);
    expect(localStorage.getItem('test-save')).toBeNull();

    await vi.advanceTimersByTimeAsync(100);
    expect(localStorage.getItem('test-save')).not.toBeNull();
  });

  it('uses default key when none provided', async () => {
    autoSave = new AutoSave(store, camera);
    autoSave.start();

    store.add(makeNote());
    await vi.advanceTimersByTimeAsync(1000);

    expect(localStorage.getItem('fieldnotes-autosave')).not.toBeNull();
  });

  it('defaults to a localStorage-backed adapter when none is provided', async () => {
    autoSave = new AutoSave(store, camera, { key: 'test-save' });
    autoSave.start();

    store.add(makeNote());
    await vi.advanceTimersByTimeAsync(1000);

    expect(localStorage.getItem('test-save')).not.toBeNull();
  });

  it('persists to and loads from a provided adapter', async () => {
    const adapter = new MemoryAdapter();
    autoSave = new AutoSave(store, camera, { adapter, debounceMs: 0 });
    autoSave.start();

    store.add(makeNote('persisted'));
    await vi.advanceTimersByTimeAsync(0);

    expect(localStorage.getItem('fieldnotes-autosave')).toBeNull();

    const loaded = await autoSave.load();
    expect(loaded).not.toBeNull();
    expect(loaded?.elements).toHaveLength(1);
    expect(loaded?.elements[0]?.type).toBe('note');
  });

  it('clears state from a provided adapter', async () => {
    const adapter = new MemoryAdapter();
    autoSave = new AutoSave(store, camera, { adapter, debounceMs: 0 });
    autoSave.start();

    store.add(makeNote());
    await vi.advanceTimersByTimeAsync(0);
    expect(await autoSave.load()).not.toBeNull();

    await autoSave.clear();
    expect(await autoSave.load()).toBeNull();
  });

  it('routes a rejected adapter save to onError', async () => {
    const onError = vi.fn();
    const adapter: StorageAdapter = {
      load: async () => null,
      save: async () => {
        throw new Error('boom');
      },
      clear: async () => undefined,
    };
    autoSave = new AutoSave(store, camera, { adapter, debounceMs: 0, onError });
    autoSave.start();

    store.add(makeNote());
    await vi.advanceTimersByTimeAsync(0);

    expect(onError).toHaveBeenCalledOnce();
    const err = onError.mock.calls[0]?.[0];
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('boom');
  });

  it('routes a localStorage quota error to onError', async () => {
    const onError = vi.fn();
    autoSave = new AutoSave(store, camera, { key: 'test-save', onError });
    autoSave.start();

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });

    store.add(makeNote());
    await vi.advanceTimersByTimeAsync(1000);

    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);

    vi.restoreAllMocks();
  });

  it('does not throw when onError is not provided and save fails', async () => {
    autoSave = new AutoSave(store, camera, { key: 'test-save' });
    autoSave.start();

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });

    store.add(makeNote());
    await expect(vi.advanceTimersByTimeAsync(1000)).resolves.not.toThrow();

    vi.restoreAllMocks();
  });

  it('serializes overlapping saves and persists the latest state', async () => {
    const deferreds: (() => void)[] = [];
    const save = vi.fn(
      (_key: string, _value: string) =>
        new Promise<void>((resolve) => {
          deferreds.push(resolve);
        }),
    );
    const adapter: StorageAdapter = {
      load: async () => null,
      clear: async () => undefined,
      save,
    };
    autoSave = new AutoSave(store, camera, { adapter, debounceMs: 0 });
    autoSave.start();

    store.add(makeNote('a'));
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(1);

    store.add(makeNote('b'));
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(1);

    deferreds[0]?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(2);

    const lastValue = save.mock.calls[1]?.[1];
    expect(lastValue).toBeDefined();
    const parsed = JSON.parse(lastValue as string) as { elements: unknown[] };
    expect(parsed.elements).toHaveLength(2);

    deferreds[1]?.();
    await vi.advanceTimersByTimeAsync(0);
  });
});
