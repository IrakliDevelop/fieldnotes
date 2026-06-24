import type { Bounds, Point } from '../core/types';
import type { Tool, ToolContext, PointerState } from './types';
import { smartSnap } from '../core/snap';
import { rotatePoint, normalizeAngle } from '../core/geometry';
import type { CanvasElement } from '../elements/types';
import { updateArrowsBoundToElements } from '../elements/arrow-binding';
import { getElementBounds } from '../elements/element-bounds';
import { expandToGroups } from '../elements/group';
import { getElementsBoundingBox } from '../elements/bounds';
import { lineFromEndpoints } from '../elements/shape-geometry';
import { translateElementPatch } from '../elements/translate';
import {
  type ArrowHandle,
  hitTestArrowHandles,
  applyArrowHandleDrag,
  getArrowHandleCursor,
  getArrowHandleDragTarget,
} from './arrow-handles';
import { computeSnapGuides } from '../elements/snap-guides';
import type { SnapGuide } from '../elements/snap-guides';
import {
  hitTest,
  hitTestResizeHandle,
  hitTestRotateHandle,
  hitTestLineHandles,
  hitTestTemplateResizeHandle,
  findElementsInRect,
} from './select-hit';
import type { HandlePosition, OverlayLayout } from './select-overlay';
import {
  HANDLE_CURSORS,
  getOverlayLayout,
  renderMarquee,
  renderSelectionBoxes,
  renderGuideLines,
} from './select-overlay';

const SNAP_PX = 6;
const MIN_ELEMENT_SIZE = 20;
const ROTATE_SNAP = Math.PI / 12; // 15°

type Mode =
  | { type: 'idle' }
  | { type: 'dragging' }
  | { type: 'marquee'; start: Point }
  | { type: 'resizing'; elementId: string; handle: HandlePosition }
  | { type: 'resizing-template'; elementId: string }
  | { type: 'arrow-handle'; elementId: string; handle: ArrowHandle }
  | { type: 'line-handle'; elementId: string; fixed: Point }
  | {
      type: 'rotating';
      elementId: string;
      center: Point;
      startPointerAngle: number;
      startRotation: number;
    };

export class SelectTool implements Tool {
  readonly name = 'select';
  private _selectedIds: string[] = [];
  private selectionListeners = new Set<() => void>();
  private mode: Mode = { type: 'idle' };
  private lastWorld: Point = { x: 0, y: 0 };
  private currentWorld: Point = { x: 0, y: 0 };
  private ctx: ToolContext | null = null;
  private pendingSingleSelectId: string | null = null;
  private hasDragged = false;
  private activeGuides: SnapGuide[] = [];
  private dragSnapTargets: Bounds[] | null = null;
  private dragVisibleRect: Bounds | null = null;
  private resizeAspectRatio = 0;
  private hoveredId: string | null = null;

  get selectedIds(): string[] {
    return this._selectedIds;
  }

  onSelectionChange(listener: () => void): () => void {
    this.selectionListeners.add(listener);
    return () => {
      this.selectionListeners.delete(listener);
    };
  }

  private setSelectedIds(ids: string[]): void {
    const prev = this._selectedIds;
    if (prev.length === ids.length && prev.every((id, i) => id === ids[i])) return;
    this._selectedIds = ids;
    for (const listener of this.selectionListeners) listener();
  }

  setSelection(ids: string[]): void {
    this.setSelectedIds(ids);
    this.ctx?.requestRender();
  }

  selectAtPoint(world: Point, ctx: ToolContext): void {
    const hit = hitTest(world, ctx);
    if (!hit) {
      this.setSelectedIds([]);
      return;
    }
    if (this._selectedIds.includes(hit.id)) return;
    this.setSelectedIds(expandToGroups([hit.id], ctx.store.getAll()));
  }

  get isMarqueeActive(): boolean {
    return this.mode.type === 'marquee';
  }

  onActivate(ctx: ToolContext): void {
    this.ctx = ctx;
  }

  onDeactivate(ctx: ToolContext): void {
    this.setSelectedIds([]);
    this.mode = { type: 'idle' };
    this.hoveredId = null;
    this.activeGuides = [];
    this.dragSnapTargets = null;
    this.dragVisibleRect = null;
    ctx.setCursor?.('default');
  }

  private snap(point: Point, ctx: ToolContext): Point {
    return smartSnap(point, ctx);
  }

