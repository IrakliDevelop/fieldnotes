import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { FieldNotesCanvas } from '../field-notes-canvas';
import { useElements } from './use-elements';
import { createNote, createStroke } from '@fieldnotes/core';
import type { CanvasElement, NoteElement, Viewport } from '@fieldnotes/core';

describe('useElements', () => {
  afterEach(cleanup);

  it('returns empty array initially', () => {
    let elements: CanvasElement[] = [];
    function Consumer() {
      elements = useElements();
      return null;
    }

    render(
      <FieldNotesCanvas>
        <Consumer />
      </FieldNotesCanvas>,
    );
    expect(elements).toEqual([]);
  });

  it('updates when element is added', () => {
    let elements: CanvasElement[] = [];
    let vp: Viewport | null = null;
    function Consumer() {
      elements = useElements();
      return null;
    }

    render(
      <FieldNotesCanvas
        onReady={(v) => {
          vp = v;
        }}
      >
        <Consumer />
      </FieldNotesCanvas>,
    );

    act(() => {
      const note = createNote({
        position: { x: 0, y: 0 },
        size: { w: 100, h: 100 },
        backgroundColor: '#ffeb3b',
        textColor: '#000',
        layerId: vp?.layerManager.activeLayerId ?? '',
      });
      vp?.store.add(note);
    });
    expect(elements).toHaveLength(1);
  });

  it('updates when element is removed', () => {
    let elements: CanvasElement[] = [];
    let vp: Viewport | null = null;
    function Consumer() {
      elements = useElements();
      return null;
    }

    render(
      <FieldNotesCanvas
        onReady={(v) => {
          vp = v;
        }}
      >
        <Consumer />
      </FieldNotesCanvas>,
    );

    let noteId = '';
    act(() => {
      const note = createNote({
        position: { x: 0, y: 0 },
        size: { w: 100, h: 100 },
        backgroundColor: '#ffeb3b',
        textColor: '#000',
        layerId: vp?.layerManager.activeLayerId ?? '',
      });
      vp?.store.add(note);
      noteId = note.id;
    });
    expect(elements).toHaveLength(1);

    act(() => {
      vp?.store.remove(noteId);
    });
    expect(elements).toHaveLength(0);
  });

  it('filters by type when argument provided', () => {
    let notes: NoteElement[] = [];
    let vp: Viewport | null = null;
    function Consumer() {
      notes = useElements('note');
      return null;
    }

    render(
      <FieldNotesCanvas
        onReady={(v) => {
          vp = v;
        }}
      >
        <Consumer />
      </FieldNotesCanvas>,
    );

    act(() => {
      const layerId = vp?.layerManager.activeLayerId ?? '';
      vp?.store.add(
        createNote({
          position: { x: 0, y: 0 },
          size: { w: 100, h: 100 },
          backgroundColor: '#ffeb3b',
          textColor: '#000',
          layerId,
        }),
      );
      vp?.store.add(
        createStroke({
          points: [
            { x: 0, y: 0, pressure: 0.5 },
            { x: 10, y: 10, pressure: 0.5 },
          ],
          color: '#000',
          width: 1,
          layerId,
        }),
      );
    });
    expect(notes).toHaveLength(1);
    expect(notes[0]?.type).toBe('note');
  });

  it('updates when element is updated', () => {
    let elements: CanvasElement[] = [];
    let vp: Viewport | null = null;
    function Consumer() {
      elements = useElements();
      return null;
    }

    render(
      <FieldNotesCanvas
        onReady={(v) => {
          vp = v;
        }}
      >
        <Consumer />
      </FieldNotesCanvas>,
    );

    let noteId = '';
    act(() => {
      const note = createNote({
        position: { x: 0, y: 0 },
        size: { w: 100, h: 100 },
        backgroundColor: '#ffeb3b',
        textColor: '#000',
        layerId: vp?.layerManager.activeLayerId ?? '',
      });
      vp?.store.add(note);
      noteId = note.id;
    });

    act(() => {
      vp?.store.update(noteId, { position: { x: 50, y: 50 } });
    });
    expect(elements[0]?.position).toEqual({ x: 50, y: 50 });
  });
});
