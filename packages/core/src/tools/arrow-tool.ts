import type { Point } from '../core/types';
import type { ArrowStrokeStyle, Binding, CanvasElement } from '../elements/types';
import type { Tool, ToolContext, PointerState } from './types';
import { createArrow } from '../elements/element-factory';
import { findBindTarget, getElementCenter } from '../elements/arrow-binding';
import { getElementBounds } from '../elements/element-bounds';
import { getElbowRoute } from '../elements/elbow-cache';
import { DEFAULT_SELECTION_COLOR } from './selection-color';

const BIND_THRESHOLD = 20;

export interface ArrowToolOptions {
  color?: string;
  width?: number;
  strokeStyle?: ArrowStrokeStyle;
  routing?: 'bezier' | 'elbow';
}

export class ArrowTool implements Tool {
  readonly name = 'arrow';
  private drawing = false;
  private start: Point = { x: 0, y: 0 };
  private end: Point = { x: 0, y: 0 };
  private color: string;
  private width: number;
  private strokeStyle: ArrowStrokeStyle;
  private routing: 'bezier' | 'elbow';
  private fromBinding: Binding | undefined;
  private fromTarget: CanvasElement | null = null;
  private toTarget: CanvasElement | null = null;
  // renderOverlay gets no ToolContext, so keep the colour from the gesture's context.
  private selectionColor = DEFAULT_SELECTION_COLOR;
  private previewArrow: ReturnType<typeof createArrow> | null = null;
  private previewRoute: ReturnType<typeof getElbowRoute> = null;
  private optionListeners = new Set<() => void>();

  constructor(options: ArrowToolOptions = {}) {
    this.color = options.color ?? '#000000';
    this.width = options.width ?? 2;
    this.strokeStyle = options.strokeStyle ?? 'solid';
    this.routing = validateRouting(options.routing ?? 'bezier');
  }

  getOptions(): ArrowToolOptions {
    return {
      color: this.color,
      width: this.width,
      strokeStyle: this.strokeStyle,
      routing: this.routing,
    };
  }

  onOptionsChange(listener: () => void): () => void {
    this.optionListeners.add(listener);
    return () => this.optionListeners.delete(listener);
  }

  setOptions(options: ArrowToolOptions): void {
    const routing = options.routing === undefined ? undefined : validateRouting(options.routing);
    if (options.color !== undefined) this.color = options.color;
    if (options.width !== undefined) this.width = options.width;
    if (options.strokeStyle !== undefined) this.strokeStyle = options.strokeStyle;
    if (routing !== undefined) this.routing = routing;
    this.notifyOptionsChange();
  }

  private notifyOptionsChange(): void {
    for (const listener of this.optionListeners) listener();
  }

  private layerFilter(ctx: ToolContext): ((el: CanvasElement) => boolean) | undefined {
    const activeLayerId = ctx.activeLayerId;
    if (!activeLayerId && !ctx.isLayerVisible && !ctx.isLayerLocked) return undefined;
    return (el: CanvasElement) => {
      if (activeLayerId && el.layerId !== activeLayerId) return false;
      if (ctx.isLayerVisible && !ctx.isLayerVisible(el.layerId)) return false;
      if (ctx.isLayerLocked && ctx.isLayerLocked(el.layerId)) return false;
      return true;
    };
  }

  onPointerDown(state: PointerState, ctx: ToolContext): void {
    this.drawing = true;
    this.selectionColor = ctx.selectionColor ?? DEFAULT_SELECTION_COLOR;
    const world = ctx.camera.screenToWorld({ x: state.x, y: state.y });
    const threshold = BIND_THRESHOLD / ctx.camera.zoom;
    const filter = this.layerFilter(ctx);

    const target = findBindTarget(world, ctx.store, threshold, undefined, filter);
    if (target) {
      this.start = getElementCenter(target);
      this.fromBinding = { elementId: target.id };
      this.fromTarget = target;
    } else {
      const cs = ctx.constraintService;
      this.start = cs?.isActive ? cs.constrainPoint(world) : world;
      this.fromBinding = undefined;
      this.fromTarget = null;
    }
    this.end = { ...this.start };
    this.toTarget = null;
    this.previewArrow =
      this.routing === 'elbow'
        ? createArrow({
            from: this.start,
            to: this.end,
            position: this.start,
            color: this.color,
            width: this.width,
            strokeStyle: this.strokeStyle,
            fromBinding: this.fromBinding,
            routing: 'elbow',
            layerId: ctx.activeLayerId ?? '',
          })
        : null;
    this.previewRoute = null;
  }

