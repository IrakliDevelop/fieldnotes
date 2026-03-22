import type { Point } from '../core/types';
import type { Tool, ToolContext, PointerState } from './types';
import type { CanvasElement, ArrowElement } from '../elements/types';
import { isNearBezier, getArrowBounds } from '../elements/arrow-geometry';
import type { Rect } from '../elements/arrow-geometry';
import { findBoundArrows, updateBoundArrow, getElementBounds } from '../elements/arrow-binding';
import {
  type ArrowHandle,
  hitTestArrowHandles,
  applyArrowHandleDrag,
  renderArrowHandles,
  getArrowHandleCursor,
  getArrowHandleDragTarget,
} from './arrow-handles';

type HandlePosition = 'nw' | 'ne' | 'sw' | 'se';

const HANDLE_SIZE = 8;
const HANDLE_HIT_PADDING = 4;
const SELECTION_PAD = 4;
const MIN_ELEMENT_SIZE = 20;

const HANDLE_CURSORS: Record<HandlePosition, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
};

type Mode =
  | { type: 'idle' }
  | { type: 'dragging' }
  | { type: 'marquee'; start: Point }
  | { type: 'resizing'; elementId: string; handle: HandlePosition }
  | { type: 'arrow-handle'; elementId: string; handle: ArrowHandle };

export class SelectTool implements Tool {
  readonly name = 'select';
  private _selectedIds: string[] = [];
  private mode: Mode = { type: 'idle' };
  private lastWorld: Point = { x: 0, y: 0 };
  private currentWorld: Point = { x: 0, y: 0 };
  private ctx: ToolContext | null = null;

  get selectedIds(): string[] {
    return [...this._selectedIds];
  }

  get isMarqueeActive(): boolean {
    return this.mode.type === 'marquee';
  }

  onActivate(ctx: ToolContext): void {
    this.ctx = ctx;
  }

  onDeactivate(ctx: ToolContext): void {
    this._selectedIds = [];
    this.mode = { type: 'idle' };
    ctx.setCursor?.('default');
  }

  onPointerDown(state: PointerState, ctx: ToolContext): void {
    this.ctx = ctx;
    const world = ctx.camera.screenToWorld({ x: state.x, y: state.y });
    this.lastWorld = world;
    this.currentWorld = world;

    const arrowHit = hitTestArrowHandles(world, this._selectedIds, ctx);
    if (arrowHit) {
      this.mode = {
        type: 'arrow-handle',
        elementId: arrowHit.elementId,
        handle: arrowHit.handle,
      };
      ctx.requestRender();
      return;
    }

    const resizeHit = this.hitTestResizeHandle(world, ctx);
    if (resizeHit) {
      const el = ctx.store.getById(resizeHit.elementId);
      if (el) {
        this.mode = {
          type: 'resizing',
          elementId: resizeHit.elementId,
          handle: resizeHit.handle,
        };
        ctx.requestRender();
        return;
      }
    }

    const hit = this.hitTest(world, ctx);
    if (hit) {
      const alreadySelected = this._selectedIds.includes(hit.id);
      if (!alreadySelected) {
        this._selectedIds = [hit.id];
      }
      this.mode = hit.locked ? { type: 'idle' } : { type: 'dragging' };
    } else {
      this._selectedIds = [];
      this.mode = { type: 'marquee', start: world };
    }

    ctx.requestRender();
  }

