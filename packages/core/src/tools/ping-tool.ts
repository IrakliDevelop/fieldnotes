import type { Tool, ToolContext, PointerState } from './types';
import { renderPingPulse } from '../canvas/ping-pulse';

export interface PingToolOptions {
  name?: string;
  color?: string;
  /** Total pulse animation length in milliseconds. */
  durationMs?: number;
  /** Maximum ripple radius in world units. */
  radius?: number;
  /**
   * Minimum interval between emitted pings. Taps arriving faster are ignored
   * entirely (no local pulse, no emission), so rapid-fire pings cannot starve
   * durable sync traffic.
   */
  minIntervalMs?: number;
}

/**
 * One emitted ping — the outgoing side of a shared "look here" marker.
 * Emissions carry the world position and the tool's current style so a host
 * can forward them as ephemeral presence without duplicating input handling.
 */
export interface PingEmission {
  /** World-space ping position. */
  readonly x: number;
  readonly y: number;
  readonly color: string;
  readonly durationMs: number;
  readonly radius: number;
}

interface LocalPing {
  x: number;
  y: number;
  t: number;
}

const DEFAULT_COLOR = '#ff3b30';
const DEFAULT_DURATION_MS = 1800;
const DEFAULT_RADIUS = 48;
const DEFAULT_MIN_INTERVAL_MS = 300;

/**
 * Tap or click to ping a world position: a short expanding-pulse animation is
 * rendered locally and one `PingEmission` is delivered to `onPing` listeners
 * per accepted tap. Pings are ephemeral by contract: they never create
 * elements, enter undo history, or touch persisted canvas state — hosts
 * forward emissions as presence only.
 */
export class PingTool implements Tool {
  readonly name: string;
  private color: string;
  private durationMs: number;
  private radius: number;
  private minIntervalMs: number;
  private pings: LocalPing[] = [];
  private lastEmitAt = -Infinity;
  private rafId: number | null = null;
  private optionListeners = new Set<() => void>();
  private pingListeners = new Set<(emission: PingEmission) => void>();

  constructor(options: PingToolOptions = {}) {
    this.name = options.name ?? 'ping';
    this.color = options.color ?? DEFAULT_COLOR;
    this.durationMs = options.durationMs ?? DEFAULT_DURATION_MS;
    this.radius = options.radius ?? DEFAULT_RADIUS;
    this.minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  }

  private now(): number {
    return performance.now();
  }

  onActivate(ctx: ToolContext): void {
    ctx.setCursor?.('crosshair');
  }

  onDeactivate(ctx: ToolContext): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.pings = [];
    ctx.setCursor?.('default');
    ctx.requestRender();
  }

  getOptions(): PingToolOptions {
    return {
      name: this.name,
      color: this.color,
      durationMs: this.durationMs,
      radius: this.radius,
      minIntervalMs: this.minIntervalMs,
    };
  }

  setOptions(options: PingToolOptions): void {
    if (options.color !== undefined) this.color = options.color;
    if (options.durationMs !== undefined) this.durationMs = options.durationMs;
    if (options.radius !== undefined) this.radius = options.radius;
    if (options.minIntervalMs !== undefined) this.minIntervalMs = options.minIntervalMs;
    this.notifyOptionsChange();
  }

  onOptionsChange(listener: () => void): () => void {
    this.optionListeners.add(listener);
    return () => this.optionListeners.delete(listener);
  }

  /**
   * Subscribes to accepted pings. Listeners must not throw; a throwing
   * listener is isolated so it cannot break the tap handling or other
   * listeners.
   */
  onPing(listener: (emission: PingEmission) => void): () => void {
    this.pingListeners.add(listener);
    return () => this.pingListeners.delete(listener);
  }

  onPointerDown(state: PointerState, ctx: ToolContext): void {
    const t = this.now();
    if (t - this.lastEmitAt < this.minIntervalMs) return;
    this.lastEmitAt = t;

    const world = ctx.camera.screenToWorld({ x: state.x, y: state.y });
    this.pings.push({ x: world.x, y: world.y, t });
    const emission: PingEmission = {
      x: world.x,
      y: world.y,
      color: this.color,
      durationMs: this.durationMs,
      radius: this.radius,
    };
    for (const listener of this.pingListeners) {
      try {
        listener(emission);
      } catch {
        // A throwing host listener must not break tap handling.
      }
    }
    this.ensureAnimating(ctx);
    ctx.requestRender();
  }

  onPointerMove(_state: PointerState, _ctx: ToolContext): void {
    // Pings are discrete taps; dragging does nothing.
  }

  onPointerUp(_state: PointerState, _ctx: ToolContext): void {
    // Nothing to finish; the ping fired on pointer down.
  }

  renderOverlay(ctx: CanvasRenderingContext2D): void {
    if (this.pings.length === 0) return;
    const now = this.now();
    for (const ping of this.pings) {
      renderPingPulse(ctx, ping.x, ping.y, now - ping.t, {
        color: this.color,
        durationMs: this.durationMs,
        radius: this.radius,
      });
    }
  }

  private ensureAnimating(ctx: ToolContext): void {
    if (this.rafId === null) {
      this.rafId = requestAnimationFrame(() => this.tick(ctx));
    }
  }

  private tick(ctx: ToolContext): void {
    const cutoff = this.now() - this.durationMs;
    this.pings = this.pings.filter((ping) => ping.t > cutoff);
    ctx.requestRender();
    this.rafId = this.pings.length > 0 ? requestAnimationFrame(() => this.tick(ctx)) : null;
  }

  private notifyOptionsChange(): void {
    for (const listener of this.optionListeners) listener();
  }
}
