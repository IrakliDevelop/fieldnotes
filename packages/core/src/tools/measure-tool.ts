import type { Point } from '../core/types';
import type { HexOrientation } from '../elements/types';
import type { Tool, ToolContext, PointerState } from './types';
import { snapPoint, snapToHexCenter } from '../core/snap';
import { getHexDistance } from '../elements/hex-fill';

export interface MeasureToolOptions {
  feetPerCell?: number;
  color?: string;
}

export interface Measurement {
  start: Point;
  end: Point;
  worldDistance: number;
  cells: number;
  feet: number;
}

/**
 * A raf-coalesced snapshot of the in-progress measurement — the outgoing
 * side of a shared live ruler. Emissions carry world coordinates, derived
 * distance, and the tool's current color so a host can forward them as
 * ephemeral presence without duplicating the tool's input handling.
 * Ephemeral by contract: presence only — never elements, history, or
 * persisted state.
 */
export interface MeasureEmission {
  readonly start: Point;
  readonly end: Point;
  readonly worldDistance: number;
  readonly cells: number;
  readonly feet: number;
  readonly color: string;
}

export class MeasureTool implements Tool {
  readonly name = 'measure';
  private start: Point | null = null;
  private end: Point | null = null;
  private gridSize = 1;
  private gridType: 'square' | 'hex' | undefined;
  private hexOrientation: HexOrientation | undefined;
  private feetPerCell: number;
  private color: string;
  private optionListeners = new Set<() => void>();
  private measurementListeners = new Set<(emission: MeasureEmission | null) => void>();
  private emissionRafId: number | null = null;

  constructor(options: MeasureToolOptions = {}) {
    this.feetPerCell = options.feetPerCell ?? 5;
    this.color = options.color ?? '#FF5722';
  }

  getOptions(): MeasureToolOptions {
    return { feetPerCell: this.feetPerCell, color: this.color };
  }

  setOptions(options: MeasureToolOptions): void {
    if (options.feetPerCell !== undefined) this.feetPerCell = options.feetPerCell;
    if (options.color !== undefined) this.color = options.color;
    this.notifyOptionsChange();
  }

  onOptionsChange(listener: () => void): () => void {
    this.optionListeners.add(listener);
    return () => this.optionListeners.delete(listener);
  }

  /**
   * Subscribes to raf-coalesced measurement snapshots. While a measurement is
   * in progress, listeners receive at most one snapshot per animation frame
   * carrying the latest state; `null` is delivered synchronously when the
   * measurement clears (pointer-up or deactivate). Emissions are ephemeral by
   * contract: presence only — never elements, history, or persisted state.
   */
  onMeasurement(listener: (emission: MeasureEmission | null) => void): () => void {
    this.measurementListeners.add(listener);
    return () => this.measurementListeners.delete(listener);
  }

  onPointerDown(state: PointerState, ctx: ToolContext): void {
    this.gridSize = ctx.gridSize ?? 1;
    this.gridType = ctx.gridType;
    this.hexOrientation = ctx.hexOrientation;
    const world = ctx.camera.screenToWorld({ x: state.x, y: state.y });
    this.start = this.snapToGrid(world, ctx);
    this.end = { ...this.start };
    this.scheduleEmission();
  }

  onPointerMove(state: PointerState, ctx: ToolContext): void {
    if (!this.start) return;
    const world = ctx.camera.screenToWorld({ x: state.x, y: state.y });
    this.end = this.snapToGrid(world, ctx);
    ctx.requestRender();
    this.scheduleEmission();
  }

  onPointerUp(_state: PointerState, ctx: ToolContext): void {
    if (!this.start) return;
    this.start = null;
    this.end = null;
    ctx.requestRender();
    this.emitClear();
  }

  onDeactivate(_ctx: ToolContext): void {
    const wasActive = this.start !== null;
    this.start = null;
    this.end = null;
    if (wasActive) this.emitClear();
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

    ctx.strokeStyle = this.color;
    ctx.setLineDash([8, 4]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(m.start.x, m.start.y);
    ctx.lineTo(m.end.x, m.end.y);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.fillStyle = this.color;
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

  private scheduleEmission(): void {
    if (this.measurementListeners.size === 0) return;
    if (this.emissionRafId !== null) return;
    this.emissionRafId = requestAnimationFrame(() => {
      this.emissionRafId = null;
      const m = this.getMeasurement();
      if (!m) return; // cleared before the frame; the sync null already went out
      this.emit({ ...m, color: this.color });
    });
  }

  private emitClear(): void {
    if (this.emissionRafId !== null) {
      cancelAnimationFrame(this.emissionRafId);
      this.emissionRafId = null;
    }
    if (this.measurementListeners.size === 0) return;
    this.emit(null);
  }

  private emit(emission: MeasureEmission | null): void {
    for (const listener of this.measurementListeners) {
      try {
        listener(emission);
      } catch {
        // A throwing host listener must not break measurement input.
      }
    }
  }
}