  onPointerMove(state: PointerState, ctx: ToolContext): void {
    if (!this.drawing) return;
    const world = ctx.camera.screenToWorld({ x: state.x, y: state.y });
    const threshold = BIND_THRESHOLD / ctx.camera.zoom;
    const excludeId = this.fromBinding?.elementId;
    const filter = this.layerFilter(ctx);

    const target = findBindTarget(world, ctx.store, threshold, excludeId, filter);
    if (target) {
      this.end = getElementCenter(target);
      this.toTarget = target;
    } else {
      const cs = ctx.constraintService;
      this.end = cs?.isActive ? cs.constrainPoint(world) : world;
      this.toTarget = null;
    }
    if (this.previewArrow) {
      this.previewArrow.to = this.end;
      this.previewArrow.toBinding = this.toTarget ? { elementId: this.toTarget.id } : undefined;
      this.previewRoute = getElbowRoute(ctx.store, this.previewArrow);
    }
    ctx.requestOverlayRender();
  }

  onPointerUp(_state: PointerState, ctx: ToolContext): void {
    if (!this.drawing) return;
    this.drawing = false;

    if (this.start.x === this.end.x && this.start.y === this.end.y) {
      this.previewArrow = null;
      this.previewRoute = null;
      return;
    }

    const arrow = createArrow({
      from: this.start,
      to: this.end,
      position: this.start,
      color: this.color,
      width: this.width,
      strokeStyle: this.strokeStyle,
      routing: this.routing === 'elbow' ? 'elbow' : undefined,
      fromBinding: this.fromBinding,
      toBinding: this.toTarget ? { elementId: this.toTarget.id } : undefined,
      layerId: ctx.activeLayerId ?? '',
    });
    ctx.store.add(arrow);
    this.fromTarget = null;
    this.toTarget = null;
    this.previewArrow = null;
    this.previewRoute = null;
    ctx.requestRender();
    ctx.switchTool?.('select');
  }

  /** Pinch takeover or platform cancel: abandon the arrow without creating it. */
  onPointerCancel(_state: PointerState, ctx: ToolContext): void {
    if (!this.drawing) return;
    this.drawing = false;
    this.fromTarget = null;
    this.toTarget = null;
    this.fromBinding = undefined;
    this.previewArrow = null;
    this.previewRoute = null;
    ctx.requestOverlayRender();
  }

  renderOverlay(ctx: CanvasRenderingContext2D): void {
    if (!this.drawing) return;
    if (this.start.x === this.end.x && this.start.y === this.end.y) return;

    ctx.save();

    if (this.fromTarget) {
      const bounds = getElementBounds(this.fromTarget);
      if (bounds) {
        ctx.strokeStyle = this.selectionColor;
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h);
      }
    }

    if (this.toTarget) {
      const bounds = getElementBounds(this.toTarget);
      if (bounds) {
        ctx.strokeStyle = this.selectionColor;
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
    const points = this.previewRoute?.points;
    const routeStart = points?.[0] ?? this.start;
    const routeEnd = points?.at(-1) ?? this.end;
    ctx.moveTo(routeStart.x, routeStart.y);
    if (points) {
      for (let index = 1; index < points.length; index++) {
        const point = points[index];
        if (point) ctx.lineTo(point.x, point.y);
      }
    } else ctx.lineTo(this.end.x, this.end.y);
    ctx.stroke();

    const beforeEnd = points?.at(-2) ?? this.start;
    const angle = Math.atan2(routeEnd.y - beforeEnd.y, routeEnd.x - beforeEnd.x);
    const headLen = 12;
    const headAngle = Math.PI / 6;

    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.moveTo(routeEnd.x, routeEnd.y);
    ctx.lineTo(
      routeEnd.x - headLen * Math.cos(angle - headAngle),
      routeEnd.y - headLen * Math.sin(angle - headAngle),
    );
    ctx.lineTo(
      routeEnd.x - headLen * Math.cos(angle + headAngle),
      routeEnd.y - headLen * Math.sin(angle + headAngle),
    );
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

function validateRouting(routing: unknown): 'bezier' | 'elbow' {
  if (routing === 'bezier' || routing === 'elbow') return routing;
  throw new TypeError('Invalid arrow routing');
}
