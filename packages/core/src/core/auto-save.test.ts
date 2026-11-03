// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AutoSave } from './auto-save';
import { ElementStore } from '../elements/element-store';
import { Camera } from '../canvas/camera';
import { LayerManager } from '../layers/layer-manager';
import { createNote } from '../elements/element-factory';
import { MemoryAdapter } from './storage/memory-adapter';
import type { StorageAdapter } from './storage/storage-adapter';
import { exportState, migrateState } from './state-serializer';
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

  it('flush saves a pending change without waiting for the debounce', async () => {
    const adapter = new MemoryAdapter();
    const save = vi.spyOn(adapter, 'save');
    autoSave = new AutoSave(store, camera, { adapter, key: 'k', debounceMs: 1000 });
    autoSave.start();

    store.add(makeNote('x'));
    await autoSave.flush();
    await vi.advanceTimersByTimeAsync(1000);

    expect(save).toHaveBeenCalledOnce();
    const saved = JSON.parse((await adapter.load('k')) ?? 'null') as { elements: unknown[] };
    expect(saved.elements).toHaveLength(1);
  });

  it('flush is a no-op when nothing is pending', async () => {
    const adapter = new MemoryAdapter();
    autoSave = new AutoSave(store, camera, { adapter, key: 'k' });
    autoSave.start();

    await autoSave.flush();

    expect(await adapter.load('k')).toBeNull();
  });

  it('flush takes its snapshot before the adapter write settles', async () => {
    let resolveSave: (() => void) | undefined;
    let savedValue: string | undefined;
    const adapter: StorageAdapter = {
      load: async () => null,
      clear: async () => undefined,
      save: async (_key, value) => {
        savedValue = value;
        await new Promise<void>((resolve) => {
          resolveSave = resolve;
        });
      },
    };
    autoSave = new AutoSave(store, camera, { adapter, debounceMs: 1000 });
    autoSave.start();

    store.add(makeNote());
    let flushSettled = false;
    const flush = autoSave.flush().then(() => {
      flushSettled = true;
    });
    store.clear();
    await Promise.resolve();
    expect(flushSettled).toBe(false);
    resolveSave?.();
    await flush;

    const saved = JSON.parse(savedValue ?? 'null') as { elements: unknown[] };
    expect(saved.elements).toHaveLength(1);
  });

  it('flush waits for an in-flight write and the newer queued snapshot', async () => {
    const saved = new Map<string, string>();
    const deferreds: (() => void)[] = [];
    const adapter: StorageAdapter = {
      load: async () => null,
      clear: async () => undefined,
      save: (key, value) =>
        new Promise<void>((resolve) => {
          deferreds.push(() => {
            saved.set(key, value);
            resolve();
          });
        }),
    };
    autoSave = new AutoSave(store, camera, { adapter, key: 'k', debounceMs: 100 });
    autoSave.start();

    store.add(makeNote('first'));
    await vi.advanceTimersByTimeAsync(100);
    store.add(makeNote('second'));

    let flushed = false;
    const flush = autoSave.flush().then(() => {
      flushed = true;
    });
    await Promise.resolve();

    expect(flushed).toBe(false);
    expect(deferreds).toHaveLength(1);

    deferreds[0]?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(flushed).toBe(false);
    expect(deferreds).toHaveLength(2);

    deferreds[1]?.();
    await flush;

    const state = JSON.parse(saved.get('k') ?? 'null') as { elements: { text: string }[] };
    expect(state.elements.map((element) => element.text)).toEqual(['first', 'second']);
  });

  it('a new AutoSave on the same key loads after the previous instance finishes writing', async () => {
    const saved = new Map<string, string>();
    const deferreds: (() => void)[] = [];
    const adapter: StorageAdapter = {
      load: async (key) => saved.get(key) ?? null,
      clear: async () => undefined,
      save: (key, value) =>
        new Promise<void>((resolve) => {
          deferreds.push(() => {
            saved.set(key, value);
            resolve();
          });
        }),
    };
    const first = new AutoSave(store, camera, { adapter, key: 'k', debounceMs: 100 });
    first.start();
    store.add(makeNote('a1'));
    await vi.advanceTimersByTimeAsync(100);
    store.add(makeNote('a2'));
    void first.flush();
    first.stop();

    const second = new AutoSave(new ElementStore(), new Camera(), { adapter, key: 'k' });
    let loaded: { elements: { text: string }[] } | null | undefined;
    const load = second.load().then((state) => {
      loaded = state as { elements: { text: string }[] } | null;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(loaded).toBeUndefined();

    deferreds[0]?.();
    await vi.advanceTimersByTimeAsync(0);
    deferreds[1]?.();
    await load;

    expect(loaded?.elements.map((element) => element.text)).toEqual(['a1', 'a2']);
  });

  it('flush after stop does not save', async () => {
    const adapter = new MemoryAdapter();
    autoSave = new AutoSave(store, camera, { adapter, key: 'k', debounceMs: 1000 });
    autoSave.start();

    store.add(makeNote());
    autoSave.stop();
    await autoSave.flush();

    expect(await adapter.load('k')).toBeNull();
  });

  it('flush is a no-op after the debounced save already ran', async () => {
    const adapter = new MemoryAdapter();
    const save = vi.spyOn(adapter, 'save');
    autoSave = new AutoSave(store, camera, { adapter, debounceMs: 1000 });
    autoSave.start();

    store.add(makeNote());
    await vi.advanceTimersByTimeAsync(1000);
    await autoSave.flush();

    expect(save).toHaveBeenCalledOnce();
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

  it('drains queued writes when onError throws for an adapter failure', async () => {
    const saved = new Map<string, string>();
    let rejectFirst: ((error: Error) => void) | undefined;
    let first = true;
    const adapter: StorageAdapter = {
      load: async () => null,
      clear: async () => undefined,
      save: (key, value) => {
        if (first) {
          first = false;
          return new Promise<void>((_resolve, reject) => {
            rejectFirst = reject;
          });
        }
        saved.set(key, value);
        return Promise.resolve();
      },
    };
    const adapterFailure = new Error('adapter failed');
    const callbackFailure = new Error('host callback failed');
    const reportError = vi.fn();
    vi.stubGlobal('reportError', reportError);
    autoSave = new AutoSave(store, camera, {
      adapter,
      key: 'k',
      debounceMs: 100,
      onError: () => {
        throw callbackFailure;
      },
    });
    autoSave.start();

    store.add(makeNote('first'));
    await vi.advanceTimersByTimeAsync(100);
    store.add(makeNote('second'));
    const flush = autoSave.flush();

    rejectFirst?.(adapterFailure);
    await expect(flush).resolves.toBeUndefined();

    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(callbackFailure);
    const state = JSON.parse(saved.get('k') ?? 'null') as { elements: { text: string }[] };
    expect(state.elements.map((element) => element.text)).toEqual(['first', 'second']);
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

function versionedRegistry() {
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
  return { registry, migrate };
}

function versionedElement(id: string): ExtensionElementEnvelope {
  return {
    id,
    type: 'extension',
    extensionType: 'test:versioned',
    position: { x: 0, y: 0 },
    index: 'a0',
    version: 1,
    locked: false,
    layerId: '',
    data: { value: 'current' },
  };
}

describe('AutoSave with a store-owned registry', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a runtime element saved without an explicit registry is not migrated again on load', async () => {
    vi.useFakeTimers();
    const { registry, migrate } = versionedRegistry();
    const store = new ElementStore(registry);
    const autoSave = new AutoSave(store, new Camera(), { adapter: new MemoryAdapter() });
    autoSave.start();

    store.add(versionedElement('v-1'));
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

  it('saves with the registry the store holds at save time', async () => {
    vi.useFakeTimers();
    const store = new ElementStore();
    const adapter = new MemoryAdapter();
    const autoSave = new AutoSave(store, new Camera(), { adapter });
    autoSave.start();
    store.add(versionedElement('v-1'));
    store.setElementRegistry(versionedRegistry().registry);
    store.update('v-1', { position: { x: 1, y: 0 } });
    await vi.advanceTimersByTimeAsync(1000);
    autoSave.stop();

    const saved = JSON.parse((await adapter.load('fieldnotes-autosave')) ?? '{}') as {
      elements: { dataVersion?: number }[];
    };
    expect(saved.elements[0]?.dataVersion).toBe(2);
  });

  it('loads with the registry the store holds at load time', async () => {
    const adapter = new MemoryAdapter();
    await adapter.save(
      'fieldnotes-autosave',
      JSON.stringify(exportState([versionedElement('v-1')], new Camera(), [])),
    );
    const store = new ElementStore();
    const autoSave = new AutoSave(store, new Camera(), { adapter });
    const { registry, migrate } = versionedRegistry();
    store.setElementRegistry(registry);

    const state = await autoSave.load();

    expect(migrate).toHaveBeenCalledWith({ value: 'current' }, 1);
    expect(state?.elements[0]).toMatchObject({ id: 'v-1', dataVersion: 2 });
  });

  it('keeps an explicit elementRegistry after the store registry changes', async () => {
    const adapter = new MemoryAdapter();
    await adapter.save(
      'fieldnotes-autosave',
      JSON.stringify(exportState([versionedElement('v-1')], new Camera(), [])),
    );
    const store = new ElementStore();
    const { registry, migrate } = versionedRegistry();
    const autoSave = new AutoSave(store, new Camera(), { adapter, elementRegistry: registry });
    store.setElementRegistry(new ElementRegistry());

    const state = await autoSave.load();

    expect(migrate).toHaveBeenCalledTimes(1);
    expect(state?.elements[0]).toMatchObject({ id: 'v-1', dataVersion: 2 });
  });
});
