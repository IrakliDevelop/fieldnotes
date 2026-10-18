// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AutoSave } from './auto-save';
import { ElementStore } from '../elements/element-store';
import { Camera } from '../canvas/camera';
import { LayerManager } from '../layers/layer-manager';
import { createNote } from '../elements/element-factory';
import { MemoryAdapter } from './storage/memory-adapter';
import type { StorageAdapter } from './storage/storage-adapter';
import { migrateState } from './state-serializer';
import { ElementRegistry } from '../elements/element-registry';
import type { ExtensionElementEnvelope } from '../elements/types';

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

  it('saves after a store clear', async () => {
    store.add(makeNote());
    autoSave = new AutoSave(store, camera, { key: 'test-save' });
    autoSave.start();

    store.clear();
    await vi.advanceTimersByTimeAsync(1000);

    expect(readSaved('test-save').elements).toEqual([]);
  });

  it('saves the layer manager active layer id', async () => {
    const layerManager = new LayerManager(store);
    const second = layerManager.createLayer('second');
    layerManager.setActiveLayer(second.id);
    autoSave = new AutoSave(store, camera, { key: 'test-save', layerManager });
    autoSave.start();

    store.add(makeNote());
    await vi.advanceTimersByTimeAsync(1000);

    expect(readSaved('test-save').activeLayerId).toBe(second.id);
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

  describe('corrupt or newer saved state', () => {
    it('reports an unreadable save through onError instead of silently returning null', async () => {
      const adapter = new MemoryAdapter();
      await adapter.save('k', JSON.stringify({ version: 999, elements: [] }));
      const onError = vi.fn();
      autoSave = new AutoSave(store, camera, { key: 'k', adapter, onError });

      expect(await autoSave.load()).toBeNull();
      expect(onError).toHaveBeenCalledOnce();
    });

    it('does not overwrite a save it could not load', async () => {
      const adapter = new MemoryAdapter();
      const original = JSON.stringify({ version: 999, elements: [] });
      await adapter.save('k', original);
      const onError = vi.fn();
      autoSave = new AutoSave(store, camera, { key: 'k', adapter, onError });
      await autoSave.load();

      autoSave.start();
      store.add(makeNote());
      await vi.advanceTimersByTimeAsync(1000);

      expect(await adapter.load('k')).toBe(original);
    });

    it('reports a rejected adapter load and blocks later saves', async () => {
      const save = vi.fn(async () => undefined);
      const adapter: StorageAdapter = {
        load: async () => {
          throw new Error('storage unavailable');
        },
        save,
        clear: async () => undefined,
      };
      const onError = vi.fn();
      autoSave = new AutoSave(store, camera, { key: 'k', adapter, onError });

      await expect(autoSave.load()).resolves.toBeNull();
      expect(onError).toHaveBeenCalledOnce();
      expect(onError.mock.calls[0]?.[0]).toMatchObject({
        message: expect.stringContaining('storage unavailable'),
      });

      autoSave.start();
      store.add(makeNote());
      await vi.advanceTimersByTimeAsync(1000);
      expect(save).not.toHaveBeenCalled();
    });

    it('clear() re-enables saving after a failed load', async () => {
      const adapter = new MemoryAdapter();
      await adapter.save('k', 'not json');
      autoSave = new AutoSave(store, camera, { key: 'k', adapter });
      await autoSave.load();
      await autoSave.clear();

      autoSave.start();
      store.add(makeNote());
      await vi.advanceTimersByTimeAsync(1000);

      const saved = await adapter.load('k');
      expect(saved).not.toBeNull();
      expect(JSON.parse(saved ?? '{}')).toHaveProperty('elements');
    });
  });
});

describe('AutoSave with a store-owned registry', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a runtime element saved without an explicit registry is not migrated again on load', async () => {
    vi.useFakeTimers();
    const migrate = vi.fn((data: Record<string, unknown>) => ({ ...data, migrated: true }));
    const registry = new ElementRegistry();
    registry.register<ExtensionElementEnvelope>({
      type: 'test:versioned',
      legacyTypes: [],
      decodeLegacy: (raw) => raw as unknown as ExtensionElementEnvelope,
      validateData: () => true,
      unwrap: (element) => element,
      wrap: (element) => element,
      bounds: (element) => ({ x: element.position.x, y: element.position.y, w: 10, h: 10 }),
      dataVersion: 2,
      migrate,
    });
    const store = new ElementStore(registry);
    const autoSave = new AutoSave(store, new Camera(), { adapter: new MemoryAdapter() });
    autoSave.start();

    store.add({
      id: 'v-1',
      type: 'extension',
      extensionType: 'test:versioned',
      position: { x: 0, y: 0 },
      zIndex: 0,
      locked: false,
      layerId: '',
      data: { value: 'current' },
    });
    await vi.advanceTimersByTimeAsync(1000);
    autoSave.stop();
    const loaded = await autoSave.load();
    if (!loaded) throw new Error('nothing saved');
    const state = migrateState(structuredClone(loaded), registry);

    expect(migrate).not.toHaveBeenCalled();
    expect(state.elements).toEqual([
      expect.objectContaining({ id: 'v-1', dataVersion: 2, data: { value: 'current' } }),
    ]);
  });
});
