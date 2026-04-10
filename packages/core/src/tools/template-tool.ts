import type { Point } from '../core/types';
import type { TemplateShape } from '../elements/types';
import type { Tool, ToolContext, PointerState } from './types';
import { createTemplate } from '../elements/element-factory';
import { smartSnap } from '../core/snap';

export interface TemplateToolOptions {
  templateShape?: TemplateShape;
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  opacity?: number;
}

export class TemplateTool implements Tool {
  readonly name = 'template';
  private drawing = false;
  private origin: Point = { x: 0, y: 0 };
  private current: Point = { x: 0, y: 0 };
  private gridSize = 1;
  private snapEnabled = false;
  private templateShape: TemplateShape;
  private fillColor: string;
  private strokeColor: string;
  private strokeWidth: number;
  private opacity: number;
  private optionListeners = new Set<() => void>();

  constructor(options: TemplateToolOptions = {}) {
    this.templateShape = options.templateShape ?? 'circle';
    this.fillColor = options.fillColor ?? 'rgba(255, 87, 34, 0.2)';
    this.strokeColor = options.strokeColor ?? '#FF5722';
    this.strokeWidth = options.strokeWidth ?? 2;
    this.opacity = options.opacity ?? 0.6;
  }

  getOptions(): TemplateToolOptions {
    return {
      templateShape: this.templateShape,
      fillColor: this.fillColor,
      strokeColor: this.strokeColor,
      strokeWidth: this.strokeWidth,
      opacity: this.opacity,
    };
  }

  setOptions(options: TemplateToolOptions): void {
    if (options.templateShape !== undefined) this.templateShape = options.templateShape;
    if (options.fillColor !== undefined) this.fillColor = options.fillColor;
    if (options.strokeColor !== undefined) this.strokeColor = options.strokeColor;
    if (options.strokeWidth !== undefined) this.strokeWidth = options.strokeWidth;
    if (options.opacity !== undefined) this.opacity = options.opacity;
    this.notifyOptionsChange();
  }

  onOptionsChange(listener: () => void): () => void {
    this.optionListeners.add(listener);
    return () => this.optionListeners.delete(listener);
  }

  onPointerDown(state: PointerState, ctx: ToolContext): void {
    this.drawing = true;
    this.gridSize = ctx.gridSize ?? 1;
    this.snapEnabled = ctx.snapToGrid ?? false;
    const world = ctx.camera.screenToWorld({ x: state.x, y: state.y });
    this.origin = smartSnap(world, ctx);
    this.current = { ...this.origin };
  }

  onPointerMove(state: PointerState, ctx: ToolContext): void {
    if (!this.drawing) return;
    this.current = ctx.camera.screenToWorld({ x: state.x, y: state.y });
    ctx.requestRender();
  }

  onPointerUp(_state: PointerState, ctx: ToolContext): void {
    if (!this.drawing) return;
    this.drawing = false;

    const radius = this.computeRadius();
    if (radius <= 0) return;

    const angle = this.computeAngle();
    const element = createTemplate({
      position: { ...this.origin },
      templateShape: this.templateShape,
      radius,
      angle,
      fillColor: this.fillColor,
      strokeColor: this.strokeColor,
      strokeWidth: this.strokeWidth,
      opacity: this.opacity,
      layerId: ctx.activeLayerId ?? '',
    });
    ctx.store.add(element);
    ctx.requestRender();
    ctx.switchTool?.('select');
  }

  onDeactivate(_ctx: ToolContext): void {
    this.drawing = false;
    this.origin = { x: 0, y: 0 };
    this.current = { x: 0, y: 0 };
  }

  renderOverlay(ctx: CanvasRenderingContext2D): void {
    if (!this.drawing) return;

    const radius = this.computeRadius();
    if (radius <= 0) return;

    const cx = this.origin.x;
    const cy = this.origin.y;
    const angle = this.computeAngle();

    ctx.save();
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = this.fillColor;
    ctx.strokeStyle = this.strokeColor;
    ctx.lineWidth = this.strokeWidth;

    switch (this.templateShape) {
      case 'circle':
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        break;

      case 'square':
        ctx.fillRect(cx - radius / 2, cy - radius / 2, radius, radius);
        ctx.strokeRect(cx - radius / 2, cy - radius / 2, radius, radius);
        break;

      case 'cone': {
        const halfAngle = Math.atan(0.5);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius, angle - halfAngle, angle + halfAngle);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
      }

      case 'line': {
        const halfW = radius / 12;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const perpX = -sin * halfW;
        const perpY = cos * halfW;

        ctx.beginPath();
        ctx.moveTo(cx + perpX, cy + perpY);
        ctx.lineTo(cx + radius * cos + perpX, cy + radius * sin + perpY);
        ctx.lineTo(cx + radius * cos - perpX, cy + radius * sin - perpY);
        ctx.lineTo(cx - perpX, cy - perpY);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
      }
    }

    ctx.restore();
  }

  private computeRadius(): number {
    const dx = this.current.x - this.origin.x;
    const dy = this.current.y - this.origin.y;
    const raw = Math.sqrt(dx * dx + dy * dy);
    if (this.snapEnabled && this.gridSize > 0) {
      return Math.round(raw / this.gridSize) * this.gridSize;
    }
    return raw;
  }

  private computeAngle(): number {
    const dx = this.current.x - this.origin.x;
    const dy = this.current.y - this.origin.y;
    return Math.atan2(dy, dx);
  }

  private notifyOptionsChange(): void {
    for (const listener of this.optionListeners) listener();
  }
}
