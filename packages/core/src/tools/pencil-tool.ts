import type { StrokePoint } from '../core/types';
import type { Tool, ToolContext, PointerState } from './types';
import { createStroke } from '../elements/element-factory';
import { simplifyPoints, smoothToSegments, pressureToWidth } from '../elements/stroke-smoothing';

export interface PencilToolOptions {
  color?: string;
  width?: number;
  smoothing?: number;
}

const MIN_POINTS_FOR_STROKE = 2;
const DEFAULT_SMOOTHING = 1.5;
const DEFAULT_PRESSURE = 0.5;

export class PencilTool implements Tool {
  readonly name = 'pencil';
  private drawing = false;
  private points: StrokePoint[] = [];
  private color: string;
  private width: number;
  private smoothing: number;

  constructor(options: PencilToolOptions = {}) {
    this.color = options.color ?? '#000000';
    this.width = options.width ?? 2;
    this.smoothing = options.smoothing ?? DEFAULT_SMOOTHING;
  }

  onActivate(ctx: ToolContext): void {
    ctx.setCursor?.('crosshair');
  }

  onDeactivate(ctx: ToolContext): void {
    ctx.setCursor?.('default');
  }

  setOptions(options: PencilToolOptions): void {
    if (options.color !== undefined) this.color = options.color;
    if (options.width !== undefined) this.width = options.width;
    if (options.smoothing !== undefined) this.smoothing = options.smoothing;
  }

  onPointerDown(state: PointerState, ctx: ToolContext): void {
    this.drawing = true;
    const world = ctx.camera.screenToWorld({ x: state.x, y: state.y });
    const pressure = state.pressure === 0 ? DEFAULT_PRESSURE : state.pressure;
    this.points = [{ x: world.x, y: world.y, pressure }];
  }

  onPointerMove(state: PointerState, ctx: ToolContext): void {
    if (!this.drawing) return;
    const world = ctx.camera.screenToWorld({ x: state.x, y: state.y });
    const pressure = state.pressure === 0 ? DEFAULT_PRESSURE : state.pressure;
    this.points.push({ x: world.x, y: world.y, pressure });
    ctx.requestRender();
  }

  onPointerUp(_state: PointerState, ctx: ToolContext): void {
    if (!this.drawing) return;
    this.drawing = false;

    if (this.points.length < MIN_POINTS_FOR_STROKE) {
      this.points = [];
      return;
    }

    const simplified = simplifyPoints(this.points, this.smoothing);
    const stroke = createStroke({
      points: simplified,
      color: this.color,
      width: this.width,
      layerId: ctx.activeLayerId ?? '',
    });
    ctx.store.add(stroke);
    this.points = [];
    ctx.requestRender();
  }

  renderOverlay(ctx: CanvasRenderingContext2D): void {
    if (!this.drawing || this.points.length < 2) return;

    ctx.save();
    ctx.strokeStyle = this.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = 0.8;

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
