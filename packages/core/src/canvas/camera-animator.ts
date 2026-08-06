import type { Camera } from './camera';
import { applyCameraView, assertCanvasDims, assertValidView, type CameraView } from './camera-view';

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
    // `element` is not touched in this task; input listeners (drag/wheel
    // arbitration against a running animation) attach to it in Task 4.
    void element;
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
    this.rafId = this.frames.requestFrame(this.step);
  }

  jumpTo(view: CameraView): void {
    const size = this.validateAndMeasure(view);
    const generation = ++this.generation;
    this.end('superseded');
    if (this.generation !== generation) return; // nested operation owns us now
    applyCameraView(this.camera, view, size.w, size.h);
  }

  cancel(): void {
    this.end('cancelled');
  }

  dispose(): void {
    this.end('cancelled');
    this.endListeners.clear();
  }

  /**
   * Shared prologue for `animateTo`/`jumpTo`. Validates the target
   * SYNCHRONOUSLY before touching any animation state, so an invalid input
   * throws from the public call without writing, scheduling, or terminating a
   * running animation.
   */
  private validateAndMeasure(view: CameraView): { w: number; h: number } {
    assertValidView(view);
    const size = this.getCanvasSize();
    assertCanvasDims(size.w, size.h);
    return size;
  }

  private step = (): void => {
    if (this.to === null || this.from === null) return;
    const size = this.getCanvasSize();
    const elapsed = this.now() - this.startedAt;
    const t = this.durationMs <= 0 ? 1 : Math.min(1, elapsed / this.durationMs);
    const view = lerpView(this.from, this.to, this.easing(t));
    applyCameraView(this.camera, view, size.w, size.h);

    if (t >= 1) {
      this.end('complete');
      return;
    }
    this.rafId = this.frames.requestFrame(this.step);
  };

  /** Terminates an in-flight animation with `reason`. No-op when idle. */
  private end(reason: CameraAnimationEndReason): void {
    if (this.to === null) return;
    this.clearFrame();
    this.from = null;
    this.to = null;
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
