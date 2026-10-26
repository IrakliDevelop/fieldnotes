// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { ElementStore } from './element-store';
import * as strokeCache from './stroke-cache';
import { getElementBounds } from './element-bounds';
import { ElementRegistry } from './element-registry';
import { HistoryRecorder } from '../history/history-recorder';
import { HistoryStack } from '../history/history-stack';
import { createStroke, createArrow } from './element-factory';
import type {
  CanvasElement,
  ExtensionElementEnvelope,
  NoteElement,
  StrokeElement,
  TextElement,
} from './types';

function makeNote(overrides: Partial<NoteElement> = {}): NoteElement {
  return {
    id: 'note-1',
    type: 'note',
    position: { x: 0, y: 0 },
    size: { w: 200, h: 100 },
    text: 'Hello',
    backgroundColor: '#ffeb3b',
    textColor: '#000000',
    index: 'a0',
    version: 1,
    locked: false,
    layerId: '',
    ...overrides,
  };
}

function makeStroke(overrides: Partial<StrokeElement> = {}): StrokeElement {
  return {
    id: 'stroke-1',
    type: 'stroke',
    position: { x: 0, y: 0 },
    points: [
      { x: 0, y: 0, pressure: 0.5 },
      { x: 10, y: 10, pressure: 0.5 },
    ],
    color: '#000',
    width: 2,
    opacity: 1,
    index: 'a0',
    version: 1,
    locked: false,
    layerId: '',
    ...overrides,
  };
}

function makeText(overrides: Partial<TextElement> = {}): TextElement {
  return {
    id: 'text-1',
    type: 'text',
    position: { x: 0, y: 0 },
    size: { w: 200, h: 28 },
    text: 'Hello',
    fontSize: 16,
    color: '#000000',
    textAlign: 'left',
    index: 'a0',
    version: 1,
    locked: false,
    layerId: '',
    ...overrides,
  };
}

