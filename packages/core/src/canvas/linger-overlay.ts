import type { OverlayRenderer } from './render-loop';

/** The two viewport capabilities the overlay needs; `Viewport` satisfies it. */
export interface LingerOverlayHost {
  registerOverlay(draw: OverlayRenderer): () => void;
  requestRender(): void;
}

export interface LingerOverlayOptions {
  /** Full-opacity hold once an entry starts lingering. Default `1500`. */
  holdMs?: number;
  /** Linear fade to 0 after the hold. Default `400`. */
  fadeMs?: number;
  /** Stale active entries start lingering after this. Default `30000`. */
  maxAgeMs?: number;
}

/**
 * Draws one entry for the overlay. The overlay does NOT wrap the call in
 * `save`/`restore` — the callback owns the context state it touches. `alpha` is
 * normally in `(0, 1]`, but is exactly `0` on the single frame where the fade
 * completes. Invoked as a method of the overlay, once per visible entry per
 * frame.
 */
export type LingerDraw<T> = (ctx: CanvasRenderingContext2D, entry: T, alpha: number) => void;

interface LingerEntry<T> {
  entry: T;
  /** Local receive time of the linger start; `null` while active. */
  clearedAt: number | null;
  expiryTimer: ReturnType<typeof setTimeout> | null;
}

const DEFAULT_HOLD_MS = 1500;
const DEFAULT_FADE_MS = 400;
const DEFAULT_MAX_AGE_MS = 30_000;

/**
 * Per-sender presence entries with a hold-then-fade lifetime, rendered through
 * the viewport overlay registration and independent of the viewer's active
 * tool. Entries are stamped with local time (remote clocks are never trusted).
 * `linger` holds the final entry for `holdMs`, fades it over `fadeMs`, and
 * deletes it; `remove` deletes immediately. An active entry not updated for
 * `maxAgeMs` is lingered by a timer — an idle map never renders, so expiry
 * cannot ride on the draw path. The overlay never touches elements, history,
 * or persisted state, and never moves the viewer's camera.
 *
 * Internal to `@fieldnotes/core`: not exported from `src/index.ts`.
 */
export class LingerOverlay<T> {
  private readonly host: LingerOverlayHost;
  private readonly draw: LingerDraw<T>;
  private readonly clock: () => number;
  private readonly holdMs: number;
  private readonly fadeMs: number;
  private readonly maxAgeMs: number;
  private readonly entries = new Map<string, LingerEntry<T>>();
  private unregister: (() => void) | null;
  private rafId: number | null = null;
  private isDisposed = false;

  /**
   * `clock` exists only as a test seam; production callers leave it at
   * `performance.now`. Owners that expose their own `now()` seam pass it
   * through so a spy on the owner still drives this overlay's timing.
   */
  constructor(
    host: LingerOverlayHost,
    options: LingerOverlayOptions,
    draw: LingerDraw<T>,
    clock: () => number = () => performance.now(),
  ) {
    this.host = host;
    this.draw = draw;
    this.clock = clock;
    this.holdMs = options.holdMs ?? DEFAULT_HOLD_MS;
    this.fadeMs = options.fadeMs ?? DEFAULT_FADE_MS;
    this.maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    this.unregister = host.registerOverlay((ctx) => this.render(ctx));
  }

  private now(): number {
    return this.clock();
  }

  /**
   * Stores `sender`'s current entry as active, replacing any previous one and
   * cancelling an in-flight linger, and restarts the `maxAgeMs` expiry timer.
   */
  set(sender: string, entry: T): void {
    if (this.isDisposed) return;
    const existing = this.entries.get(sender);
    if (existing?.expiryTimer != null) clearTimeout(existing.expiryTimer);
    this.entries.set(sender, {
      entry,
      clearedAt: null,
      expiryTimer: setTimeout(() => this.linger(sender), this.maxAgeMs),
    });
    this.host.requestRender();
  }

  /** Starts the hold-then-fade lifetime for `sender`'s entry. */
  linger(sender: string): void {
    const entry = this.entries.get(sender);
    if (!entry || entry.clearedAt !== null) return;
    if (entry.expiryTimer != null) {
      clearTimeout(entry.expiryTimer);
      entry.expiryTimer = null;
    }
    entry.clearedAt = this.now();
    this.ensureAnimating();
    this.host.requestRender();
  }

  /** Removes a sender's entry immediately (presence-leave/disconnect). */
  remove(sender: string): void {
    const entry = this.entries.get(sender);
    if (!entry) return;
    if (entry.expiryTimer != null) clearTimeout(entry.expiryTimer);
    this.entries.delete(sender);
    this.host.requestRender();
  }

  /** Removes every entry immediately. */
  clear(): void {
    if (this.entries.size === 0) return;
    for (const entry of this.entries.values()) {
      if (entry.expiryTimer != null) clearTimeout(entry.expiryTimer);
    }
    this.entries.clear();
    this.host.requestRender();
  }

  /** Number of senders with a visible (active or lingering) entry. */
  get activeSenderCount(): number {
    return this.entries.size;
  }

  /** True once `dispose` has run; the overlay accepts no further entries. */
  get disposed(): boolean {
    return this.isDisposed;
  }

  /** Unregisters the overlay, cancels timers, stops animating. Idempotent. */
  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    for (const entry of this.entries.values()) {
      if (entry.expiryTimer != null) clearTimeout(entry.expiryTimer);
    }
    this.entries.clear();
    this.unregister?.();
    this.unregister = null;
    this.host.requestRender();
  }

  private ensureAnimating(): void {
    if (this.rafId === null) {
      this.rafId = requestAnimationFrame(() => this.tick());
    }
  }

  private tick(): void {
    if (this.isDisposed) return;
    const now = this.now();
    let lingering = 0;
    for (const [sender, entry] of this.entries) {
      if (entry.clearedAt === null) continue;
      if (now - entry.clearedAt >= this.holdMs + this.fadeMs) {
        this.entries.delete(sender);
      } else {
        lingering += 1;
      }
    }
    this.host.requestRender();
    this.rafId = lingering > 0 ? requestAnimationFrame(() => this.tick()) : null;
  }

  private render(ctx: CanvasRenderingContext2D): void {
    if (this.entries.size === 0) return;
    const now = this.now();
    for (const entry of this.entries.values()) {
      let alpha = 1;
      if (entry.clearedAt !== null) {
        const fadeAge = now - entry.clearedAt - this.holdMs;
        if (fadeAge > 0) alpha = Math.max(0, 1 - fadeAge / this.fadeMs);
      }
      this.draw(ctx, entry.entry, alpha);
    }
  }
}
