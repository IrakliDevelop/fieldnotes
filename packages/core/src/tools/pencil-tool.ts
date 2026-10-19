import type { StrokePoint } from '../core/types';
import type { Tool, ToolContext, PointerState } from './types';
import { createStroke } from '../elements/element-factory';
import { createId } from '../elements/create-id';
import { simplifyPoints, smoothToSegments, pressureToWidth } from '../elements/stroke-smoothing';
import { computeStrokeSegments } from '../elements/stroke-cache';

export interface PencilToolOptions {
  name?: string;
  color?: string;
  width?: number;
  smoothing?: number;
  minPointDistance?: number;
  progressiveSimplifyThreshold?: number;
  opacity?: number;
  blendMode?: 'multiply';
}

/**
 * A full-state preview of the stroke being drawn, keyed by the id its committed
 * element will have, or `cleared` when the gesture was cancelled.
 */
export type StrokePreview =
  | {
      readonly id: string;
      /** The newest points as `[x, y, pressure]`, oldest first. */
      readonly points: readonly (readonly [number, number, number?])[];
      readonly color: string;
      readonly width: number;
      readonly opacity?: number;
      readonly blendMode?: 'multiply';
    }
  | { readonly id: string; readonly cleared: true };

const MIN_POINTS_FOR_STROKE = 2;
const PREVIEW_INTERVAL_MS = 50;
const PREVIEW_MAX_POINTS = 120;
const DEFAULT_SMOOTHING = 1.5;
const DEFAULT_PRESSURE = 0.5;
const DEFAULT_MIN_POINT_DISTANCE = 3;
const DEFAULT_PROGRESSIVE_THRESHOLD = 200;
const PROGRESSIVE_HOT_ZONE = 30;

export class PencilTool implements Tool {
  readonly name: string;
  private drawing = false;
  private points: StrokePoint[] = [];
  private color: string;
  private width: number;
  private smoothing: number;
  private minPointDistance: number;
  private progressiveThreshold: number;
  private nextSimplifyAt: number;
  private opacity: number;
  private blendMode: 'multiply' | undefined;
  private optionListeners = new Set<() => void>();
  private previewListeners = new Set<(preview: StrokePreview) => void>();
  private strokeId = '';
  private lastPreviewAt = -Infinity;

  constructor(options: PencilToolOptions = {}) {
    this.name = options.name ?? 'pencil';
    this.color = options.color ?? '#000000';
    this.width = options.width ?? 2;
    this.smoothing = options.smoothing ?? DEFAULT_SMOOTHING;
    this.minPointDistance = options.minPointDistance ?? DEFAULT_MIN_POINT_DISTANCE;
    this.progressiveThreshold =
      options.progressiveSimplifyThreshold ?? DEFAULT_PROGRESSIVE_THRESHOLD;
    this.nextSimplifyAt = this.progressiveThreshold;
    this.opacity = options.opacity ?? 1;
    this.blendMode = options.blendMode;
  }

  onActivate(ctx: ToolContext): void {
    ctx.setCursor?.('crosshair');
  }

  onDeactivate(ctx: ToolContext): void {
    ctx.setCursor?.('default');
  }

  getOptions(): PencilToolOptions {
    return {
      color: this.color,
      width: this.width,
      smoothing: this.smoothing,
      minPointDistance: this.minPointDistance,
      progressiveSimplifyThreshold: this.progressiveThreshold,
      opacity: this.opacity,
      blendMode: this.blendMode,
    };
  }

  onOptionsChange(listener: () => void): () => void {
    this.optionListeners.add(listener);
    return () => this.optionListeners.delete(listener);
  }

  /**
   * Subscribes to previews of the stroke in progress, at most one per 50 ms,
   * windowed to the newest 120 points; `cleared` follows a cancelled gesture.
   */
  onPreview(listener: (preview: StrokePreview) => void): () => void {
    this.previewListeners.add(listener);
    return () => this.previewListeners.delete(listener);
  }

  setOptions(options: PencilToolOptions): void {
    if (options.color !== undefined) this.color = options.color;
    if (options.width !== undefined) this.width = options.width;
    if (options.smoothing !== undefined) this.smoothing = options.smoothing;
    if (options.minPointDistance !== undefined) this.minPointDistance = options.minPointDistance;
    if (options.progressiveSimplifyThreshold !== undefined)
      this.progressiveThreshold = options.progressiveSimplifyThreshold;
    if (options.opacity !== undefined) this.opacity = options.opacity;
    if (options.blendMode !== undefined) this.blendMode = options.blendMode;
    this.notifyOptionsChange();
  }

