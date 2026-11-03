import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook } from '@testing-library/react';
import { StrictMode, useEffect, type ReactNode } from 'react';
import { CameraAnimator } from '@fieldnotes/core';
import { ViewportContext } from '../context';
import { FieldNotesCanvas } from '../field-notes-canvas';
import { createTestViewport, destroyTestViewports } from '../test-utils/create-test-viewport';
import { useCameraControls } from './use-camera-controls';

function withViewport(viewport: ReturnType<typeof createTestViewport>) {
  return function ViewportProvider({ children }: { children: ReactNode }) {
    return <ViewportContext.Provider value={viewport}>{children}</ViewportContext.Provider>;
  };
}

function setCanvasSize(viewport: ReturnType<typeof createTestViewport>): void {
  const canvas = viewport.domLayer.parentElement?.querySelector('canvas');
  if (!canvas) throw new Error('Viewport canvas missing');
  Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: 200 });
  Object.defineProperty(canvas, 'clientHeight', { configurable: true, value: 100 });
}

describe('useCameraControls', () => {
  afterEach(() => {
    destroyTestViewports();
    vi.restoreAllMocks();
  });

  it('sets zoom, moves, and centers the camera', () => {
    const viewport = createTestViewport();
    setCanvasSize(viewport);
    const { result } = renderHook(useCameraControls, { wrapper: withViewport(viewport) });

    act(() => {
      result.current.setZoom(2);
      result.current.moveTo(10, 20);
    });
    expect(viewport.camera.zoom).toBe(2);
    expect(viewport.camera.position).toEqual({ x: 10, y: 20 });

    act(() => result.current.centerAt({ x: 50, y: 50 }));
    expect(viewport.camera.position).toEqual({ x: 0, y: -50 });
  });

  it('captures the visible rect', () => {
    const viewport = createTestViewport();
    setCanvasSize(viewport);
    const { result } = renderHook(useCameraControls, { wrapper: withViewport(viewport) });

    expect(result.current.captureView()).toEqual({ x: 0, y: 0, w: 200, h: 100 });
  });

  it('builds one animator and disposes it on unmount', () => {
    const viewport = createTestViewport();
    setCanvasSize(viewport);
    const animateTo = vi.spyOn(CameraAnimator.prototype, 'animateTo');
    const dispose = vi.spyOn(CameraAnimator.prototype, 'dispose');
    const { result, unmount } = renderHook(useCameraControls, { wrapper: withViewport(viewport) });

    act(() => {
      result.current.animateTo({ x: 0, y: 0, w: 100, h: 50 });
      result.current.animateTo({ x: 10, y: 20, w: 100, h: 50 });
    });

    expect(animateTo).toHaveBeenCalledTimes(2);
    expect(new Set(animateTo.mock.contexts).size).toBe(1);
    unmount();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('uses a live animator after a StrictMode rehearsal', () => {
    const viewport = createTestViewport();
    setCanvasSize(viewport);
    const dispose = vi.spyOn(CameraAnimator.prototype, 'dispose');
    const { result, unmount } = renderHook(useCameraControls, {
      wrapper: ({ children }) => <StrictMode>{withViewport(viewport)({ children })}</StrictMode>,
    });

    act(() => result.current.animateTo({ x: 0, y: 0, w: 100, h: 50 }));
    expect(dispose).not.toHaveBeenCalled();
    unmount();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('does not throw when the canvas unmounts after animation', () => {
    const dispose = vi.spyOn(CameraAnimator.prototype, 'dispose');
    function Consumer() {
      const { animateTo } = useCameraControls();
      useEffect(() => {
        animateTo({ x: 0, y: 0, w: 100, h: 50 });
      }, [animateTo]);
      return null;
    }

    const { unmount } = render(
      <FieldNotesCanvas>
        <Consumer />
      </FieldNotesCanvas>,
    );

    expect(() => unmount()).not.toThrow();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
