import type { Tool, ToolContext, PointerState } from './types';
import type { Point } from '../core/types';

export interface LaserToolOptions {
  name?: string;
  color?: string;
  width?: number;
  fadeMs?: number;
}

/**
 * A coalesced batch of locally drawn trail points, flushed at most once per
 * animation frame — the outgoing side of a shared laser pointer. Emissions
 * carry world coordinates and the tool's current style so a host can forward
 * them as ephemeral presence without duplicating the tool's input handling.
 */
export interface LaserTrailEmission {
  /** World-space points recorded since the previous emission, oldest first. */
  readonly points: readonly Point[];
  readonly color: string;
  readonly width: number;
  readonly fadeMs: number;
}

interface TrailPoint {
  x: number;
  y: number;
  t: number;
}

const DEFAULT_COLOR = '#ff3b30';
const DEFAULT_WIDTH = 4;
const DEFAULT_FADE_MS = 1200;

export class LaserTool implements Tool {
  readonly name: string;
  private color: string;
  private width: number;
  private fadeMs: number;
  private trail: TrailPoint[] = [];
  private rafId: number | null = null;
  private drawing = false;
  private optionListeners = new Set<() => void>();
  private trailListeners = new Set<(emission: LaserTrailEmission) => void>();
  private pendingEmission: Point[] = [];

  constructor(options: LaserToolOptions = {}) {
    this.name = options.name ?? 'laser';
    this.color = options.color ?? DEFAULT_COLOR;
    this.width = options.width ?? DEFAULT_WIDTH;
    this.fadeMs = options.fadeMs ?? DEFAULT_FADE_MS;
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
    this.trail = [];
    this.drawing = false;
    this.pendingEmission = [];
    ctx.setCursor?.('default');
    ctx.requestRender();
  }

  getOptions(): LaserToolOptions {
    return {
      name: this.name,
      color: this.color,
      width: this.width,
      fadeMs: this.fadeMs,
    };
  }

  onOptionsChange(listener: () => void): () => void {
    this.optionListeners.add(listener);
    return () => this.optionListeners.delete(listener);
  }

  /**
   * Subscribes to coalesced trail emissions. Points recorded by pointer input
   * are batched and delivered at most once per animation frame, keeping
   * outgoing presence packets small. Listeners must not throw; a throwing
   * listener is isolated so it cannot stall the fade loop.
   */
  onTrail(listener: (emission: LaserTrailEmission) => void): () => void {
    this.trailListeners.add(listener);
    return () => this.trailListeners.delete(listener);
  }

  setOptions(options: LaserToolOptions): void {
    if (options.color !== undefined) this.color = options.color;
    if (options.width !== undefined) this.width = options.width;
    if (options.fadeMs !== undefined) this.fadeMs = options.fadeMs;
    this.notifyOptionsChange();
  }

  onPointerDown(state: PointerState, ctx: ToolContext): void {
    this.drawing = true;
    this.recordPoint(state, ctx);
  }

  onPointerMove(state: PointerState, ctx: ToolContext): void {
    if (!this.drawing) return;
    this.recordPoint(state, ctx);
  }

  private recordPoint(state: PointerState, ctx: ToolContext): void {
    const world = ctx.camera.screenToWorld({ x: state.x, y: state.y });
    this.trail.push({ x: world.x, y: world.y, t: this.now() });
    if (this.trailListeners.size > 0) {
      this.pendingEmission.push({ x: world.x, y: world.y });
    }
    this.ensureAnimating(ctx);
  }

  onPointerUp(_state: PointerState, _ctx: ToolContext): void {
    this.drawing = false;
  }

  renderOverlay(ctx: CanvasRenderingContext2D): void {
    if (this.trail.length < 2) return;

    ctx.save();
    ctx.strokeStyle = this.color;
    ctx.lineWidth = this.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const now = this.now();
    for (let i = 0; i < this.trail.length - 1; i++) {
      const a = this.trail[i];
      const b = this.trail[i + 1];
      if (!a || !b) continue;
      const age = now - b.t;
      ctx.globalAlpha = Math.max(0, 1 - age / this.fadeMs);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    ctx.restore();
  }

  private ensureAnimating(ctx: ToolContext): void {
    if (this.rafId === null) {
      this.rafId = requestAnimationFrame(() => this.tick(ctx));
    }
  }

  private flushEmission(): void {
    if (this.pendingEmission.length === 0) return;
    const emission: LaserTrailEmission = {
      points: this.pendingEmission,
      color: this.color,
      width: this.width,
      fadeMs: this.fadeMs,
    };
    this.pendingEmission = [];
    for (const listener of this.trailListeners) {
      try {
        listener(emission);
      } catch {
        // A throwing host listener must not stall the fade/emission loop.
      }
    }
  }

  private tick(ctx: ToolContext): void {
    this.flushEmission();
    const cutoff = this.now() - this.fadeMs;
    this.trail = this.trail.filter((p) => p.t >= cutoff);
    if (this.trail.length > 0) {
      ctx.requestRender();
      this.rafId = requestAnimationFrame(() => this.tick(ctx));
    } else {
      ctx.requestRender();
      this.rafId = null;
    }
  }

  private notifyOptionsChange(): void {
    for (const listener of this.optionListeners) listener();
  }
}
