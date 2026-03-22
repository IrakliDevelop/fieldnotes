import type { Point } from '../core/types';
import type { ShapeKind } from '../elements/types';
import type { Tool, ToolContext, PointerState } from './types';
import { createShape } from '../elements/element-factory';

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

  constructor(options: ShapeToolOptions = {}) {
    this.shape = options.shape ?? 'rectangle';
    this.strokeColor = options.strokeColor ?? '#000000';
    this.strokeWidth = options.strokeWidth ?? 2;
    this.fillColor = options.fillColor ?? 'none';
  }

  setOptions(options: ShapeToolOptions): void {
    if (options.shape !== undefined) this.shape = options.shape;
    if (options.strokeColor !== undefined) this.strokeColor = options.strokeColor;
    if (options.strokeWidth !== undefined) this.strokeWidth = options.strokeWidth;
    if (options.fillColor !== undefined) this.fillColor = options.fillColor;
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
    this.start = ctx.camera.screenToWorld({ x: state.x, y: state.y });
    this.end = { ...this.start };
  }

  onPointerMove(state: PointerState, ctx: ToolContext): void {
    if (!this.drawing) return;
    this.end = ctx.camera.screenToWorld({ x: state.x, y: state.y });
    ctx.requestRender();
  }

  onPointerUp(_state: PointerState, ctx: ToolContext): void {
    if (!this.drawing) return;
    this.drawing = false;

    const { position, size } = this.computeRect();
    if (size.w === 0 || size.h === 0) return;

    const shape = createShape({
      position,
      size,
      shape: this.shape,
      strokeColor: this.strokeColor,
      strokeWidth: this.strokeWidth,
      fillColor: this.fillColor,
    });
    ctx.store.add(shape);
    ctx.requestRender();
    ctx.switchTool?.('select');
  }

  renderOverlay(ctx: CanvasRenderingContext2D): void {
    if (!this.drawing) return;

    const { position, size } = this.computeRect();
    if (size.w === 0 || size.h === 0) return;

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
    }

    ctx.restore();
  }

  private computeRect(): { position: Point; size: { w: number; h: number } } {
    let x = Math.min(this.start.x, this.end.x);
    let y = Math.min(this.start.y, this.end.y);
    let w = Math.abs(this.end.x - this.start.x);
    let h = Math.abs(this.end.y - this.start.y);

    if (this.shiftHeld) {
      const side = Math.max(w, h);
      w = side;
      h = side;
      x = this.end.x >= this.start.x ? this.start.x : this.start.x - side;
      y = this.end.y >= this.start.y ? this.start.y : this.start.y - side;
    }

    return { position: { x, y }, size: { w, h } };
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Shift') this.shiftHeld = true;
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === 'Shift') this.shiftHeld = false;
  };
}
