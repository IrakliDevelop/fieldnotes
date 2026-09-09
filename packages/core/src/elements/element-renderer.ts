import type { CanvasElement, HtmlElement } from './types';
import { getElementBounds } from './element-bounds';
import { withRotation } from './rotate-canvas';
import { renderStroke } from './renderers/stroke-renderer';
import { renderShape } from './renderers/shape-renderer';
import { renderArrow } from './renderers/arrow-renderer';
import { renderImage } from './renderers/image-renderer';
import type { ElementStore } from './element-store';
import type { Camera } from '../canvas/camera';
import { resolveHtmlRouting } from '../canvas/html-painter-registry';
import type { HtmlPainterRegistry } from '../canvas/html-painter-registry';
import { paintHtmlElement } from '../canvas/html-paint';
import type { HtmlPaintDiagnostic, HtmlRenderTarget } from '../canvas/html-paint-diagnostics';
import type { ElementRegistry } from './element-registry';

const DOM_ELEMENT_TYPES = new Set(['note', 'html', 'text']);

export class ElementRenderer {
  private store: ElementStore | null = null;
  private imageCache = new Map<string, ImageBitmap | HTMLImageElement | 'failed'>();
  private onImageLoad: (() => void) | null = null;
  private onImageError: ((src: string, cause?: unknown) => void) | null = null;
  private camera: Camera | null = null;
  private labelEditingId: string | null = null;
  private htmlPainters: HtmlPainterRegistry | null = null;
  private expectedCanvasTypes: ReadonlySet<string> | undefined;
  private renderTarget: HtmlRenderTarget = 'screen';
  private diagnosticSink: ((d: HtmlPaintDiagnostic) => void) | null = null;
  private surfaceZoom: number | null = null;
  private elementRegistry: ElementRegistry | null = null;

  setStore(store: ElementStore): void {
    this.store = store;
  }

  setElementRegistry(registry: ElementRegistry): void {
    this.elementRegistry = registry;
  }

  setOnImageLoad(callback: () => void): void {
    this.onImageLoad = callback;
  }

  setOnImageError(callback: (src: string, cause?: unknown) => void): void {
    this.onImageError = callback;
  }

  setCamera(camera: Camera): void {
    this.camera = camera;
  }

  setCanvasSize(_w: number, _h: number): void {
    // Reserved for future use; canvas dimensions are no longer needed by core rendering.
  }

  /**
   * Render an extension element that needs explicit world-space bounds rather than
   * relying on the canvas transform (e.g. viewport-filling grids). The caller provides
   * the visible world bounds; the adapter's render method receives them via a
   * temporarily translated/scaled context.
   */
  renderExtensionWithBounds(
    ctx: CanvasRenderingContext2D,
    el: CanvasElement,
    worldBounds: { minX: number; minY: number; maxX: number; maxY: number },
    allElements: readonly CanvasElement[],
  ): void {
    if (el.type !== 'extension' || !this.elementRegistry) return;
    const adapter = this.elementRegistry.getAdapter(el.extensionType);
    if (!adapter?.render) return;
    adapter.render(ctx, el, allElements, worldBounds);
  }

  setLabelEditingId(id: string | null): void {
    this.labelEditingId = id;
  }

  /** Registry of canvas-backed html painters, plus any types declared canvas-routed
   *  before a painter is registered (`expectedCanvasTypes`). Null clears routing back
   *  to legacy DOM-only behavior. */
  setHtmlPainters(registry: HtmlPainterRegistry | null, expected?: ReadonlySet<string>): void {
    this.htmlPainters = registry;
    this.expectedCanvasTypes = expected;
  }

  setRenderTarget(target: HtmlRenderTarget): void {
    this.renderTarget = target;
  }

  setDiagnosticSink(sink: ((d: HtmlPaintDiagnostic) => void) | null): void {
    this.diagnosticSink = sink;
  }

  /** Explicit zoom used for surfaces with no camera (minimap, export). Ignored for
   *  the 'screen' target, which always reads the live camera zoom. */
  setSurfaceZoom(zoom: number): void {
    this.surfaceZoom = zoom;
  }

  isDomElement(element: CanvasElement): boolean {
    if (element.type === 'extension' && this.elementRegistry) {
      const adapter = this.elementRegistry.getAdapter(element.extensionType);
      return adapter?.renderMode === 'dom';
    }
    if (element.type !== 'html') return DOM_ELEMENT_TYPES.has(element.type);
    // canvas and missing are NOT DOM-participating; dom is.
    return resolveHtmlRouting(element, this.htmlPainters, this.expectedCanvasTypes) === 'dom';
  }

  isFullCanvasElement(element: CanvasElement): boolean {
    if (element.type === 'extension' && this.elementRegistry) {
      const adapter = this.elementRegistry.getAdapter(element.extensionType);
      return adapter?.fullCanvas === true;
    }
    return false;
  }

  renderCanvasElement(ctx: CanvasRenderingContext2D, element: CanvasElement): void {
    switch (element.type) {
      case 'stroke': {
        const b = getElementBounds(element);
        const c = b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : element.position;
        withRotation(ctx, element, c, () => renderStroke(ctx, element));
        break;
      }
      case 'arrow':
        renderArrow(ctx, element, this.store, this.labelEditingId);
        break;
      case 'shape': {
        const b = getElementBounds(element);
        const c = b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : element.position;
        withRotation(ctx, element, c, () => renderShape(ctx, element));
        break;
      }
      case 'image': {
        const b = getElementBounds(element);
        const c = b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : element.position;
        withRotation(ctx, element, c, () =>
          renderImage(ctx, element, this.imageCache, this.onImageLoad, this.onImageError),
        );
        break;
      }
      case 'html':
        this.renderHtml(ctx, element);
        break;
      case 'extension': {
        if (this.elementRegistry) {
          const adapter = this.elementRegistry.getAdapter(element.extensionType);
          if (adapter?.render) {
            const allElements = this.store?.getAll() ?? [];
            adapter.render(ctx, element, allElements);
          }
        }
        break;
      }
    }
  }

  /** Only reached for canvas-routed html (isDomElement already sent 'dom'-routed
   *  elements down the DOM sync branch instead). */
  private renderHtml(ctx: CanvasRenderingContext2D, el: HtmlElement): void {
    const routing = resolveHtmlRouting(el, this.htmlPainters, this.expectedCanvasTypes);
    if (routing === 'dom') return; // DOM layer owns it
    if (routing === 'missing') {
      this.diagnosticSink?.({
        kind: 'missing-painter',
        elementId: el.id,
        htmlType: el.htmlType,
        target: this.renderTarget,
      });
      return; // never fall back to DOM
    }
    const painter = this.htmlPainters?.getActivePainter(el.htmlType ?? '');
    if (!painter) return;
    paintHtmlElement(el, painter, {
      ctx,
      zoom: this.zoomForTarget(),
      target: this.renderTarget,
      onDiagnostic: this.diagnosticSink ?? undefined,
    });
  }

  private zoomForTarget(): number {
    if (this.renderTarget === 'screen') return this.camera?.zoom ?? 1;
    return this.surfaceZoom ?? 1;
  }
}
