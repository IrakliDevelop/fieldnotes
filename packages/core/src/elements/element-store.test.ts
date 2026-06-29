// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { ElementStore } from './element-store';
import * as strokeCache from './stroke-cache';
import { getElementBounds } from './element-bounds';
import { createStroke, createArrow } from './element-factory';
import type { CanvasElement, NoteElement, StrokeElement } from './types';

function makeNote(overrides: Partial<NoteElement> = {}): NoteElement {
  return {
    id: 'note-1',
    type: 'note',
    position: { x: 0, y: 0 },
    size: { w: 200, h: 100 },
    text: 'Hello',
    backgroundColor: '#ffeb3b',
    zIndex: 0,
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
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ],
    color: '#000',
    width: 2,
    opacity: 1,
    zIndex: 0,
    locked: false,
    layerId: '',
    ...overrides,
  };
}

describe('ElementStore', () => {
  describe('CRUD', () => {
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
      expect(store.getById('note-1')?.text).toBe('Updated');
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

  describe('ordering', () => {
    it('returns elements sorted by zIndex', () => {
      const store = new ElementStore();
      store.add(makeNote({ id: 'a', zIndex: 2 }));
      store.add(makeStroke({ id: 'b', zIndex: 0 }));
      store.add(makeNote({ id: 'c', zIndex: 1 }));

      const ids = store.getAll().map((el) => el.id);
      expect(ids).toEqual(['b', 'c', 'a']);
    });
  });

  describe('layer-aware sorting', () => {
    it('sorts by layer order then zIndex', () => {
      const store = new ElementStore();
      store.setLayerOrder(
        new Map([
          ['bg', 0],
          ['fg', 1],
        ]),
      );

      store.add(makeNote({ id: 'fg-z0', zIndex: 0, layerId: 'fg' }));
      store.add(makeNote({ id: 'bg-z1', zIndex: 1, layerId: 'bg' }));
      store.add(makeNote({ id: 'bg-z0', zIndex: 0, layerId: 'bg' }));

      const ids = store.getAll().map((e) => e.id);
      expect(ids).toEqual(['bg-z0', 'bg-z1', 'fg-z0']);
    });

    it('falls back to zIndex-only when no layer order set', () => {
      const store = new ElementStore();
      store.add(makeNote({ id: 'a', zIndex: 2, layerId: 'x' }));
      store.add(makeNote({ id: 'b', zIndex: 1, layerId: 'y' }));
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
        makeNote({ id: 'low', position: { x: 0, y: 0 }, size: { w: 50, h: 50 }, zIndex: 1 }),
      );
      store.add(
        makeNote({ id: 'high', position: { x: 0, y: 0 }, size: { w: 50, h: 50 }, zIndex: 10 }),
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
        type: 'grid',
        position: { x: 0, y: 0 },
        gridType: 'square',
        hexOrientation: 'pointy',
        cellSize: 50,
        strokeColor: '#ccc',
        strokeWidth: 1,
        opacity: 0.5,
        zIndex: 0,
        locked: false,
        layerId: 'default',
      } as CanvasElement);
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
      store.add(makeNote({ id: 'a', zIndex: 1 }));
      store.add(makeStroke({ id: 'b', zIndex: 0 }));

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
      store.update('a', { zIndex: 5 });
      const after = store.getAll();
      expect(before).not.toBe(after);
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
      expect(store.getById('stroke-1')?.color).toBe('#ff0000');
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
    describe('bringToFront', () => {
      it('sets zIndex to max + 1 within layer', () => {
        const store = new ElementStore();
        store.add(makeNote({ id: 'a', zIndex: 0, layerId: 'L1' }));
        store.add(makeNote({ id: 'b', zIndex: 5, layerId: 'L1' }));
        store.add(makeNote({ id: 'c', zIndex: 2, layerId: 'L1' }));
        store.bringToFront('a');
        expect(store.getById('a')?.zIndex).toBe(6);
      });

      it('no-ops when element is already at front', () => {
        const store = new ElementStore();
        store.add(makeNote({ id: 'a', zIndex: 10, layerId: 'L1' }));
        store.add(makeNote({ id: 'b', zIndex: 5, layerId: 'L1' }));
        store.bringToFront('a');
        expect(store.getById('a')?.zIndex).toBe(10);
      });

      it('no-ops for unknown id', () => {
        const store = new ElementStore();
        store.bringToFront('nonexistent');
        expect(store.count).toBe(0);
      });

      it('no-ops for only element in layer', () => {
        const store = new ElementStore();
        store.add(makeNote({ id: 'a', zIndex: 0, layerId: 'L1' }));
        store.bringToFront('a');
        expect(store.getById('a')?.zIndex).toBe(0);
      });

      it('only considers elements in same layer', () => {
        const store = new ElementStore();
        store.add(makeNote({ id: 'a', zIndex: 0, layerId: 'L1' }));
        store.add(makeNote({ id: 'b', zIndex: 100, layerId: 'L2' }));
        store.bringToFront('a');
        expect(store.getById('a')?.zIndex).toBe(0);
      });
    });

    describe('sendToBack', () => {
      it('sets zIndex to min - 1 within layer', () => {
        const store = new ElementStore();
        store.add(makeNote({ id: 'a', zIndex: 5, layerId: 'L1' }));
        store.add(makeNote({ id: 'b', zIndex: 0, layerId: 'L1' }));
        store.add(makeNote({ id: 'c', zIndex: 2, layerId: 'L1' }));
        store.sendToBack('a');
        expect(store.getById('a')?.zIndex).toBe(-1);
      });

      it('no-ops when element is already at back', () => {
        const store = new ElementStore();
        store.add(makeNote({ id: 'a', zIndex: 0, layerId: 'L1' }));
        store.add(makeNote({ id: 'b', zIndex: 5, layerId: 'L1' }));
        store.sendToBack('a');
        expect(store.getById('a')?.zIndex).toBe(0);
      });

      it('no-ops for unknown id', () => {
        const store = new ElementStore();
        store.sendToBack('nonexistent');
        expect(store.count).toBe(0);
      });
    });

    describe('bringForward', () => {
      it('swaps zIndex with next higher element in same layer', () => {
        const store = new ElementStore();
        store.add(makeNote({ id: 'a', zIndex: 0, layerId: 'L1' }));
        store.add(makeNote({ id: 'b', zIndex: 1, layerId: 'L1' }));
        store.add(makeNote({ id: 'c', zIndex: 2, layerId: 'L1' }));
        store.bringForward('a');
        expect(store.getById('a')?.zIndex).toBe(1);
        expect(store.getById('b')?.zIndex).toBe(0);
      });

      it('no-ops when element is already at front', () => {
        const store = new ElementStore();
        store.add(makeNote({ id: 'a', zIndex: 0, layerId: 'L1' }));
        store.add(makeNote({ id: 'b', zIndex: 5, layerId: 'L1' }));
        store.bringForward('b');
        expect(store.getById('b')?.zIndex).toBe(5);
      });

      it('no-ops for unknown id', () => {
        const store = new ElementStore();
        store.bringForward('nonexistent');
        expect(store.count).toBe(0);
      });

      it('only considers elements in same layer', () => {
        const store = new ElementStore();
        store.add(makeNote({ id: 'a', zIndex: 0, layerId: 'L1' }));
        store.add(makeNote({ id: 'b', zIndex: 1, layerId: 'L2' }));
        store.bringForward('a');
        expect(store.getById('a')?.zIndex).toBe(0);
      });
    });

    describe('sendBackward', () => {
      it('swaps zIndex with next lower element in same layer', () => {
        const store = new ElementStore();
        store.add(makeNote({ id: 'a', zIndex: 0, layerId: 'L1' }));
        store.add(makeNote({ id: 'b', zIndex: 1, layerId: 'L1' }));
        store.add(makeNote({ id: 'c', zIndex: 2, layerId: 'L1' }));
        store.sendBackward('c');
        expect(store.getById('c')?.zIndex).toBe(1);
        expect(store.getById('b')?.zIndex).toBe(2);
      });

      it('no-ops when element is already at back', () => {
        const store = new ElementStore();
        store.add(makeNote({ id: 'a', zIndex: 0, layerId: 'L1' }));
        store.add(makeNote({ id: 'b', zIndex: 5, layerId: 'L1' }));
        store.sendBackward('a');
        expect(store.getById('a')?.zIndex).toBe(0);
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