  onPointerDown(state: PointerState, ctx: ToolContext): void {
    this.ctx = ctx;
    this.setHovered(null, ctx);
    this.dragSnapTargets = null;
    this.dragVisibleRect = null;
    const world = ctx.camera.screenToWorld({ x: state.x, y: state.y });
    this.lastWorld = this.snap(world, ctx);
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

    const lineHit = hitTestLineHandles(world, ctx, this._selectedIds);
    if (lineHit) {
      this.mode = { type: 'line-handle', elementId: lineHit.elementId, fixed: lineHit.fixed };
      ctx.requestRender();
      return;
    }

    const templateResizeHit = hitTestTemplateResizeHandle(world, ctx, this._selectedIds);
    if (templateResizeHit) {
      this.mode = { type: 'resizing-template', elementId: templateResizeHit };
      ctx.requestRender();
      return;
    }

    const rotateHit = hitTestRotateHandle(world, ctx, this._selectedIds);
    if (rotateHit) {
      const el = ctx.store.getById(rotateHit.elementId);
      const layout = el ? this.getOverlayLayout(el, ctx.camera.zoom) : null;
      if (el && layout) {
        this.mode = {
          type: 'rotating',
          elementId: rotateHit.elementId,
          center: layout.center,
          startPointerAngle: Math.atan2(world.y - layout.center.y, world.x - layout.center.x),
          startRotation: el.rotation ?? 0,
        };
        ctx.requestRender();
        return;
      }
    }

    const resizeHit = hitTestResizeHandle(world, ctx, this._selectedIds);
    if (resizeHit) {
      const el = ctx.store.getById(resizeHit.elementId);
      if (el && 'size' in el) {
        this.resizeAspectRatio = el.size.h > 0 ? el.size.w / el.size.h : 0;
        this.mode = {
          type: 'resizing',
          elementId: resizeHit.elementId,
          handle: resizeHit.handle,
        };
        ctx.requestRender();
        return;
      }
    }

    this.pendingSingleSelectId = null;
    this.hasDragged = false;
    const hit = hitTest(world, ctx);
    if (hit) {
      const all = ctx.store.getAll();
      const alreadySelected = this._selectedIds.includes(hit.id);
      if (state.shiftKey) {
        if (alreadySelected) {
          const grp = new Set(expandToGroups([hit.id], all));
          this.setSelectedIds(this._selectedIds.filter((id) => !grp.has(id)));
          this.mode = { type: 'idle' };
        } else {
          this.setSelectedIds(expandToGroups([...this._selectedIds, hit.id], all));
          this.mode = hit.locked ? { type: 'idle' } : { type: 'dragging' };
        }
      } else {
        if (!alreadySelected) {
          this.setSelectedIds(expandToGroups([hit.id], all));
        } else if (this._selectedIds.length > 1) {
          this.pendingSingleSelectId = hit.id;
        }
        this.mode = hit.locked ? { type: 'idle' } : { type: 'dragging' };
      }
    } else {
      this.setSelectedIds([]);
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

    if (this.mode.type === 'line-handle') {
      ctx.setCursor?.('grabbing');
      const el = ctx.store.getById(this.mode.elementId);
      if (el && el.type === 'shape') {
        ctx.store.update(el.id, lineFromEndpoints(this.mode.fixed, world));
      }
      ctx.requestRender();
      return;
    }

    if (this.mode.type === 'resizing-template') {
      ctx.setCursor?.('nwse-resize');
      this.handleTemplateResize(world, ctx);
      return;
    }

    if (this.mode.type === 'rotating') {
      const { elementId, center, startPointerAngle, startRotation } = this.mode;
      const a = Math.atan2(world.y - center.y, world.x - center.x);
      let next = startRotation + (a - startPointerAngle);
      if (state.shiftKey) next = Math.round(next / ROTATE_SNAP) * ROTATE_SNAP;
      ctx.store.update(elementId, { rotation: normalizeAngle(next) });
      ctx.requestRender();
      return;
    }

    if (this.mode.type === 'resizing') {
      ctx.setCursor?.(HANDLE_CURSORS[this.mode.handle]);
      this.handleResize(world, ctx, state.shiftKey);
      return;
    }

    if (this.mode.type === 'dragging' && this._selectedIds.length > 0) {
      this.hasDragged = true;
      ctx.setCursor?.('move');
      const snapped = this.snap(world, ctx);
      const dx = snapped.x - this.lastWorld.x;
      const dy = snapped.y - this.lastWorld.y;
      this.lastWorld = snapped;

      let adjDx = dx;
      let adjDy = dy;
      this.activeGuides = [];
      if (ctx.smartGuides) {
        // Candidates (non-selected visible elements) and the viewport rect don't change
        // during a single-pointer drag, so compute them once per drag and reuse each frame.
        if (this.dragSnapTargets === null) {
          const selSet = new Set(this._selectedIds);
          this.dragVisibleRect = ctx.getVisibleRect?.() ?? null;
          const candidates = (
            this.dragVisibleRect ? ctx.store.queryRect(this.dragVisibleRect) : ctx.store.getAll()
          ).filter((el) => !selSet.has(el.id) && el.type !== 'grid');
          const targets: Bounds[] = [];
          for (const el of candidates) {
            const b = getElementBounds(el);
            if (b) targets.push(b);
          }
          this.dragSnapTargets = targets;
        }
        const selectedEls = this._selectedIds
          .map((id) => ctx.store.getById(id))
          .filter((el): el is CanvasElement => !!el && !el.locked);
        const base = getElementsBoundingBox(selectedEls);
        if (base) {
          const moving: Bounds = { x: base.x + dx, y: base.y + dy, w: base.w, h: base.h };
          const res = computeSnapGuides(moving, this.dragSnapTargets, SNAP_PX / ctx.camera.zoom);
          adjDx = dx + res.dx;
          adjDy = dy + res.dy;
          this.activeGuides = res.guides;
        }
      }

      for (const id of this._selectedIds) {
        const el = ctx.store.getById(id);
        if (!el || el.locked) continue;

        if (el.type === 'arrow') {
          if (el.fromBinding || el.toBinding) {
            continue;
          }

          ctx.store.update(id, {
            position: { x: el.position.x + adjDx, y: el.position.y + adjDy },
            from: { x: el.from.x + adjDx, y: el.from.y + adjDy },
            to: { x: el.to.x + adjDx, y: el.to.y + adjDy },
          });
        } else if (!ctx.smartGuides && ctx.gridType && 'size' in el) {
          const centerX = el.position.x + el.size.w / 2 + adjDx;
          const centerY = el.position.y + el.size.h / 2 + adjDy;
          const snappedCenter = this.snap({ x: centerX, y: centerY }, ctx);
          ctx.store.update(id, {
            position: {
              x: snappedCenter.x - el.size.w / 2,
              y: snappedCenter.y - el.size.h / 2,
            },
          });
        } else {
          ctx.store.update(id, {
            position: { x: el.position.x + adjDx, y: el.position.y + adjDy },
          });
        }
      }

      this.updateArrowsBoundTo(this._selectedIds, ctx);

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
        this.setSelectedIds(expandToGroups(findElementsInRect(rect, ctx), ctx.store.getAll()));
      }
      ctx.requestRender();
    }

    if (!this.hasDragged && this.pendingSingleSelectId !== null) {
      this.setSelectedIds(expandToGroups([this.pendingSingleSelectId], ctx.store.getAll()));
    }
    this.pendingSingleSelectId = null;
    this.hasDragged = false;

    const resizedNoteId = this.mode.type === 'resizing' ? this.mode.elementId : null;

    this.mode = { type: 'idle' };
    this.activeGuides = [];
    this.dragSnapTargets = null;
    this.dragVisibleRect = null;
    ctx.requestRender();
    ctx.setCursor?.('default');

    if (resizedNoteId !== null) {
      const el = ctx.store.getById(resizedNoteId);
      // Runs during tool pointer-up, inside the InputHandler resize transaction, so the
      // height fit coalesces into the same undo step as the resize.
      if (el?.type === 'note') ctx.fitNoteHeight?.(resizedNoteId);
    }
  }