  onPointerMove(state: PointerState, ctx: ToolContext): void {
    const world = ctx.camera.screenToWorld({ x: state.x, y: state.y });
    this.currentWorld = world;

    if (this.mode.type === 'arrow-handle') {
      ctx.setCursor?.(getArrowHandleCursor(this.mode.handle, true));
      applyArrowHandleDrag(this.mode.handle, this.mode.elementId, world, ctx);
      return;
    }

    if (this.mode.type === 'resizing') {
      ctx.setCursor?.(HANDLE_CURSORS[this.mode.handle]);
      this.handleResize(world, ctx);
      return;
    }

    if (this.mode.type === 'dragging' && this._selectedIds.length > 0) {
      ctx.setCursor?.('move');
      const dx = world.x - this.lastWorld.x;
      const dy = world.y - this.lastWorld.y;
      this.lastWorld = world;

      for (const id of this._selectedIds) {
        const el = ctx.store.getById(id);
        if (!el || el.locked) continue;

        if (el.type === 'arrow') {
          if (el.fromBinding || el.toBinding) {
            // Arrow has bindings — don't allow independent dragging.
            // Use handle drag to detach individual endpoints.
            continue;
          }

          ctx.store.update(id, {
            position: { x: el.position.x + dx, y: el.position.y + dy },
            from: { x: el.from.x + dx, y: el.from.y + dy },
            to: { x: el.to.x + dx, y: el.to.y + dy },
          });
        } else {
          ctx.store.update(id, {
            position: { x: el.position.x + dx, y: el.position.y + dy },
          });
        }
      }

      // Update any arrows bound to moved elements
      const movedNonArrowIds = new Set<string>();
      for (const id of this._selectedIds) {
        const el = ctx.store.getById(id);
        if (el && el.type !== 'arrow') movedNonArrowIds.add(id);
      }

      if (movedNonArrowIds.size > 0) {
        const updatedArrows = new Set<string>();
        for (const id of movedNonArrowIds) {
          const boundArrows = findBoundArrows(id, ctx.store);
          for (const ba of boundArrows) {
            if (updatedArrows.has(ba.id)) continue;
            updatedArrows.add(ba.id);
            const updates = updateBoundArrow(ba, ctx.store);
            if (updates) ctx.store.update(ba.id, updates);
          }
        }
      }

      ctx.requestRender();
      return;
    }

    if (this.mode.type === 'marquee') {
      ctx.setCursor?.('crosshair');
      ctx.requestRender();
      return;
    }

    this.updateHoverCursor(world, ctx);
  }

  onPointerUp(_state: PointerState, ctx: ToolContext): void {
    if (this.mode.type === 'marquee') {
      const rect = this.getMarqueeRect();
      if (rect) {
        this._selectedIds = this.findElementsInRect(rect, ctx);
      }
      ctx.requestRender();
    }

    this.mode = { type: 'idle' };
    ctx.setCursor?.('default');
  }

  onHover(state: PointerState, ctx: ToolContext): void {
    const world = ctx.camera.screenToWorld({ x: state.x, y: state.y });
    this.updateHoverCursor(world, ctx);
  }

  renderOverlay(canvasCtx: CanvasRenderingContext2D): void {
    this.renderMarquee(canvasCtx);
    this.renderSelectionBoxes(canvasCtx);

    if (this.mode.type === 'arrow-handle' && this.ctx) {
      const target = getArrowHandleDragTarget(
        this.mode.handle,
        this.mode.elementId,
        this.currentWorld,
        this.ctx,
      );
      if (target) {
        canvasCtx.save();
        canvasCtx.strokeStyle = '#2196F3';
        canvasCtx.lineWidth = 2 / this.ctx.camera.zoom;
        canvasCtx.setLineDash([]);
        canvasCtx.strokeRect(target.x, target.y, target.w, target.h);
        canvasCtx.restore();
      }
    }
  }

  private updateHoverCursor(world: Point, ctx: ToolContext): void {
    const arrowHit = hitTestArrowHandles(world, this._selectedIds, ctx);
    if (arrowHit) {
      ctx.setCursor?.(getArrowHandleCursor(arrowHit.handle, false));
      return;
    }

    const resizeHit = this.hitTestResizeHandle(world, ctx);
    if (resizeHit) {
      ctx.setCursor?.(HANDLE_CURSORS[resizeHit.handle]);
      return;
    }

    const hit = this.hitTest(world, ctx);
    ctx.setCursor?.(hit ? 'move' : 'default');
  }

