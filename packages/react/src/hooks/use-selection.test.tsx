// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { FieldNotesCanvas } from '../field-notes-canvas';
import { useSelection } from './use-selection';
import { SelectTool, createNote } from '@fieldnotes/core';
import type { Viewport } from '@fieldnotes/core';

describe('useSelection', () => {
  afterEach(cleanup);

  it('returns empty array initially', () => {
    let ids: string[] = [];
    function Consumer() {
      ids = useSelection();
      return null;
    }

    render(
      <FieldNotesCanvas tools={[new SelectTool()]} defaultTool="select">
        <Consumer />
      </FieldNotesCanvas>,
    );
    expect(ids).toEqual([]);
  });

  it('updates when selection changes', () => {
    let ids: string[] = [];
    let vp: Viewport | null = null;
    function Consumer() {
      ids = useSelection();
      return null;
    }

    render(
      <FieldNotesCanvas
        tools={[new SelectTool()]}
        defaultTool="select"
        onReady={(v) => {
          vp = v;
        }}
      >
        <Consumer />
      </FieldNotesCanvas>,
    );

    let noteId = '';
    act(() => {
      const note = createNote({ position: { x: 0, y: 0 } });
      vp?.store.add(note);
      noteId = note.id;
    });

    act(() => {
      const sel = vp?.toolManager.getTool<SelectTool>('select');
      sel?.setSelection([noteId]);
    });

    expect(ids).toEqual([noteId]);
  });

  it('returns referentially stable array when selection does not change', () => {
    let ids: string[] = [];
    let vp: Viewport | null = null;
    function Consumer() {
      ids = useSelection();
      return null;
    }

    render(
      <FieldNotesCanvas
        tools={[new SelectTool()]}
        defaultTool="select"
        onReady={(v) => {
          vp = v;
        }}
      >
        <Consumer />
      </FieldNotesCanvas>,
    );

    let noteId = '';
    act(() => {
      const note = createNote({ position: { x: 0, y: 0 } });
      vp?.store.add(note);
      noteId = note.id;
    });

    act(() => {
      const sel = vp?.toolManager.getTool<SelectTool>('select');
      sel?.setSelection([noteId]);
    });

    const snapshot = ids;

    // Store mutation unrelated to selection — array should not change reference
    act(() => {
      vp?.store.update(noteId, { position: { x: 99, y: 99 } });
    });

    expect(ids).toBe(snapshot);
  });
});
