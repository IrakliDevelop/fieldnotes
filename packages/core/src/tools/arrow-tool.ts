import type { Point } from '../core/types';
import type { Binding, CanvasElement } from '../elements/types';
import type { Tool, ToolContext, PointerState } from './types';
import { createArrow } from '../elements/element-factory';
import { findBindTarget, getElementCenter, getElementBounds } from '../elements/arrow-binding';
import { snapPoint } from '../core/snap';

const BIND_THRESHOLD = 20;

export interface ArrowToolOptions {
  color?: string;
  width?: number;
}

export class ArrowTool implements Tool {
  readonly name = 'arrow';
  private drawing = false;
  private start: Point = { x: 0, y: 0 };
  private end: Point = { x: 0, y: 0 };
  private color: string;
  private width: number;
  private fromBinding: Binding | undefined;
  private fromTarget: CanvasElement | null = null;
  private toTarget: CanvasElement | null = null;

  constructor(options: ArrowToolOptions = {}) {
    this.color = options.color ?? '#000000';
    this.width = options.width ?? 2;
  }

  setOptions(options: ArrowToolOptions): void {
    if (options.color !== undefined) this.color = options.color;
    if (options.width !== undefined) this.width = options.width;
  }

  onPointerDown(state: PointerState, ctx: ToolContext): void {
    this.drawing = true;
    const world = ctx.camera.screenToWorld({ x: state.x, y: state.y });
    const threshold = BIND_THRESHOLD / ctx.camera.zoom;

    const target = findBindTarget(world, ctx.store, threshold);
    if (target) {
      this.start = getElementCenter(target);
      this.fromBinding = { elementId: target.id };
      this.fromTarget = target;
    } else {
      this.start = ctx.snapToGrid && ctx.gridSize ? snapPoint(world, ctx.gridSize) : world;
      this.fromBinding = undefined;
      this.fromTarget = null;
    }
    this.end = { ...this.start };
    this.toTarget = null;
  }

  onPointerMove(state: PointerState, ctx: ToolContext): void {
    if (!this.drawing) return;
    const world = ctx.camera.screenToWorld({ x: state.x, y: state.y });
    const threshold = BIND_THRESHOLD / ctx.camera.zoom;
    const excludeId = this.fromBinding?.elementId;

    const target = findBindTarget(world, ctx.store, threshold, excludeId);
    if (target) {
      this.end = getElementCenter(target);
      this.toTarget = target;
    } else {
      this.end = ctx.snapToGrid && ctx.gridSize ? snapPoint(world, ctx.gridSize) : world;
      this.toTarget = null;
    }
    ctx.requestRender();
  }

  onPointerUp(_state: PointerState, ctx: ToolContext): void {
    if (!this.drawing) return;
    this.drawing = false;

    if (this.start.x === this.end.x && this.start.y === this.end.y) return;

    const arrow = createArrow({
      from: this.start,
      to: this.end,
      position: this.start,
      color: this.color,
      width: this.width,
      fromBinding: this.fromBinding,
      toBinding: this.toTarget ? { elementId: this.toTarget.id } : undefined,
    });
    ctx.store.add(arrow);
    this.fromTarget = null;
    this.toTarget = null;
    ctx.requestRender();
    ctx.switchTool?.('select');
  }

  renderOverlay(ctx: CanvasRenderingContext2D): void {
    if (!this.drawing) return;
    if (this.start.x === this.end.x && this.start.y === this.end.y) return;

    ctx.save();

    if (this.fromTarget) {
      const bounds = getElementBounds(this.fromTarget);
      if (bounds) {
        ctx.strokeStyle = '#2196F3';
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h);
      }
    }

    if (this.toTarget) {
      const bounds = getElementBounds(this.toTarget);
      if (bounds) {
        ctx.strokeStyle = '#2196F3';
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h);
      }
    }

    ctx.strokeStyle = this.color;
    ctx.lineWidth = this.width;
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.6;

    ctx.beginPath();
    ctx.moveTo(this.start.x, this.start.y);
    ctx.lineTo(this.end.x, this.end.y);
    ctx.stroke();

    const angle = Math.atan2(this.end.y - this.start.y, this.end.x - this.start.x);
    const headLen = 12;
    const headAngle = Math.PI / 6;

    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.moveTo(this.end.x, this.end.y);
    ctx.lineTo(
      this.end.x - headLen * Math.cos(angle - headAngle),
      this.end.y - headLen * Math.sin(angle - headAngle),
    );
    ctx.lineTo(
      this.end.x - headLen * Math.cos(angle + headAngle),
      this.end.y - headLen * Math.sin(angle + headAngle),
    );
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
