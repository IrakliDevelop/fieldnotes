import type { Point } from '../core/types';
import type { PathEmission } from '../tools/path-tool';
import type { OverlayRenderer } from './render-loop';
import { drawPath, resolveSegmentColors } from './path-render';
import { LingerOverlay } from './linger-overlay';

/**
 * The wire shape of a movement-path presence payload. Presence data is untyped
 * on the wire, so hosts discriminate on `kind`; `isPathPresence` validates a
 * received payload before it reaches the overlay. Distance is
 * sender-authoritative: receivers render the payload's `feet` and pre-resolved
 * `segmentColors` and never recompute from their own grid or range bands.
 * Paths are ephemeral by contract: presence only — never elements, undo
 * history, persisted canvas state, or durable operations. The emission's
 * `anchorKey` is host-private and never travels on the wire.
 */
export type PathPresence =
  | {
      readonly kind: 'path';
      readonly points: readonly Point[];
      /** One entry per segment: `points.length - 1` colours. */
      readonly segmentColors: readonly string[];
      readonly feet: number;
      readonly color?: string;
    }
  | { readonly kind: 'path'; readonly cleared: true };

export const PATH_PRESENCE_KIND = 'path';

/** Point cap for a received path; longer payloads are rejected outright. */
export const PATH_PRESENCE_MAX_POINTS = 256;

const EPS = 1e-6;

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

export function isPathPresence(data: unknown): data is PathPresence {
  if (typeof data !== 'object' || data === null) return false;
  const payload = data as {
    kind?: unknown;
    cleared?: unknown;
    points?: unknown;
    segmentColors?: unknown;
    feet?: unknown;
    color?: unknown;
  };
  if (payload.kind !== PATH_PRESENCE_KIND) return false;
  if ('cleared' in payload) return payload.cleared === true;
  if (!Array.isArray(payload.points)) return false;
  if (payload.points.length === 0 || payload.points.length > PATH_PRESENCE_MAX_POINTS) return false;
  if (!payload.points.every(isFinitePoint)) return false;
  if (!Array.isArray(payload.segmentColors)) return false;
  if (payload.segmentColors.length !== payload.points.length - 1) return false;
  if (!payload.segmentColors.every((color) => typeof color === 'string')) return false;
  if (typeof payload.feet !== 'number' || !Number.isFinite(payload.feet)) return false;
  if (payload.color !== undefined && typeof payload.color !== 'string') return false;
  return true;
}

function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS;
}

/**
 * Builds the presence payload for one local `PathTool` emission. Range bands
 * are resolved to per-segment colours here, so a receiver renders the sender's
 * bands without knowing them. `anchorKey` is deliberately dropped: it names a
 * local element the receiver cannot resolve.
 */
export function toPathPresence(emission: PathEmission | null): PathPresence {
  if (emission === null) return { kind: PATH_PRESENCE_KIND, cleared: true };
  const points: Point[] = emission.waypoints.map((point) => ({ x: point.x, y: point.y }));
  const last = points[points.length - 1];
  const cursor = emission.cursor;
  if (cursor && (!last || !samePoint(cursor, last))) points.push({ x: cursor.x, y: cursor.y });
  // Cumulative feet at every point, so `segmentColors` always has exactly one
  // entry per segment even if `segments` is shorter than the point list.
  const cumulativeFeet: number[] = [0];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += emission.segments[i - 1]?.feet ?? 0;
    cumulativeFeet.push(total);
  }
  return {
    kind: PATH_PRESENCE_KIND,
    points,
    segmentColors: resolveSegmentColors(cumulativeFeet, [...emission.rangeBands], emission.color),
    feet: emission.totalFeet,
    color: emission.color,
  };
}

/**
 * The two viewport capabilities the overlay needs; `Viewport` satisfies it.
 * Structurally identical to the internal `LingerOverlayHost` and to
 * `RemoteMeasureOverlayHost`; the members are spelled out rather than inherited
 * so the public shape never depends on an unexported internal interface.
 */
export interface RemotePathOverlayHost {
  registerOverlay(draw: OverlayRenderer): () => void;
  requestRender(): void;
}

export interface RemotePathOverlayOptions {
  /** Style fallback when a payload omits `color`. Default `'#FF5722'`. */
  color?: string;
  /** Full-opacity hold after a cleared payload. Default `1500`. */
  holdMs?: number;
  /** Linear fade to 0 after the hold. Default `400`. */
  fadeMs?: number;
  /** Stale active entries are treated as cleared after this. Default `30000`. */
  maxAgeMs?: number;
}

interface RemotePath {
  points: readonly Point[];
  segmentColors: readonly string[];
  feet: number;
  color: string;
}

const DEFAULT_COLOR = '#FF5722';

/**
 * Renders remote movement paths through the viewport overlay registration,
 * independent of the viewer's active tool. Entries are stamped with local
 * receive time (remote clocks are never trusted). A cleared payload holds the
 * final path for `holdMs`, fades over `fadeMs`, and deletes; presence-leave
 * (`remove`) deletes immediately. An active entry not updated for `maxAgeMs`
 * is expired by a timer — an idle map never renders, so expiry cannot ride on
 * the draw path. The overlay never touches elements, history, or persisted
 * state, and never moves the viewer's camera.
 *
 * The per-sender lifetime is `LingerOverlay`; this class only validates
 * payloads and draws one path.
 */
export class RemotePathOverlay {
  private readonly color: string;
  private readonly overlay: LingerOverlay<RemotePath>;

  constructor(host: RemotePathOverlayHost, options: RemotePathOverlayOptions = {}) {
    this.color = options.color ?? DEFAULT_COLOR;
    this.overlay = new LingerOverlay<RemotePath>(
      host,
      options,
      (ctx, entry, alpha) => drawPath(ctx, entry, { alpha }),
      () => this.now(),
    );
  }

  private now(): number {
    return performance.now();
  }

  /**
   * Applies a presence payload from `sender` (any opaque per-sender key, e.g.
   * the envelope `from`). Non-path or malformed payloads are ignored and
   * reported as `false`, so hosts can feed every presence frame through.
   */
  apply(sender: string, data: unknown): boolean {
    if (this.overlay.disposed || !isPathPresence(data)) return false;
    if ('cleared' in data) {
      this.overlay.linger(sender);
      return true;
    }
    this.overlay.set(sender, {
      points: data.points,
      segmentColors: data.segmentColors,
      feet: data.feet,
      color: data.color ?? this.color,
    });
    return true;
  }

  /** Removes a sender's path immediately (presence-leave/disconnect). */
  remove(sender: string): void {
    this.overlay.remove(sender);
  }

  /** Removes every path immediately. */
  clear(): void {
    this.overlay.clear();
  }

  /** Number of senders with a visible (active or lingering) path. */
  get activeSenderCount(): number {
    return this.overlay.activeSenderCount;
  }

  /** Unregisters the overlay, cancels timers, stops animating. Idempotent. */
  dispose(): void {
    this.overlay.dispose();
  }
}
