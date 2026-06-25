// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { FieldNotesCanvas } from '../field-notes-canvas';
import { useSelectionOps } from './use-selection-ops';
import type { UseSelectionOpsResult } from './use-selection-ops';
import { SelectTool, createNote } from '@fieldnotes/core';
import type { Viewport } from '@fieldnotes/core';

function setup(): { getResult: () => UseSelectionOpsResult; getVp: () => Viewport | null } {
  let result: UseSelectionOpsResult | null = null;
  let vp: Viewport | null = null;

  function Consumer() {
    result = useSelectionOps();
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

  return {
    getResult: () => {
      if (!result) throw new Error('hook result not captured');
      return result;
    },
    getVp: () => vp,
  };
}

function select(vp: Viewport | null, ids: string[]): void {
  act(() => {
    const sel = vp?.toolManager.getTool<SelectTool>('select');
    sel?.setSelection(ids);
  });
}

describe('useSelectionOps', () => {
  afterEach(cleanup);

  it('reports empty defaults with no selection', () => {
    const { getResult } = setup();
    const r = getResult();
    expect(r.selectedCount).toBe(0);
    expect(r.selectedIds).toEqual([]);
    expect(r.canGroup).toBe(false);
    expect(r.canUngroup).toBe(false);
    expect(r.canAlign).toBe(false);
    expect(r.canDistribute).toBe(false);
    expect(r.isLocked).toBeNull();
  });

  it('derives can-predicates from selection size', () => {
    const { getResult, getVp } = setup();
    const vp = getVp();

    const ids: string[] = [];
    act(() => {
      for (let i = 0; i < 3; i++) {
        const note = createNote({ position: { x: i * 100, y: 0 } });
        vp?.store.add(note);
        ids.push(note.id);
      }
    });

    select(vp, ids.slice(0, 2));
    let r = getResult();
    expect(r.selectedCount).toBe(2);
    expect(r.canGroup).toBe(true);
    expect(r.canAlign).toBe(true);
    expect(r.canDistribute).toBe(false);

    select(vp, ids);
    r = getResult();
    expect(r.selectedCount).toBe(3);
    expect(r.canDistribute).toBe(true);
  });

  it('group makes the selection ungroupable', () => {
    const { getResult, getVp } = setup();
    const vp = getVp();

    const ids: string[] = [];
    act(() => {
      for (let i = 0; i < 2; i++) {
        const note = createNote({ position: { x: i * 100, y: 0 } });
        vp?.store.add(note);
        ids.push(note.id);
      }
    });

    select(vp, ids);
    expect(getResult().canUngroup).toBe(false);

    act(() => {
      getResult().group();
    });

    expect(getResult().canUngroup).toBe(true);
  });

  it('toggleLock flips isLocked for the selection', () => {
    const { getResult, getVp } = setup();
    const vp = getVp();

    let noteId = '';
    act(() => {
      const note = createNote({ position: { x: 0, y: 0 } });
      vp?.store.add(note);
      noteId = note.id;
    });

    select(vp, [noteId]);
    expect(getResult().isLocked).toBe(false);

    act(() => {
      getResult().toggleLock();
    });
    expect(getResult().isLocked).toBe(true);

    act(() => {
      getResult().toggleLock();
    });
    expect(getResult().isLocked).toBe(false);
  });

  it('does not re-render when an unrelated store change leaves the selection unchanged', () => {
    let renders = 0;
    let result: UseSelectionOpsResult | null = null;
    let vp: Viewport | null = null;

    function Consumer() {
      renders++;
      result = useSelectionOps();
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

    const ids: string[] = [];
    act(() => {
      for (let i = 0; i < 2; i++) {
        const note = createNote({ position: { x: i * 100, y: 0 } });
        vp?.store.add(note);
        ids.push(note.id);
      }
    });
    select(vp, ids);
    expect(result?.selectedCount).toBe(2);

    const before = renders;
    act(() => {
      vp?.store.add(createNote({ position: { x: 999, y: 999 } }));
    });

    expect(renders - before).toBe(0);
    expect(result?.selectedCount).toBe(2);
    expect(result?.selectedIds).toEqual(ids);
  });

  it('align(left) snaps selected elements to the min x', () => {
    const { getResult, getVp } = setup();
    const vp = getVp();

    const ids: string[] = [];
    act(() => {
      const a = createNote({ position: { x: 50, y: 0 } });
      const b = createNote({ position: { x: 300, y: 0 } });
      vp?.store.add(a);
      vp?.store.add(b);
      ids.push(a.id, b.id);
    });

    select(vp, ids);
    act(() => {
      getResult().align('left');
    });

    const xs = ids.map((id) => vp?.store.getById(id)?.position.x);
    expect(xs[0]).toBe(50);
    expect(xs[1]).toBe(50);
  });
});
