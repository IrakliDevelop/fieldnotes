import type { Point } from '../core/types';
import type { Tool, ToolContext, PointerState } from './types';
import { smartSnap } from '../core/snap';

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
  private measuring = false;
  private start: Point | null = null;
  private end: Point | null = null;
  private gridSize = 1;
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
    this.measuring = true;
    this.gridSize = ctx.gridSize ?? 1;
    const world = ctx.camera.screenToWorld({ x: state.x, y: state.y });
    this.start = smartSnap(world, ctx);
    this.end = { ...this.start };
  }

  onPointerMove(state: PointerState, ctx: ToolContext): void {
    if (!this.measuring) return;
    const world = ctx.camera.screenToWorld({ x: state.x, y: state.y });
    this.end = smartSnap(world, ctx);
    ctx.requestRender();
  }

  onPointerUp(_state: PointerState, ctx: ToolContext): void {
    if (!this.measuring) return;
    this.measuring = false;
    this.start = null;
    this.end = null;
    ctx.requestRender();
  }

  getMeasurement(): Measurement | null {
    if (!this.start || !this.end) return null;
    const dx = this.end.x - this.start.x;
    const dy = this.end.y - this.start.y;
    const worldDistance = Math.sqrt(dx * dx + dy * dy);
    const cells = worldDistance / this.gridSize;
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
    const pillW = metrics.width + padX * 2;
    const pillH = 14 + padY * 2;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    const pillX = midX - pillW / 2;
    const pillY = midY - pillH / 2;
    const r = pillH / 2;
    ctx.beginPath();
    ctx.moveTo(pillX + r, pillY);
    ctx.lineTo(pillX + pillW - r, pillY);
    ctx.arcTo(pillX + pillW, pillY, pillX + pillW, pillY + r, r);
    ctx.arcTo(pillX + pillW, pillY + pillH, pillX + pillW - r, pillY + pillH, r);
    ctx.lineTo(pillX + r, pillY + pillH);
    ctx.arcTo(pillX, pillY + pillH, pillX, pillY + pillH - r, r);
    ctx.arcTo(pillX, pillY, pillX + r, pillY, r);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, midX, midY);

    ctx.restore();
  }

  private notifyOptionsChange(): void {
    for (const listener of this.optionListeners) listener();
  }
}
