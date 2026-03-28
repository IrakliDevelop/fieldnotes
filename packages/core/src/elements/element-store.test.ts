import { describe, it, expect, vi } from 'vitest';
import { ElementStore } from './element-store';
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
      expect(listener).toHaveBeenCalledWith(note);
    });

    it('emits remove event', () => {
      const store = new ElementStore();
      const listener = vi.fn();
      store.on('remove', listener);

      const note = makeNote();
      store.add(note);
      store.remove('note-1');
      expect(listener).toHaveBeenCalledWith(note);
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
});
