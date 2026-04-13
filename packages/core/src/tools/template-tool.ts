import type { Point } from '../core/types';
import type { TemplateShape, HexOrientation } from '../elements/types';
import type { Tool, ToolContext, PointerState } from './types';
import { createTemplate } from '../elements/element-factory';
import { snapPoint, snapToHexCenter } from '../core/snap';
import {
  getHexCellsInRadius,
  getHexCellsInCone,
  getHexCellsInLine,
  getHexCellsInSquare,
  drawHexPath,
} from '../elements/hex-fill';

export interface TemplateToolOptions {
  templateShape?: TemplateShape;
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  opacity?: number;
  feetPerCell?: number;
}

export class TemplateTool implements Tool {
  readonly name = 'template';
  private drawing = false;
  private origin: Point = { x: 0, y: 0 };
  private current: Point = { x: 0, y: 0 };
  private gridSize = 1;
  private gridType: 'square' | 'hex' | undefined;
  private hexOrientation: HexOrientation | undefined;
  private snapEnabled = false;
  private templateShape: TemplateShape;
  private fillColor: string;
  private strokeColor: string;
  private strokeWidth: number;
  private opacity: number;
  private feetPerCell: number;
  private optionListeners = new Set<() => void>();

  constructor(options: TemplateToolOptions = {}) {
    this.templateShape = options.templateShape ?? 'circle';
    this.fillColor = options.fillColor ?? 'rgba(255, 87, 34, 0.2)';
    this.strokeColor = options.strokeColor ?? '#FF5722';
    this.strokeWidth = options.strokeWidth ?? 2;
    this.opacity = options.opacity ?? 0.6;
    this.feetPerCell = options.feetPerCell ?? 5;
  }

  getOptions(): TemplateToolOptions {
    return {
      templateShape: this.templateShape,
      fillColor: this.fillColor,
      strokeColor: this.strokeColor,
      strokeWidth: this.strokeWidth,
      opacity: this.opacity,
      feetPerCell: this.feetPerCell,
    };
  }

  setOptions(options: TemplateToolOptions): void {
    if (options.templateShape !== undefined) this.templateShape = options.templateShape;
    if (options.fillColor !== undefined) this.fillColor = options.fillColor;
    if (options.strokeColor !== undefined) this.strokeColor = options.strokeColor;
    if (options.strokeWidth !== undefined) this.strokeWidth = options.strokeWidth;
    if (options.opacity !== undefined) this.opacity = options.opacity;
    if (options.feetPerCell !== undefined) this.feetPerCell = options.feetPerCell;
    this.notifyOptionsChange();
  }

  onOptionsChange(listener: () => void): () => void {
    this.optionListeners.add(listener);
    return () => this.optionListeners.delete(listener);
  }

