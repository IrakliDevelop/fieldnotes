import type { OverlayRenderer } from './render-loop';
import { renderPingPulse } from './ping-pulse';
import type { PingEmission } from '../tools/ping-tool';

/**
 * The wire shape of a map-ping presence payload. Presence data is untyped on
 * the wire, so hosts discriminate on `kind`; `isPingPresence` validates a
 * received payload before it reaches the overlay. Pings are ephemeral by
 * contract: they must travel as presence only — never as elements, undo
 * history, persisted canvas state, or durable operations.
 */
export interface PingPresence {
  readonly kind: 'ping';
  /** World-space ping position. */
  readonly x: number;
  readonly y: number;
  readonly color?: string;
  readonly durationMs?: number;
  readonly radius?: number;
}

export const PING_PRESENCE_KIND = 'ping';

export function isPingPresence(data: unknown): data is PingPresence {
  if (typeof data !== 'object' || data === null) return false;
  const payload = data as {
    kind?: unknown;
    x?: unknown;
    y?: unknown;
    color?: unknown;
    durationMs?: unknown;
    radius?: unknown;
  };
  if (payload.kind !== PING_PRESENCE_KIND) return false;
  if (typeof payload.x !== 'number' || !Number.isFinite(payload.x)) return false;
  if (typeof payload.y !== 'number' || !Number.isFinite(payload.y)) return false;
  if (payload.color !== undefined && typeof payload.color !== 'string') return false;
  if (
    payload.durationMs !== undefined &&
    !(
      typeof payload.durationMs === 'number' &&
      Number.isFinite(payload.durationMs) &&
      payload.durationMs > 0
    )
  ) {
    return false;
  }
  if (
    payload.radius !== undefined &&
    !(typeof payload.radius === 'number' && Number.isFinite(payload.radius) && payload.radius > 0)
  ) {
    return false;
  }
  return true;
}

/** Builds the presence payload for one local `PingTool` emission. */
export function toPingPresence(emission: PingEmission): PingPresence {
  return {
    kind: PING_PRESENCE_KIND,
    x: emission.x,
    y: emission.y,
    color: emission.color,
    durationMs: emission.durationMs,
    radius: emission.radius,
  };
}

/**
 * The two viewport capabilities the overlay needs; `Viewport` satisfies it.
 */
export interface RemotePingOverlayHost {
  registerOverlay(draw: OverlayRenderer): () => void;
  requestRender(): void;
}

export interface RemotePingOverlayOptions {
  /** Style fallbacks when a payload omits them. */
  color?: string;
  durationMs?: number;
  radius?: number;
  /** Per-sender live-ping cap; oldest pings drop first. Default `8`. */
  maxPingsPerSender?: number;
}

interface RemotePing {
  x: number;
  y: number;
  t: number;
  color: string;
  durationMs: number;
  radius: number;
}

const DEFAULT_COLOR = '#ff3b30';
const DEFAULT_DURATION_MS = 1800;
const DEFAULT_RADIUS = 48;
const DEFAULT_MAX_PINGS = 8;

/**
 * Renders expanding-pulse pings for remote senders through the viewport
 * overlay registration, independent of the viewer's active tool. Pings are
 * stamped with local receive time (remote clocks are never trusted),
 * self-expire when their animation ends, and a sender's pings disappear
 * immediately on `remove()` — wire that to `presence-leave`/disconnect. The
 * controller never touches elements, history, or persisted state, and it
 * never moves the viewer's camera: pings are visual only.
 */
export class RemotePingOverlay {
  private readonly host: RemotePingOverlayHost;
  private readonly color: string;
  private readonly durationMs: number;
  private readonly radius: number;
  private readonly maxPingsPerSender: number;
  private readonly pings = new Map<string, RemotePing[]>();
  private unregister: (() => void) | null;
  private rafId: number | null = null;
  private disposed = false;

  constructor(host: RemotePingOverlayHost, options: RemotePingOverlayOptions = {}) {
    this.host = host;
    this.color = options.color ?? DEFAULT_COLOR;
    this.durationMs = options.durationMs ?? DEFAULT_DURATION_MS;
    this.radius = options.radius ?? DEFAULT_RADIUS;
    this.maxPingsPerSender = options.maxPingsPerSender ?? DEFAULT_MAX_PINGS;
    this.unregister = host.registerOverlay((ctx) => this.renderPings(ctx));
  }

  private now(): number {
    return performance.now();
  }

  /**
   * Applies a presence payload from `sender` (any opaque per-sender key, e.g.
   * the envelope `from`). Non-ping or malformed payloads are ignored and
   * reported as `false`, so hosts can feed every presence frame through.
   */
  apply(sender: string, data: unknown): boolean {
    if (this.disposed || !isPingPresence(data)) return false;
    let senderPings = this.pings.get(sender);
    if (!senderPings) {
      senderPings = [];
      this.pings.set(sender, senderPings);
    }
    senderPings.push({
      x: data.x,
      y: data.y,
      t: this.now(),
      color: data.color ?? this.color,
      durationMs: data.durationMs ?? this.durationMs,
      radius: data.radius ?? this.radius,
    });
    const excess = senderPings.length - this.maxPingsPerSender;
    if (excess > 0) senderPings.splice(0, excess);
    this.ensureAnimating();
    this.host.requestRender();
    return true;
  }

  /** Removes a sender's pings immediately (presence-leave/disconnect). */
  remove(sender: string): void {
    if (this.pings.delete(sender)) this.host.requestRender();
  }

  /** Removes every ping immediately. */
  clear(): void {
    if (this.pings.size === 0) return;
    this.pings.clear();
    this.host.requestRender();
  }

  /** Number of senders with a live (unexpired) ping. */
  get activeSenderCount(): number {
    return this.pings.size;
  }

  /** Unregisters the overlay and stops the animation loop. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.pings.clear();
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
    for (const [sender, senderPings] of this.pings) {
      const live = senderPings.filter((ping) => now - ping.t < ping.durationMs);
      if (live.length === 0) {
        this.pings.delete(sender);
      } else {
        this.pings.set(sender, live);
      }
    }
    this.host.requestRender();
    this.rafId = this.pings.size > 0 ? requestAnimationFrame(() => this.tick()) : null;
  }

  private renderPings(ctx: CanvasRenderingContext2D): void {
    if (this.pings.size === 0) return;
    const now = this.now();
    for (const senderPings of this.pings.values()) {
      for (const ping of senderPings) {
        renderPingPulse(ctx, ping.x, ping.y, now - ping.t, {
          color: ping.color,
          durationMs: ping.durationMs,
          radius: ping.radius,
        });
      }
    }
  }
}