  private handleResize(world: Point, ctx: ToolContext): void {
    if (this.mode.type !== 'resizing') return;

    const el = ctx.store.getById(this.mode.elementId);
    if (!el || !('size' in el) || el.locked) return;

    const { handle } = this.mode;
    const dx = world.x - this.lastWorld.x;
    const dy = world.y - this.lastWorld.y;
    this.lastWorld = world;

    let { x, y, w, h } = { x: el.position.x, y: el.position.y, w: el.size.w, h: el.size.h };

    switch (handle) {
      case 'se':
        w += dx;
        h += dy;
        break;
      case 'sw':
        x += dx;
        w -= dx;
        h += dy;
        break;
      case 'ne':
        y += dy;
        w += dx;
        h -= dy;
        break;
      case 'nw':
        x += dx;
        y += dy;
        w -= dx;
        h -= dy;
        break;
    }

    if (w < MIN_ELEMENT_SIZE) {
      if (handle === 'nw' || handle === 'sw') x = el.position.x + el.size.w - MIN_ELEMENT_SIZE;
      w = MIN_ELEMENT_SIZE;
    }
    if (h < MIN_ELEMENT_SIZE) {
      if (handle === 'nw' || handle === 'ne') y = el.position.y + el.size.h - MIN_ELEMENT_SIZE;
      h = MIN_ELEMENT_SIZE;
    }

    ctx.store.update(this.mode.elementId, {
      position: { x, y },
      size: { w, h },
    });

    // Update arrows bound to the resized element
    const boundArrows = findBoundArrows(this.mode.elementId, ctx.store);
    for (const ba of boundArrows) {
      const updates = updateBoundArrow(ba, ctx.store);
      if (updates) ctx.store.update(ba.id, updates);
    }

    ctx.requestRender();
  }

  private hitTestResizeHandle(
    world: Point,
    ctx: ToolContext,
  ): { elementId: string; handle: HandlePosition } | null {
    if (this._selectedIds.length === 0) return null;

    const zoom = ctx.camera.zoom;
    const handleHalf = (HANDLE_SIZE / 2 + HANDLE_HIT_PADDING) / zoom;

    for (const id of this._selectedIds) {
      const el = ctx.store.getById(id);
      if (!el || !('size' in el)) continue;

      const bounds = this.getElementBounds(el);
      if (!bounds) continue;

      const corners = this.getHandlePositions(bounds);
      for (const [handle, pos] of corners) {
        if (Math.abs(world.x - pos.x) <= handleHalf && Math.abs(world.y - pos.y) <= handleHalf) {
          return { elementId: id, handle };
        }
      }
    }

    return null;
  }

  private getHandlePositions(bounds: Rect): [HandlePosition, Point][] {
    return [
      ['nw', { x: bounds.x, y: bounds.y }],
      ['ne', { x: bounds.x + bounds.w, y: bounds.y }],
      ['sw', { x: bounds.x, y: bounds.y + bounds.h }],
      ['se', { x: bounds.x + bounds.w, y: bounds.y + bounds.h }],
    ];
  }

  private renderMarquee(canvasCtx: CanvasRenderingContext2D): void {
    if (this.mode.type !== 'marquee') return;

    const rect = this.getMarqueeRect();
    if (!rect) return;

    canvasCtx.save();
    canvasCtx.strokeStyle = '#2196F3';
    canvasCtx.fillStyle = 'rgba(33, 150, 243, 0.08)';
    canvasCtx.lineWidth = 1;
    canvasCtx.setLineDash([4, 4]);
    canvasCtx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    canvasCtx.fillRect(rect.x, rect.y, rect.w, rect.h);
    canvasCtx.restore();
  }

  private renderSelectionBoxes(canvasCtx: CanvasRenderingContext2D): void {
    if (this._selectedIds.length === 0 || !this.ctx) return;

    const zoom = this.ctx.camera.zoom;
    const handleWorldSize = HANDLE_SIZE / zoom;

    canvasCtx.save();
    canvasCtx.strokeStyle = '#2196F3';
    canvasCtx.lineWidth = 1.5 / zoom;
    canvasCtx.setLineDash([4 / zoom, 4 / zoom]);

    for (const id of this._selectedIds) {
      const el = this.ctx.store.getById(id);
      if (!el) continue;

      if (el.type === 'arrow') {
        renderArrowHandles(canvasCtx, el, zoom);
        this.renderBindingHighlights(canvasCtx, el, zoom);
        continue;
      }

      const bounds = this.getElementBounds(el);
      if (!bounds) continue;

      const pad = SELECTION_PAD / zoom;
      canvasCtx.strokeRect(bounds.x - pad, bounds.y - pad, bounds.w + pad * 2, bounds.h + pad * 2);

      if ('size' in el) {
        canvasCtx.setLineDash([]);
        canvasCtx.fillStyle = '#ffffff';
        const corners = this.getHandlePositions(bounds);
        for (const [, pos] of corners) {
          canvasCtx.fillRect(
            pos.x - handleWorldSize / 2,
            pos.y - handleWorldSize / 2,
            handleWorldSize,
            handleWorldSize,
          );
          canvasCtx.strokeRect(
            pos.x - handleWorldSize / 2,
            pos.y - handleWorldSize / 2,
            handleWorldSize,
            handleWorldSize,
          );
        }
        canvasCtx.setLineDash([4 / zoom, 4 / zoom]);
      }
    }

    canvasCtx.restore();
  }

