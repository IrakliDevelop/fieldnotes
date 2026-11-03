import { useCallback, useEffect, useMemo, useRef } from 'react';
import { CameraAnimator, captureCameraView } from '@fieldnotes/core';
import type { CameraView, Point } from '@fieldnotes/core';
import { useViewport } from './use-viewport';

/** Stable controls for the viewport camera. */
export interface UseCameraControlsResult {
  pan(dx: number, dy: number): void;
  moveTo(x: number, y: number): void;
  setZoom(level: number): void;
  zoomAt(level: number, screenPoint: Point): void;
  centerAt(world: Point): void;
  fitToContent(padding?: number): void;
  captureView(): CameraView;
  animateTo(view: CameraView): void;
}

/** Controls the current viewport camera. */
export function useCameraControls(): UseCameraControlsResult {
  const viewport = useViewport();
  const animatorRef = useRef<CameraAnimator | null>(null);

  useEffect(() => {
    return () => {
      animatorRef.current?.dispose();
      animatorRef.current = null;
    };
  }, [viewport]);

  const pan = useCallback((dx: number, dy: number) => viewport.camera.pan(dx, dy), [viewport]);
  const moveTo = useCallback((x: number, y: number) => viewport.camera.moveTo(x, y), [viewport]);
  const setZoom = useCallback((level: number) => viewport.camera.setZoom(level), [viewport]);
  const zoomAt = useCallback(
    (level: number, screenPoint: Point) => viewport.camera.zoomAt(level, screenPoint),
    [viewport],
  );
  const centerAt = useCallback((world: Point) => viewport.centerCameraAt(world), [viewport]);
  const fitToContent = useCallback(
    (padding?: number) => viewport.fitToContent(padding),
    [viewport],
  );
  const captureView = useCallback(() => captureCameraView(viewport), [viewport]);
  const animateTo = useCallback(
    (view: CameraView) => {
      const wrapper = viewport.domLayer.parentElement ?? viewport.domLayer;
      animatorRef.current ??= new CameraAnimator(wrapper, viewport.camera, {
        getCanvasSize: () => viewport.getCanvasSize(),
      });
      animatorRef.current.animateTo(view);
    },
    [viewport],
  );

  return useMemo(
    () => ({ pan, moveTo, setZoom, zoomAt, centerAt, fitToContent, captureView, animateTo }),
    [pan, moveTo, setZoom, zoomAt, centerAt, fitToContent, captureView, animateTo],
  );
}
