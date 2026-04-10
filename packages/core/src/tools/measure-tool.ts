import type { Point } from '../core/types';
import type { HexOrientation } from '../elements/types';
import type { Tool, ToolContext, PointerState } from './types';
import { snapPoint, snapToHexCenter } from '../core/snap';
import { getHexDistance } from '../elements/hex-fill';

export interface MeasureToolOptions {
  feetPerCell?: number;
}

export interface Measurement {
  start: Point;
  end: Point;
  worldDistance: number;
  cells: number;
  feet: number;
}

export class MeasureTool implements Tool {
  readonly name = 'measure';
  private start: Point | null = null;
  private end: Point | null = null;
  private gridSize = 1;
  private gridType: 'square' | 'hex' | undefined;
  private hexOrientation: HexOrientation | undefined;
  private feetPerCell: number;
  private optionListeners = new Set<() => void>();

  constructor(options: MeasureToolOptions = {}) {
    this.feetPerCell = options.feetPerCell ?? 5;
  }

  getOptions(): MeasureToolOptions {
    return { feetPerCell: this.feetPerCell };
  }

  setOptions(options: MeasureToolOptions): void {
    if (options.feetPerCell !== undefined) this.feetPerCell = options.feetPerCell;
    this.notifyOptionsChange();
  }

  onOptionsChange(listener: () => void): () => void {
    this.optionListeners.add(listener);
    return () => this.optionListeners.delete(listener);
  }

  onPointerDown(state: PointerState, ctx: ToolContext): void {
    this.gridSize = ctx.gridSize ?? 1;
    this.gridType = ctx.gridType;
    this.hexOrientation = ctx.hexOrientation;
    const world = ctx.camera.screenToWorld({ x: state.x, y: state.y });
    this.start = this.snapToGrid(world, ctx);
    this.end = { ...this.start };
  }

  onPointerMove(state: PointerState, ctx: ToolContext): void {
    if (!this.start) return;
    const world = ctx.camera.screenToWorld({ x: state.x, y: state.y });
    this.end = this.snapToGrid(world, ctx);
    ctx.requestRender();
  }

  onPointerUp(_state: PointerState, ctx: ToolContext): void {
    if (!this.start) return;
    this.start = null;
    this.end = null;
    ctx.requestRender();
  }

  onDeactivate(_ctx: ToolContext): void {
    this.start = null;
    this.end = null;
  }

  getMeasurement(): Measurement | null {
    if (!this.start || !this.end) return null;
    const dx = this.end.x - this.start.x;
    const dy = this.end.y - this.start.y;
    const worldDistance = Math.sqrt(dx * dx + dy * dy);

    let cells: number;
    if (this.gridType === 'hex' && this.hexOrientation) {
      cells = getHexDistance(this.start, this.end, this.gridSize, this.hexOrientation);
    } else {
      const snapUnit = this.gridSize;
      cells = worldDistance / snapUnit;
    }

    const feet = cells * this.feetPerCell;
    return {
      start: { ...this.start },
      end: { ...this.end },
      worldDistance,
      cells,
      feet,
    };
  }

  renderOverlay(ctx: CanvasRenderingContext2D): void {
    const m = this.getMeasurement();
    if (!m) return;

    ctx.save();

    ctx.strokeStyle = '#FF5722';
    ctx.setLineDash([8, 4]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(m.start.x, m.start.y);
    ctx.lineTo(m.end.x, m.end.y);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.fillStyle = '#FF5722';
    const dotRadius = 4;
    ctx.beginPath();
    ctx.arc(m.start.x, m.start.y, dotRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(m.end.x, m.end.y, dotRadius, 0, Math.PI * 2);
    ctx.fill();

    const label = `${Math.round(m.feet)} ft`;
    const midX = (m.start.x + m.end.x) / 2;
    const midY = (m.start.y + m.end.y) / 2;
    ctx.font = '14px sans-serif';
    const metrics = ctx.measureText(label);
    const padX = 6;
    const padY = 4;
    const textH = 14;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.beginPath();
    ctx.roundRect(
      midX - metrics.width / 2 - padX,
      midY - textH / 2 - padY,
      metrics.width + padX * 2,
      textH + padY * 2,
      4,
    );
    ctx.fill();

    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, midX, midY);

    ctx.restore();
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