describe('ElementStore', () => {
  it('elementRegistry returns the constructor registry, then the one set later', () => {
    const initial = new ElementRegistry();
    const next = new ElementRegistry();
    const store = new ElementStore(initial);
    expect(store.elementRegistry).toBe(initial);
    store.setElementRegistry(next);
    expect(store.elementRegistry).toBe(next);
  });

  describe('CRUD', () => {
    it('keeps invalid remote descendants raw but out of scene and queries until repaired', () => {
      const store = new ElementStore();
      const child = makeNote({ id: 'child', parentId: 'parent' });
      store.add(child, { origin: 'remote' });

      expect(store.getById('child')).toBe(child);
      expect(store.getAll()).toEqual([]);
      expect(store.queryPoint({ x: 1, y: 1 })).toEqual([]);

      store.add(makeNote({ id: 'parent', index: 'a0' }), { origin: 'remote' });
      expect(store.getAll().map((element) => element.id)).toEqual(['parent', 'child']);
    });

    it('rejects local orphaning without emitting or mutating', () => {
      const store = new ElementStore();
      const parent = makeNote({ id: 'parent' });
      store.add(parent);
      const changes = vi.fn();
      store.on('update', changes);

      expect(() => store.update('parent', { parentId: 'missing' })).toThrow(/Invalid hierarchy/);
      expect(store.getById('parent')).toBe(parent);
      expect(changes).not.toHaveBeenCalled();
    });

    it('installs updateMany values before emitting the first update', () => {
      const store = new ElementStore();
      store.add(makeNote({ id: 'parent' }));
      store.add(makeNote({ id: 'child', parentId: 'parent' }));
      const seen: string[] = [];
      store.on('update', () => seen.push(store.getById('child')?.layerId ?? 'missing'));

      store.updateMany([
        { id: 'parent', partial: { layerId: 'next' } },
        { id: 'child', partial: { layerId: 'next' } },
      ]);

      expect(seen).toEqual(['next', 'next']);
      expect(store.getAll().map((element) => element.layerId)).toEqual(['next', 'next']);
    });
    it('starts empty', () => {
      const store = new ElementStore();
      expect(store.getAll()).toEqual([]);
    });

    it('adds an element', () => {
      const store = new ElementStore();
      const note = makeNote();
      store.add(note);
      expect(store.getAll()).toEqual([note]);
    });

    it('gets element by id', () => {
      const store = new ElementStore();
      const note = makeNote();
      store.add(note);
      expect(store.getById('note-1')).toBe(note);
    });

    it('returns undefined for unknown id', () => {
      const store = new ElementStore();
      expect(store.getById('nope')).toBeUndefined();
    });

    it('updates an element partially', () => {
      const store = new ElementStore();
      store.add(makeNote());
      store.update('note-1', { text: 'Updated' });
      const updated = store.getById('note-1');
      expect(updated?.type === 'note' && updated.text).toBe('Updated');
    });

    it('preserves other fields on update', () => {
      const store = new ElementStore();
      store.add(makeNote());
      store.update('note-1', { text: 'Updated' });
      const el = store.getById('note-1') as NoteElement;
      expect(el.backgroundColor).toBe('#ffeb3b');
      expect(el.position).toEqual({ x: 0, y: 0 });
    });

    it('removes an element', () => {
      const store = new ElementStore();
      store.add(makeNote());
      store.remove('note-1');
      expect(store.getAll()).toEqual([]);
    });

    it('ignores remove for unknown id', () => {
      const store = new ElementStore();
      store.add(makeNote());
      store.remove('nope');
      expect(store.getAll()).toHaveLength(1);
    });

    it('clears all elements', () => {
      const store = new ElementStore();
      store.add(makeNote());
      store.add(makeStroke());
      store.clear();
      expect(store.getAll()).toEqual([]);
    });
  });

  describe('rich-text sanitization boundary', () => {
    const unsafe = '<img src="x" onerror="alert(1)"><b onclick="alert(2)">safe</b>';

    it('sanitizes direct text and note additions before storing or emitting them', () => {
      const store = new ElementStore();
      const added: CanvasElement[] = [];
      store.on('add', (element) => added.push(element));

      store.add(makeText({ text: unsafe }));
      store.add(makeNote({ id: 'note-unsafe', text: unsafe }));

      const text = store.getById('text-1');
      const note = store.getById('note-unsafe');
      expect(text?.type === 'text' && text.text).toBe('<b>safe</b>');
      expect(note?.type === 'note' && note.text).toBe('<b>safe</b>');
      expect(added.map((element) => ('text' in element ? element.text : undefined))).toEqual([
        '<b>safe</b>',
        '<b>safe</b>',
      ]);
    });

    it('sanitizes text updates', () => {
      const store = new ElementStore();
      store.add(makeText());

      store.update('text-1', { text: unsafe });

      const updated = store.getById('text-1');
      expect(updated?.type === 'text' && updated.text).toBe('<b>safe</b>');
    });

    it('sanitizes rich text loaded from remote snapshots', () => {
      const store = new ElementStore();

      store.loadSnapshot([makeText({ text: unsafe })], { origin: 'remote' });

      const loaded = store.getById('text-1');
      expect(loaded?.type === 'text' && loaded.text).toBe('<b>safe</b>');
    });
  });

  describe('ordering', () => {
    it('returns elements sorted by index', () => {
      const store = new ElementStore();
      store.add(makeNote({ id: 'a', index: 'a2' }));
      store.add(makeStroke({ id: 'b', index: 'a0' }));
      store.add(makeNote({ id: 'c', index: 'a1' }));

      const ids = store.getAll().map((el) => el.id);
      expect(ids).toEqual(['b', 'c', 'a']);
    });
  });

  describe('layer-aware sorting', () => {
    it('sorts by layer order then index', () => {
      const store = new ElementStore();
      store.setLayerOrder(
        new Map([
          ['bg', 0],
          ['fg', 1],
        ]),
      );

      store.add(makeNote({ id: 'fg-z0', index: 'a0', layerId: 'fg' }));
      store.add(makeNote({ id: 'bg-z1', index: 'a1', layerId: 'bg' }));
      store.add(makeNote({ id: 'bg-z0', index: 'a0', layerId: 'bg' }));

      const ids = store.getAll().map((e) => e.id);
      expect(ids).toEqual(['bg-z0', 'bg-z1', 'fg-z0']);
    });

    it('falls back to index-only when no layer order set', () => {
      const store = new ElementStore();
      store.add(makeNote({ id: 'a', index: 'a2', layerId: 'x' }));
      store.add(makeNote({ id: 'b', index: 'a1', layerId: 'y' }));
      const ids = store.getAll().map((e) => e.id);
      expect(ids).toEqual(['b', 'a']);
    });
  });

  describe('querying', () => {
    it('gets elements by type', () => {
      const store = new ElementStore();
      store.add(makeNote({ id: 'n1' }));
      store.add(makeStroke({ id: 's1' }));
      store.add(makeNote({ id: 'n2' }));

      const notes = store.getElementsByType('note');
      expect(notes).toHaveLength(2);
      expect(notes.every((el) => el.type === 'note')).toBe(true);
    });

    it('returns element count', () => {
      const store = new ElementStore();
      store.add(makeNote({ id: 'a' }));
      store.add(makeStroke({ id: 'b' }));
      expect(store.count).toBe(2);
    });
  });

  describe('events', () => {
    it('emits add event', () => {
      const store = new ElementStore();
      const listener = vi.fn();
      store.on('add', listener);

      const note = makeNote();
      store.add(note);
      expect(listener).toHaveBeenCalledWith(note, expect.anything());
    });

    it('emits remove event', () => {
      const store = new ElementStore();
      const listener = vi.fn();
      store.on('remove', listener);

      const note = makeNote();
      store.add(note);
      store.remove('note-1');
      expect(listener).toHaveBeenCalledWith(note, expect.anything());
    });

    it('emits update event with previous and current element', () => {
      const store = new ElementStore();
      const listener = vi.fn();
      store.on('update', listener);

      store.add(makeNote());
      store.update('note-1', { text: 'Changed' });

      expect(listener).toHaveBeenCalledOnce();
      const event = listener.mock.calls[0]?.[0] as {
        previous: CanvasElement;
        current: CanvasElement;
      };
      expect((event.previous as NoteElement).text).toBe('Hello');
      expect((event.current as NoteElement).text).toBe('Changed');
    });

    it('emits clear event', () => {
      const store = new ElementStore();
      const listener = vi.fn();
      store.on('clear', listener);

      store.add(makeNote());
      store.clear();
      expect(listener).toHaveBeenCalledOnce();
    });
  });

  describe('onChange', () => {
    it('fires on add', () => {
      const store = new ElementStore();
      const listener = vi.fn();
      store.onChange(listener);
      store.add(makeStroke());
      expect(listener).toHaveBeenCalledOnce();
    });

    it('fires on remove', () => {
      const store = new ElementStore();
      const el = makeStroke();
      store.add(el);
      const listener = vi.fn();
      store.onChange(listener);
      store.remove(el.id);
      expect(listener).toHaveBeenCalledOnce();
    });

    it('fires on update', () => {
      const store = new ElementStore();
      const el = makeStroke();
      store.add(el);
      const listener = vi.fn();
      store.onChange(listener);
      store.update(el.id, { position: { x: 10, y: 10 } });
      expect(listener).toHaveBeenCalledOnce();
    });

    it('fires on clear', () => {
      const store = new ElementStore();
      store.add(makeStroke());
      const listener = vi.fn();
      store.onChange(listener);
      store.clear();
      expect(listener).toHaveBeenCalledOnce();
    });

    it('returns unsubscribe function', () => {
      const store = new ElementStore();
      const listener = vi.fn();
      const unsub = store.onChange(listener);
      unsub();
      store.add(makeStroke());
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('queryPoint', () => {
    it('returns elements whose bounds contain the point', () => {
      const store = new ElementStore();
      store.add(makeNote({ id: 'n1', position: { x: 0, y: 0 }, size: { w: 100, h: 100 } }));
      store.add(makeNote({ id: 'n2', position: { x: 200, y: 200 }, size: { w: 100, h: 100 } }));
      const results = store.queryPoint({ x: 50, y: 50 });
      expect(results.map((e) => e.id)).toEqual(['n1']);
    });

    it('returns elements beyond the initial spatial-index bounds', () => {
      const store = new ElementStore();
      store.add(
        makeNote({
          id: 'far-away',
          position: { x: 1_000_000, y: -1_000_000 },
          size: { w: 100, h: 100 },
        }),
      );

      expect(store.queryPoint({ x: 1_000_050, y: -999_950 }).map((element) => element.id)).toEqual([
        'far-away',
      ]);
    });
  });

  describe('queryRect', () => {
    it('returns elements whose bounds intersect the rect', () => {
      const store = new ElementStore();
      store.add(makeNote({ id: 'n1', position: { x: 0, y: 0 }, size: { w: 50, h: 50 } }));
      store.add(makeNote({ id: 'n2', position: { x: 500, y: 500 }, size: { w: 50, h: 50 } }));
      const results = store.queryRect({ x: 0, y: 0, w: 100, h: 100 });
      expect(results.map((e) => e.id)).toEqual(['n1']);
    });

    it('returns results sorted by z-order', () => {
      const store = new ElementStore();
      store.add(
        makeNote({ id: 'low', position: { x: 0, y: 0 }, size: { w: 50, h: 50 }, index: 'a1' }),
      );
      store.add(
        makeNote({ id: 'high', position: { x: 0, y: 0 }, size: { w: 50, h: 50 }, index: 'aA' }),
      );
      const results = store.queryRect({ x: 0, y: 0, w: 100, h: 100 });
      expect(results.map((e) => e.id)).toEqual(['low', 'high']);
    });

    it('reflects element removal', () => {
      const store = new ElementStore();
      store.add(makeNote({ id: 'n1', position: { x: 0, y: 0 }, size: { w: 50, h: 50 } }));
      store.remove('n1');
      expect(store.queryPoint({ x: 25, y: 25 })).toEqual([]);
    });

    it('reflects element update (moved position)', () => {
      const store = new ElementStore();
      store.add(makeNote({ id: 'n1', position: { x: 0, y: 0 }, size: { w: 50, h: 50 } }));
      store.update('n1', { position: { x: 500, y: 500 } });
      expect(store.queryPoint({ x: 25, y: 25 })).toEqual([]);
      expect(store.queryPoint({ x: 525, y: 525 }).map((e) => e.id)).toEqual(['n1']);
    });

    it('rebuilds index on loadSnapshot', () => {
      const store = new ElementStore();
      store.add(makeNote({ id: 'n1', position: { x: 0, y: 0 }, size: { w: 50, h: 50 } }));
      store.loadSnapshot([
        makeNote({ id: 'n2', position: { x: 200, y: 200 }, size: { w: 50, h: 50 } }),
      ]);
      expect(store.queryPoint({ x: 25, y: 25 })).toEqual([]);
      expect(store.queryPoint({ x: 225, y: 225 }).map((e) => e.id)).toEqual(['n2']);
    });

    it('does not index grid elements', () => {
      const store = new ElementStore();
      store.add({
        id: 'g',
        // @ts-expect-error 'grid' is not a core element type: the store must ignore
        // elements it cannot measure instead of indexing them.
        type: 'grid',
        position: { x: 0, y: 0 },
        gridType: 'square',
        hexOrientation: 'pointy',
        cellSize: 50,
        strokeColor: '#ccc',
        strokeWidth: 1,
        opacity: 0.5,
        index: 'a0',
        version: 1,
        locked: false,
        layerId: 'default',
      });
      expect(store.queryPoint({ x: 0, y: 0 })).toEqual([]);
    });
  });

  describe('snapshot', () => {
    it('exports a serializable snapshot', () => {
      const store = new ElementStore();
      store.add(makeNote());
      store.add(makeStroke());

      const snapshot = store.snapshot();
      expect(snapshot).toHaveLength(2);
      expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
    });

    it('loads from a snapshot', () => {
      const store = new ElementStore();
      const note = makeNote();
      const stroke = makeStroke();

      store.loadSnapshot([note, stroke]);
      expect(store.count).toBe(2);
      expect(store.getById('note-1')).toEqual(note);
    });

    it('clears existing elements when loading snapshot', () => {
      const store = new ElementStore();
      store.add(makeNote({ id: 'old' }));
      store.loadSnapshot([makeStroke()]);

      expect(store.count).toBe(1);
      expect(store.getById('old')).toBeUndefined();
    });
  });

  describe('edge cases', () => {
    it('update on non-existent ID is a no-op and does not emit event', () => {
      const store = new ElementStore();
      const listener = vi.fn();
      store.on('update', listener);

      store.update('nonexistent', { text: 'Hello' } as Partial<CanvasElement>);

      expect(listener).not.toHaveBeenCalled();
      expect(store.count).toBe(0);
    });

    it('remove on non-existent ID is a no-op and does not emit event', () => {
      const store = new ElementStore();
      const listener = vi.fn();
      store.on('remove', listener);

      store.remove('nonexistent');

      expect(listener).not.toHaveBeenCalled();
      expect(store.count).toBe(0);
    });

    it('getById returns undefined for missing ID', () => {
      const store = new ElementStore();
      store.add(makeNote({ id: 'exists' }));
      expect(store.getById('missing')).toBeUndefined();
    });

    it('queryPoint returns empty array for point with no elements', () => {
      const store = new ElementStore();
      store.add(makeNote({ id: 'n1', position: { x: 0, y: 0 }, size: { w: 50, h: 50 } }));
      const results = store.queryPoint({ x: 9999, y: 9999 });
      expect(results).toEqual([]);
    });
  });

  describe('getAll caching', () => {
    it('returns same array reference on consecutive calls', () => {
      const store = new ElementStore();
      store.add(makeNote({ id: 'a', index: 'a1' }));
      store.add(makeStroke({ id: 'b', index: 'a0' }));

      const first = store.getAll();
      const second = store.getAll();
      expect(first).toBe(second);
    });

    it('invalidates cache after add', () => {
      const store = new ElementStore();
      store.add(makeNote({ id: 'a' }));
      const before = store.getAll();
      store.add(makeStroke({ id: 'b' }));
      const after = store.getAll();
      expect(before).not.toBe(after);
    });

    it('invalidates cache after remove', () => {
      const store = new ElementStore();
      store.add(makeNote({ id: 'a' }));
      const before = store.getAll();
      store.remove('a');
      const after = store.getAll();
      expect(before).not.toBe(after);
    });

    it('invalidates cache after update', () => {
      const store = new ElementStore();
      store.add(makeNote({ id: 'a' }));
      const before = store.getAll();
      store.update('a', { index: 'a5' });
      const after = store.getAll();
      expect(before).not.toBe(after);
    });

    it('swaps a position-only update into a fresh array without re-sorting', () => {
      const store = new ElementStore();
      store.add(makeNote({ id: 'a', index: 'a2' }));
      store.add(makeNote({ id: 'b', index: 'a0' }));
      store.add(makeNote({ id: 'c', index: 'a1' }));
      const before = store.getAll();
      const sort = vi.spyOn(Array.prototype, 'sort');

      store.update('c', { position: { x: 40, y: 50 } }, { origin: 'remote' });
      const after = store.getAll();
      const sorts = sort.mock.calls.length;
      sort.mockRestore();

      expect(after).not.toBe(before);
      expect(sorts).toBe(0);
      expect(after.map((el) => el.id)).toEqual(['b', 'c', 'a']);
      expect(after[1]).toBe(store.getById('c'));
      expect(before[1]?.position).toEqual({ x: 0, y: 0 });
    });

    it.each([{ index: 'a5' }, { layerId: 'L0' }])('re-sorts after an update with %o', (patch) => {
      const store = new ElementStore();
      store.setLayerOrder(
        new Map([
          ['L0', 0],
          ['L1', 1],
        ]),
      );
      store.add(makeNote({ id: 'a', index: 'a1', layerId: 'L1' }));
      store.add(makeNote({ id: 'b', index: 'a2', layerId: 'L1' }));
      store.getAll();

      store.update('a', patch);

      expect(store.getAll().map((el) => el.id)).toEqual('index' in patch ? ['b', 'a'] : ['a', 'b']);
    });

    it('invalidates cache after clear', () => {
      const store = new ElementStore();
      store.add(makeNote({ id: 'a' }));
      const before = store.getAll();
      store.clear();
      const after = store.getAll();
      expect(before).not.toBe(after);
    });

    it('invalidates cache after loadSnapshot', () => {
      const store = new ElementStore();
      store.add(makeNote({ id: 'a' }));
      const before = store.getAll();
      store.loadSnapshot([makeStroke({ id: 'b' })]);
      const after = store.getAll();
      expect(before).not.toBe(after);
    });

    it('invalidates cache after setLayerOrder', () => {
      const store = new ElementStore();
      store.add(makeNote({ id: 'a', layerId: 'L1' }));
      const before = store.getAll();
      store.setLayerOrder(new Map([['L1', 1]]));
      const after = store.getAll();
      expect(before).not.toBe(after);
    });
  });

  describe('loadSnapshot events', () => {
    it('emits clear event', () => {
      const store = new ElementStore();
      store.add(makeNote({ id: 'old' }));
      const listener = vi.fn();
      store.on('clear', listener);

      store.loadSnapshot([makeStroke({ id: 'new' })]);
      expect(listener).toHaveBeenCalledOnce();
    });

    it('emits add event for each loaded element', () => {
      const store = new ElementStore();
      const listener = vi.fn();
      store.on('add', listener);

      const note = makeNote({ id: 'n1' });
      const stroke = makeStroke({ id: 's1' });
      store.loadSnapshot([note, stroke]);

      expect(listener).toHaveBeenCalledTimes(2);
      expect(listener).toHaveBeenCalledWith(note, expect.anything());
      expect(listener).toHaveBeenCalledWith(stroke, expect.anything());
    });

    it('fires onChange during loadSnapshot', () => {
      const store = new ElementStore();
      const listener = vi.fn();
      store.onChange(listener);

      store.loadSnapshot([makeNote({ id: 'n1' })]);
      expect(listener).toHaveBeenCalled();
    });

    it('emits clear before add events', () => {
      const store = new ElementStore();
      const order: string[] = [];
      store.on('clear', () => order.push('clear'));
      store.on('add', () => order.push('add'));

      store.loadSnapshot([makeNote({ id: 'n1' }), makeStroke({ id: 's1' })]);
      expect(order).toEqual(['clear', 'add', 'add']);
    });

    it('listeners see new elements when responding to events', () => {
      const store = new ElementStore();
      let countDuringClear = -1;
      store.on('clear', () => {
        countDuringClear = store.count;
      });

      store.loadSnapshot([makeNote({ id: 'n1' }), makeStroke({ id: 's1' })]);
      expect(countDuringClear).toBe(2);
    });
  });

  describe('change origin meta', () => {
    it('forwards origin to add listeners', () => {
      const store = new ElementStore();
      const listener = vi.fn();
      store.on('add', listener);
      store.add(makeNote(), { origin: 'remote' });
      const meta = listener.mock.calls[0]?.[1] as { origin?: string };
      expect(meta.origin).toBe('remote');
    });

    it('add with no meta has undefined origin', () => {
      const store = new ElementStore();
      const listener = vi.fn();
      store.on('add', listener);
      store.add(makeNote());
      const meta = listener.mock.calls[0]?.[1] as { origin?: string };
      expect(meta.origin).toBeUndefined();
    });

    it('forwards origin to update listeners', () => {
      const store = new ElementStore();
      store.add(makeNote());
      const listener = vi.fn();
      store.on('update', listener);
      store.update('note-1', { text: 'X' }, { origin: 'remote' });
      const meta = listener.mock.calls[0]?.[1] as { origin?: string };
      expect(meta.origin).toBe('remote');
    });

    it('update with no meta has undefined origin', () => {
      const store = new ElementStore();
      store.add(makeNote());
      const listener = vi.fn();
      store.on('update', listener);
      store.update('note-1', { text: 'X' });
      const meta = listener.mock.calls[0]?.[1] as { origin?: string };
      expect(meta.origin).toBeUndefined();
    });

    it('forwards origin to remove listeners', () => {
      const store = new ElementStore();
      store.add(makeNote());
      const listener = vi.fn();
      store.on('remove', listener);
      store.remove('note-1', { origin: 'remote' });
      const meta = listener.mock.calls[0]?.[1] as { origin?: string };
      expect(meta.origin).toBe('remote');
    });

    it('forwards origin to clear listeners', () => {
      const store = new ElementStore();
      store.add(makeNote());
      const listener = vi.fn();
      store.on('clear', listener);
      store.clear({ origin: 'remote' });
      const meta = listener.mock.calls[0]?.[1] as { origin?: string };
      expect(meta.origin).toBe('remote');
    });

    it('still calls a single-arg listener after a tagged mutation', () => {
      const store = new ElementStore();
      let calls = 0;
      store.on('add', (_data) => {
        calls += 1;
      });
      store.add(makeNote(), { origin: 'remote' });
      expect(calls).toBe(1);
    });

    it('forwards origin to both clear and add during loadSnapshot', () => {
      const store = new ElementStore();
      const clearListener = vi.fn();
      const addListener = vi.fn();
      store.on('clear', clearListener);
      store.on('add', addListener);

      store.loadSnapshot([makeNote({ id: 'n1' })], { origin: 'remote' });

      const clearMeta = clearListener.mock.calls[0]?.[1] as { origin?: string };
      const addMeta = addListener.mock.calls[0]?.[1] as { origin?: string };
      expect(clearMeta.origin).toBe('remote');
      expect(addMeta.origin).toBe('remote');
    });
  });

  describe('note sanitization on update', () => {
    it('sanitizes HTML in note text on update', () => {
      const store = new ElementStore();
      store.add(makeNote());
      store.update('note-1', { text: '<script>alert(1)</script>Safe' });
      expect((store.getById('note-1') as NoteElement).text).toBe('Safe');
    });

    it('does not sanitize text on non-note elements', () => {
      const store = new ElementStore();
      store.add(makeStroke());
      store.update('stroke-1', { color: '#ff0000' } as Partial<CanvasElement>);
      const updated = store.getById('stroke-1');
      expect(updated?.type === 'stroke' && updated.color).toBe('#ff0000');
    });

    it('preserves allowed HTML on note update', () => {
      const store = new ElementStore();
      store.add(makeNote());
      store.update('note-1', { text: '<b>bold</b>' });
      expect((store.getById('note-1') as NoteElement).text).toBe('<b>bold</b>');
    });
  });

  describe('version tracking', () => {
    it('returns 0 for a newly added element', () => {
      const store = new ElementStore();
      const note = makeNote({ id: 'n1' });
      store.add(note);
      expect(store.getVersion('n1')).toBe(0);
    });

    it('increments version on update', () => {
      const store = new ElementStore();
      store.add(makeNote({ id: 'n1' }));
      store.update('n1', { text: 'Changed' });
      expect(store.getVersion('n1')).toBe(1);
    });

    it('increments version on each update', () => {
      const store = new ElementStore();
      store.add(makeNote({ id: 'n1' }));
      store.update('n1', { text: 'A' });
      store.update('n1', { text: 'B' });
      expect(store.getVersion('n1')).toBe(2);
    });

    it('returns -1 for unknown id', () => {
      const store = new ElementStore();
      expect(store.getVersion('nonexistent')).toBe(-1);
    });

    it('removes version on element removal', () => {
      const store = new ElementStore();
      store.add(makeNote({ id: 'n1' }));
      store.remove('n1');
      expect(store.getVersion('n1')).toBe(-1);
    });

    it('resets versions on clear', () => {
      const store = new ElementStore();
      store.add(makeNote({ id: 'n1' }));
      store.update('n1', { text: 'X' });
      store.clear();
      expect(store.getVersion('n1')).toBe(-1);
    });

    it('resets versions on loadSnapshot', () => {
      const store = new ElementStore();
      store.add(makeNote({ id: 'n1' }));
      store.update('n1', { text: 'X' });
      store.loadSnapshot([makeNote({ id: 'n2' })]);
      expect(store.getVersion('n1')).toBe(-1);
      expect(store.getVersion('n2')).toBe(0);
    });
  });

  describe('z-order', () => {
    const order = (store: ElementStore) => store.getAll().map((el) => el.id);

    describe('bringToFront', () => {
      it('moves the element above every sibling in its layer', () => {
        const store = new ElementStore();
        store.add(makeNote({ id: 'a', index: 'a0', layerId: 'L1' }));
        store.add(makeNote({ id: 'b', index: 'a5', layerId: 'L1' }));
        store.add(makeNote({ id: 'c', index: 'a2', layerId: 'L1' }));
        store.bringToFront('a');
        expect(order(store)).toEqual(['c', 'b', 'a']);
      });

      it('no-ops when element is already at front', () => {
        const store = new ElementStore();
        store.add(makeNote({ id: 'a', index: 'aA', layerId: 'L1' }));
        store.add(makeNote({ id: 'b', index: 'a5', layerId: 'L1' }));
        store.bringToFront('a');
        expect(store.getById('a')?.index).toBe('aA');
      });

      it('no-ops for unknown id', () => {
        const store = new ElementStore();
        store.bringToFront('nonexistent');
        expect(store.count).toBe(0);
      });

      it('no-ops for only element in layer', () => {
        const store = new ElementStore();
        store.add(makeNote({ id: 'a', index: 'a0', layerId: 'L1' }));
        store.bringToFront('a');
        expect(store.getById('a')?.index).toBe('a0');
      });

      it('only considers elements in same layer', () => {
        const store = new ElementStore();
        store.add(makeNote({ id: 'a', index: 'a0', layerId: 'L1' }));
        store.add(makeNote({ id: 'b', index: 'b10', layerId: 'L2' }));
        store.bringToFront('a');
        expect(store.getById('a')?.index).toBe('a0');
      });
    });

    describe('sendToBack', () => {
      it('moves the element below every sibling in its layer', () => {
        const store = new ElementStore();
        store.add(makeNote({ id: 'a', index: 'a5', layerId: 'L1' }));
        store.add(makeNote({ id: 'b', index: 'a0', layerId: 'L1' }));
        store.add(makeNote({ id: 'c', index: 'a2', layerId: 'L1' }));
        store.sendToBack('a');
        expect(order(store)).toEqual(['a', 'b', 'c']);
      });

      it('no-ops when element is already at back', () => {
        const store = new ElementStore();
        store.add(makeNote({ id: 'a', index: 'a0', layerId: 'L1' }));
        store.add(makeNote({ id: 'b', index: 'a5', layerId: 'L1' }));
        store.sendToBack('a');
        expect(store.getById('a')?.index).toBe('a0');
      });

      it('no-ops for unknown id', () => {
        const store = new ElementStore();
        store.sendToBack('nonexistent');
        expect(store.count).toBe(0);
      });
    });

    describe('bringForward', () => {
      it('moves above the next higher element in the same layer', () => {
        const store = new ElementStore();
        store.add(makeNote({ id: 'a', index: 'a0', layerId: 'L1' }));
        store.add(makeNote({ id: 'b', index: 'a1', layerId: 'L1' }));
        store.add(makeNote({ id: 'c', index: 'a2', layerId: 'L1' }));
        store.bringForward('a');
        expect(order(store)).toEqual(['b', 'a', 'c']);
      });

      it('no-ops when element is already at front', () => {
        const store = new ElementStore();
        store.add(makeNote({ id: 'a', index: 'a0', layerId: 'L1' }));
        store.add(makeNote({ id: 'b', index: 'a5', layerId: 'L1' }));
        store.bringForward('b');
        expect(store.getById('b')?.index).toBe('a5');
      });

      it('no-ops for unknown id', () => {
        const store = new ElementStore();
        store.bringForward('nonexistent');
        expect(store.count).toBe(0);
      });

      it('only considers elements in same layer', () => {
        const store = new ElementStore();
        store.add(makeNote({ id: 'a', index: 'a0', layerId: 'L1' }));
        store.add(makeNote({ id: 'b', index: 'a1', layerId: 'L2' }));
        store.bringForward('a');
        expect(store.getById('a')?.index).toBe('a0');
      });
    });

    describe('sendBackward', () => {
      it('moves below the next lower element in the same layer', () => {
        const store = new ElementStore();
        store.add(makeNote({ id: 'a', index: 'a0', layerId: 'L1' }));
        store.add(makeNote({ id: 'b', index: 'a1', layerId: 'L1' }));
        store.add(makeNote({ id: 'c', index: 'a2', layerId: 'L1' }));
        store.sendBackward('c');
        expect(order(store)).toEqual(['a', 'c', 'b']);
      });

      it('no-ops when element is already at back', () => {
        const store = new ElementStore();
        store.add(makeNote({ id: 'a', index: 'a0', layerId: 'L1' }));
        store.add(makeNote({ id: 'b', index: 'a5', layerId: 'L1' }));
        store.sendBackward('a');
        expect(store.getById('a')?.index).toBe('a0');
      });

      it('no-ops for unknown id', () => {
        const store = new ElementStore();
        store.sendBackward('nonexistent');
        expect(store.count).toBe(0);
      });
    });
  });

  describe('cache warming and transfer', () => {
    it('loadSnapshot warms stroke segments', () => {
      const spy = vi.spyOn(strokeCache, 'computeStrokeSegments');
      const store = new ElementStore();
      const s1 = createStroke({
        points: [
          { x: 0, y: 0, pressure: 0.5 },
          { x: 10, y: 0, pressure: 0.5 },
        ],
      });
      store.loadSnapshot([s1]);
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });

    it('loadSnapshot restores cachedControlPoint for bent arrows', () => {
      const store = new ElementStore();
      const arrow = createArrow({
        position: { x: 0, y: 0 },
        from: { x: 0, y: 0 },
        to: { x: 100, y: 0 },
        bend: 0.5,
      });
      delete (arrow as { cachedControlPoint?: unknown }).cachedControlPoint;
      store.loadSnapshot([arrow]);
      const loaded = store.getById(arrow.id);
      expect(loaded && loaded.type === 'arrow' && loaded.cachedControlPoint).toBeTruthy();
    });

    it('loadSnapshot does NOT set cachedControlPoint for straight arrows', () => {
      const store = new ElementStore();
      const arrow = createArrow({
        position: { x: 0, y: 0 },
        from: { x: 0, y: 0 },
        to: { x: 100, y: 0 },
        bend: 0,
      });
      delete (arrow as { cachedControlPoint?: unknown }).cachedControlPoint;
      store.loadSnapshot([arrow]);
      const loaded = store.getById(arrow.id);
      expect(loaded && loaded.type === 'arrow' && loaded.cachedControlPoint).toBeFalsy();
    });

    it('color-only update keeps the stroke render-data cache', () => {
      const store = new ElementStore();
      const s = createStroke({
        index: 'a0',
        points: [
          { x: 0, y: 0, pressure: 0.5 },
          { x: 10, y: 0, pressure: 0.5 },
        ],
      });
      store.add(s);
      const before = strokeCache.getStrokeRenderData(s);
      store.update(s.id, { color: '#ff0000' });
      const after = store.getById(s.id);
      expect(after).not.toBe(s);
      if (after && after.type === 'stroke') {
        expect(strokeCache.getStrokeRenderData(after)).toBe(before);
      }
    });

    it('position-only update keeps segments but recomputes bounds', () => {
      const store = new ElementStore();
      const s = createStroke({
        index: 'a0',
        points: [
          { x: 0, y: 0, pressure: 0.5 },
          { x: 10, y: 0, pressure: 0.5 },
        ],
      });
      store.add(s);
      const segsBefore = strokeCache.getStrokeRenderData(s);
      const boundsBefore = getElementBounds(s);
      store.update(s.id, { position: { x: 50, y: 50 } });
      const after = store.getById(s.id);
      if (after && after.type === 'stroke') {
        expect(strokeCache.getStrokeRenderData(after)).toBe(segsBefore);
        const boundsAfter = getElementBounds(after);
        expect(boundsAfter).not.toEqual(boundsBefore);
      }
    });

    it('points update drops both caches', () => {
      const store = new ElementStore();
      const s = createStroke({
        points: [
          { x: 0, y: 0, pressure: 0.5 },
          { x: 10, y: 0, pressure: 0.5 },
        ],
      });
      store.add(s);
      const segsBefore = strokeCache.getStrokeRenderData(s);
      store.update(s.id, {
        points: [
          { x: 0, y: 0, pressure: 0.5 },
          { x: 20, y: 20, pressure: 0.5 },
          { x: 40, y: 0, pressure: 0.5 },
        ],
      });
      const after = store.getById(s.id);
      if (after && after.type === 'stroke') {
        expect(strokeCache.getStrokeRenderData(after)).not.toBe(segsBefore);
      }
    });
  });
});

describe('ElementStore extension dataVersion stamping', () => {
  function makeRegistry(): ElementRegistry {
    const registry = new ElementRegistry();
    for (const [type, dataVersion] of [
      ['test:versioned', 3],
      ['test:plain', undefined],
    ] as const) {
      registry.register<ExtensionElementEnvelope>({
        type,
        legacyTypes: [],
        decodeLegacy: (raw) => raw as unknown as ExtensionElementEnvelope,
        validateData: () => true,
        unwrap: (element) => element,
        wrap: (element) => element,
        bounds: (element) => ({ x: element.position.x, y: element.position.y, w: 10, h: 10 }),
        dataVersion,
        migrate: (data) => data,
      });
    }
    return registry;
  }

  function envelope(
    extensionType: string,
    overrides: Partial<ExtensionElementEnvelope> = {},
  ): ExtensionElementEnvelope {
    return {
      id: `${extensionType}-1`,
      type: 'extension',
      extensionType,
      position: { x: 0, y: 0 },
      index: 'a0',
      version: 1,
      locked: false,
      layerId: '',
      data: { value: 1 },
      ...overrides,
    };
  }

  it('add stamps the registered dataVersion on an envelope without one', () => {
    const store = new ElementStore(makeRegistry());
    store.add(envelope('test:versioned'));
    expect(store.getById('test:versioned-1')).toMatchObject({ dataVersion: 3, data: { value: 1 } });
  });

  it('add keeps an existing dataVersion unchanged', () => {
    const store = new ElementStore(makeRegistry());
    store.add(envelope('test:versioned', { dataVersion: 1 }));
    expect(store.getById('test:versioned-1')).toMatchObject({ dataVersion: 1 });
  });

  it('loadSnapshot stamps the registered dataVersion on an envelope without one', () => {
    const store = new ElementStore(makeRegistry());
    store.loadSnapshot([envelope('test:versioned')]);
    expect(store.getById('test:versioned-1')).toMatchObject({ dataVersion: 3 });
  });

  it.each([
    ['an unversioned type', envelope('test:plain')],
    ['an unregistered type', envelope('test:unknown')],
    ['a core element', makeNote()],
  ])('add leaves %s without a dataVersion', (_label, element: CanvasElement) => {
    const store = new ElementStore(makeRegistry());
    store.add(element);
    expect(store.getById(element.id)).not.toHaveProperty('dataVersion');
  });
});

describe('ElementStore order keys and versions', () => {
  function ids(store: ElementStore): string[] {
    return store.getAll().map((el) => el.id);
  }

  it("add places an unplaced element above the layer's top", () => {
    const store = new ElementStore();
    store.add(makeNote({ id: 'first', index: '' }));
    store.add(makeNote({ id: 'second', index: '' }));
    const first = store.getById('first')?.index ?? '';
    const second = store.getById('second')?.index ?? '';
    expect(first).not.toBe('');
    expect(second > first).toBe(true);
  });

  it('add keeps a placed index and the given version', () => {
    const store = new ElementStore();
    store.add(makeNote({ id: 'n', index: 'a5', version: 7 }));
    expect(store.getById('n')).toMatchObject({ index: 'a5', version: 7 });
  });

  it('local update bumps version and drops editor', () => {
    const store = new ElementStore();
    store.add(makeNote({ id: 'n', index: 'a0', version: 3, editor: 'x' }));
    store.update('n', { position: { x: 1, y: 0 } });
    expect(store.getById('n')?.version).toBe(4);
    expect(store.getById('n')).not.toHaveProperty('editor');
    store.update('n', { version: 99, editor: 'y' });
    expect(store.getById('n')?.version).toBe(5);
    expect(store.getById('n')).not.toHaveProperty('editor');
    store.update('n', { version: 99 }, { origin: 'local' });
    expect(store.getById('n')?.version).toBe(6);
  });

  it('undo never lowers version', () => {
    const store = new ElementStore();
    const stack = new HistoryStack();
    const recorder = new HistoryRecorder(store, stack);
    recorder.pause();
    store.add(makeNote({ id: 'n', index: 'a0', version: 1 }));
    recorder.resume();
    recorder.begin();
    store.update('n', { position: { x: 10, y: 0 } });
    recorder.commit();
    expect(store.getById('n')?.version).toBe(2);
    recorder.pause();
    stack.undo(store);
    expect(store.getById('n')?.version).toBe(3);
    expect(store.getById('n')?.position).toEqual({ x: 0, y: 0 });
    stack.redo(store);
    expect(store.getById('n')?.version).toBe(4);
    expect(store.getById('n')?.position).toEqual({ x: 10, y: 0 });
  });

  it('remote update takes version verbatim, including lower and equal', () => {
    const store = new ElementStore();
    store.add(makeNote({ id: 'n', index: 'a0', version: 5, editor: 'a' }));
    store.update('n', { version: 2, editor: 'b' }, { origin: 'remote' });
    expect(store.getById('n')).toMatchObject({ version: 2, editor: 'b' });
    store.update('n', { version: 2 }, { origin: 'host' });
    expect(store.getById('n')?.version).toBe(2);
    expect(store.getById('n')).not.toHaveProperty('editor');
  });

  it('remote update without version keeps version and editor', () => {
    const store = new ElementStore();
    store.add(makeNote({ id: 'n', index: 'a0', version: 5, editor: 'a' }));
    store.update('n', { position: { x: 3, y: 3 }, editor: 'z' }, { origin: 'remote' });
    expect(store.getById('n')).toMatchObject({ version: 5, editor: 'a', position: { x: 3, y: 3 } });
  });

  it('ties order by id', () => {
    const store = new ElementStore();
    store.add(makeNote({ id: 'b', index: 'a0' }));
    store.add(makeNote({ id: 'a', index: 'a0' }));
    expect(ids(store)).toEqual(['a', 'b']);
  });

  it('orders by layer, then index, then id in queryRect', () => {
    const store = new ElementStore();
    store.setLayerOrder(
      new Map([
        ['bg', 0],
        ['fg', 1],
      ]),
    );
    store.add(makeNote({ id: 'fg', index: 'a0', layerId: 'fg' }));
    store.add(makeNote({ id: 'bg-top', index: 'a2', layerId: 'bg' }));
    store.add(makeNote({ id: 'bg-b', index: 'a1', layerId: 'bg' }));
    store.add(makeNote({ id: 'bg-a', index: 'a1', layerId: 'bg' }));
    const expected = ['bg-a', 'bg-b', 'bg-top', 'fg'];
    expect(ids(store)).toEqual(expected);
    expect(store.queryPoint({ x: 10, y: 10 }).map((el) => el.id)).toEqual(expected);
  });

  it('a remote index update re-sorts getAll', () => {
    const store = new ElementStore();
    store.add(makeNote({ id: 'a', index: 'a0' }));
    store.add(makeNote({ id: 'b', index: 'a1' }));
    expect(ids(store)).toEqual(['a', 'b']);
    store.update('a', { index: 'a2' }, { origin: 'remote' });
    expect(ids(store)).toEqual(['b', 'a']);
  });

  function reorderStore(): ElementStore {
    const store = new ElementStore();
    store.add(makeNote({ id: 'a', index: 'a0' }));
    store.add(makeNote({ id: 'b', index: 'a1' }));
    store.add(makeNote({ id: 'c', index: 'a2' }));
    store.add(makeNote({ id: 'other', index: 'Zz', layerId: 'other' }));
    return store;
  }

  it.each([
    ['bringToFront', 'a', ['b', 'c', 'a']],
    ['sendToBack', 'c', ['c', 'a', 'b']],
    ['bringForward', 'a', ['b', 'a', 'c']],
    ['sendBackward', 'c', ['a', 'c', 'b']],
  ] as const)('%s writes exactly one element', (op, id, expected) => {
    const store = reorderStore();
    const updated: string[] = [];
    store.on('update', ({ current }) => updated.push(current.id));
    store[op](id);
    expect(updated).toEqual([id]);
    expect(
      store
        .getAll()
        .filter((el) => el.layerId === '')
        .map((el) => el.id),
    ).toEqual(expected);
  });

  it.each([
    ['bringToFront', 'c'],
    ['bringForward', 'c'],
    ['sendToBack', 'a'],
    ['sendBackward', 'a'],
  ] as const)('%s at the end of the layer is a no-op', (op, id) => {
    const store = reorderStore();
    const updated: string[] = [];
    store.on('update', ({ current }) => updated.push(current.id));
    store[op](id);
    expect(updated).toEqual([]);
  });

  it('bringForward over two siblings with equal keys moves above both', () => {
    const store = new ElementStore();
    store.add(makeNote({ id: 'x', index: 'a0' }));
    store.add(makeNote({ id: 'y', index: 'a1' }));
    store.add(makeNote({ id: 'z', index: 'a1' }));
    store.add(makeNote({ id: 'w', index: 'a2' }));
    store.bringForward('x');
    expect(ids(store)).toEqual(['y', 'z', 'x', 'w']);
  });

  it('sendBackward under two siblings with equal keys moves below both', () => {
    const store = new ElementStore();
    store.add(makeNote({ id: 'w', index: 'a0' }));
    store.add(makeNote({ id: 'y', index: 'a1' }));
    store.add(makeNote({ id: 'z', index: 'a1' }));
    store.add(makeNote({ id: 'x', index: 'a2' }));
    store.sendBackward('x');
    expect(ids(store)).toEqual(['w', 'x', 'y', 'z']);
  });

  it('bringToFront is a no-op when no key fits above the layer top', () => {
    const store = new ElementStore();
    const top = 'z'.repeat(27 + 101);
    store.add(makeNote({ id: 'a', index: 'a0' }));
    store.add(makeNote({ id: 'b', index: top }));
    store.bringToFront('a');
    expect(ids(store)).toEqual(['a', 'b']);
  });

  it("loadSnapshot places '' elements in array order", () => {
    const store = new ElementStore();
    store.loadSnapshot([
      makeNote({ id: 'c', index: '' }),
      makeNote({ id: 'placed', index: 'a5' }),
      makeNote({ id: 'a', index: '' }),
      makeNote({ id: 'b', index: '', layerId: 'other' }),
    ]);
    expect(ids(store).filter((id) => id !== 'b')).toEqual(['placed', 'c', 'a']);
    expect(store.getById('b')?.index).not.toBe('');
    expect(store.getAll().every((el) => el.index !== '')).toBe(true);
  });
});
