import type { Bounds, Point } from '../core/types';
import type { CanvasElement } from '../elements/types';
import type { Viewport } from './viewport';
import type { HtmlPainterRegistry } from './html-painter-registry';
import type { FogRenderer } from '../fog/fog-renderer';
import { ElementRenderer } from '../elements/element-renderer';
import { getElementBounds } from '../elements/element-bounds';
import { getElementsBoundingBox } from '../elements/bounds';
import {
  computeMinimapTransform,
  miniToWorld,
  unionBounds,
  worldToMini,
  type MinimapTransform,
} from './minimap-transform';

export interface MinimapControllerOptions {
  /** Minimap width in CSS pixels. Default `200`. */
  width?: number;
  /** Minimap height in CSS pixels. Default `140`. */
  height?: number;
  /** Content inset inside the minimap, in minimap pixels. Default `8`. */
  padding?: number;
  /** Backdrop fill behind the thumbnail. Default: none (transparent). */
  background?: string;
  /** Stroke color of the viewport rectangle. Default `'#3b82f6'`. */
  viewportStroke?: string;
  /** Trailing debounce for scene bitmap re-renders. Default `200`. */
  debounceMs?: number;
  /** Tap/drag-to-center navigation on the canvas. Default `true`. */
  interactive?: boolean;
  /** Frame scheduler; default `requestAnimationFrame`. Injected by tests. */
  requestFrame?: (cb: () => void) => number;
  /** Frame canceller; default `cancelAnimationFrame`. Injected by tests. */
  cancelFrame?: (id: number) => void;
}

const DEFAULT_WIDTH = 200;
const DEFAULT_HEIGHT = 140;
const DEFAULT_PADDING = 8;
const DEFAULT_DEBOUNCE_MS = 200;
const DEFAULT_VIEWPORT_STROKE = '#3b82f6';
const NEUTRAL = 'rgba(100,116,139,0.6)';

function elementColor(el: CanvasElement): string {
  return 'color' in el && typeof el.color === 'string' ? el.color : NEUTRAL;
}

interface SceneCache {
  canvas: HTMLCanvasElement;
  transform: MinimapTransform;
  mapping: Bounds;
}

function sameBounds(a: Bounds, b: Bounds): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/**
 * Thumbnail overview navigator: renders the scene (real element shapes,
 * downscaled images, per-layer opacity compositing) into a cached offscreen
 * bitmap, composites it with the live viewport rectangle each frame, and
 * centers the camera on tap/drag. The cached bitmap and its transform swap
 * atomically: camera motion never renders the scene, only re-composites.
 */
export class MinimapController {
  private width: number;
  private height: number;
  private readonly padding: number;
  private readonly background: string | null;
  private readonly viewportStroke: string;
  private readonly debounceMs: number;
  private readonly interactive: boolean;
  private readonly requestFrame: (cb: () => void) => number;
  private readonly cancelFrame: (id: number) => void;
  private readonly renderer = new ElementRenderer();
  // Declared, not initialized here: a field initializer runs before parameter
  // properties are assigned (ES2022 useDefineForClassFields), so it cannot
  // read the `viewport` parameter. Assigned in the constructor body instead.
  private readonly htmlPainters: HtmlPainterRegistry;
  private scene: SceneCache | null = null;
  private fogRenderer: FogRenderer | null = null;
  private fogUnsub: (() => void) | null = null;
  private frameId: number | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private dragging = false;
  private disposed = false;
  private readonly unsubs: (() => void)[] = [];

