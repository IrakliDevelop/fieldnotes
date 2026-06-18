import type { Point } from '../core/types';
import type { ShapeKind } from '../elements/types';
import type { Tool, ToolContext, PointerState } from './types';
import { createShape } from '../elements/element-factory';
import { smartSnap } from '../core/snap';

function snapTo45(start: Point, end: Point): Point {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { ...end };
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: start.x + Math.cos(angle) * len, y: start.y + Math.sin(angle) * len };
}

export interface ShapeToolOptions {
  shape?: ShapeKind;
  strokeColor?: string;
  strokeWidth?: number;
  fillColor?: string;
}

export class ShapeTool implements Tool {
  readonly name = 'shape';
  private drawing = false;
  private start: Point = { x: 0, y: 0 };
  private end: Point = { x: 0, y: 0 };
  private shiftHeld = false;
  private shape: ShapeKind;
  private strokeColor: string;
  private strokeWidth: number;
  private fillColor: string;
  private optionListeners = new Set<() => void>();

  constructor(options: ShapeToolOptions = {}) {
    this.shape = options.shape ?? 'rectangle';
    this.strokeColor = options.strokeColor ?? '#000000';
    this.strokeWidth = options.strokeWidth ?? 2;
    this.fillColor = options.fillColor ?? 'none';
  }

  getOptions(): ShapeToolOptions {
    return {
      shape: this.shape,
      strokeColor: this.strokeColor,
      strokeWidth: this.strokeWidth,
      fillColor: this.fillColor,
    };
  }

  onOptionsChange(listener: () => void): () => void {
    this.optionListeners.add(listener);
    return () => this.optionListeners.delete(listener);
  }

  setOptions(options: ShapeToolOptions): void {
    if (options.shape !== undefined) this.shape = options.shape;
    if (options.strokeColor !== undefined) this.strokeColor = options.strokeColor;
    if (options.strokeWidth !== undefined) this.strokeWidth = options.strokeWidth;
    if (options.fillColor !== undefined) this.fillColor = options.fillColor;
    this.notifyOptionsChange();
  }

  onActivate(_ctx: ToolContext): void {
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.onKeyDown);
      window.addEventListener('keyup', this.onKeyUp);
    }
  }

  onDeactivate(_ctx: ToolContext): void {
    this.shiftHeld = false;
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onKeyDown);
      window.removeEventListener('keyup', this.onKeyUp);
    }
  }

  onPointerDown(state: PointerState, ctx: ToolContext): void {
    this.drawing = true;
    this.start = this.snap(ctx.camera.screenToWorld({ x: state.x, y: state.y }), ctx);
    this.end = { ...this.start };
  }

  onPointerMove(state: PointerState, ctx: ToolContext): void {
    if (!this.drawing) return;
    this.end = this.snap(ctx.camera.screenToWorld({ x: state.x, y: state.y }), ctx);
    if (this.shape === 'line' && this.shiftHeld) {
      this.end = snapTo45(this.start, this.end);
    }
    ctx.requestRender();
  }

  onPointerUp(_state: PointerState, ctx: ToolContext): void {
    if (!this.drawing) return;
    this.drawing = false;

    const { position, size } = this.computeRect();
    const isLine = this.shape === 'line';
    if (isLine ? size.w === 0 && size.h === 0 : size.w === 0 || size.h === 0) return;

    const shape = createShape({
      position,
      size,
      shape: this.shape,
      strokeColor: this.strokeColor,
      strokeWidth: this.strokeWidth,
      fillColor: this.fillColor,
      ...(isLine ? { flip: this.end.x > this.start.x !== this.end.y > this.start.y } : {}),
      layerId: ctx.activeLayerId ?? '',
    });
    ctx.store.add(shape);
    ctx.requestRender();
    ctx.switchTool?.('select');
  }

  renderOverlay(ctx: CanvasRenderingContext2D): void {
    if (!this.drawing) return;

    const { position, size } = this.computeRect();
    if (size.w === 0 && size.h === 0) return;

    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = this.strokeColor;
    ctx.lineWidth = this.strokeWidth;

    if (this.fillColor !== 'none') {
      ctx.fillStyle = this.fillColor;
    }

    switch (this.shape) {
      case 'rectangle':
        if (this.fillColor !== 'none') {
          ctx.fillRect(position.x, position.y, size.w, size.h);
        }
        ctx.strokeRect(position.x, position.y, size.w, size.h);
        break;
      case 'ellipse': {
        const cx = position.x + size.w / 2;
        const cy = position.y + size.h / 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, size.w / 2, size.h / 2, 0, 0, Math.PI * 2);
        if (this.fillColor !== 'none') ctx.fill();
        ctx.stroke();
        break;
      }
      case 'line':
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(this.start.x, this.start.y);
        ctx.lineTo(this.end.x, this.end.y);
        ctx.stroke();
        break;
    }

    ctx.restore();
  }

  private computeRect(): { position: Point; size: { w: number; h: number } } {
    let x = Math.min(this.start.x, this.end.x);
    let y = Math.min(this.start.y, this.end.y);
    let w = Math.abs(this.end.x - this.start.x);
    let h = Math.abs(this.end.y - this.start.y);

    if (this.shiftHeld && this.shape !== 'line') {
      const side = Math.max(w, h);
      w = side;
      h = side;
      x = this.end.x >= this.start.x ? this.start.x : this.start.x - side;
      y = this.end.y >= this.start.y ? this.start.y : this.start.y - side;
    }

    return { position: { x, y }, size: { w, h } };
  }

  private notifyOptionsChange(): void {
    for (const listener of this.optionListeners) listener();
  }

  private snap(point: Point, ctx: ToolContext): Point {
    return smartSnap(point, ctx);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Shift') this.shiftHeld = true;
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === 'Shift') this.shiftHeld = false;
  };
}
