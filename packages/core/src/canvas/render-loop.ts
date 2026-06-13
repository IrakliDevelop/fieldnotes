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
  private activeDrawingLayerId: string | null = null;
  private gridCacheDirty = true;
  private readonly stats = new RenderStats();
  private layerGroups = new Map<string, CanvasElement[]>();
  private gridCacheCanvas: HTMLCanvasElement | null = null;
  private gridCacheCtx: CanvasRenderingContext2D | null = null;
  private gridCacheZoom = -1;
  private gridCacheCamX = -Infinity;
  private gridCacheCamY = -Infinity;
  private gridCacheWidth = 0;
  private gridCacheHeight = 0;
  private lastGridRef: unknown = null;

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
  }

  getStats(): RenderStatsSnapshot {
    return this.stats.getSnapshot();
  }

  private compositeLayerCache(ctx: CanvasRenderingContext2D, layerId: string): void {
    const cached = this.layerCache.getCanvas(layerId);
    const offset = this.marginViewport.compositeOffset(
      this.camera.position.x,
      this.camera.position.y,
    );
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(cached as CanvasImageSource, offset.x, offset.y);
    ctx.restore();
  }

  private ensureGridCache(cssWidth: number, cssHeight: number, dpr: number): void {
    if (
      this.gridCacheCanvas !== null &&
      this.gridCacheWidth === cssWidth &&
      this.gridCacheHeight === cssHeight
    ) {
      return;
    }

    const physWidth = Math.round(cssWidth * dpr);
    const physHeight = Math.round(cssHeight * dpr);

    if (typeof OffscreenCanvas !== 'undefined') {
      this.gridCacheCanvas = new OffscreenCanvas(
        physWidth,
        physHeight,
      ) as unknown as HTMLCanvasElement;
    } else if (typeof document !== 'undefined') {
      const el = document.createElement('canvas');
      el.width = physWidth;
      el.height = physHeight;
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
    this.layerGroups.clear();
    const gridElements: CanvasElement[] = [];
    let domZIndex = 0;

    for (const element of allElements) {
      if (!this.layerManager.isLayerVisible(element.layerId)) {
        if (this.renderer.isDomElement(element)) {
          this.domNodeManager.hideDomNode(element.id);
        }
        continue;
      }

      if (this.renderer.isDomElement(element)) {
        const elBounds = getElementBounds(element);
        if (elBounds && !boundsIntersect(elBounds, cullingRect)) {
          this.domNodeManager.hideDomNode(element.id);
        } else {
          this.domNodeManager.syncDomNode(element, domZIndex++);
        }
        continue;
      }

      // Grids are viewport-filling and recompute on every pan — skip caching
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

    for (const [layerId, elements] of this.layerGroups) {
      const isActiveDrawingLayer = layerId === this.activeDrawingLayerId;

      if (!this.layerCache.isDirty(layerId)) {
        const compT0 = performance.now();
        this.compositeLayerCache(ctx, layerId);
        compositeMs += performance.now() - compT0;
        continue;
      }

      if (isActiveDrawingLayer) {
        const compT0 = performance.now();
        this.compositeLayerCache(ctx, layerId);
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
        this.compositeLayerCache(ctx, layerId);
        compositeMs += performance.now() - compT0;
      }
    }

    // Render grids on top of layer elements
    if (gridElements.length > 0) {
      const gridT0 = performance.now();
      const gridRef = gridElements[0];
      const gridCacheHit =
        this.gridCacheCanvas !== null &&
        currentZoom === this.gridCacheZoom &&
        currentCamX === this.gridCacheCamX &&
        currentCamY === this.gridCacheCamY &&
        cssWidth === this.gridCacheWidth &&
        cssHeight === this.gridCacheHeight &&
        gridRef === this.lastGridRef;

      if (gridCacheHit) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(this.gridCacheCanvas as CanvasImageSource, 0, 0);
        ctx.restore();
      } else {
        this.ensureGridCache(cssWidth, cssHeight, dpr);
        if (this.gridCacheCtx && this.gridCacheCanvas) {
          const gc = this.gridCacheCtx;
          gc.clearRect(0, 0, this.gridCacheCanvas.width, this.gridCacheCanvas.height);
          gc.save();
          gc.scale(dpr, dpr);
          gc.translate(currentCamX, currentCamY);
          gc.scale(currentZoom, currentZoom);
          for (const grid of gridElements) {
            this.renderer.renderCanvasElement(gc as CanvasRenderingContext2D, grid);
          }
          gc.restore();

          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.drawImage(this.gridCacheCanvas as CanvasImageSource, 0, 0);
          ctx.restore();
        } else {
          for (const grid of gridElements) {
            this.renderer.renderCanvasElement(ctx, grid);
          }
        }

        this.gridCacheZoom = currentZoom;
        this.gridCacheCamX = currentCamX;
        this.gridCacheCamY = currentCamY;
        this.gridCacheWidth = cssWidth;
        this.gridCacheHeight = cssHeight;
        this.lastGridRef = gridRef;
      }
      gridMs = performance.now() - gridT0;
    }

    const overlayT0 = performance.now();
    const activeTool = this.toolManager.activeTool;
    if (activeTool?.renderOverlay) {
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
