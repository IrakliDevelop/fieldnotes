import type { Camera } from './camera';
import type { DomNodeManager } from './dom-node-manager';
import type { HtmlElements } from './html-elements';
import { LIVE_NODE_ATTR } from './live-control';
import { ElementStore } from '../elements/element-store';
import type { ElementRegistry } from '../elements/element-registry';
import type { NoteEditor } from '../elements/note-editor';
import type { HistoryStack } from '../history/history-stack';
import type { HistoryRecorder } from '../history/history-recorder';
import type { LayerManager } from '../layers/layer-manager';
import type {
  NotificationController,
  PersistedPluginState,
  PluginStateManager,
} from '../core/plugin-state-manager';
import { migrateState } from '../core/state-serializer';
import type { CanvasState, ImportableCanvasState } from '../core/state-serializer';

export interface StateLoaderDeps {
  elementRegistry: ElementRegistry;
  store: ElementStore;
  layerManager: LayerManager;
  camera: Camera;
  history: HistoryStack;
  historyRecorder: HistoryRecorder;
  pluginStateManager: PluginStateManager;
  noteEditor: NoteEditor;
  domNodeManager: DomNodeManager;
  html: HtmlElements;
  flushPendingHistory: () => void;
  suspendNotifications: () => NotificationController;
  onHtmlElementMount:
    ((elementId: string, domId: string | undefined, container: HTMLDivElement) => void) | undefined;
}

export function loadViewportState(state: ImportableCanvasState, deps: StateLoaderDeps): void {
  const incoming = migrateState(
    structuredClone(state) as ImportableCanvasState,
    deps.elementRegistry,
  );
  new ElementStore(deps.elementRegistry).loadSnapshot(incoming.elements);
  const preparedPlugins = deps.pluginStateManager.prepareState(
    (incoming.extensions ?? {}) as Record<string, PersistedPluginState>,
  );
  if (!preparedPlugins.success) throw new Error(preparedPlugins.error);

  deps.flushPendingHistory();
  const previous = {
    elements: deps.store.snapshot(),
    layers: deps.layerManager.snapshot(),
    activeLayerId: deps.layerManager.activeLayerId,
    camera: { position: deps.camera.position, zoom: deps.camera.zoom },
    history: deps.history.snapshot(),
  };
  const notifications = deps.suspendNotifications();
  deps.historyRecorder.pause();
  let pluginsCommitted = false;
  try {
    deps.noteEditor.destroy(deps.store);
    deps.domNodeManager.clearDomNodes();
    applyCoreState(incoming, deps);
    deps.history.clear();
    deps.camera.moveTo(incoming.camera.position.x, incoming.camera.position.y);
    deps.camera.setZoom(incoming.camera.zoom);
    deps.domNodeManager.reconcileHtmlRouting(deps.store, deps.html.resolveRouting);
    const pluginResult = deps.pluginStateManager.commitPrepared(preparedPlugins.prepared);
    if (!pluginResult.success) throw new Error(pluginResult.error);
    pluginsCommitted = true;
    notifications.resume();
    deps.historyRecorder.resume();
    for (const name of pluginResult.droppedPlugins ?? []) {
      console.warn(
        `[fieldnotes] dropped saved state of plugin "${name}": version could not be migrated`,
      );
    }
  } catch (error) {
    const rollbackErrors: string[] = [];
    if (pluginsCommitted) {
      rollbackErrors.push(...deps.pluginStateManager.rollbackPrepared(preparedPlugins.prepared));
    }
    try {
      deps.store.loadSnapshot(previous.elements);
      deps.layerManager.loadSnapshot(previous.layers);
      deps.layerManager.setActiveLayer(previous.activeLayerId);
      deps.camera.moveTo(previous.camera.position.x, previous.camera.position.y);
      deps.camera.setZoom(previous.camera.zoom);
      deps.history.loadSnapshot(previous.history);
      deps.domNodeManager.clearDomNodes();
      deps.domNodeManager.reattachHtmlContent(deps.store);
      deps.domNodeManager.reconcileHtmlRouting(deps.store, deps.html.resolveRouting);
    } catch (rollbackError) {
      rollbackErrors.push(
        rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
      );
    } finally {
      deps.historyRecorder.resume();
      notifications.discard();
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors.map((message) => new Error(message))],
        'Viewport state load and rollback failed',
        { cause: error },
      );
    }
    throw error;
  }
}

function applyCoreState(state: CanvasState, deps: StateLoaderDeps): void {
  deps.store.loadSnapshot(state.elements);
  if (state.layers && state.layers.length > 0) deps.layerManager.loadSnapshot(state.layers);
  if (state.activeLayerId) deps.layerManager.setActiveLayer(state.activeLayerId);
  deps.domNodeManager.reattachHtmlContent(deps.store);
  for (const el of deps.store.getElementsByType('html')) {
    if (deps.domNodeManager.hasContent(el.id)) continue;
    const rebuilt = deps.html.buildContent(el);
    if (rebuilt) deps.domNodeManager.syncDomNode(el);
    if (!deps.onHtmlElementMount) continue;
    if (!rebuilt) deps.domNodeManager.syncDomNode(el);
    const node = deps.domNodeManager.getNode(el.id);
    if (!node) continue;
    deps.onHtmlElementMount(el.id, el.domId, node);
    deps.domNodeManager.markHostOwnedContent(el.id);
    node.dataset['initialized'] = 'true';
    node.toggleAttribute(LIVE_NODE_ATTR, el.interactive === true);
    Object.assign(node.style, {
      overflow: 'hidden',
      pointerEvents: el.interactive ? 'auto' : 'none',
    });
  }
}
