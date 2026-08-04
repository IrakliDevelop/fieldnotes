import type { Point } from '../core/types';
import type { OverlayRenderer } from './render-loop';
import type { LaserTrailEmission } from '../tools/laser-tool';

/**
 * The wire shape of a laser-trail presence payload. Presence data is untyped
 * on the wire, so hosts discriminate on `kind`; `isLaserTrailPresence`
 * validates a received payload before it reaches the overlay. Trails are
 * ephemeral by contract: they must travel as presence only — never as
 * elements, undo history, persisted canvas state, or durable operations.
 */
export interface LaserTrailPresence {
  readonly kind: 'laser';
  /** World-space points, oldest first. */
  readonly points: readonly Point[];
  readonly color?: string;
  readonly width?: number;
  readonly fadeMs?: number;
}

export const LASER_TRAIL_PRESENCE_KIND = 'laser';

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

export function isLaserTrailPresence(data: unknown): data is LaserTrailPresence {
  if (typeof data !== 'object' || data === null) return false;
  const payload = data as {
    kind?: unknown;
    points?: unknown;
    color?: unknown;
    width?: unknown;
    fadeMs?: unknown;
  };
  if (payload.kind !== LASER_TRAIL_PRESENCE_KIND) return false;
  if (!Array.isArray(payload.points) || !payload.points.every(isFinitePoint)) return false;
  if (payload.color !== undefined && typeof payload.color !== 'string') return false;
  if (payload.width !== undefined && !(typeof payload.width === 'number' && payload.width > 0)) {
    return false;
  }
  if (payload.fadeMs !== undefined && !(typeof payload.fadeMs === 'number' && payload.fadeMs > 0)) {
    return false;
  }
  return true;
}

/** Builds the presence payload for one local `LaserTool` emission. */
export function toLaserTrailPresence(emission: LaserTrailEmission): LaserTrailPresence {
  return {
    kind: LASER_TRAIL_PRESENCE_KIND,
    points: emission.points.map((point) => ({ x: point.x, y: point.y })),
    color: emission.color,
    width: emission.width,
    fadeMs: emission.fadeMs,
  };
}

/**
 * The two viewport capabilities the overlay needs; `Viewport` satisfies it.
 */
export interface RemoteLaserOverlayHost {
  registerOverlay(draw: OverlayRenderer): () => void;
  requestRender(): void;
}

export interface RemoteLaserOverlayOptions {
  /** Style fallbacks when a payload omits them. */
  color?: string;
  width?: number;
  fadeMs?: number;
  /** Per-sender point cap; oldest points drop first. Default `512`. */
  maxPointsPerSender?: number;
}

interface RemoteTrailPoint {
  x: number;
  y: number;
  t: number;
}

interface RemoteTrail {
  points: RemoteTrailPoint[];
  color: string;
  width: number;
  fadeMs: number;
}

const DEFAULT_COLOR = '#ff3b30';
const DEFAULT_WIDTH = 4;
const DEFAULT_FADE_MS = 1200;
const DEFAULT_MAX_POINTS = 512;

/**
 * Renders fading laser trails for remote senders through the viewport overlay
 * registration, independent of the viewer's active tool. Points are stamped
 * with local receive time (remote clocks are never trusted), fade like the
 * local `LaserTool`, and a sender's trail disappears immediately on
 * `remove()` — wire that to `presence-leave`/disconnect. The controller never
 * touches elements, history, or persisted state.
 */
export class RemoteLaserOverlay {
  private readonly host: RemoteLaserOverlayHost;
  private readonly color: string;
  private readonly width: number;
  private readonly fadeMs: number;
  private readonly maxPointsPerSender: number;
  private readonly trails = new Map<string, RemoteTrail>();
  private unregister: (() => void) | null;
  private rafId: number | null = null;
  private disposed = false;

  constructor(host: RemoteLaserOverlayHost, options: RemoteLaserOverlayOptions = {}) {
    this.host = host;
    this.color = options.color ?? DEFAULT_COLOR;
    this.width = options.width ?? DEFAULT_WIDTH;
    this.fadeMs = options.fadeMs ?? DEFAULT_FADE_MS;
    this.maxPointsPerSender = options.maxPointsPerSender ?? DEFAULT_MAX_POINTS;
    this.unregister = host.registerOverlay((ctx) => this.renderTrails(ctx));
  }

  private now(): number {
    return performance.now();
  }

  /**
   * Applies a presence payload from `sender` (any opaque per-sender key, e.g.
   * the envelope `from`). Non-laser or malformed payloads are ignored and
   * reported as `false`, so hosts can feed every presence frame through.
   */
  apply(sender: string, data: unknown): boolean {
    if (this.disposed || !isLaserTrailPresence(data)) return false;
    let trail = this.trails.get(sender);
    if (!trail) {
      trail = { points: [], color: this.color, width: this.width, fadeMs: this.fadeMs };
      this.trails.set(sender, trail);
    }
    trail.color = data.color ?? this.color;
    trail.width = data.width ?? this.width;
    trail.fadeMs = data.fadeMs ?? this.fadeMs;
    const t = this.now();
    for (const point of data.points) {
      trail.points.push({ x: point.x, y: point.y, t });
    }
    const excess = trail.points.length - this.maxPointsPerSender;
    if (excess > 0) trail.points.splice(0, excess);
    this.ensureAnimating();
    this.host.requestRender();
    return true;
  }

  /** Removes a sender's trail immediately (presence-leave/disconnect). */
  remove(sender: string): void {
    if (this.trails.delete(sender)) this.host.requestRender();
  }

  /** Removes every trail immediately. */
  clear(): void {
    if (this.trails.size === 0) return;
    this.trails.clear();
    this.host.requestRender();
  }

  /** Number of senders with a live (unfaded) trail. */
  get activeSenderCount(): number {
    return this.trails.size;
  }

  /** Unregisters the overlay and stops the fade loop. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.trails.clear();
    this.unregister?.();
    this.unregister = null;
  }

  private ensureAnimating(): void {
    if (this.rafId === null) {
      this.rafId = requestAnimationFrame(() => this.tick());
    }
  }

  private tick(): void {
    if (this.disposed) return;
    const now = this.now();
    for (const [sender, trail] of this.trails) {
      const cutoff = now - trail.fadeMs;
      trail.points = trail.points.filter((point) => point.t >= cutoff);
      if (trail.points.length === 0) this.trails.delete(sender);
    }
    this.host.requestRender();
    this.rafId = this.trails.size > 0 ? requestAnimationFrame(() => this.tick()) : null;
  }

  private renderTrails(ctx: CanvasRenderingContext2D): void {
    if (this.trails.size === 0) return;
    const now = this.now();
    for (const trail of this.trails.values()) {
      if (trail.points.length < 2) continue;
      ctx.save();
      ctx.strokeStyle = trail.color;
      ctx.lineWidth = trail.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = 0; i < trail.points.length - 1; i++) {
        const a = trail.points[i];
        const b = trail.points[i + 1];
        if (!a || !b) continue;
        const age = now - b.t;
        ctx.globalAlpha = Math.max(0, 1 - age / trail.fadeMs);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}