  onHover(state: PointerState, ctx: ToolContext): void {
    const world = ctx.camera.screenToWorld({ x: state.x, y: state.y });
    const hoverId = this.updateHoverCursor(world, ctx);
    this.setHovered(hoverId, ctx);
  }

  renderOverlay(canvasCtx: CanvasRenderingContext2D): void {
    if (this.mode.type === 'marquee') {
      const rect = this.getMarqueeRect();
      if (rect) renderMarquee(canvasCtx, rect);
    }
    if (this.ctx)
      renderSelectionBoxes(canvasCtx, {
        selectedIds: this._selectedIds,
        store: this.ctx.store,
        zoom: this.ctx.camera.zoom,
      });

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

    if (this.hoveredId && this.ctx && this.mode.type === 'idle') {
      if (!this._selectedIds.includes(this.hoveredId)) {
        const el = this.ctx.store.getById(this.hoveredId);
        if (el) {
          const b = getElementBounds(el);
          if (b) {
            canvasCtx.save();
            canvasCtx.strokeStyle = '#2196F3';
            canvasCtx.globalAlpha = 0.35;
            canvasCtx.lineWidth = 1.5 / this.ctx.camera.zoom;
            canvasCtx.setLineDash([]);
            canvasCtx.strokeRect(b.x, b.y, b.w, b.h);
            canvasCtx.restore();
          }
        }
      }
    }

    if (this.mode.type === 'dragging' && this.ctx && this.activeGuides.length)
      renderGuideLines(canvasCtx, {
        guides: this.activeGuides,
        rect: this.dragVisibleRect,
        currentWorld: this.currentWorld,
        zoom: this.ctx.camera.zoom,
      });
  }

