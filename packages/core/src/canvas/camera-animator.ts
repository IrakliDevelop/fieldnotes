import type { Camera } from './camera';
import {
  applyCameraView,
  assertCanvasDims,
  assertValidView,
  canvasDimsUsable,
  type CameraView,
} from './camera-view';

/** A scheduler and its matching canceller. Inseparable by construction. */
export interface FrameScheduler {
  requestFrame: (cb: () => void) => number;
  cancelFrame: (id: number) => void;
}

export interface CameraAnimatorOptions {
  /** REQUIRED. `element` is used for input listeners only, never measurement. */
  getCanvasSize: () => { w: number; h: number };
  durationMs?: number;
  easing?: (t: number) => number;
  interactive?: boolean;
  frames?: FrameScheduler;
  now?: () => number;
}

export type CameraAnimationEndReason = 'complete' | 'cancelled' | 'superseded';

const DEFAULT_DURATION_MS = 400;
const FRAMED_EPSILON = 1e-6;

const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k;
}

function lerpView(from: CameraView, to: CameraView, k: number): CameraView {
  return {
    x: lerp(from.x, to.x, k),
    y: lerp(from.y, to.y, k),
    w: lerp(from.w, to.w, k),
    h: lerp(from.h, to.h, k),
  };
}

function viewsClose(a: CameraView, b: CameraView): boolean {
  return (
    Math.abs(a.x - b.x) < FRAMED_EPSILON &&
    Math.abs(a.y - b.y) < FRAMED_EPSILON &&
    Math.abs(a.w - b.w) < FRAMED_EPSILON &&
    Math.abs(a.h - b.h) < FRAMED_EPSILON
  );
}

/**
 * Animates a camera to a `CameraView`. Standalone controller in the
 * `PingInput`/`MinimapController` shape: the host owns construction and
 * disposal, and every timing dependency is injectable for deterministic tests.
 */
export class CameraAnimator {
  private readonly camera: Camera;
  private readonly getCanvasSize: () => { w: number; h: number };
  private readonly frames: FrameScheduler;
  private readonly now: () => number;
  private readonly durationMs: number;
  private readonly easing: (t: number) => number;

  private rafId: number | null = null;
  private from: CameraView | null = null;
  private to: CameraView | null = null;
  private startedAt = 0;
  private endListeners = new Set<(reason: CameraAnimationEndReason) => void>();
  /**
   * Monotonic operation counter. `animateTo`/`jumpTo` claim a generation
   * before emitting 'superseded'; if an onEnd listener starts a newer
   * operation during that emit, the outer call sees a bumped counter and
   * bails instead of overwriting the nested animation's state. Without this,
   * the nested animation would run to completion having never reported an end
   * reason, breaking the exactly-one guarantee the spec makes.
   */
  private generation = 0;

  private lastWrite: { x: number; y: number; zoom: number } | null = null;
  private disposed = false;
  private detachListeners: (() => void) | null = null;

  constructor(element: HTMLElement, camera: Camera, options: CameraAnimatorOptions) {
    if (options.frames !== undefined) {
      const { requestFrame, cancelFrame } = options.frames;
      if (typeof requestFrame !== 'function' || typeof cancelFrame !== 'function') {
        throw new Error(
          '[fieldnotes] CameraAnimator: `frames` must supply both requestFrame and cancelFrame',
        );
      }
    }
    this.camera = camera;
    this.getCanvasSize = options.getCanvasSize;
    this.frames = options.frames ?? {
      requestFrame: (cb) => requestAnimationFrame(cb),
      cancelFrame: (id) => cancelAnimationFrame(id),
    };
    this.now = options.now ?? (() => performance.now());
    this.durationMs = options.durationMs ?? DEFAULT_DURATION_MS;
    this.easing = options.easing ?? easeOutCubic;

    if (options.interactive ?? true) {
      const onUserInput = (): void => {
        this.end('cancelled');
      };
      const types = ['pointerdown', 'wheel', 'keydown'] as const;
      for (const type of types) {
        element.addEventListener(type, onUserInput, { passive: true });
      }
      this.detachListeners = () => {
        for (const type of types) {
          element.removeEventListener(type, onUserInput);
        }
      };
    }
  }

  get animating(): boolean {
    return this.to !== null;
  }

  onEnd(listener: (reason: CameraAnimationEndReason) => void): () => void {
    this.endListeners.add(listener);
    return () => this.endListeners.delete(listener);
  }

  animateTo(view: CameraView): void {
    const size = this.validateAndMeasure(view);
    if (size === null) return;

    const current = this.camera.getVisibleRect(size.w, size.h);
    const generation = ++this.generation;
    this.end('superseded');
    // An onEnd listener may have started a newer operation during that
    // 'superseded' emit. It now owns the animator; overwriting its state here
    // would leave it running with no end reason ever reported.
    if (this.generation !== generation) return;

    if (viewsClose(current, view)) {
      applyCameraView(this.camera, view, size.w, size.h);
      this.emit('complete');
      return;
    }

    this.from = current;
    this.to = view;
    this.startedAt = this.now();
    this.lastWrite = null;
    this.rafId = this.frames.requestFrame(this.step);
  }

