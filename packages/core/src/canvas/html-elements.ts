import type { ElementStore } from '../elements/element-store';
import type { HtmlElement } from '../elements/types';
import type { DomNodeManager } from './dom-node-manager';
import { HtmlPainterRegistry, resolveHtmlRouting } from './html-painter-registry';
import type { HtmlRouting } from './html-painter-registry';
import { HtmlPaintDiagnosticDeduper } from './html-paint-diagnostics';
import type { HtmlPaintDiagnostic } from './html-paint-diagnostics';

export interface HtmlElementsDeps {
  store: ElementStore;
  /** Assigned later in the Viewport constructor; read only when a method runs. */
  getDomNodeManager: () => DomNodeManager;
  markAllLayersDirty: () => void;
  requestRender: () => void;
}

export class HtmlElements {
  readonly painters = new HtmlPainterRegistry();
  readonly diagnostics = new HtmlPaintDiagnosticDeduper((d) => {
    for (const listener of [...this.diagnosticListeners]) {
      try {
        listener(d);
      } catch {
        /* isolated: one listener's fault must not break its siblings */
      }
    }
  });
  readonly resolveRouting = (el: HtmlElement): HtmlRouting => resolveHtmlRouting(el, this.painters);
  private readonly renderers = new Map<string, (el: HtmlElement) => HTMLElement>();
  private readonly diagnosticListeners = new Set<(d: HtmlPaintDiagnostic) => void>();

  constructor(private readonly deps: HtmlElementsDeps) {}

  registerRenderer(htmlType: string, factory: (el: HtmlElement) => HTMLElement): void {
    this.renderers.set(htmlType, factory);
  }

  buildContent(el: HtmlElement): HTMLElement | null {
    const factory = el.htmlType ? this.renderers.get(el.htmlType) : undefined;
    if (!factory) return null;
    const content = factory(el);
    this.deps.getDomNodeManager().storeHtmlContent(el.id, content);
    return content;
  }

  updateContent(id: string, newContent: HTMLElement): void {
    const el = this.deps.store.getById(id);
    if (!el) throw new Error(`Element not found: ${id}`);
    if (el.type !== 'html') throw new Error(`Element ${id} is not an HTML element`);
    const domNodeManager = this.deps.getDomNodeManager();
    domNodeManager.resetHtmlContent(id);
    domNodeManager.storeHtmlContent(id, newContent);
    // Content changes need the same synchronous reconciliation as registry changes: newly
    // available content for a dom-routed element must mount immediately rather than waiting
    // for the next render pass (and this method never calls store.update, so the store's own
    // 'update' listener never fires for it).
    domNodeManager.reconcileHtmlRouting(this.deps.store, this.resolveRouting);
    this.deps.requestRender();
  }

  onDiagnostic(listener: (d: HtmlPaintDiagnostic) => void): () => void {
    this.diagnosticListeners.add(listener);
    return () => this.diagnosticListeners.delete(listener);
  }

  /**
   * Fires whenever the html painter registry's active-painter set changes
   * (declare, register, or their release). Reconciliation is synchronous —
   * routing flips (and any DOM detach/remount) happen before this returns —
   * while the actual repaint of newly canvas-routed elements is deferred to
   * the next render frame via markAllLayersDirty + requestRender. Does NOT
   * touch a minimap: Viewport does not own a MinimapController, and the
   * built-in wrapper / React <Minimap /> each subscribe to the registry
   * directly.
   */
  onRegistryChanged(): void {
    this.deps.getDomNodeManager().reconcileHtmlRouting(this.deps.store, this.resolveRouting);
    this.deps.markAllLayersDirty();
    this.deps.requestRender();
  }

  clearDiagnosticListeners(): void {
    this.diagnosticListeners.clear();
  }
}
