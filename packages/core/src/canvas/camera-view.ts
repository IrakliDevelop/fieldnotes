import type { Point } from '../core/types';
import type { Camera } from './camera';

/**
 * A viewport-size-independent camera view: the world rectangle to frame.
 * Restored by contain-fit, so the same view frames the same world content on
 * any screen size or aspect — a DM's saved zone looks right on a phone and a
 * TV. Center+zoom would NOT have this property.
 */
export interface CameraView {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function assertValidView(view: CameraView): void {
  const { x, y, w, h } = view;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) {
    throw new Error('[fieldnotes] CameraView requires finite x, y, w, and h');
  }
  if (w <= 0 || h <= 0) {
    throw new Error('[fieldnotes] CameraView requires positive w and h');
  }
}

/**
 * Rejects dimensions that would poison the camera. Zero is NOT rejected here:
 * callers decide, because a zero-size canvas is a legitimate transient (an
 * unmounted or `display: none` host reports 0) while a negative or non-finite
 * dimension is always a bug or a poisoned measurement.
 */
export function assertCanvasDims(canvasW: number, canvasH: number): void {
  if (!Number.isFinite(canvasW) || !Number.isFinite(canvasH)) {
    throw new Error('[fieldnotes] canvas dimensions must be finite');
  }
  if (canvasW < 0 || canvasH < 0) {
    throw new Error('[fieldnotes] canvas dimensions must not be negative');
  }
}

/**
 * Non-throwing companion to `assertCanvasDims`, for call sites that cannot
 * throw (the per-frame animation path) and must instead resolve a zero-size
 * canvas into a clean lifecycle outcome. Zero IS accepted here — see
 * `assertCanvasDims` for why zero is a legitimate transient rather than a bug.
 */
export function canvasDimsUsable(canvasW: number, canvasH: number): boolean {
  return Number.isFinite(canvasW) && Number.isFinite(canvasH) && canvasW >= 0 && canvasH >= 0;
}

/** Captures the currently visible world rect. */
export function captureCameraView(viewport: {
  getVisibleRect(): { x: number; y: number; w: number; h: number };
}): CameraView {
  const rect = viewport.getVisibleRect();
  return { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
}

/**
 * Unclamped contain-fit zoom: the largest zoom at which the whole rect fits.
 * Contain, never crop — a view whose aspect differs from the canvas shows
 * extra world content on the short axis.
 */
export function fitZoomForView(view: CameraView, canvasW: number, canvasH: number): number {
  assertValidView(view);
  assertCanvasDims(canvasW, canvasH);
  if (canvasW === 0 || canvasH === 0) {
    throw new Error('[fieldnotes] fitZoomForView requires a non-zero canvas size');
  }
  return Math.min(canvasW / view.w, canvasH / view.h);
}

/** Camera origin that centers `view` on the canvas at an already-decided zoom. */
export function cameraOriginForView(
  view: CameraView,
  zoom: number,
  canvasW: number,
  canvasH: number,
): Point {
  return {
    x: canvasW / 2 - (view.x + view.w / 2) * zoom,
    y: canvasH / 2 - (view.y + view.h / 2) * zoom,
  };
}

/**
 * Writes `view` to `camera`. No-ops on a zero canvas dimension (mount and
 * visibility races are legitimate); throws on an invalid view or on negative
 * or non-finite dimensions.
 */
export function applyCameraView(
  camera: Camera,
  view: CameraView,
  canvasW: number,
  canvasH: number,
): void {
  assertValidView(view);
  assertCanvasDims(canvasW, canvasH);
  if (canvasW === 0 || canvasH === 0) return;

  camera.setZoom(fitZoomForView(view, canvasW, canvasH));
  // Read the zoom BACK: when the fit zoom exceeds the camera's private clamp,
  // centering must use the value the camera accepted or the view lands
  // off-center. `Camera.moveTo` takes two numbers, not a Point.
  const origin = cameraOriginForView(view, camera.zoom, canvasW, canvasH);
  camera.moveTo(origin.x, origin.y);
}