  constructor(
    private readonly viewport: Viewport,
    private readonly canvas: HTMLCanvasElement,
    options: MinimapControllerOptions = {},
  ) {
    this.width = options.width ?? DEFAULT_WIDTH;
    this.height = options.height ?? DEFAULT_HEIGHT;
    this.padding = options.padding ?? DEFAULT_PADDING;
    this.background = options.background ?? null;
    this.viewportStroke = options.viewportStroke ?? DEFAULT_VIEWPORT_STROKE;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.interactive = options.interactive !== false;
    this.requestFrame =
      options.requestFrame ??
      ((cb) => (typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame(cb) : 0));
    this.cancelFrame =
      options.cancelFrame ??
      ((id) => {
        if (typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(id);
      });

    this.renderer.setStore(viewport.store);
    this.renderer.setOnImageLoad(() => this.markSceneDirty());
    this.htmlPainters = viewport.getHtmlPainters(); // parameter, not this.viewport
    this.renderer.setHtmlPainters(this.htmlPainters);
    this.renderer.setRenderTarget('minimap');
    this.applyCanvasSize();

    const onScene = () => this.markSceneDirty();
    this.unsubs.push(
      viewport.store.on('add', onScene),
      viewport.store.on('remove', onScene),
      viewport.store.on('update', onScene),
      viewport.store.on('clear', onScene),
      viewport.layerManager.on('change', onScene),
      viewport.camera.onChange(() => this.onViewChanged()),
      viewport.onResize(() => this.onViewChanged()),
      this.htmlPainters.onChange(() => this.invalidateScene()),
    );

    if (this.interactive) {
      canvas.style.touchAction = 'none';
      canvas.style.cursor = 'pointer';
      canvas.addEventListener('pointerdown', this.onPointerDown);
      canvas.addEventListener('pointermove', this.onPointerMove);
      canvas.addEventListener('pointerup', this.onPointerUp);
      canvas.addEventListener('pointercancel', this.onPointerEnd);
      canvas.addEventListener('lostpointercapture', this.onPointerEnd);
    }

    this.renderScene();
    this.requestDraw();
  }

  setSize(width: number, height: number): void {
    if (this.disposed) return;
    this.width = width;
    this.height = height;
    this.applyCanvasSize();
    this.clearDebounce();
    this.renderScene();
    this.requestDraw();
  }

  setFogRenderer(renderer: FogRenderer | null): void {
    if (this.disposed) return;
    if (this.fogUnsub) {
      this.fogUnsub();
      this.fogUnsub = null;
    }
    this.fogRenderer = renderer;
    this.invalidateScene();
  }

  requestDraw(): void {
    if (this.disposed || this.frameId !== null) return;
    this.frameId = this.requestFrame(this.draw);
  }

  /**
   * Invalidates the cached scene bitmap in response to html-painter registry
   * changes (a painter registering/unregistering, or an `expect` declaration
   * changing) and schedules the same debounced rebuild `markSceneDirty` uses
   * for every other invalidation source. Unlike those other sources — which
   * deliberately keep compositing the OLD bitmap until the rebuild lands, so
   * camera motion and content edits never stall on a render — painter
   * availability has no "old bitmap is still valid" reading: an element that
   * was falling back to a neutral fillRect (no painter yet) or a stale
   * painter's output is not a safe thing to keep showing, so the cached
   * bitmap is dropped immediately instead of composited a further time.
   */
  invalidateScene(): void {
    if (this.disposed) return;
    this.scene = null;
    this.markSceneDirty();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearDebounce();
    if (this.frameId !== null) {
      this.cancelFrame(this.frameId);
      this.frameId = null;
    }
    for (const unsub of this.unsubs.splice(0)) unsub();
    if (this.interactive) {
      this.canvas.removeEventListener('pointerdown', this.onPointerDown);
      this.canvas.removeEventListener('pointermove', this.onPointerMove);
      this.canvas.removeEventListener('pointerup', this.onPointerUp);
      this.canvas.removeEventListener('pointercancel', this.onPointerEnd);
      this.canvas.removeEventListener('lostpointercapture', this.onPointerEnd);
    }
  }

  private clearDebounce(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private dpr(): number {
    return typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1;
  }

  private applyCanvasSize(): void {
    const dpr = this.dpr();
    this.canvas.width = Math.max(1, Math.round(this.width * dpr));
    this.canvas.height = Math.max(1, Math.round(this.height * dpr));
  }

  // Single source for both mapping bounds and rendering: layer-visible,
  // grids excluded. (getElementBounds already returns null for grids, so they
  // cannot extend the bounding box today — this filter makes the invariant
  // structural instead of relying on that special case.)
  private sceneElements(): CanvasElement[] {
    return this.viewport.store
      .getAll()
      .filter((el) => el.type !== 'grid' && this.viewport.layerManager.isLayerVisible(el.layerId));
  }

  private currentMapping(): Bounds {
    const viewportRect = this.viewport.getVisibleRect();
    let mapping = getElementsBoundingBox(this.sceneElements());
    mapping = mapping ? unionBounds(mapping, viewportRect) : viewportRect;
    if (this.fogRenderer?.isVisible()) {
      const fogState = this.fogRenderer.getState();
      if (fogState) {
        mapping = unionBounds(mapping, fogState.definition.bounds);
      }
    }
    return mapping;
  }

  private onViewChanged(): void {
    if (this.disposed) return;
    const mapping = this.currentMapping();
    if (!this.scene || !sameBounds(mapping, this.scene.mapping)) {
      this.markSceneDirty();
    }
    this.requestDraw();
  }

  private markSceneDirty(): void {
    if (this.disposed) return;
    this.clearDebounce();
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.renderScene();
      this.requestDraw();
    }, this.debounceMs);
  }

