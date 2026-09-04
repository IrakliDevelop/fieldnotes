import type { Camera } from './camera';
import type { Background } from './background';
import type { ElementStore } from '../elements/element-store';
import type { ElementRenderer } from '../elements/element-renderer';
import type { ToolManager } from '../tools/tool-manager';
import type { LayerManager } from '../layers/layer-manager';
import type { DomNodeManager } from './dom-node-manager';
import type { LayerCache } from './layer-cache';
import type { MarginViewport } from './margin-viewport';
import type { Bounds } from '../core/types';
import type { CanvasElement } from '../elements/types';
import { getElementVisualBounds, boundsIntersect } from '../elements/element-bounds';
import { RenderStats } from './render-stats';
import type { RenderStatsSnapshot } from './render-stats';
import type { HybridRenderSurface } from './hybrid-render-surface';
import type { FogRenderer } from '../fog/fog-renderer';

/**
 * A world-space draw callback rendered above elements on every frame,
 * regardless of which tool is active. The context arrives with the camera
 * transform applied; implementations must not assume exclusive context state
 * (each renderer is wrapped in save/restore). A throwing renderer is isolated
 * per frame and must not break the render loop.
 */
export type OverlayRenderer = (ctx: CanvasRenderingContext2D) => void;

export interface RenderLoopDeps {
  canvasEl: HTMLCanvasElement;
  camera: Camera;
  background: Background;
  store: ElementStore;
  renderer: ElementRenderer;
  toolManager: ToolManager;
  layerManager: LayerManager;
  domNodeManager: DomNodeManager;
  layerCache: LayerCache;
  marginViewport: MarginViewport;
  hybridSurface: HybridRenderSurface;
  fogRenderer?: FogRenderer;
}

export class RenderLoop {
  private needsRender = false;
  private animFrameId = 0;
  private readonly canvasEl: HTMLCanvasElement;
  private readonly camera: Camera;
  private readonly background: Background;
  private readonly store: ElementStore;
  private readonly renderer: ElementRenderer;
  private readonly toolManager: ToolManager;
  private readonly layerManager: LayerManager;
  private readonly domNodeManager: DomNodeManager;
  private readonly layerCache: LayerCache;
  private readonly marginViewport: MarginViewport;
  private readonly hybridSurface: HybridRenderSurface;
  private readonly fogRenderer?: FogRenderer;
  private activeDrawingLayerId: string | null = null;
  private gridCacheDirty = true; // set on recenter/viewport-change; consumed by the grid block
  private readonly stats = new RenderStats();
  private layerGroups = new Map<string, CanvasElement[]>();
  private readonly overlays = new Set<OverlayRenderer>();
  private gridCacheCanvas: HTMLCanvasElement | null = null;
  private gridCacheCtx: CanvasRenderingContext2D | null = null;
  private lastGridRefs: CanvasElement[] = [];
  private htmlScratchCanvas: HTMLCanvasElement | null = null;
  private htmlScratchCtx: CanvasRenderingContext2D | null = null;

  constructor(deps: RenderLoopDeps) {
    this.canvasEl = deps.canvasEl;
    this.camera = deps.camera;
    this.background = deps.background;
    this.store = deps.store;
    this.renderer = deps.renderer;
    this.toolManager = deps.toolManager;
    this.layerManager = deps.layerManager;
    this.domNodeManager = deps.domNodeManager;
    this.layerCache = deps.layerCache;
    this.marginViewport = deps.marginViewport;
    this.hybridSurface = deps.hybridSurface;
    this.fogRenderer = deps.fogRenderer;
  }

  requestRender(): void {
    this.needsRender = true;
  }

  flush(): void {
    if (this.needsRender) {
      this.render();
      this.needsRender = false;
    }
  }

