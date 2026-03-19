import type { Point } from '../core/types';
import type { Tool, ToolContext, PointerState } from './types';
import { createStroke } from '../elements/element-factory';

export interface PencilToolOptions {
  color?: string;
  width?: number;
}

const MIN_POINTS_FOR_STROKE = 2;

export class PencilTool implements Tool {
  readonly name = 'pencil';
  private drawing = false;
  private points: Point[] = [];
  private color: string;
  private width: number;

  constructor(options: PencilToolOptions = {}) {
    this.color = options.color ?? '#000000';
    this.width = options.width ?? 2;
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
  }

  onPointerDown(state: PointerState, ctx: ToolContext): void {
    this.drawing = true;
    const world = ctx.camera.screenToWorld({ x: state.x, y: state.y });
    this.points = [world];
  }

  onPointerMove(state: PointerState, ctx: ToolContext): void {
    if (!this.drawing) return;
    const world = ctx.camera.screenToWorld({ x: state.x, y: state.y });
    this.points.push(world);
    ctx.requestRender();
  }

  onPointerUp(_state: PointerState, ctx: ToolContext): void {
    if (!this.drawing) return;
    this.drawing = false;

    if (this.points.length < MIN_POINTS_FOR_STROKE) {
      this.points = [];
      return;
    }

    const stroke = createStroke({
      points: this.points,
      color: this.color,
      width: this.width,
    });
    ctx.store.add(stroke);
    this.points = [];
    ctx.requestRender();
  }

  renderOverlay(ctx: CanvasRenderingContext2D): void {
    if (!this.drawing || this.points.length < 2) return;

    ctx.save();
    ctx.strokeStyle = this.color;
    ctx.lineWidth = this.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = 0.8;

    ctx.beginPath();
    const first = this.points[0];
    if (!first) return;
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < this.points.length; i++) {
      const p = this.points[i];
      if (p) ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.restore();
  }
}
