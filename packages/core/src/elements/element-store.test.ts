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