  jumpTo(view: CameraView): void {
    const size = this.validateAndMeasure(view);
    if (size === null) return;
    const generation = ++this.generation;
    this.end('superseded');
    if (this.generation !== generation) return; // nested operation owns us now
    applyCameraView(this.camera, view, size.w, size.h);
    this.lastWrite = null;
  }

  cancel(): void {
    if (this.disposed) return;
    this.end('cancelled');
  }

  /**
   * Terminal. Order is load-bearing: the flag is set BEFORE any listener runs,
   * because an onEnd listener can call animateTo during the disposal callback.
   * With the flag set last, that call would start a real animation which the
   * listener clear then silently discards — a second animation with no end
   * reason, breaking the exactly-one guarantee.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    const wasAnimating = this.to !== null;
    this.clearFrame();
    this.from = null;
    this.to = null;
    this.lastWrite = null;

    if (wasAnimating) this.emit('cancelled');

    this.endListeners.clear();
    this.detachListeners?.();
    this.detachListeners = null;
  }

  /**
   * Steps 1-3 of the public-call contract. Returns null when the caller must
   * stop, having already handled termination.
   *
   * The disposed check precedes validation deliberately: ordering it after
   * would make `disposed.animateTo(invalidView)` both required to throw and
   * required to stay silent. Disposal wins — a terminal animator is inert for
   * every input, and post-disposal calls are exactly the racy teardown paths
   * where a throw is least useful.
   */
  private validateAndMeasure(view: CameraView): { w: number; h: number } | null {
    if (this.disposed) return null;
    assertValidView(view);
    const size = this.getCanvasSize();
    // Validate the MEASUREMENT too, not just the target. A negative or
    // non-finite dimension would otherwise reach camera.getVisibleRect()
    // before applyCameraView could reject it, and NaN propagates through
    // Camera.setZoom's Math.min/Math.max clamp to poison the camera
    // permanently. Throws synchronously here, where the caller can catch it.
    assertCanvasDims(size.w, size.h);
    if (size.w === 0 || size.h === 0) {
      // A valid target meeting a zero size cancels any running animation
      // synchronously within this call, so `animating` is false the instant it
      // returns. 'cancelled', never 'superseded': the animation was ended by
      // the host becoming unmeasurable, not replaced by a running successor.
      this.end('cancelled');
      return null;
    }
    return size;
  }

  private step = (): void => {
    if (this.disposed || this.to === null || this.from === null) return;

    // Foreign-write guard: if the camera no longer matches what this animator
    // last wrote, another writer moved it — drag, pinch, wheel, keyboard zoom,
    // a PanInertia coast frame, a minimap tap, fitToContent, or loadState.
    if (this.foreignWrite()) {
      this.end('cancelled');
      return;
    }

    const size = this.getCanvasSize();
    if (!canvasDimsUsable(size.w, size.h)) {
      // A poisoned measurement mid-flight TERMINATES rather than throws.
      // Throwing from inside a frame callback has no catcher and would strand
      // the animation state with its lifecycle unresolved — the exact orphan
      // this contract exists to prevent. Public calls still throw, because
      // there a caller can handle it.
      this.end('cancelled');
      return;
    }
    if (size.w === 0 || size.h === 0) {
      // The clock keeps advancing while a host is hidden, so without this the
      // animation would reach t=1, write nothing, and report a false 'complete'.
      this.end('cancelled');
      return;
    }

    const elapsed = this.now() - this.startedAt;
    const t = this.durationMs <= 0 ? 1 : Math.min(1, elapsed / this.durationMs);
    const view = lerpView(this.from, this.to, this.easing(t));
    applyCameraView(this.camera, view, size.w, size.h);
    this.recordWrite();

    if (t >= 1) {
      this.end('complete');
      return;
    }
    this.rafId = this.frames.requestFrame(this.step);
  };

  private recordWrite(): void {
    this.lastWrite = {
      x: this.camera.position.x,
      y: this.camera.position.y,
      zoom: this.camera.zoom,
    };
  }

  private foreignWrite(): boolean {
    if (this.lastWrite === null) return false;
    const eps = 1e-6;
    return (
      Math.abs(this.camera.position.x - this.lastWrite.x) > eps ||
      Math.abs(this.camera.position.y - this.lastWrite.y) > eps ||
      Math.abs(this.camera.zoom - this.lastWrite.zoom) > eps
    );
  }

  /** Terminates an in-flight animation with `reason`. No-op when idle. */
  private end(reason: CameraAnimationEndReason): void {
    if (this.disposed || this.to === null) return;
    this.clearFrame();
    this.from = null;
    this.to = null;
    this.lastWrite = null;
    this.emit(reason);
  }

  private clearFrame(): void {
    if (this.rafId !== null) {
      this.frames.cancelFrame(this.rafId);
      this.rafId = null;
    }
  }

  private emit(reason: CameraAnimationEndReason): void {
    for (const listener of [...this.endListeners]) {
      try {
        listener(reason);
      } catch {
        // Listener faults must never wedge the animator.
      }
    }
  }
}
