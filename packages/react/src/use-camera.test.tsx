import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { FieldNotesCanvas } from './field-notes-canvas';
import { useCamera } from './use-camera';
import type { Viewport } from '@fieldnotes/core';

describe('useCamera', () => {
  afterEach(cleanup);

  it('returns initial camera state', () => {
    let state = { x: -1, y: -1, zoom: -1 };
    function Consumer() {
      state = useCamera();
      return null;
    }
    render(
      <FieldNotesCanvas>
        <Consumer />
      </FieldNotesCanvas>,
    );
    expect(state.x).toBe(0);
    expect(state.y).toBe(0);
    expect(state.zoom).toBe(1);
  });

  it('updates when camera pans', () => {
    let state = { x: 0, y: 0, zoom: 1 };
    let vp: Viewport | null = null;
    function Consumer() {
      state = useCamera();
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
      vp?.camera.pan(100, 50);
    });
    expect(state.x).toBe(100);
    expect(state.y).toBe(50);
  });

  it('updates when camera zooms', () => {
    let state = { x: 0, y: 0, zoom: 1 };
    let vp: Viewport | null = null;
    function Consumer() {
      state = useCamera();
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
      vp?.camera.setZoom(2);
    });
    expect(state.zoom).toBe(2);
  });
});
