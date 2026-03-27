import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { FieldNotesCanvas } from '../field-notes-canvas';
import { useHistory } from './use-history';
import type { Viewport } from '@fieldnotes/core';

describe('useHistory', () => {
  afterEach(cleanup);

  it('returns initial state with canUndo=false canRedo=false', () => {
    let canUndo = true;
    let canRedo = true;
    function Consumer() {
      const h = useHistory();
      canUndo = h.canUndo;
      canRedo = h.canRedo;
      return null;
    }

    render(
      <FieldNotesCanvas>
        <Consumer />
      </FieldNotesCanvas>,
    );
    expect(canUndo).toBe(false);
    expect(canRedo).toBe(false);
  });

  it('canUndo becomes true after a command is pushed', () => {
    let canUndo = false;
    let vp: Viewport | null = null;
    function Consumer() {
      const h = useHistory();
      canUndo = h.canUndo;
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
    expect(canUndo).toBe(false);

    act(() => {
      vp?.history.push({
        execute: (_store) => {
          return;
        },
        undo: (_store) => {
          return;
        },
      });
    });
    expect(canUndo).toBe(true);
  });

  it('undo and redo update state', () => {
    let canUndo = false;
    let canRedo = false;
    let undo: (() => void) | null = null;
    let redo: (() => void) | null = null;
    let vp: Viewport | null = null;
    function Consumer() {
      const h = useHistory();
      canUndo = h.canUndo;
      canRedo = h.canRedo;
      undo = h.undo;
      redo = h.redo;
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
      vp?.history.push({
        execute: (_store) => {
          return;
        },
        undo: (_store) => {
          return;
        },
      });
    });
    expect(canUndo).toBe(true);
    expect(canRedo).toBe(false);

    act(() => {
      undo?.();
    });
    expect(canUndo).toBe(false);
    expect(canRedo).toBe(true);

    act(() => {
      redo?.();
    });
    expect(canUndo).toBe(true);
    expect(canRedo).toBe(false);
  });
});
