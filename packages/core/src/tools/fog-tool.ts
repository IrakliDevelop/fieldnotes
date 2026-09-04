import type { Point } from '../core/types';
import type { Tool, ToolContext, PointerState } from './types';
import type { FogManager } from '../fog/fog-manager';
import type { FogOperation, FogRegion, FogToolOptions } from '../fog/types';

const DEFAULT_RADIUS = 40;
const MIN_POINT_DISTANCE = 4;

export class FogTool implements Tool {
  readonly name = 'fog';
  private drawing = false;
  private points: Point[] = [];
  private startPoint: Point | null = null;
  private operation: FogOperation;
  private shape: 'brush' | 'rectangle' | 'polygon';
  private radius: number;
  private readonly manager: FogManager;
  private optionListeners = new Set<() => void>();

  constructor(manager: FogManager, options: FogToolOptions = {}) {
    this.manager = manager;
    this.operation = options.operation ?? 'reveal';
    this.shape = options.shape ?? 'brush';
    this.radius = options.radius ?? DEFAULT_RADIUS;
  }

  onActivate(ctx: ToolContext): void {
    ctx.setCursor?.('crosshair');
  }

  onDeactivate(ctx: ToolContext): void {
    this.cancelGesture(ctx);
    ctx.setCursor?.('default');
  }

  getOptions(): FogToolOptions {
    return {
      operation: this.operation,
      shape: this.shape,
      radius: this.radius,
    };
  }

  setOptions(options: FogToolOptions): void {
    if (options.operation !== undefined) this.operation = options.operation;
    if (options.shape !== undefined) this.shape = options.shape;
    if (options.radius !== undefined && Number.isFinite(options.radius) && options.radius > 0) {
      this.radius = options.radius;
    }
    for (const listener of this.optionListeners) listener();
  }

  onOptionsChange(listener: () => void): () => void {
    this.optionListeners.add(listener);
    return () => this.optionListeners.delete(listener);
  }

  onPointerDown(state: PointerState, ctx: ToolContext): void {
    if (this.drawing) return;
    this.drawing = true;
    const world = ctx.camera.screenToWorld({ x: state.x, y: state.y });
    this.startPoint = world;
    this.points = [world];
    ctx.requestRender();
  }

  onPointerMove(state: PointerState, ctx: ToolContext): void {
    if (!this.drawing) return;
    const world = ctx.camera.screenToWorld({ x: state.x, y: state.y });

    if (this.shape === 'rectangle') {
      if (this.startPoint) this.points = [this.startPoint, world];
    } else {
      const last = this.points[this.points.length - 1];
      if (last) {
        const dx = world.x - last.x;
        const dy = world.y - last.y;
        if (dx * dx + dy * dy < MIN_POINT_DISTANCE * MIN_POINT_DISTANCE) return;
      }
      this.points.push(world);
    }
    ctx.requestRender();
  }

  onPointerUp(_state: PointerState, ctx: ToolContext): void {
    if (!this.drawing) return;
    this.drawing = false;

    const region = this.buildRegion();
    if (region) {
      this.manager.applyRegion(region, this.operation);
    }

    this.points = [];
    this.startPoint = null;
    ctx.requestRender();
  }

  onPointerCancel(_state: PointerState, ctx: ToolContext): void {
    this.cancelGesture(ctx);
  }

  onKeyDown(event: KeyboardEvent, ctx: ToolContext): boolean {
    if (event.key === 'Escape' && this.drawing) {
      this.cancelGesture(ctx);
      return true;
    }
    return false;
  }

  renderOverlay(ctx: CanvasRenderingContext2D): void {
    if (!this.drawing || this.points.length === 0) return;

    ctx.save();
    ctx.strokeStyle = this.operation === 'reveal' ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.4)';
    ctx.fillStyle = this.operation === 'reveal' ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);

    switch (this.shape) {
      case 'brush':
        this.renderBrushPreview(ctx);
        break;
      case 'rectangle':
        this.renderRectanglePreview(ctx);
        break;
      case 'polygon':
        this.renderPolygonPreview(ctx);
        break;
    }

    ctx.restore();
  }

  private buildRegion(): FogRegion | null {
    switch (this.shape) {
      case 'brush': {
        if (this.points.length === 0) return null;
        return { kind: 'brush', points: this.points, radius: this.radius };
      }
      case 'rectangle': {
        if (!this.startPoint || this.points.length < 2) return null;
        const end = this.points[this.points.length - 1] as Point;
        if (this.startPoint.x === end.x && this.startPoint.y === end.y) return null;
        return { kind: 'rectangle', from: this.startPoint, to: end };
      }
      case 'polygon': {
        if (this.points.length < 3) return null;
        return { kind: 'polygon', points: this.points };
      }
    }
  }

  private cancelGesture(ctx: ToolContext): void {
    this.drawing = false;
    this.points = [];
    this.startPoint = null;
    ctx.requestRender();
  }

  private renderBrushPreview(ctx: CanvasRenderingContext2D): void {
    if (this.points.length === 1) {
      const p = this.points[0] as Point;
      ctx.beginPath();
      ctx.arc(p.x, p.y, this.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      return;
    }
    ctx.beginPath();
    for (let i = 0; i < this.points.length; i++) {
      const p = this.points[i] as Point;
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.lineWidth = this.radius * 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  private renderRectanglePreview(ctx: CanvasRenderingContext2D): void {
    if (this.points.length < 2) return;
    const from = this.points[0] as Point;
    const to = this.points[this.points.length - 1] as Point;
    const x = Math.min(from.x, to.x);
    const y = Math.min(from.y, to.y);
    const w = Math.abs(to.x - from.x);
    const h = Math.abs(to.y - from.y);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
  }

  private renderPolygonPreview(ctx: CanvasRenderingContext2D): void {
    if (this.points.length < 2) return;
    const first = this.points[0] as Point;
    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < this.points.length; i++) {
      const p = this.points[i] as Point;
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}