  private updateArrowsBoundTo(ids: Iterable<string>, ctx: ToolContext): void {
    updateArrowsBoundToElements(ids, ctx.store);
  }

  nudgeSelection(dx: number, dy: number, ctx: ToolContext): boolean {
    let moved = false;
    for (const id of this._selectedIds) {
      const el = ctx.store.getById(id);
      if (!el || el.locked) continue;
      if (el.type === 'arrow' && (el.fromBinding || el.toBinding)) continue;
      ctx.store.update(id, translateElementPatch(el, dx, dy));
      moved = true;
    }

    if (moved) {
      this.updateArrowsBoundTo(this._selectedIds, ctx);
      ctx.requestRender();
    }
    return moved;
  }

  private updateHoverCursor(world: Point, ctx: ToolContext): string | null {
    const arrowHit = hitTestArrowHandles(world, this._selectedIds, ctx);
    if (arrowHit) {
      ctx.setCursor?.(getArrowHandleCursor(arrowHit.handle, false));
      return null;
    }

    if (hitTestLineHandles(world, ctx, this._selectedIds)) {
      ctx.setCursor?.('grab');
      return null;
    }

    const templateResizeHit = hitTestTemplateResizeHandle(world, ctx, this._selectedIds);
    if (templateResizeHit) {
      ctx.setCursor?.('nwse-resize');
      return null;
    }

    if (hitTestRotateHandle(world, ctx, this._selectedIds)) {
      ctx.setCursor?.('grab');
      return null;
    }

    const resizeHit = hitTestResizeHandle(world, ctx, this._selectedIds);
    if (resizeHit) {
      ctx.setCursor?.(HANDLE_CURSORS[resizeHit.handle]);
      return null;
    }

    const hit = hitTest(world, ctx);
    ctx.setCursor?.(hit ? 'move' : 'default');
    return hit ? hit.id : null;
  }

  private setHovered(id: string | null, ctx: ToolContext): void {
    if (this.hoveredId === id) return;
    this.hoveredId = id;
    ctx.requestRender();
  }