  private renderScene(): void {
    if (this.disposed) return;
    const dpr = this.dpr();
    const mapping = this.currentMapping();
    const transform = computeMinimapTransform(mapping, this.width, this.height, this.padding);
    // The minimap fit scale, not the live camera zoom — canvas-routed html
    // painters read this via HtmlPaintContext.zoom (renderTarget 'minimap'
    // ignores the camera entirely; see ElementRenderer.zoomForTarget).
    this.renderer.setSurfaceZoom(transform.scale);
    const sceneCanvas = document.createElement('canvas');
    sceneCanvas.width = Math.max(1, Math.round(this.width * dpr));
    sceneCanvas.height = Math.max(1, Math.round(this.height * dpr));
    const ctx = sceneCanvas.getContext('2d');
    if (!ctx) return;

    const byLayer = new Map<string, CanvasElement[]>();
    for (const el of this.sceneElements()) {
      let list = byLayer.get(el.layerId);
      if (!list) {
        list = [];
        byLayer.set(el.layerId, list);
      }
      list.push(el);
    }

    for (const layer of this.viewport.layerManager.getLayers()) {
      const els = byLayer.get(layer.id);
      if (!els || els.length === 0) continue;
      const opacity = layer.opacity;
      if (opacity >= 1) {
        this.renderLayerElements(ctx, els, transform, dpr);
        continue;
      }
      // Translucent layers composite ONCE so overlapping elements within the
      // layer do not darken each other (main-renderer semantics).
      const layerCanvas = document.createElement('canvas');
      layerCanvas.width = sceneCanvas.width;
      layerCanvas.height = sceneCanvas.height;
      const layerCtx = layerCanvas.getContext('2d');
      if (!layerCtx) continue;
      this.renderLayerElements(layerCtx, els, transform, dpr);
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.drawImage(layerCanvas, 0, 0);
      ctx.restore();
    }

    if (this.fogRenderer?.isVisible()) {
      const fogState = this.fogRenderer.getState();
      const fogMode = this.fogRenderer.getViewMode();
      if (fogState && (fogMode === 'editor' || fogMode === 'player')) {
        ctx.save();
        ctx.setTransform(
          dpr * transform.scale,
          0,
          0,
          dpr * transform.scale,
          dpr * transform.offsetX,
          dpr * transform.offsetY,
        );
        this.fogRenderer.renderForExport(ctx, fogState, fogMode);
        ctx.restore();
      }
    }

    // Atomic swap: bitmap, transform, and mapping replace together.
    this.scene = { canvas: sceneCanvas, transform, mapping };
  }