  private renderBindingHighlights(
    canvasCtx: CanvasRenderingContext2D,
    arrow: ArrowElement,
    zoom: number,
  ): void {
    if (!this.ctx) return;
    if (!arrow.fromBinding && !arrow.toBinding) return;

    const pad = SELECTION_PAD / zoom;

    canvasCtx.save();
    canvasCtx.strokeStyle = '#2196F3';
    canvasCtx.lineWidth = 2 / zoom;
    canvasCtx.setLineDash([]);

    const drawn = new Set<string>();
    for (const binding of [arrow.fromBinding, arrow.toBinding]) {
      if (!binding || drawn.has(binding.elementId)) continue;
      drawn.add(binding.elementId);

      const target = this.ctx.store.getById(binding.elementId);
      if (!target) continue;

      const bounds = getElementBounds(target);
      if (!bounds) continue;

      canvasCtx.strokeRect(bounds.x - pad, bounds.y - pad, bounds.w + pad * 2, bounds.h + pad * 2);
    }

    canvasCtx.restore();
  }

  private getMarqueeRect(): Rect | null {
    if (this.mode.type !== 'marquee') return null;

    const { start } = this.mode;
    const end = this.currentWorld;
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const w = Math.abs(end.x - start.x);
    const h = Math.abs(end.y - start.y);

    if (w === 0 && h === 0) return null;
    return { x, y, w, h };
  }

  private findElementsInRect(marquee: Rect, ctx: ToolContext): string[] {
    const ids: string[] = [];
    for (const el of ctx.store.getAll()) {
      const bounds = this.getElementBounds(el);
      if (bounds && this.rectsOverlap(marquee, bounds)) {
        ids.push(el.id);
      }
    }
    return ids;
  }

  private rectsOverlap(a: Rect, b: Rect): boolean {
    return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
  }

  private getElementBounds(el: CanvasElement): Rect | null {
    if ('size' in el) {
      return { x: el.position.x, y: el.position.y, w: el.size.w, h: el.size.h };
    }
    if (el.type === 'stroke' && el.points.length > 0) {
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const p of el.points) {
        const px = p.x + el.position.x;
        const py = p.y + el.position.y;
        if (px < minX) minX = px;
        if (py < minY) minY = py;
        if (px > maxX) maxX = px;
        if (py > maxY) maxY = py;
      }
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
    if (el.type === 'arrow') {
      return getArrowBounds(el.from, el.to, el.bend);
    }
    return null;
  }

  private hitTest(world: Point, ctx: ToolContext): CanvasElement | null {
    const elements = ctx.store.getAll().reverse();
    for (const el of elements) {
      if (this.isInsideBounds(world, el)) return el;
    }
    return null;
  }

  private isInsideBounds(point: Point, el: CanvasElement): boolean {
    if ('size' in el) {
      const s = el.size;
      return (
        point.x >= el.position.x &&
        point.x <= el.position.x + s.w &&
        point.y >= el.position.y &&
        point.y <= el.position.y + s.h
      );
    }

    if (el.type === 'stroke') {
      const HIT_RADIUS = 10;
      return el.points.some((p) => {
        const dx = p.x + el.position.x - point.x;
        const dy = p.y + el.position.y - point.y;
        return dx * dx + dy * dy <= HIT_RADIUS * HIT_RADIUS;
      });
    }

    if (el.type === 'arrow') {
      return isNearBezier(point, el.from, el.to, el.bend, 10);
    }

    return false;
  }
}
