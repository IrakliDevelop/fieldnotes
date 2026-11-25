import type { ElementStore } from '../elements/element-store';
import type { ElementRegistry } from '../elements/element-registry';
import type { DomNodeManager } from './dom-node-manager';
import type { HtmlElements } from './html-elements';
import type { RenderLoop } from './render-loop';
import type { SelectionTracker } from './selection-tracker';
import { unbindArrowsFrom } from '../elements/arrow-binding';
import { getBoundText } from '../elements/bound-text';
import { reportFailure } from '../core/report-failure';

export interface StoreBindingsDeps {
  store: ElementStore;
  elementRegistry: ElementRegistry;
  domNodeManager: DomNodeManager;
  html: HtmlElements;
  renderLoop: RenderLoop;
  selectionTracker: SelectionTracker;
  requestRender: () => void;
  stopInteractingIfLive: () => void;
}

/** Unsubscribe functions in subscription order: add, remove, update, clear, batch. */
export function bindStoreListeners(deps: StoreBindingsDeps): (() => void)[] {
  return [
    deps.store.on('add', (el) => {
      if (el.type === 'html') {
        // Remote adds and undo re-adds arrive without DOM; rebuild it from the renderer.
        if (!deps.domNodeManager.hasContent(el.id)) {
          try {
            deps.html.buildContent(el);
          } catch (error) {
            reportFailure(error, 'html renderer failed');
          }
        }
        deps.domNodeManager.reconcileHtmlRouting(deps.store, deps.html.resolveRouting);
      }
      deps.renderLoop.markLayerDirty(el.layerId);
      deps.requestRender();
    }),
    deps.store.on('remove', (el, meta) => {
      unbindArrowsFrom(deps.store, el, meta, deps.elementRegistry);
      deps.domNodeManager.removeDomNode(el.id);
      deps.html.diagnostics.forget(el.id);
      deps.renderLoop.markLayerDirty(el.layerId);
      deps.renderLoop.forgetElement(el.id, el.layerId);
      deps.requestRender();
      deps.selectionTracker.handleRemoved(el.id);
    }),
    deps.store.on('update', ({ previous, current }) => {
      if (current.type === 'html') {
        deps.stopInteractingIfLive();
        deps.domNodeManager.reconcileHtmlRouting(deps.store, deps.html.resolveRouting);
      }
      if (
        previous.type === 'shape' &&
        current.type === 'shape' &&
        previous.fillColor !== current.fillColor
      ) {
        const text = getBoundText(current, deps.store);
        if (text) deps.domNodeManager.invalidateNode(text.id);
      }
      deps.renderLoop.noteElementUpdate(previous, current);
      deps.requestRender();
    }),
    deps.store.on('clear', () => {
      deps.domNodeManager.clearDomNodes();
      deps.html.diagnostics.reset();
      deps.renderLoop.clearLive();
      deps.renderLoop.markAllLayersDirty();
      deps.requestRender();
      deps.selectionTracker.prune();
    }),
    deps.store.on('batch', () => {
      deps.stopInteractingIfLive();
      deps.domNodeManager.reconcileHtmlRouting(deps.store, deps.html.resolveRouting);
      deps.html.diagnostics.reset();
      deps.renderLoop.clearLive();
      deps.renderLoop.markAllLayersDirty();
      deps.requestRender();
      deps.selectionTracker.prune();
    }),
  ];
}
