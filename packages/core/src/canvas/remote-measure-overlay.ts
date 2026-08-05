import type { Point } from '../core/types';
import type { MeasureEmission } from '../tools/measure-tool';
import type { OverlayRenderer } from './render-loop';
import { drawMeasurement } from './measure-render';

/**
 * The wire shape of a shared-ruler presence payload. Presence data is untyped
 * on the wire, so hosts discriminate on `kind`; `isMeasurePresence` validates
 * a received payload before it reaches the overlay. Distance is
 * sender-authoritative: receivers render the payload's `feet`/`cells` and
 * never recompute from their own grid. Measurements are ephemeral by
 * contract: presence only — never elements, undo history, persisted canvas
 * state, or durable operations.
 */
export type MeasurePresence =
  | {
      readonly kind: 'measure';
      readonly start: Point;
      readonly end: Point;
      readonly cells: number;
      readonly feet: number;
      readonly color?: string;
    }
  | { readonly kind: 'measure'; readonly cleared: true };

export const MEASURE_PRESENCE_KIND = 'measure';

function isFinitePoint(value: unknown): value is Point {
  if (typeof value !== 'object' || value === null) return false;
  const point = value as { x?: unknown; y?: unknown };
  return (
    typeof point.x === 'number' &&
    Number.isFinite(point.x) &&
    typeof point.y === 'number' &&
    Number.isFinite(point.y)
  );
}

export function isMeasurePresence(data: unknown): data is MeasurePresence {
  if (typeof data !== 'object' || data === null) return false;
  const payload = data as {
    kind?: unknown;
    cleared?: unknown;
    start?: unknown;
    end?: unknown;
    cells?: unknown;
    feet?: unknown;
    color?: unknown;
  };
  if (payload.kind !== MEASURE_PRESENCE_KIND) return false;
  if ('cleared' in payload) return payload.cleared === true;
  if (!isFinitePoint(payload.start) || !isFinitePoint(payload.end)) return false;
  if (typeof payload.cells !== 'number' || !Number.isFinite(payload.cells)) return false;
  if (typeof payload.feet !== 'number' || !Number.isFinite(payload.feet)) return false;
  if (payload.color !== undefined && typeof payload.color !== 'string') return false;
  return true;
}

/** Builds the presence payload for one local `MeasureTool` emission. */
export function toMeasurePresence(emission: MeasureEmission | null): MeasurePresence {
  if (emission === null) return { kind: MEASURE_PRESENCE_KIND, cleared: true };
  return {
    kind: MEASURE_PRESENCE_KIND,
    start: emission.start,
    end: emission.end,
    cells: emission.cells,
    feet: emission.feet,
    color: emission.color,
  };
}

/** The two viewport capabilities the overlay needs; `Viewport` satisfies it. */
export interface RemoteMeasureOverlayHost {
  registerOverlay(draw: OverlayRenderer): () => void;
  requestRender(): void;
}

export interface RemoteMeasureOverlayOptions {
  /** Style fallback when a payload omits `color`. Default `'#FF5722'`. */
  color?: string;
  /** Full-opacity hold after a cleared payload. Default `1500`. */
  holdMs?: number;
  /** Linear fade to 0 after the hold. Default `400`. */
  fadeMs?: number;
  /** Stale active entries are treated as cleared after this. Default `30000`. */
  maxAgeMs?: number;
}

interface RemoteMeasurement {
  start: Point;
  end: Point;
  feet: number;
  color: string;
  /** Local receive time of the linger start; `null` while active. */
  clearedAt: number | null;
  expiryTimer: ReturnType<typeof setTimeout> | null;
}

const DEFAULT_COLOR = '#FF5722';
const DEFAULT_HOLD_MS = 1500;
const DEFAULT_FADE_MS = 400;
const DEFAULT_MAX_AGE_MS = 30_000;

/**
 * Renders remote shared-ruler measurements through the viewport overlay
 * registration, independent of the viewer's active tool. Entries are stamped
 * with local receive time (remote clocks are never trusted). A cleared
 * payload holds the final measurement for `holdMs`, fades over `fadeMs`, and
 * deletes; presence-leave (`remove`) deletes immediately. An active entry not
 * updated for `maxAgeMs` is expired by a timer — an idle map never renders,
 * so expiry cannot ride on the draw path. The overlay never touches elements,
 * history, or persisted state, and never moves the viewer's camera.
 */
