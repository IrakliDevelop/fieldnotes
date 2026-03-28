import type { Camera } from './camera';
import type { Background } from './background';
import type { ElementStore } from '../elements/element-store';
import type { ElementRenderer } from '../elements/element-renderer';
import type { ToolManager } from '../tools/tool-manager';
import type { LayerManager } from '../layers/layer-manager';
import type { DomNodeManager } from './dom-node-manager';
import type { LayerCache } from './layer-cache';
import type { Bounds } from '../core/types';
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
  private activeDrawingLayerId: string | null = null;
  private lastZoom: number;
  private lastCamX: number;
  private lastCamY: number;
  private readonly stats = new RenderStats();

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
    this.lastZoom = deps.camera.zoom;
    this.lastCamX = deps.camera.position.x;
    this.lastCamY = deps.camera.position.y;
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
    this.layerCache.resize(this.canvasEl.clientWidth, this.canvasEl.clientHeight);
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

  private compositeLayerCache(ctx: CanvasRenderingContext2D, layerId: string, dpr: number): void {
    const cached = this.layerCache.getCanvas(layerId);
    ctx.save();
    ctx.scale(1 / this.camera.zoom, 1 / this.camera.zoom);
    ctx.translate(-this.camera.position.x, -this.camera.position.y);
    ctx.scale(1 / dpr, 1 / dpr);
    ctx.drawImage(cached as CanvasImageSource, 0, 0);
    ctx.restore();
  }

  private render(): void {
    const t0 = performance.now();
    const ctx = this.canvasEl.getContext('2d');
    if (!ctx) return;

    const dpr = typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1;
    const cssWidth = this.canvasEl.clientWidth;
    const cssHeight = this.canvasEl.clientHeight;

    const currentZoom = this.camera.zoom;
    const currentCamX = this.camera.position.x;
    const currentCamY = this.camera.position.y;
    if (
      currentZoom !== this.lastZoom ||
      currentCamX !== this.lastCamX ||
      currentCamY !== this.lastCamY
    ) {
      this.layerCache.markAllDirty();
      this.lastZoom = currentZoom;
      this.lastCamX = currentCamX;
      this.lastCamY = currentCamY;
    }

    ctx.save();
    ctx.scale(dpr, dpr);

    this.renderer.setCanvasSize(cssWidth, cssHeight);
    this.background.render(ctx, this.camera);

    ctx.save();
    ctx.translate(this.camera.position.x, this.camera.position.y);
    ctx.scale(this.camera.zoom, this.camera.zoom);

    const visibleRect = this.camera.getVisibleRect(cssWidth, cssHeight);
    const margin = Math.max(visibleRect.w, visibleRect.h) * 0.1;
    const cullingRect: Bounds = {
      x: visibleRect.x - margin,
      y: visibleRect.y - margin,
      w: visibleRect.w + margin * 2,
      h: visibleRect.h + margin * 2,
    };

    const allElements = this.store.getAll();
    const layerElements = new Map<string, typeof allElements>();
    const gridElements: typeof allElements = [];
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

      let group = layerElements.get(element.layerId);
      if (!group) {
        group = [];
        layerElements.set(element.layerId, group);
      }
      group.push(element);
    }

    // Render grids directly to main canvas (they fill the viewport every frame)
    for (const grid of gridElements) {
      this.renderer.renderCanvasElement(ctx, grid);
    }

    for (const [layerId, elements] of layerElements) {
      const isActiveDrawingLayer = layerId === this.activeDrawingLayerId;

      if (!this.layerCache.isDirty(layerId)) {
        this.compositeLayerCache(ctx, layerId, dpr);
        continue;
      }

      if (isActiveDrawingLayer) {
        this.compositeLayerCache(ctx, layerId, dpr);
        continue;
      }

      const offCtx = this.layerCache.getContext(layerId);
      if (offCtx) {
        const offCanvas = this.layerCache.getCanvas(layerId);
        offCtx.clearRect(0, 0, offCanvas.width, offCanvas.height);
        offCtx.save();
        offCtx.scale(dpr, dpr);
        offCtx.translate(this.camera.position.x, this.camera.position.y);
        offCtx.scale(this.camera.zoom, this.camera.zoom);

        for (const element of elements) {
          const elBounds = getElementBounds(element);
          if (elBounds && !boundsIntersect(elBounds, cullingRect)) continue;
          this.renderer.renderCanvasElement(offCtx as CanvasRenderingContext2D, element);
        }

        offCtx.restore();
        this.layerCache.markClean(layerId);

        this.compositeLayerCache(ctx, layerId, dpr);
      }
    }

    const activeTool = this.toolManager.activeTool;
    if (activeTool?.renderOverlay) {
      activeTool.renderOverlay(ctx);
    }

    ctx.restore();
    ctx.restore();

    this.stats.recordFrame(performance.now() - t0);
  }
}