  onPointerDown(state: PointerState, ctx: ToolContext): void {
    this.drawing = true;
    this.gridSize = ctx.gridSize ?? 1;
    this.gridType = ctx.gridType;
    this.hexOrientation = ctx.hexOrientation;
    this.snapEnabled = !!ctx.gridType || (ctx.snapToGrid ?? false);
    const world = ctx.camera.screenToWorld({ x: state.x, y: state.y });
    this.origin = this.snapToGrid(world, ctx);
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
    const gridSize = ctx.gridSize;
    const snapUnit =
      gridSize && gridSize > 0 ? (ctx.gridType === 'hex' ? Math.sqrt(3) * gridSize : gridSize) : 0;
    const cells = snapUnit > 0 ? radius / snapUnit : 0;
    const radiusFeet = cells * this.feetPerCell;

    const element = createTemplate({
      position: { ...this.origin },
      templateShape: this.templateShape,
      radius,
      angle,
      fillColor: this.fillColor,
      strokeColor: this.strokeColor,
      strokeWidth: this.strokeWidth,
      opacity: this.opacity,
      feetPerCell: this.feetPerCell,
      radiusFeet: radiusFeet > 0 ? radiusFeet : undefined,
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

    if (this.gridType === 'hex' && this.hexOrientation) {
      this.renderHexOverlay(ctx, radius);
      return;
    }

    this.renderGeometricOverlay(ctx, radius);
  }

  private renderGeometricOverlay(ctx: CanvasRenderingContext2D, radius: number): void {
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

  private renderHexOverlay(ctx: CanvasRenderingContext2D, radius: number): void {
    const orientation = this.hexOrientation;
    if (!orientation) return;
    const cellSize = this.gridSize;
    const snapUnit = Math.sqrt(3) * cellSize;
    const radiusCells = radius / snapUnit;
    const angle = this.computeAngle();
    const center = this.origin;

    let hexCells: Point[];
    switch (this.templateShape) {
      case 'circle':
        hexCells = getHexCellsInRadius(center, radiusCells, cellSize, orientation);
        break;
      case 'cone':
        hexCells = getHexCellsInCone(center, angle, radiusCells, cellSize, orientation);
        break;
      case 'line':
        hexCells = getHexCellsInLine(center, angle, radiusCells, cellSize, orientation);
        break;
      case 'square':
        hexCells = getHexCellsInSquare(center, radiusCells, cellSize, orientation);
        break;
    }

    ctx.save();
    ctx.globalAlpha = 0.4;

    ctx.beginPath();
    for (const cell of hexCells) {
      drawHexPath(ctx, cell.x, cell.y, cellSize, orientation);
    }
    ctx.fillStyle = this.fillColor;
    ctx.fill();

    ctx.beginPath();
    for (const cell of hexCells) {
      drawHexPath(ctx, cell.x, cell.y, cellSize, orientation);
    }
    ctx.strokeStyle = this.strokeColor;
    ctx.lineWidth = this.strokeWidth;
    ctx.stroke();

    if (
      this.templateShape === 'cone' ||
      this.templateShape === 'line' ||
      this.templateShape === 'circle' ||
      this.templateShape === 'square'
    ) {
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      drawHexPath(ctx, center.x, center.y, cellSize, orientation);
      ctx.fillStyle = this.strokeColor;
      ctx.fill();
      ctx.strokeStyle = this.strokeColor;
      ctx.lineWidth = this.strokeWidth;
      ctx.stroke();
    }

    if (this.templateShape === 'circle') {
      const feet = radiusCells * this.feetPerCell;
      if (feet > 0) {
        ctx.globalAlpha = 1;
        const label = `${Math.round(feet)} ft`;
        const fontSize = Math.max(10, Math.min(14, radius * 0.15));
        ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const textX = center.x;
        const textY = center.y - 4;

        const metrics = ctx.measureText(label);
        const padX = 4;
        const padY = 2;
        const textW = metrics.width + padX * 2;
        const textH = fontSize + padY * 2;

        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.beginPath();
        ctx.roundRect(textX - textW / 2, textY - textH, textW, textH, 3);
        ctx.fill();

        ctx.fillStyle = this.strokeColor;
        ctx.fillText(label, textX, textY - padY);
      }
    }

    ctx.restore();
  }

  private computeRadius(): number {
    const dx = this.current.x - this.origin.x;
    const dy = this.current.y - this.origin.y;
    const raw = Math.sqrt(dx * dx + dy * dy);
    if (this.snapEnabled && this.gridSize > 0) {
      const snapUnit = this.gridType === 'hex' ? Math.sqrt(3) * this.gridSize : this.gridSize;
      return Math.max(snapUnit, Math.round(raw / snapUnit) * snapUnit);
    }
    return raw;
  }

  private computeAngle(): number {
    const dx = this.current.x - this.origin.x;
    const dy = this.current.y - this.origin.y;
    return Math.atan2(dy, dx);
  }

  private snapToGrid(point: Point, ctx: ToolContext): Point {
    if (!ctx.gridSize) return point;
    if (ctx.gridType === 'hex' && ctx.hexOrientation) {
      return snapToHexCenter(point, ctx.gridSize, ctx.hexOrientation);
    }
    if (ctx.gridType === 'square') {
      return snapPoint(point, ctx.gridSize);
    }
    if (ctx.snapToGrid) {
      return snapPoint(point, ctx.gridSize);
    }
    return point;
  }

  private notifyOptionsChange(): void {
    for (const listener of this.optionListeners) listener();
  }
}
