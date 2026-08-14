import { getElementBounds } from '../elements/element-bounds';

import type { FrameScheduler } from './camera-animator';
import type { ElementStore } from '../elements/element-store';
import type { CanvasElement } from '../elements/types';

/** World-space rect of a tracked element, plus the host key it matched under. */
export interface ElementRect {
  id: string;
  /** Opaque host key echoed back from `match`. Core never interprets it. */
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Radians, clockwise, about the rect centre. 0 when the element has none. */
  rotation: number;
}

/** Returns an opaque key to track the element, or `null` to skip it. */
export type ElementRectMatch = (element: CanvasElement) => string | null;

export type ElementRectMatchError = (error: unknown, element: CanvasElement) => void;

/**
 * The tracker's per-frame computation, exported so consumers that need a
 * snapshot without a live tracker (e.g. a React `getSnapshot` before
 * subscription) cannot drift from these rules.
 */
export function computeElementRects(
  store: ElementStore,
  match: ElementRectMatch,
  onError?: ElementRectMatchError,
): ElementRect[] {
  const rects: ElementRect[] = [];
  for (const element of store.getAll()) {
    let key: string | null;
    try {
      key = match(element);
    } catch (error) {
      onError?.(error, element);
      continue;
    }
    if (typeof key !== 'string') continue;
    const bounds = getElementBounds(element);
    if (!bounds) continue;
    rects.push({
      id: element.id,
      key,
      x: bounds.x,
      y: bounds.y,
      w: bounds.w,
      h: bounds.h,
      rotation: element.rotation ?? 0,
    });
  }
  return rects;
}

/** Field-for-field comparison; `key` participates so identity changes emit. */
export function elementRectsEqual(a: readonly ElementRect[], b: readonly ElementRect[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const p = a[i];
    const q = b[i];
    if (!p || !q) return false;
    if (
      p.id !== q.id ||
      p.key !== q.key ||
      p.x !== q.x ||
      p.y !== q.y ||
      p.w !== q.w ||
      p.h !== q.h ||
      p.rotation !== q.rotation
    ) {
      return false;
    }
  }
  return true;
}

/** Narrow structural host: the tracker needs the element store and nothing else. */
export interface RectTrackerHost {
  store: ElementStore;
}

export interface ElementRectTrackerOptions {
  match: ElementRectMatch;
  /** Inseparable request/cancel pair. Defaults to global rAF. */
  frames?: FrameScheduler;
  onError?: ElementRectMatchError;
}

const defaultFrames: FrameScheduler = {
  requestFrame: (cb) => requestAnimationFrame(cb),
  cancelFrame: (id) => cancelAnimationFrame(id),
};

/**
 * Tracks the world rects of a host-matched subset of elements.
 *
 * Deliberately store-only: it never subscribes to the camera, so pan and zoom
 * emit nothing and hosts that position content under a single camera transform
 * (the SDK's own domLayer technique) do no per-frame work.
 */
export class ElementRectTracker {
  private readonly store: ElementStore;
  private readonly frames: FrameScheduler;
  private readonly onError?: ElementRectMatchError;
  private readonly listeners = new Set<(rects: readonly ElementRect[]) => void>();
  private readonly unsubscribe: () => void;
  private match: ElementRectMatch;
  private rects: ElementRect[];
  private frameId: number | null = null;
  private disposed = false;

  constructor(host: RectTrackerHost, options: ElementRectTrackerOptions) {
    this.store = host.store;
    this.match = options.match;
    this.frames = options.frames ?? defaultFrames;
    this.onError = options.onError;
    // Synchronous: getRects() is valid before any frame, and this snapshot is
    // the change baseline, so the first dirty frame cannot emit spuriously.
    this.rects = computeElementRects(this.store, this.match, this.onError);
    this.unsubscribe = this.store.onChange(() => this.schedule());
  }

  onChange(listener: (rects: readonly ElementRect[]) => void): () => void {
    if (this.disposed)
      return () => {
        // Disposed trackers hand back a stable no-op unsubscribe.
      };
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getRects(): readonly ElementRect[] {
    return this.rects;
  }

  /**
   * Replaces the matcher and forces a rescan — including when handed the same
   * reference, because callers legitimately pass one stable wrapper whose
   * behavior changes (see the React hook).
   */
  setMatch(match: ElementRectMatch): void {
    if (this.disposed) return;
    this.match = match;
    this.schedule();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    if (this.frameId !== null) {
      this.frames.cancelFrame(this.frameId);
      this.frameId = null;
    }
    this.listeners.clear();
  }

  private schedule(): void {
    if (this.disposed || this.frameId !== null) return;
    // `requestFrame` may invoke its callback synchronously (a test double, or
    // a host that treats "frame" as "next microtask"). When it does, the
    // callback already nulls `frameId` before `requestFrame` returns — so the
    // assignment below must not blindly overwrite that with the now-stale id,
    // or the tracker would believe a frame is forever pending and never
    // schedule another one.
    let ranSynchronously = false;
    const id = this.frames.requestFrame(() => {
      ranSynchronously = true;
      this.frameId = null;
      this.flush();
    });
    if (!ranSynchronously) {
      this.frameId = id;
    }
  }

  private flush(): void {
    if (this.disposed) return;
    const next = computeElementRects(this.store, this.match, this.onError);
    if (elementRectsEqual(this.rects, next)) return;
    this.rects = next;
    for (const listener of [...this.listeners]) {
      try {
        listener(this.rects);
      } catch {
        // Listener exceptions are isolated: one bad consumer never stops the rest.
      }
    }
  }
}