  private handleResize(world: Point, ctx: ToolContext, shiftKey = false): void {
    if (this.mode.type !== 'resizing') return;

    const el = ctx.store.getById(this.mode.elementId);
    if (!el || !('size' in el) || el.locked) return;

    const angle = el.rotation ?? 0;
    if (angle !== 0) {
      this.handleRotatedResize(world, el, angle, ctx, shiftKey);
      return;
    }

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

    if (shiftKey && this.resizeAspectRatio > 0) {
      const absDw = Math.abs(w - el.size.w);
      const absDh = Math.abs(h - el.size.h);
      if (absDw >= absDh) {
        h = w / this.resizeAspectRatio;
      } else {
        w = h * this.resizeAspectRatio;
      }
      if (handle === 'nw' || handle === 'sw') {
        x = el.position.x + el.size.w - w;
      }
      if (handle === 'nw' || handle === 'ne') {
        y = el.position.y + el.size.h - h;
      }
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

    this.updateArrowsBoundTo([this.mode.elementId], ctx);

    ctx.requestRender();
  }

  private anchorOffset(handle: HandlePosition, w: number, h: number): Point {
    switch (handle) {
      case 'se':
        return { x: -w / 2, y: -h / 2 };
      case 'sw':
        return { x: w / 2, y: -h / 2 };
      case 'ne':
        return { x: -w / 2, y: h / 2 };
      case 'nw':
        return { x: w / 2, y: h / 2 };
      default:
        return { x: 0, y: 0 };
    }
  }

  private handleRotatedResize(
    world: Point,
    el: CanvasElement & { size: { w: number; h: number } },
    angle: number,
    ctx: ToolContext,
    shiftKey: boolean,
  ): void {
    if (this.mode.type !== 'resizing') return;
    const { handle } = this.mode;

    const wdx = world.x - this.lastWorld.x;
    const wdy = world.y - this.lastWorld.y;
    this.lastWorld = world;

    // world delta → element local frame (inverse rotation of the vector)
    const cosN = Math.cos(-angle);
    const sinN = Math.sin(-angle);
    const ldx = wdx * cosN - wdy * sinN;
    const ldy = wdx * sinN + wdy * cosN;

    let w = el.size.w;
    let h = el.size.h;
    switch (handle) {
      case 'se':
        w += ldx;
        h += ldy;
        break;
      case 'sw':
        w -= ldx;
        h += ldy;
        break;
      case 'ne':
        w += ldx;
        h -= ldy;
        break;
      case 'nw':
        w -= ldx;
        h -= ldy;
        break;
    }

    if (shiftKey && this.resizeAspectRatio > 0) {
      const absDw = Math.abs(w - el.size.w);
      const absDh = Math.abs(h - el.size.h);
      if (absDw >= absDh) h = w / this.resizeAspectRatio;
      else w = h * this.resizeAspectRatio;
    }
    w = Math.max(w, MIN_ELEMENT_SIZE);
    h = Math.max(h, MIN_ELEMENT_SIZE);

    // anchor (opposite corner) fixed in world space, computed from OLD geometry
    const oldCenter = { x: el.position.x + el.size.w / 2, y: el.position.y + el.size.h / 2 };
    const oldAnchorLocal = this.anchorOffset(handle, el.size.w, el.size.h);
    const anchorWorld = rotatePoint(
      { x: oldCenter.x + oldAnchorLocal.x, y: oldCenter.y + oldAnchorLocal.y },
      oldCenter,
      angle,
    );

    // new center so the anchor stays put: anchorWorld = newCenter + R(angle)·newAnchorLocal
    const newAnchorLocal = this.anchorOffset(handle, w, h);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rotatedAnchor = {
      x: newAnchorLocal.x * cos - newAnchorLocal.y * sin,
      y: newAnchorLocal.x * sin + newAnchorLocal.y * cos,
    };
    const newCenter = { x: anchorWorld.x - rotatedAnchor.x, y: anchorWorld.y - rotatedAnchor.y };
    const position = { x: newCenter.x - w / 2, y: newCenter.y - h / 2 };

    ctx.store.update(this.mode.elementId, { position, size: { w, h } });
    this.updateArrowsBoundTo([this.mode.elementId], ctx);
    ctx.requestRender();
  }

  private getOverlayLayout(el: CanvasElement, zoom: number): OverlayLayout | null {
    return getOverlayLayout(el, zoom);
  }

  private handleTemplateResize(world: Point, ctx: ToolContext): void {
    if (this.mode.type !== 'resizing-template') return;

    const el = ctx.store.getById(this.mode.elementId);
    if (!el || el.type !== 'template' || el.locked) return;

    const dx = world.x - el.position.x;
    const dy = world.y - el.position.y;
    let newRadius = Math.sqrt(dx * dx + dy * dy);

    if (ctx.snapToGrid && ctx.gridSize && ctx.gridSize > 0) {
      const snapUnit = ctx.gridType === 'hex' ? Math.sqrt(3) * ctx.gridSize : ctx.gridSize;
      newRadius = Math.max(snapUnit, Math.round(newRadius / snapUnit) * snapUnit);
    }
    newRadius = Math.max(MIN_ELEMENT_SIZE, newRadius);

    const updates: Record<string, unknown> = { radius: newRadius };
    if (el.feetPerCell != null && ctx.gridSize && ctx.gridSize > 0) {
      const snapUnit = ctx.gridType === 'hex' ? Math.sqrt(3) * ctx.gridSize : ctx.gridSize;
      updates.radiusFeet = (newRadius / snapUnit) * el.feetPerCell;
    }

    ctx.store.update(this.mode.elementId, updates);
    ctx.requestRender();
  }

  private getMarqueeRect(): Bounds | null {
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
}