  onPointerDown(state: PointerState, ctx: ToolContext): void {
    this.drawing = true;
    const world = ctx.camera.screenToWorld({ x: state.x, y: state.y });
    const pressure = state.pressure === 0 ? DEFAULT_PRESSURE : state.pressure;
    this.points = [{ x: world.x, y: world.y, pressure }];
    this.nextSimplifyAt = this.progressiveThreshold;
    this.strokeId = createId('stroke');
    this.lastPreviewAt = -Infinity;
  }

  onPointerMove(state: PointerState, ctx: ToolContext): void {
    if (!this.drawing) return;
    const world = ctx.camera.screenToWorld({ x: state.x, y: state.y });
    const pressure = state.pressure === 0 ? DEFAULT_PRESSURE : state.pressure;

    const last = this.points[this.points.length - 1];
    if (last) {
      const dx = world.x - last.x;
      const dy = world.y - last.y;
      if (dx * dx + dy * dy < this.minPointDistance * this.minPointDistance) return;
    }

    this.points.push({ x: world.x, y: world.y, pressure });

    // Progressively simplify the cold zone to bound memory on very long strokes.
    // nextSimplifyAt doubles after each pass to avoid compounding data loss.
    if (this.points.length > this.nextSimplifyAt) {
      const hotZone = this.points.slice(-PROGRESSIVE_HOT_ZONE);
      const coldZone = this.points.slice(0, -PROGRESSIVE_HOT_ZONE);
      const simplified = simplifyPoints(coldZone, this.smoothing * 2);
      this.points = [...simplified, ...hotZone];
      this.nextSimplifyAt = this.points.length + this.progressiveThreshold;
    }

    this.emitPreview();
    ctx.requestOverlayRender();
  }

  onPointerUp(_state: PointerState, ctx: ToolContext): void {
    if (!this.drawing) return;
    this.drawing = false;

    if (this.points.length < MIN_POINTS_FOR_STROKE) {
      this.points = [];
      return;
    }

    const simplified = simplifyPoints(this.points, this.smoothing);
    const stroke = {
      ...createStroke({
        points: simplified,
        color: this.color,
        width: this.width,
        layerId: ctx.activeLayerId ?? '',
        opacity: this.opacity,
        blendMode: this.blendMode,
      }),
      id: this.strokeId,
    };
    ctx.store.add(stroke);
    // add() stores a placed copy, so warm the stored element rather than `stroke`.
    const stored = ctx.store.getById(stroke.id);
    if (stored?.type === 'stroke') computeStrokeSegments(stored);
    this.points = [];
    ctx.requestRender();
  }

  /** Pinch takeover or platform cancel: drop the partial stroke instead of committing it. */
  onPointerCancel(_state: PointerState, ctx: ToolContext): void {
    if (!this.drawing) return;
    this.drawing = false;
    this.points = [];
    this.notifyPreview({ id: this.strokeId, cleared: true });
    ctx.requestOverlayRender();
  }

  private notifyOptionsChange(): void {
    for (const listener of this.optionListeners) listener();
  }

  private emitPreview(): void {
    if (this.previewListeners.size === 0 || this.points.length < MIN_POINTS_FOR_STROKE) return;
    const now = performance.now();
    if (now - this.lastPreviewAt < PREVIEW_INTERVAL_MS) return;
    this.lastPreviewAt = now;
    // 0.1 world units and 0.01 pressure keep 120 points under a 4 KiB presence frame.
    const points = this.points
      .slice(-PREVIEW_MAX_POINTS)
      .map(
        (p) =>
          [
            Math.round(p.x * 10) / 10,
            Math.round(p.y * 10) / 10,
            Math.round(p.pressure * 100) / 100,
          ] as const,
      );
    this.notifyPreview({
      id: this.strokeId,
      points,
      color: this.color,
      width: this.width,
      opacity: this.opacity,
      ...(this.blendMode && { blendMode: this.blendMode }),
    });
  }

  private notifyPreview(preview: StrokePreview): void {
    for (const listener of this.previewListeners) listener(preview);
  }

  renderOverlay(ctx: CanvasRenderingContext2D): void {
    if (!this.drawing || this.points.length < 2) return;

    ctx.save();
    ctx.strokeStyle = this.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Preview a highlighter at its real opacity + blend so it doesn't snap on commit;
    // a normal pencil keeps the lighter 0.8 in-progress affordance.
    ctx.globalAlpha = this.blendMode ? this.opacity : 0.8;
    if (this.blendMode) ctx.globalCompositeOperation = this.blendMode;

    const segments = smoothToSegments(this.points);
    for (const seg of segments) {
      const w =
        (pressureToWidth(seg.start.pressure, this.width) +
          pressureToWidth(seg.end.pressure, this.width)) /
        2;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(seg.start.x, seg.start.y);
      ctx.bezierCurveTo(seg.cp1.x, seg.cp1.y, seg.cp2.x, seg.cp2.y, seg.end.x, seg.end.y);
      ctx.stroke();
    }

    ctx.restore();
  }
}