export class RemoteMeasureOverlay {
  private readonly host: RemoteMeasureOverlayHost;
  private readonly color: string;
  private readonly holdMs: number;
  private readonly fadeMs: number;
  private readonly maxAgeMs: number;
  private readonly measurements = new Map<string, RemoteMeasurement>();
  private unregister: (() => void) | null;
  private rafId: number | null = null;
  private disposed = false;

  constructor(host: RemoteMeasureOverlayHost, options: RemoteMeasureOverlayOptions = {}) {
    this.host = host;
    this.color = options.color ?? DEFAULT_COLOR;
    this.holdMs = options.holdMs ?? DEFAULT_HOLD_MS;
    this.fadeMs = options.fadeMs ?? DEFAULT_FADE_MS;
    this.maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    this.unregister = host.registerOverlay((ctx) => this.renderMeasurements(ctx));
  }

  private now(): number {
    return performance.now();
  }

  /**
   * Applies a presence payload from `sender` (any opaque per-sender key, e.g.
   * the envelope `from`). Non-measure or malformed payloads are ignored and
   * reported as `false`, so hosts can feed every presence frame through.
   */
  apply(sender: string, data: unknown): boolean {
    if (this.disposed || !isMeasurePresence(data)) return false;
    if ('cleared' in data) {
      this.beginLinger(sender);
      return true;
    }
    const existing = this.measurements.get(sender);
    if (existing?.expiryTimer != null) clearTimeout(existing.expiryTimer);
    this.measurements.set(sender, {
      start: data.start,
      end: data.end,
      feet: data.feet,
      color: data.color ?? this.color,
      clearedAt: null,
      expiryTimer: setTimeout(() => this.beginLinger(sender), this.maxAgeMs),
    });
    this.host.requestRender();
    return true;
  }

  /** Removes a sender's ruler immediately (presence-leave/disconnect). */
  remove(sender: string): void {
    const entry = this.measurements.get(sender);
    if (!entry) return;
    if (entry.expiryTimer != null) clearTimeout(entry.expiryTimer);
    this.measurements.delete(sender);
    this.host.requestRender();
  }

  /** Removes every ruler immediately. */
  clear(): void {
    if (this.measurements.size === 0) return;
    for (const entry of this.measurements.values()) {
      if (entry.expiryTimer != null) clearTimeout(entry.expiryTimer);
    }
    this.measurements.clear();
    this.host.requestRender();
  }

  /** Number of senders with a visible (active or lingering) ruler. */
  get activeSenderCount(): number {
    return this.measurements.size;
  }

  /** Unregisters the overlay, cancels timers, stops animating. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    for (const entry of this.measurements.values()) {
      if (entry.expiryTimer != null) clearTimeout(entry.expiryTimer);
    }
    this.measurements.clear();
    this.unregister?.();
    this.unregister = null;
  }

  private beginLinger(sender: string): void {
    const entry = this.measurements.get(sender);
    if (!entry || entry.clearedAt !== null) return;
    if (entry.expiryTimer != null) {
      clearTimeout(entry.expiryTimer);
      entry.expiryTimer = null;
    }
    entry.clearedAt = this.now();
    this.ensureAnimating();
    this.host.requestRender();
  }

  private ensureAnimating(): void {
    if (this.rafId === null) {
      this.rafId = requestAnimationFrame(() => this.tick());
    }
  }

  private tick(): void {
    if (this.disposed) return;
    const now = this.now();
    let lingering = 0;
    for (const [sender, entry] of this.measurements) {
      if (entry.clearedAt === null) continue;
      if (now - entry.clearedAt >= this.holdMs + this.fadeMs) {
        this.measurements.delete(sender);
      } else {
        lingering += 1;
      }
    }
    this.host.requestRender();
    this.rafId = lingering > 0 ? requestAnimationFrame(() => this.tick()) : null;
  }

  private renderMeasurements(ctx: CanvasRenderingContext2D): void {
    if (this.measurements.size === 0) return;
    const now = this.now();
    for (const entry of this.measurements.values()) {
      let alpha = 1;
      if (entry.clearedAt !== null) {
        const fadeAge = now - entry.clearedAt - this.holdMs;
        if (fadeAge > 0) alpha = Math.max(0, 1 - fadeAge / this.fadeMs);
      }
      drawMeasurement(ctx, entry, { alpha });
    }
  }
}