  private renderLayerElements(
    ctx: CanvasRenderingContext2D,
    elements: CanvasElement[],
    t: MinimapTransform,
    dpr: number,
  ): void {
    for (const el of elements) {
      // note/text always fall back; 'html' only falls back when the shared
      // renderer's routing resolves it to 'dom' (no canvas painter claims
      // it) — the SAME routing decision the main renderer and export make,
      // via the registry this controller forwarded in setHtmlPainters().
      if (this.renderer.isDomElement(el)) {
        const b = getElementBounds(el);
        if (!b) continue;
        const tl = worldToMini(t, { x: b.x, y: b.y });
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = elementColor(el);
        ctx.fillRect(tl.x, tl.y, Math.max(1, b.w * t.scale), Math.max(1, b.h * t.scale));
        ctx.restore();
        continue;
      }
      ctx.save();
      ctx.setTransform(dpr * t.scale, 0, 0, dpr * t.scale, dpr * t.offsetX, dpr * t.offsetY);
      this.renderer.renderCanvasElement(ctx, el);
      ctx.restore();
    }
  }

  private draw = (): void => {
    this.frameId = null;
    if (this.disposed) return;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const dpr = this.dpr();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    if (this.background) {
      ctx.fillStyle = this.background;
      ctx.fillRect(0, 0, this.width, this.height);
    }
    const scene = this.scene;
    if (!scene) return;
    ctx.drawImage(scene.canvas, 0, 0, this.width, this.height);
    // The rect projects through the SAME transform the bitmap was rendered
    // with (atomic-swap invariant) — never a fresher transform.
    const viewportRect = this.viewport.getVisibleRect();
    const tl = worldToMini(scene.transform, { x: viewportRect.x, y: viewportRect.y });
    ctx.strokeStyle = this.viewportStroke;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(
      tl.x,
      tl.y,
      viewportRect.w * scene.transform.scale,
      viewportRect.h * scene.transform.scale,
    );
  };

  private navTransform(): MinimapTransform {
    return (
      this.scene?.transform ??
      computeMinimapTransform(this.currentMapping(), this.width, this.height, this.padding)
    );
  }

  private navigateFromEvent(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    // The canvas's DISPLAYED CSS size (rect.width/height) can differ from the
    // logical width/height the minimap transform is built for — applyCanvasSize
    // only sets the backing-store pixel attributes, never canvas.style
    // width/height, so a consumer that doesn't explicitly style the canvas (or
    // that CSS-scales it responsively) can display it at a different CSS size.
    // Normalize the pointer position from displayed to logical space first.
    // A zero-size rect (unmeasured/unlaid-out canvas) carries no scaling
    // information, so it falls back to an identity ratio rather than
    // dividing by zero.
    const scaleX = rect.width > 0 ? this.width / rect.width : 1;
    const scaleY = rect.height > 0 ? this.height / rect.height : 1;
    const point = {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
    const world: Point = miniToWorld(this.navTransform(), point);
    this.viewport.centerCameraAt(world);
  }

  private onPointerDown = (e: PointerEvent): void => {
    e.stopPropagation();
    e.preventDefault();
    this.dragging = true;
    this.canvas.setPointerCapture?.(e.pointerId);
    this.navigateFromEvent(e);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.dragging) return;
    e.stopPropagation();
    this.navigateFromEvent(e);
  };

  private onPointerUp = (e: PointerEvent): void => {
    this.dragging = false;
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      // already released
    }
  };

  // pointercancel / lostpointercapture: a browser gesture or interrupted touch
  // can end the interaction without a pointerup — the drag must not stick.
  private onPointerEnd = (): void => {
    this.dragging = false;
  };
}
