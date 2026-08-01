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
import { getElementBounds, boundsIntersect } from '../elements/element-bounds';
import { RenderStats } from './render-stats';
import type { RenderStatsSnapshot } from './render-stats';
import type { HybridRenderSurface } from './hybrid-render-surface';

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
  private activeDrawingLayerId: string | null = null;
  private gridCacheDirty = true; // set on recenter/viewport-change; consumed by the grid block
  private readonly stats = new RenderStats();
  private layerGroups = new Map<string, CanvasElement[]>();
  private gridCacheCanvas: HTMLCanvasElement | null = null;
  private gridCacheCtx: CanvasRenderingContext2D | null = null;
  private lastGridRefs: CanvasElement[] = [];

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
        const elBounds = getElementBounds(element);
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
    const overlayOrder = visibleElements.length + 1;
    if (hybridActive && activeTool?.renderOverlay) hybridOrders.add(overlayOrder);
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
          const elBounds = getElementBounds(element);
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
        const elBounds = getElementBounds(element);
        if (elBounds && !boundsIntersect(elBounds, cullingRect)) continue;
        hybridCtx.save();
        hybridCtx.globalAlpha = this.layerManager.getLayer?.(element.layerId)?.opacity ?? 1;
        this.renderer.renderCanvasElement(hybridCtx, element);
        hybridCtx.restore();
      }
      hybridCtx.restore();
    }

    const overlayT0 = performance.now();
    if (hybridActive && activeTool?.renderOverlay) {
      const overlayCtx = this.hybridSurface.getContext(overlayOrder);
      if (overlayCtx) {
        overlayCtx.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height);
        overlayCtx.save();
        overlayCtx.scale(dpr, dpr);
        overlayCtx.translate(this.camera.position.x, this.camera.position.y);
        overlayCtx.scale(this.camera.zoom, this.camera.zoom);
        activeTool.renderOverlay(overlayCtx);
        overlayCtx.restore();
      }
    } else if (activeTool?.renderOverlay) {
      activeTool.renderOverlay(ctx);
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
