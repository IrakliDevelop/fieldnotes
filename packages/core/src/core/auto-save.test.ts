// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AutoSave } from './auto-save';
import { ElementStore } from '../elements/element-store';
import { Camera } from '../canvas/camera';
import { createNote } from '../elements/element-factory';

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

  it('saves state after debounce on store add', () => {
    autoSave = new AutoSave(store, camera, { key: 'test-save' });
    autoSave.start();

    store.add(makeNote());

    expect(localStorage.getItem('test-save')).toBeNull();

    vi.advanceTimersByTime(1000);

    const saved = readSaved('test-save');
    expect(saved.elements).toHaveLength(1);
  });

  it('debounces multiple rapid changes into one save', () => {
    autoSave = new AutoSave(store, camera, { key: 'test-save' });
    autoSave.start();

    const spy = vi.spyOn(Storage.prototype, 'setItem');

    store.add(makeNote('a'));
    vi.advanceTimersByTime(200);
    store.add(makeNote('b'));
    vi.advanceTimersByTime(200);
    store.add(makeNote('c'));
    vi.advanceTimersByTime(1000);

    expect(spy).toHaveBeenCalledTimes(1);
    const saved = readSaved('test-save');
    expect(saved.elements).toHaveLength(3);

    spy.mockRestore();
  });

  it('saves on store remove', () => {
    autoSave = new AutoSave(store, camera, { key: 'test-save' });
    const note = makeNote();
    store.add(note);

    autoSave.start();
    store.remove(note.id);
    vi.advanceTimersByTime(1000);

    const saved = readSaved('test-save');
    expect(saved.elements).toHaveLength(0);
  });

  it('saves on store update', () => {
    autoSave = new AutoSave(store, camera, { key: 'test-save' });
    const note = makeNote('before');
    store.add(note);

    autoSave.start();
    store.update(note.id, { text: 'after' });
    vi.advanceTimersByTime(1000);

    const saved = readSaved('test-save');
    const elements = saved.elements as Record<string, unknown>[];
    const first = elements[0];
    expect(first).toBeDefined();
    expect(first?.text).toBe('after');
  });

  it('saves on camera change', () => {
    autoSave = new AutoSave(store, camera, { key: 'test-save' });
    autoSave.start();

    camera.pan(100, 200);
    vi.advanceTimersByTime(1000);

    const saved = readSaved('test-save');
    const cam = saved.camera as Record<string, unknown>;
    const pos = cam.position as Record<string, number>;
    expect(pos.x).toBe(100);
    expect(pos.y).toBe(200);
  });

  it('loads saved state', () => {
    autoSave = new AutoSave(store, camera, { key: 'test-save' });
    autoSave.start();

    store.add(makeNote('persisted'));
    camera.pan(50, 75);
    vi.advanceTimersByTime(1000);

    const loaded = autoSave.load();
    expect(loaded).not.toBeNull();
    expect(loaded?.elements).toHaveLength(1);
    expect(loaded?.camera.position.x).toBe(50);
  });

  it('returns null when no saved state exists', () => {
    autoSave = new AutoSave(store, camera, { key: 'test-save' });
    expect(autoSave.load()).toBeNull();
  });

  it('clears saved state', () => {
    autoSave = new AutoSave(store, camera, { key: 'test-save' });
    autoSave.start();
    store.add(makeNote());
    vi.advanceTimersByTime(1000);

    autoSave.clear();
    expect(localStorage.getItem('test-save')).toBeNull();
  });

  it('stops listening after stop()', () => {
    autoSave = new AutoSave(store, camera, { key: 'test-save' });
    autoSave.start();
    autoSave.stop();

    store.add(makeNote());
    vi.advanceTimersByTime(1000);

    expect(localStorage.getItem('test-save')).toBeNull();
  });

  it('respects custom debounce time', () => {
    autoSave = new AutoSave(store, camera, {
      key: 'test-save',
      debounceMs: 500,
    });
    autoSave.start();

    store.add(makeNote());
    vi.advanceTimersByTime(400);
    expect(localStorage.getItem('test-save')).toBeNull();

    vi.advanceTimersByTime(100);
    expect(localStorage.getItem('test-save')).not.toBeNull();
  });

  it('uses default key when none provided', () => {
    autoSave = new AutoSave(store, camera);
    autoSave.start();

    store.add(makeNote());
    vi.advanceTimersByTime(1000);

    expect(localStorage.getItem('fieldnotes-autosave')).not.toBeNull();
  });
});
