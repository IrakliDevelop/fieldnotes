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
import type { RenderHooks } from './render-hooks';
import { reportFailure } from '../core/report-failure';

/**
 * A world-space draw callback rendered above elements on every frame,
 * regardless of which tool is active. The context arrives with the camera
 * transform applied; implementations must not assume exclusive context state
 * (each renderer is wrapped in save/restore). A throwing renderer is isolated
 * per frame and must not break the render loop.
 */
export type OverlayRenderer = (ctx: CanvasRenderingContext2D) => void;

/** The save/restore surface shared by on-screen and offscreen 2d contexts. */
interface SavableContext {
  save(): void;
  restore(): void;
}

/** Reassigning width clears the pixels and drops the whole save, clip and transform stack. */
function resetCanvas(canvas: HTMLCanvasElement): void {
  const { width } = canvas;
  canvas.width = width;
}

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
  hooks?: RenderHooks;
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
  private readonly hooks?: RenderHooks;
  private activeDrawingLayerId: string | null = null;
  private readonly stats = new RenderStats();
  private layerGroups = new Map<string, CanvasElement[]>();
  private readonly overlays = new Set<OverlayRenderer>();
  private htmlScratchCanvas: HTMLCanvasElement | null = null;
  private htmlScratchCtx: CanvasRenderingContext2D | null = null;
  private renderErrorReported = false;
  private readonly savedContexts: SavableContext[] = [];
  // Canvases a throwing hook left with stray clips or saves; reset before the next frame.
  private readonly staleCanvases: HTMLCanvasElement[] = [];
  private readonly layerOpacities = new Map<string, number>();
  // Frame structure, recomputed only when the store array or layer state changes.
  private structureSource: readonly CanvasElement[] | null = null;
  private structureDirty = true;
  private visibleCount = 0;
  private firstDomIndex = -1;
  private hybridActive = false;

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
    this.hooks = deps.hooks;
  }

  requestRender(): void {
    this.needsRender = true;
  }

  flush(): void {
    if (this.needsRender) {
      this.needsRender = false;
      this.render();
    }
  }

  start(): void {
    const loop = (): void => {
      // A throwing frame must not end the loop: rAF only continues if we reschedule.
      try {
        if (this.needsRender) {
          this.needsRender = false;
          try {
            this.render();
            this.renderErrorReported = false;
          } catch (error) {
            // Report the first failure of a streak instead of spamming every frame.
            if (!this.renderErrorReported) {
              this.renderErrorReported = true;
              reportFailure(error, 'render failed');
            }
          }
        }
      } finally {
        this.animFrameId = requestAnimationFrame(loop);
      }
    };
    this.animFrameId = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.animFrameId);
  }

  setCanvasSize(width: number, height: number): void {
    // A zero-dimension canvas throws InvalidStateError when used as a drawImage source,
    // and a hidden or collapsed container reports 0; keep the buffer at least 1x1.
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    this.canvasEl.width = w;
    this.canvasEl.height = h;
    const dpr = typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1;
    this.marginViewport.setViewport(w / dpr, h / dpr, dpr);
    this.layerCache.resize();
  }

  setActiveDrawingLayer(layerId: string | null): void {
    this.activeDrawingLayerId = layerId;
  }

  markLayerDirty(layerId: string): void {
    this.structureDirty = true;
    this.layerCache.markDirty(layerId);
  }

  markAllLayersDirty(): void {
    this.structureDirty = true;
    this.layerCache.markAllDirty();
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
    this.saveTracked(ctx);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = opacity;
    ctx.drawImage(cached as CanvasImageSource, offset.x, offset.y);
    this.restoreTracked(ctx);
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
   * Null when nothing of the element lands on the surface. `setCanvasSize` keeps the
   * buffer at least 1x1, but a host can still assign `canvasEl.width`/`height` directly,
   * and a zero-dimension scratch canvas throws `InvalidStateError` when used as a
   * `drawImage` SOURCE, so the surface is not trusted to have pixels here. Non-finite
   * bounds fail the same `>= 1` test and are rejected too.
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
      this.saveTracked(hybridCtx);
      hybridCtx.globalAlpha = layerOpacity;
      this.renderer.renderCanvasElement(hybridCtx, element);
      this.restoreTracked(hybridCtx);
      return;
    }

    scratchCtx.setTransform(1, 0, 0, 1, 0, 0);
    scratchCtx.clearRect(0, 0, rect.w, rect.h);
    this.saveTracked(scratchCtx);
    scratchCtx.globalAlpha = 1;
    scratchCtx.translate(-rect.x, -rect.y);
    scratchCtx.scale(dpr, dpr);
    scratchCtx.translate(this.camera.position.x, this.camera.position.y);
    scratchCtx.scale(this.camera.zoom, this.camera.zoom);
    this.renderer.renderCanvasElement(scratchCtx, element);
    this.restoreTracked(scratchCtx);

    this.saveTracked(hybridCtx);
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
    this.restoreTracked(hybridCtx);
  }

  /**
   * Renders one frame and guarantees every context save the frame took is restored, even
   * when a hook, tool overlay, extension, or painter throws mid-frame. Without this a
   * caught throw leaves the main and stratum contexts with stacked transforms, so every
   * later frame draws with compounded scale and translation.
   */
  private render(): void {
    // A hook can re-enter via flush(); unwind only the saves this call took.
    const depth = this.savedContexts.length;
    try {
      this.renderFrame();
    } finally {
      this.unwindSavedContexts(depth);
    }
  }

  private saveTracked(ctx: SavableContext): void {
    ctx.save();
    this.savedContexts.push(ctx);
  }

  private restoreTracked(ctx: SavableContext): void {
    this.savedContexts.pop();
    ctx.restore();
  }

  /**
   * Restores, innermost first, the saves an aborted frame left open above `depth`.
   * No-op after a clean frame.
   */
  private unwindSavedContexts(depth: number): void {
    while (this.savedContexts.length > depth) {
      this.savedContexts.pop()?.restore();
    }
  }

  private renderFrame(): void {
    const t0 = performance.now();
    const ctx = this.canvasEl.getContext('2d');
    if (!ctx) return;
    for (const canvas of this.staleCanvases) resetCanvas(canvas);
    this.staleCanvases.length = 0;

    let layersMs = 0;
    let compositeMs = 0;

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
    }

    this.saveTracked(ctx);
    ctx.scale(dpr, dpr);

    this.renderer.setCanvasSize(cssWidth, cssHeight);
    const bgT0 = performance.now();
    this.background.render(ctx, this.camera);
    const backgroundMs = performance.now() - bgT0;

    if (this.hooks) {
      this.saveTracked(ctx);
      const failed = this.hooks.viewport.call('beforeElements', ctx, this.camera, {
        width: cssWidth,
        height: cssHeight,
        dpr,
      });
      this.restoreTracked(ctx);
      if (failed) this.staleCanvases.push(this.canvasEl);
    }

    this.saveTracked(ctx);
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
    const registry = this.store.elementRegistry;

    const allElements = this.store.getAll();
    if (allElements !== this.structureSource || this.structureDirty) {
      this.structureSource = allElements;
      this.structureDirty = false;
      let visibleCount = 0;
      let firstDomIndex = -1;
      let hybridActive = false;
      for (const element of allElements) {
        if (!this.layerManager.isLayerVisible(element.layerId)) continue;
        if (!hybridActive) {
          const isDom = this.renderer.isDomElement(element);
          if (firstDomIndex < 0 && isDom) firstDomIndex = visibleCount;
          else if (firstDomIndex >= 0 && !isDom) hybridActive = true;
        }
        visibleCount++;
      }
      this.visibleCount = visibleCount;
      this.firstDomIndex = firstDomIndex;
      this.hybridActive = hybridActive;
    }
    const { firstDomIndex, hybridActive } = this;
    this.layerOpacities.clear();
    for (const layer of this.layerManager.getLayers()) {
      this.layerOpacities.set(layer.id, layer.opacity);
    }
    const hybridCanvasRuns = new Map<number, CanvasElement[]>();
    const hybridOrders = new Set<number>();
    let activeHybridOrder: number | null = null;
    this.layerGroups.clear();
    const fullCanvasElements: CanvasElement[] = [];
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
        const layerOpacity = this.layerOpacities.get(element.layerId) ?? 1;
        const elBounds = getElementVisualBounds(element, registry);
        if (elBounds && !boundsIntersect(elBounds, cullingRect)) {
          this.domNodeManager.hideDomNode(element.id);
        } else {
          this.domNodeManager.syncDomNode(element, order, layerOpacity);
        }
        continue;
      }

      // Full-canvas extensions (e.g. grids) render on a separate pass with
      // explicit world bounds, not inline with layer elements.
      if (this.renderer.isFullCanvasElement(element)) {
        fullCanvasElements.push(element);
        continue;
      }

      if (hybridActive && paintOrder > firstDomIndex + 1) {
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

      let group = this.layerGroups.get(element.layerId);
      if (!group) {
        group = [];
        this.layerGroups.set(element.layerId, group);
      }
      group.push(element);
    }

    const activeTool = this.toolManager.activeTool;
    const hasAfterElementsHook = this.hooks?.viewport.has('afterElements') ?? false;
    const hasAfterAllHook = this.hooks?.viewport.has('afterAll') ?? false;
    const masked = this.hooks?.viewport.isFailClosed() ?? false;
    const hasAfterElementsStratum = hasAfterElementsHook || masked;
    const afterElementsOrder = this.visibleCount + 1;
    const overlayOrder = afterElementsOrder + (hasAfterElementsStratum ? 1 : 0);
    const afterAllOrder = overlayOrder + 1;
    const hasOverlay = activeTool?.renderOverlay !== undefined || this.overlays.size > 0;
    if (hasAfterElementsStratum) hybridOrders.add(afterElementsOrder);
    if (hasOverlay && (hybridActive || hasAfterElementsStratum)) hybridOrders.add(overlayOrder);
    if (hasAfterAllHook) hybridOrders.add(afterAllOrder);
    this.hybridSurface.beginFrame(hybridOrders, this.canvasEl.width, this.canvasEl.height);

    for (const [layerId, elements] of this.layerGroups) {
      const isActiveDrawingLayer = layerId === this.activeDrawingLayerId;
      const layerOpacity = this.layerOpacities.get(layerId) ?? 1;

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
        this.saveTracked(offCtx);
        this.marginViewport.applyRenderTransform(offCtx);
        for (const element of elements) {
          const elBounds = getElementVisualBounds(element, registry);
          if (elBounds && !boundsIntersect(elBounds, cullingRect)) continue;
          this.renderer.renderCanvasElement(offCtx as CanvasRenderingContext2D, element);
        }
        this.restoreTracked(offCtx);
        this.layerCache.markClean(layerId);
        layersMs += performance.now() - layerT0;

        const compT0 = performance.now();
        this.compositeLayerCache(ctx, layerId, layerOpacity);
        compositeMs += performance.now() - compT0;
      }
    }

    // Render full-canvas extensions (e.g. grids) with explicit world bounds.
    // These render after layer elements but before hybrid canvas runs.
    if (fullCanvasElements.length > 0) {
      const cb = this.marginViewport.cachedWorldBounds();
      const worldBounds = {
        minX: cb.x,
        minY: cb.y,
        maxX: cb.x + cb.w,
        maxY: cb.y + cb.h,
      };
      for (const el of fullCanvasElements) {
        this.saveTracked(ctx);
        ctx.globalAlpha = this.layerOpacities.get(el.layerId) ?? 1;
        this.renderer.renderExtensionWithBounds(ctx, el, worldBounds, allElements);
        this.restoreTracked(ctx);
      }
    }

    for (const [order, elements] of hybridCanvasRuns) {
      const hybridCtx = this.hybridSurface.getContext(order);
      if (!hybridCtx) continue;
      hybridCtx.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height);
      this.saveTracked(hybridCtx);
      hybridCtx.scale(dpr, dpr);
      hybridCtx.translate(this.camera.position.x, this.camera.position.y);
      hybridCtx.scale(this.camera.zoom, this.camera.zoom);
      for (const element of elements) {
        const elBounds = getElementVisualBounds(element, registry);
        if (elBounds && !boundsIntersect(elBounds, cullingRect)) continue;
        const layerOpacity = this.layerOpacities.get(element.layerId) ?? 1;
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
        this.saveTracked(hybridCtx);
        hybridCtx.globalAlpha = layerOpacity;
        this.renderer.renderCanvasElement(hybridCtx, element);
        this.restoreTracked(hybridCtx);
      }
      this.restoreTracked(hybridCtx);
    }

    // Post-scene surfaces must live above every canvas and DOM paint stratum. The
    // base canvas is below the DOM stack, so drawing privacy surfaces such as fog
    // there would expose DOM-backed notes and interleaved hybrid elements.
    if (this.hooks && hasAfterElementsStratum) {
      const hookCtx = this.hybridSurface.getContext(afterElementsOrder);
      if (hookCtx) {
        hookCtx.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height);
        this.saveTracked(hookCtx);
        hookCtx.scale(dpr, dpr);
        const failed = this.hooks.viewport.call('afterElements', hookCtx, this.camera, {
          width: cssWidth,
          height: cssHeight,
          dpr,
        });
        this.restoreTracked(hookCtx);
        // Re-checked so the frame in which a satisfying hook throws is masked too.
        if (masked || this.hooks.viewport.isFailClosed()) {
          // A thrower may leave clips and saves the bracket cannot undo.
          if (failed) resetCanvas(hookCtx.canvas);
          hookCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
          hookCtx.fillStyle = '#000';
          hookCtx.fillRect(0, 0, cssWidth, cssHeight);
          hookCtx.setTransform(1, 0, 0, 1, 0, 0);
        } else if (failed) {
          // Resetting now would erase sibling hooks' pixels (fog) for this frame.
          this.staleCanvases.push(hookCtx.canvas);
        }
      }
    }

    const overlayT0 = performance.now();
    if ((hybridActive || hasAfterElementsStratum) && hasOverlay) {
      const overlayCtx = this.hybridSurface.getContext(overlayOrder);
      if (overlayCtx) {
        overlayCtx.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height);
        this.saveTracked(overlayCtx);
        overlayCtx.scale(dpr, dpr);
        overlayCtx.translate(this.camera.position.x, this.camera.position.y);
        overlayCtx.scale(this.camera.zoom, this.camera.zoom);
        this.drawRegisteredOverlays(overlayCtx);
        if (activeTool?.renderOverlay) activeTool.renderOverlay(overlayCtx);
        this.restoreTracked(overlayCtx);
      }
    } else if (hasOverlay) {
      this.drawRegisteredOverlays(ctx);
      if (activeTool?.renderOverlay) activeTool.renderOverlay(ctx);
    }

    if (this.hooks && hasAfterAllHook) {
      const hookCtx = this.hybridSurface.getContext(afterAllOrder);
      if (hookCtx) {
        hookCtx.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height);
        this.saveTracked(hookCtx);
        hookCtx.scale(dpr, dpr);
        const failed = this.hooks.viewport.call('afterAll', hookCtx, this.camera, {
          width: cssWidth,
          height: cssHeight,
          dpr,
        });
        this.restoreTracked(hookCtx);
        if (failed) this.staleCanvases.push(hookCtx.canvas);
      }
    }

    const overlayMs = performance.now() - overlayT0;

    this.restoreTracked(ctx);
    this.restoreTracked(ctx);
    // A hook that failed mid-frame needs a masked or reset frame without waiting for input.
    if ((!masked && this.hooks?.viewport.isFailClosed()) || this.staleCanvases.length > 0) {
      this.requestRender();
    }

    this.stats.recordFrame(performance.now() - t0, {
      layersMs,
      backgroundMs,
      compositeMs,
      overlayMs,
    });
  }
}