  start(): void {
    const loop = (): void => {
      if (this.needsRender) {
        this.render();
        this.needsRender = false;
      }
      this.animFrameId = requestAnimationFrame(loop);
    };
    this.animFrameId = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.animFrameId);
  }

  setCanvasSize(width: number, height: number): void {
    this.canvasEl.width = width;
    this.canvasEl.height = height;
    const dpr = typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1;
    this.marginViewport.setViewport(width / dpr, height / dpr, dpr);
    this.layerCache.resize();
  }

  setActiveDrawingLayer(layerId: string | null): void {
    this.activeDrawingLayerId = layerId;
  }

  markLayerDirty(layerId: string): void {
    this.layerCache.markDirty(layerId);
  }

  markAllLayersDirty(): void {
    this.layerCache.markAllDirty();
    this.gridCacheDirty = true;
  }

  getStats(): RenderStatsSnapshot {
    return this.stats.getSnapshot();
  }

  /**
   * Registers a viewport overlay drawn beneath the active tool's own overlay.
   * Returns an idempotent unsubscribe that also erases the overlay's last
   * frame.
   */
  registerOverlay(draw: OverlayRenderer): () => void {
    this.overlays.add(draw);
    this.requestRender();
    return () => {
      if (this.overlays.delete(draw)) this.requestRender();
    };
  }

  private drawRegisteredOverlays(ctx: CanvasRenderingContext2D): void {
    for (const draw of this.overlays) {
      ctx.save();
      try {
        draw(ctx);
      } catch {
        // One faulty overlay must not take down the frame or its siblings.
      } finally {
        ctx.restore();
      }
    }
  }

  private compositeLayerCache(
    ctx: CanvasRenderingContext2D,
    layerId: string,
    opacity: number,
  ): void {
    const cached = this.layerCache.getCanvas(layerId);
    const offset = this.marginViewport.compositeOffset(
      this.camera.position.x,
      this.camera.position.y,
    );
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = opacity;
    ctx.drawImage(cached as CanvasImageSource, offset.x, offset.y);
    ctx.restore();
  }

  private ensureGridCache(): void {
    const w = this.marginViewport.physicalWidth();
    const h = this.marginViewport.physicalHeight();
    if (
      this.gridCacheCanvas !== null &&
      this.gridCacheCanvas.width === w &&
      this.gridCacheCanvas.height === h
    ) {
      return;
    }

    if (typeof OffscreenCanvas !== 'undefined') {
      this.gridCacheCanvas = new OffscreenCanvas(w, h) as unknown as HTMLCanvasElement;
    } else if (typeof document !== 'undefined') {
      const el = document.createElement('canvas');
      el.width = w;
      el.height = h;
      this.gridCacheCanvas = el;
    } else {
      this.gridCacheCanvas = null;
      this.gridCacheCtx = null;
      return;
    }

    this.gridCacheCtx = this.gridCacheCanvas.getContext('2d') as CanvasRenderingContext2D | null;
  }

  /**
   * Lazily allocated, and only ever touched by the translucent-layer html branch below.
   * Grow-only: the branch runs once per element per frame, and reassigning `width` or
   * `height` reallocates the backing store, so shrinking to each element in turn would
   * thrash. The requested size is always clipped to the visible canvas by
   * `htmlScratchRect`, so this stays bounded by the canvas itself.
   */
  private ensureHtmlScratch(w: number, h: number): CanvasRenderingContext2D | null {
    if (this.htmlScratchCanvas === null || this.htmlScratchCtx === null) {
      if (typeof OffscreenCanvas !== 'undefined') {
        this.htmlScratchCanvas = new OffscreenCanvas(w, h) as unknown as HTMLCanvasElement;
      } else if (typeof document !== 'undefined') {
        this.htmlScratchCanvas = document.createElement('canvas');
      } else {
        return null;
      }
      this.htmlScratchCtx = this.htmlScratchCanvas.getContext(
        '2d',
      ) as CanvasRenderingContext2D | null;
      if (this.htmlScratchCtx === null) {
        this.htmlScratchCanvas = null;
        return null;
      }
    }
    if (this.htmlScratchCanvas.width < w) this.htmlScratchCanvas.width = w;
    if (this.htmlScratchCanvas.height < h) this.htmlScratchCanvas.height = h;
    return this.htmlScratchCtx;
  }

  /**
   * The device-pixel footprint an element occupies on the hybrid surface: its world
   * bounds mapped through the same `scale(dpr) -> translate(cam) -> scale(zoom)` chain
   * the hybrid context uses, snapped OUT to whole pixels (so the clip edge's antialiased
   * pixel is included) and intersected with the surface.
   *
   * Null when nothing of the element lands on the surface. That includes the case where
   * the surface has no pixels at all: a host hiding the viewport (`display: none`) drives
   * `canvasEl.width` to 0 via `syncCanvasSize`, culling does not go degenerate with it,
   * and a zero-dimension canvas throws `InvalidStateError` when used as a `drawImage`
   * SOURCE — which would escape `render()` and kill the frame loop permanently.
   * Non-finite bounds fail the same `>= 1` test and are rejected here too.
   */
  private htmlScratchRect(bounds: Bounds | null, dpr: number): Bounds | null {
    let left = 0;
    let top = 0;
    let right = this.canvasEl.width;
    let bottom = this.canvasEl.height;
    if (bounds) {
      const zoom = this.camera.zoom;
      const camX = this.camera.position.x;
      const camY = this.camera.position.y;
      left = Math.max(left, Math.floor((bounds.x * zoom + camX) * dpr));
      top = Math.max(top, Math.floor((bounds.y * zoom + camY) * dpr));
      right = Math.min(right, Math.ceil(((bounds.x + bounds.w) * zoom + camX) * dpr));
      bottom = Math.min(bottom, Math.ceil(((bounds.y + bounds.h) * zoom + camY) * dpr));
    }
    const w = right - left;
    const h = bottom - top;
    if (!(w >= 1) || !(h >= 1)) return null;
    return { x: left, y: top, w, h };
  }

  /**
   * Draws one canvas-routed html element on the hybrid stratum with the layer-opacity
   * boundary the painter contract requires: paint at `globalAlpha === 1` into a scratch
   * surface, then composite that raster at the layer's opacity. Mirrors `exportImage`'s
   * per-layer temp canvas and the minimap's layer composite.
   *
   * The scratch covers only the element's own device-pixel rect, the way
   * `rasterizeCanvasRoutedHtml` sizes its offscreen to the element rather than the export
   * bounds. That is exact rather than approximate because `paintHtmlElement` clips every
   * painter to the element's (rotated) rect, so nothing can land outside those bounds.
   * The offset is whole device pixels and the blit is 1:1, so the element occupies
   * exactly the pixels a full-canvas scratch would have given it.
   */
  private paintHybridHtmlAtLayerOpacity(
    hybridCtx: CanvasRenderingContext2D,
    element: CanvasElement,
    elementBounds: Bounds | null,
    layerOpacity: number,
    dpr: number,
  ): void {
    const rect = this.htmlScratchRect(elementBounds, dpr);
    if (!rect) return; // no pixels to paint into, and no degenerate drawImage source
    const scratchCtx = this.ensureHtmlScratch(rect.w, rect.h);
    const scratchCanvas = this.htmlScratchCanvas;
    if (!scratchCtx || !scratchCanvas) {
      // No scratch surface available: drawing the element pre-multiplied still beats
      // dropping it, and this is the same fallback shape the grid cache uses.
      hybridCtx.save();
      hybridCtx.globalAlpha = layerOpacity;
      this.renderer.renderCanvasElement(hybridCtx, element);
      hybridCtx.restore();
      return;
    }

    scratchCtx.setTransform(1, 0, 0, 1, 0, 0);
    scratchCtx.clearRect(0, 0, rect.w, rect.h);
    scratchCtx.save();
    scratchCtx.globalAlpha = 1;
    scratchCtx.translate(-rect.x, -rect.y);
    scratchCtx.scale(dpr, dpr);
    scratchCtx.translate(this.camera.position.x, this.camera.position.y);
    scratchCtx.scale(this.camera.zoom, this.camera.zoom);
    this.renderer.renderCanvasElement(scratchCtx, element);
    scratchCtx.restore();

    hybridCtx.save();
    hybridCtx.setTransform(1, 0, 0, 1, 0, 0);
    hybridCtx.globalAlpha = layerOpacity;
    hybridCtx.drawImage(
      scratchCanvas as CanvasImageSource,
      0,
      0,
      rect.w,
      rect.h,
      rect.x,
      rect.y,
      rect.w,
      rect.h,
    );
    hybridCtx.restore();
  }

  private render(): void {
    const t0 = performance.now();
    const ctx = this.canvasEl.getContext('2d');
    if (!ctx) return;

    let layersMs = 0;
    let compositeMs = 0;
    let gridMs = 0;

    const dpr = typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1;
    const cssWidth = this.canvasEl.clientWidth;
    const cssHeight = this.canvasEl.clientHeight;

    // idempotent; catches resizes that bypass setCanvasSize
    this.marginViewport.setViewport(cssWidth, cssHeight, dpr);

    const currentZoom = this.camera.zoom;
    const currentCamX = this.camera.position.x;
    const currentCamY = this.camera.position.y;
    if (this.marginViewport.needsRecenter(currentCamX, currentCamY, currentZoom)) {
      this.marginViewport.recenter(currentCamX, currentCamY, currentZoom);
      this.layerCache.markAllDirty();
      this.gridCacheDirty = true;
    }

    ctx.save();
    ctx.scale(dpr, dpr);

    this.renderer.setCanvasSize(cssWidth, cssHeight);
    const hasGridElement = this.store.getElementsByType('grid').length > 0;
    const bgT0 = performance.now();
    if (hasGridElement) {
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssWidth, cssHeight);
      ctx.restore();
    } else {
      this.background.render(ctx, this.camera);
    }
    const backgroundMs = performance.now() - bgT0;

    ctx.save();
    ctx.translate(this.camera.position.x, this.camera.position.y);
    ctx.scale(this.camera.zoom, this.camera.zoom);

    const cullBounds = this.marginViewport.cachedWorldBounds();
    const cullPad = Math.max(cullBounds.w, cullBounds.h) * 0.05;
    const cullingRect: Bounds = {
      x: cullBounds.x - cullPad,
      y: cullBounds.y - cullPad,
      w: cullBounds.w + cullPad * 2,
      h: cullBounds.h + cullPad * 2,
    };

    const allElements = this.store.getAll();
    const visibleElements = allElements.filter((element) =>
      this.layerManager.isLayerVisible(element.layerId),
    );
    const firstDomIndex = visibleElements.findIndex((element) =>
      this.renderer.isDomElement(element),
    );
    const hybridActive =
      firstDomIndex >= 0 &&
      visibleElements
        .slice(firstDomIndex + 1)
        .some((element) => !this.renderer.isDomElement(element));
    const hybridCanvasRuns = new Map<number, CanvasElement[]>();
    const hybridOrders = new Set<number>();
    let activeHybridOrder: number | null = null;
    this.layerGroups.clear();
    const gridElements: CanvasElement[] = [];
    let paintOrder = 0;

    for (const element of allElements) {
      if (!this.layerManager.isLayerVisible(element.layerId)) {
        if (this.renderer.isDomElement(element)) {
          this.domNodeManager.hideDomNode(element.id);
        }
        continue;
      }

      const order = ++paintOrder;

      if (this.renderer.isDomElement(element)) {
        activeHybridOrder = null;
        const layerOpacity = this.layerManager.getLayer?.(element.layerId)?.opacity ?? 1;
        const elBounds = getElementVisualBounds(element);
        if (elBounds && !boundsIntersect(elBounds, cullingRect)) {
          this.domNodeManager.hideDomNode(element.id);
        } else {
          this.domNodeManager.syncDomNode(element, order, layerOpacity);
        }
        continue;
      }

      if (hybridActive && paintOrder > firstDomIndex + 1 && element.type !== 'grid') {
        activeHybridOrder ??= order;
        let run = hybridCanvasRuns.get(activeHybridOrder);
        if (!run) {
          run = [];
          hybridCanvasRuns.set(activeHybridOrder, run);
          hybridOrders.add(activeHybridOrder);
        }
        run.push(element);
        continue;
      }

      // Grids are viewport-filling; handled via anchored cache below
      if (element.type === 'grid') {
        gridElements.push(element);
        continue;
      }

      let group = this.layerGroups.get(element.layerId);
      if (!group) {
        group = [];
        this.layerGroups.set(element.layerId, group);
      }
      group.push(element);
    }

    const activeTool = this.toolManager.activeTool;
    const fogVisible = this.fogRenderer?.isVisible() ?? false;
    const fogOrder = visibleElements.length + 1;
    const overlayOrder = fogVisible ? fogOrder + 1 : visibleElements.length + 1;
    const hasOverlay = activeTool?.renderOverlay !== undefined || this.overlays.size > 0;
    if (fogVisible) hybridOrders.add(fogOrder);
    if (hasOverlay && (hybridActive || fogVisible)) hybridOrders.add(overlayOrder);
    this.hybridSurface.beginFrame(hybridOrders, this.canvasEl.width, this.canvasEl.height);

    for (const [layerId, elements] of this.layerGroups) {
      const isActiveDrawingLayer = layerId === this.activeDrawingLayerId;
      const layerOpacity = this.layerManager.getLayer?.(layerId)?.opacity ?? 1;

      if (!this.layerCache.isDirty(layerId)) {
        const compT0 = performance.now();
        this.compositeLayerCache(ctx, layerId, layerOpacity);
        compositeMs += performance.now() - compT0;
        continue;
      }

      if (isActiveDrawingLayer) {
        const compT0 = performance.now();
        this.compositeLayerCache(ctx, layerId, layerOpacity);
        compositeMs += performance.now() - compT0;
        continue;
      }

      const offCtx = this.layerCache.getContext(layerId);
      if (offCtx) {
        const layerT0 = performance.now();
        const offCanvas = this.layerCache.getCanvas(layerId);
        offCtx.clearRect(0, 0, offCanvas.width, offCanvas.height);
        offCtx.save();
        this.marginViewport.applyRenderTransform(offCtx);
        for (const element of elements) {
          const elBounds = getElementVisualBounds(element);
          if (elBounds && !boundsIntersect(elBounds, cullingRect)) continue;
          this.renderer.renderCanvasElement(offCtx as CanvasRenderingContext2D, element);
        }
        offCtx.restore();
        this.layerCache.markClean(layerId);
        layersMs += performance.now() - layerT0;

        const compT0 = performance.now();
        this.compositeLayerCache(ctx, layerId, layerOpacity);
        compositeMs += performance.now() - compT0;
      }
    }

    // Render grids on top of layer elements
    if (gridElements.length > 0) {
      const gridT0 = performance.now();
      const gridsChanged =
        gridElements.length !== this.lastGridRefs.length ||
        gridElements.some((grid, index) => grid !== this.lastGridRefs[index]);
      const gridDirty = this.gridCacheDirty || gridsChanged;

      if (gridDirty) {
        this.ensureGridCache();
        if (this.gridCacheCtx && this.gridCacheCanvas) {
          const cb = this.marginViewport.cachedWorldBounds();
          this.renderer.setGridBoundsOverride({
            minX: cb.x,
            minY: cb.y,
            maxX: cb.x + cb.w,
            maxY: cb.y + cb.h,
          });
          const gc = this.gridCacheCtx;
          gc.clearRect(0, 0, this.gridCacheCanvas.width, this.gridCacheCanvas.height);
          gc.save();
          this.marginViewport.applyRenderTransform(gc);
          try {
            for (const grid of gridElements) {
              gc.save();
              gc.globalAlpha = this.layerManager.getLayer?.(grid.layerId)?.opacity ?? 1;
              this.renderer.renderCanvasElement(gc as CanvasRenderingContext2D, grid);
              gc.restore();
            }
          } finally {
            gc.restore();
            this.renderer.setGridBoundsOverride(null);
          }
        }
        this.gridCacheDirty = false;
        this.lastGridRefs = [...gridElements];
      }

      if (this.gridCacheCanvas) {
        const offset = this.marginViewport.compositeOffset(
          this.camera.position.x,
          this.camera.position.y,
        );
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(this.gridCacheCanvas as CanvasImageSource, offset.x, offset.y);
        ctx.restore();
      } else {
        for (const grid of gridElements) {
          ctx.save();
          ctx.globalAlpha = this.layerManager.getLayer?.(grid.layerId)?.opacity ?? 1;
          this.renderer.renderCanvasElement(ctx, grid);
          ctx.restore();
        }
      }
      gridMs = performance.now() - gridT0;
    } else {
      this.lastGridRefs = [];
    }

    for (const [order, elements] of hybridCanvasRuns) {
      const hybridCtx = this.hybridSurface.getContext(order);
      if (!hybridCtx) continue;
      hybridCtx.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height);
      hybridCtx.save();
      hybridCtx.scale(dpr, dpr);
      hybridCtx.translate(this.camera.position.x, this.camera.position.y);
      hybridCtx.scale(this.camera.zoom, this.camera.zoom);
      for (const element of elements) {
        const elBounds = getElementVisualBounds(element);
        if (elBounds && !boundsIntersect(elBounds, cullingRect)) continue;
        const layerOpacity = this.layerManager.getLayer?.(element.layerId)?.opacity ?? 1;
        // Canvas-routed html gets the painter's ALPHA BOUNDARY that every other surface
        // honours (cached-layer composite, minimap, image export, svg export): the painter
        // is handed globalAlpha 1 and layer opacity is applied to the painted RESULT.
        // Pre-multiplying here — which is the right thing for every other element type,
        // and stays that way — would let a painter that assigns globalAlpha wipe the
        // layer's opacity out, so a marker's on-screen opacity would change the moment an
        // unrelated note pushed the frame onto this hybrid path.
        //
        // The COMPOSITING GRANULARITY still differs from those surfaces, and deliberately
        // so: they composite once per layer, this composites once per element. Two
        // overlapping elements on a layer at opacity 0.5 therefore reach ~0.75 effective
        // coverage here versus 0.5 there. That is pre-existing on this path — it held for
        // every element type before the alpha boundary was fixed — and closing it means
        // grouping the hybrid run by layer and compositing once, which is a restructuring
        // this fix deliberately does not attempt.
        if (element.type === 'html' && layerOpacity < 1) {
          this.paintHybridHtmlAtLayerOpacity(hybridCtx, element, elBounds, layerOpacity, dpr);
          continue;
        }
        // html only reaches here with layerOpacity >= 1, so this is the pre-multiplied
        // path for every other element type and a no-op assignment for html.
        hybridCtx.save();
        hybridCtx.globalAlpha = layerOpacity;
        this.renderer.renderCanvasElement(hybridCtx, element);
        hybridCtx.restore();
      }
      hybridCtx.restore();
    }

    if (fogVisible && this.fogRenderer) {
      const fogCtx = this.hybridSurface.getContext(fogOrder);
      if (fogCtx) {
        fogCtx.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height);
        fogCtx.save();
        fogCtx.scale(dpr, dpr);
        this.fogRenderer.render(fogCtx, this.camera, cssWidth, cssHeight, dpr);
        fogCtx.restore();
      }
    }

    const overlayT0 = performance.now();
    if ((hybridActive || fogVisible) && hasOverlay) {
      const overlayCtx = this.hybridSurface.getContext(overlayOrder);
      if (overlayCtx) {
        overlayCtx.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height);
        overlayCtx.save();
        overlayCtx.scale(dpr, dpr);
        overlayCtx.translate(this.camera.position.x, this.camera.position.y);
        overlayCtx.scale(this.camera.zoom, this.camera.zoom);
        this.drawRegisteredOverlays(overlayCtx);
        if (activeTool?.renderOverlay) activeTool.renderOverlay(overlayCtx);
        overlayCtx.restore();
      }
    } else if (hasOverlay) {
      this.drawRegisteredOverlays(ctx);
      if (activeTool?.renderOverlay) activeTool.renderOverlay(ctx);
    }
    const overlayMs = performance.now() - overlayT0;

    ctx.restore();
    ctx.restore();

    this.stats.recordFrame(performance.now() - t0, {
      gridMs,
      layersMs,
      backgroundMs,
      compositeMs,
      overlayMs,
    });
  }
}
