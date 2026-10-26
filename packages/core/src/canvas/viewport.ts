import { Camera } from './camera';
import type { CameraOptions } from './camera';
import { InputHandler } from './input-handler';
import type { ShortcutOptions, ShortcutsApi } from './shortcut-map';
import { ActionRegistry } from '../actions/action-registry';
import type { ActionContext, ActionsApi } from '../actions/types';
import { createToolAction } from '../actions/builtin-actions';
import { buildContextMenuItems } from '../actions/context-menu-items';
import { Background } from './background';
import type { BackgroundOptions } from './background';
import { ElementStore } from '../elements/element-store';
import { ElementRenderer } from '../elements/element-renderer';
import { NoteEditor } from '../elements/note-editor';
import type { FontSizePreset } from '../elements/note-toolbar';
import type { CanvasElement, HtmlElement, ShapeKind } from '../elements/types';
import type { Point, Bounds } from '../core/types';
import { ContextMenu } from './context-menu';
import { Minimap } from './minimap';
import { createWrapper, createCanvas, createDomLayer, createPaintStack } from './viewport-dom';
import { HybridRenderSurface } from './hybrid-render-surface';
import { unbindArrowsFrom } from '../elements/arrow-binding';
import { getElementsBoundingBox } from '../elements/bounds';
import { ArrowLabelEditor } from '../elements/arrow-label-editor';
import { DEFAULT_SELECTION_COLOR } from '../tools/selection-color';
import { ToolManager } from '../tools/tool-manager';
import type { ToolContext, Tool } from '../tools/types';
import type { SelectTool } from '../tools/select-tool';
import { createDefaultTools } from '../tools/default-tools';
import { hitTest, hitTestResizeHandle, hitTestRotateHandle } from '../tools/select-hit';
import { HistoryStack } from '../history/history-stack';
import { HistoryRecorder } from '../history/history-recorder';
import { createImage, createHtmlElement, createShape } from '../elements/element-factory';
import {
  exportState as exportCanvasState,
  parseState,
  migrateState,
} from '../core/state-serializer';
import { exportImage } from './export-image';
import type { ExportImageOptions } from './export-image';
import { exportSvg } from './export-svg';
import type { ExportSvgOptions } from './export-svg';
import type { CanvasState, ImportableCanvasState } from '../core/state-serializer';
import { LayerManager } from '../layers/layer-manager';
import { InteractMode } from './interact-mode';
import { EmbeddedMode } from './embedded-mode';
import { LIVE_NODE_ATTR, isLiveControlTarget } from './live-control';
import { DomNodeManager } from './dom-node-manager';
import { RenderLoop } from './render-loop';
import type { OverlayRenderer } from './render-loop';
import { HtmlPainterRegistry, resolveHtmlRouting } from './html-painter-registry';
import type { HtmlPainter, HtmlRouting } from './html-painter-registry';
import { HtmlPaintDiagnosticDeduper } from '../canvas/html-paint-diagnostics';
import type { HtmlPaintDiagnostic } from '../canvas/html-paint-diagnostics';
import { ElementRegistry } from '../elements/element-registry';
import { getDefaultElementRegistry } from '../elements/default-registry';
import type { RenderStatsSnapshot } from './render-stats';
import { LayerCache } from './layer-cache';
import { MarginViewport } from './margin-viewport';
import type { ElementStyle } from '../elements/element-style';
import { ConstraintServiceProxy } from '../core/constraint-service';
import { SelectionOps } from './selection-ops';
import type { SelectionStyleDetails } from './selection-ops';
import type { AlignEdge, DistributeAxis } from './selection-ops';
import { ViewportInteractions } from './viewport-interactions';
import type { RotateDirection } from './selection-rotate';
import { ElementActivation } from './element-activation';
import type { ActivationOptions, ElementActivationEvent } from './element-activation';
import { createRenderHooks } from './render-hooks';
import type { RenderHooks } from './render-hooks';
import { PluginStateManager } from '../core/plugin-state-manager';
import type { NotificationController, PersistedPluginState } from '../core/plugin-state-manager';
import { PluginHost } from './plugin-host';
import type { RequiredCapabilities, ViewportPlugin } from './viewport-plugin';
import type { ServiceKey } from '../core/service-key';
import { reportFailure } from '../core/report-failure';
import { ContextLossGuard } from './context-loss-guard';
export type {
  PluginConfigureContext,
  PluginStartContext,
  RequiredCapabilities,
  ViewportPlugin,
} from './viewport-plugin';

export type { AlignEdge, DistributeAxis } from './selection-ops';
export type { RotateDirection } from './selection-rotate';

const EMPTY_IDS: string[] = [];

function noop(): void {
  // Stable unsubscribe handle for listeners that can never fire.
}

export interface ViewportOptions {
  camera?: CameraOptions;
  background?: BackgroundOptions;
  fontSizePresets?: FontSizePreset[];
  toolbar?: boolean;
  placeholder?: string;
  shortcuts?: ShortcutOptions;
  onHtmlElementMount?: (
    elementId: string,
    domId: string | undefined,
    container: HTMLDivElement,
  ) => void;
  onDrop?: (event: DragEvent, worldPosition: { x: number; y: number }) => void;
  onPaste?: (event: ClipboardEvent, worldPosition: { x: number; y: number }) => void;
  onImageError?: (info: { src: string; elementIds: string[]; cause?: unknown }) => void;
  /** CSS-pixel margin cached beyond the viewport. Default `256`. Set `0` to disable. */
  panBufferMargin?: number;
  /** Enable the built-in context menu. Default `true`. */
  contextMenu?: boolean;
  /** Coast (inertial glide) after a pan flick. Default `true`. */
  panInertia?: boolean;
  /** Show an overview minimap (bottom-right) with tap/drag-to-navigate. Default `false`. */
  minimap?: boolean;
  /** Element type registry; defaults to a per-viewport registry layered over the global default. */
  elementRegistry?: ElementRegistry;
  /** Domain plugins to install. Each plugin self-wires via the host API. */
  plugins?: ViewportPlugin[];
  /** Render capabilities that must remain installed after optional-plugin rollback. */
  requiredCapabilities?: RequiredCapabilities;
  /**
   * Tools registered after plugins start, replacing same-named plugin tools; activates `select` when present.
   * If a plugin activated a tool that an option tool replaces, the plugin's instance stays active.
   */
  tools?: 'default' | Tool[];
  /**
   * Board inside a scrolling page: plain wheel and, until `setEmbeddedEngaged(true)`, touch scroll
   * the page; Ctrl/⌘+wheel zooms; mouse and pen work as usual. Input only, read at construction.
   * Not gated: `setActivation`, the minimap, `PingInput` and `CameraAnimator`. Default `false`.
   */
  embedded?: boolean;
  /**
   * Colour of selection outlines, handles, marquee, lock badges, binding highlights and arrow
   * previews. Default `#2196F3`.
   */
  selectionColor?: string;
}

export interface HitTestOptions {
  /** Skip elements on locked layers. Default `true` (selection semantics). */
  respectLayerLock?: boolean;
  /** Applied inside the candidate walk; the topmost passing element wins. */
  match?: (element: CanvasElement) => boolean;
}

export class Viewport {
  readonly camera: Camera;
  readonly store: ElementStore;
  readonly layerManager: LayerManager;
  readonly toolManager: ToolManager;
  readonly history: HistoryStack;
  readonly elementRegistry: ElementRegistry;
  readonly domLayer: HTMLDivElement;
  private readonly canvasEl: HTMLCanvasElement;
  private readonly paintStack: HTMLDivElement;
  private readonly wrapper: HTMLDivElement;
  private readonly contextLossGuard: ContextLossGuard;
  private readonly disposers: (() => void)[] = [];
  private readonly actionRegistry: ActionRegistry;
  private readonly inputHandler: InputHandler;
  private readonly background: Background;
  private readonly renderer: ElementRenderer;
  private readonly noteEditor: NoteEditor;
  private readonly arrowLabelEditor: ArrowLabelEditor;
  readonly historyRecorder: HistoryRecorder;
  private transactionDepth = 0;
  private readonly selectionOps: SelectionOps;
  readonly toolContext: ToolContext;
  private readonly marginViewport: MarginViewport;
  private readonly layerCache: LayerCache;
  private readonly hybridSurface: HybridRenderSurface;
  private _snapToGrid = false;
  private _smartGuides = false;
  private readonly renderLoop: RenderLoop;
  private readonly _renderHooks: RenderHooks;
  private readonly pluginStateManager: PluginStateManager;
  private readonly pluginHost: PluginHost;
  private readonly domNodeManager: DomNodeManager;
  private readonly interactMode: InteractMode;
  private readonly embeddedMode: EmbeddedMode | null = null;
  private readonly wheelPassThroughListeners = new Set<(e: WheelEvent) => void>();
  private readonly onHtmlElementMount?: (
    elementId: string,
    domId: string | undefined,
    container: HTMLDivElement,
  ) => void;
  private readonly dropHandler?: (
    event: DragEvent,
    worldPosition: { x: number; y: number },
  ) => void;
  readonly constraintProxy = new ConstraintServiceProxy();
  private readonly interactions: ViewportInteractions;
  private contextMenu: ContextMenu | null = null;
  private minimap: Minimap | null = null;
  private readonly htmlRenderers = new Map<string, (el: HtmlElement) => HTMLElement>();
  private readonly htmlPainters = new HtmlPainterRegistry();
  private readonly htmlDiagnosticListeners = new Set<(d: HtmlPaintDiagnostic) => void>();
  private readonly htmlDiagnostics = new HtmlPaintDiagnosticDeduper((d) => {
    for (const listener of [...this.htmlDiagnosticListeners]) {
      try {
        listener(d);
      } catch {
        /* isolated: one listener's fault must not break its siblings */
      }
    }
  });
  private readonly resolveRouting = (el: HtmlElement): HtmlRouting =>
    resolveHtmlRouting(el, this.htmlPainters);
  private activation: ElementActivation | null = null;
  private activationGeneration = 0;
  private readonly activationListeners = new Set<(e: ElementActivationEvent) => void>();
  private readonly resizeListeners = new Set<() => void>();
  private readonly selectionListeners = new Set<() => void>();
  private readonly stateChangeListeners = new Set<() => void>();
  private detachSelectionSource: (() => void) | null = null;
  private pendingSelectionPrune = false;

  constructor(
    private readonly container: HTMLElement,
    options: ViewportOptions = {},
  ) {
    this.camera = new Camera(options.camera);
    this.background = new Background(options.background);
    this.elementRegistry =
      options.elementRegistry ?? new ElementRegistry(getDefaultElementRegistry());
    this.store = new ElementStore(this.elementRegistry);
    this.layerManager = new LayerManager(this.store);
    this.toolManager = new ToolManager();
    this.actionRegistry = new ActionRegistry(() => this.currentActionContext());
    const unsubToolRegister = this.toolManager.onRegister((tool) => {
      if (Viewport.isSelectionSource(tool)) this.attachSelectionSource(tool);
      if (!this.actionRegistry.get('tool.' + tool.name)) {
        this.actionRegistry.register(
          createToolAction(tool.name, {
            switchTool: (n: string) => this.toolContext.switchTool?.(n),
            isToolActive: () => this.inputHandler.isToolGestureActive,
            hasTool: (n: string) => this.toolManager.getTool(n) !== undefined,
          }),
        );
      }
    });
    this.disposers.push(unsubToolRegister, () => {
      this.detachSelectionSource?.();
      this.detachSelectionSource = null;
      this.selectionListeners.clear();
    });
    const existingSelect = this.getSelectTool();
    if (existingSelect && Viewport.isSelectionSource(existingSelect)) {
      this.attachSelectionSource(existingSelect);
    }
    this.renderer = new ElementRenderer();
    this.disposers.push(() => this.renderer.clearImageCache());
    this.renderer.setStore(this.store);
    this.renderer.setCamera(this.camera);
    this.renderer.setElementRegistry(this.elementRegistry);
    this.renderer.setOnImageLoad((src) => {
      for (const el of this.store.getAll()) {
        if (el.type === 'image' && el.src === src) this.renderLoop.markLayerDirty(el.layerId);
      }
      this.requestRender();
    });
    this.renderer.setOnImageError((src, cause) => {
      const elementIds: string[] = [];
      for (const el of this.store.getAll()) {
        if (el.type === 'image' && el.src === src) elementIds.push(el.id);
      }
      if (options.onImageError) {
        options.onImageError({ src, elementIds, cause });
      } else {
        console.warn(`[fieldnotes] image failed to load: ${src}`);
      }
    });
    this.renderer.setHtmlPainters(this.htmlPainters);
    this.renderer.setDiagnosticSink((d) => {
      this.htmlDiagnostics.emit(d, {
        registryVersion: this.htmlPainters.version,
        elementVersion: this.store.getVersion(d.elementId),
      });
    });
    this.noteEditor = new NoteEditor({
      fontSizePresets: options.fontSizePresets,
      toolbar: options.toolbar,
      placeholder: options.placeholder,
    });
    this.noteEditor.setOnStop((id) => this.interactions.onTextEditStop(id));
    this.noteEditor.setOnInput((id) => this.interactions.liveFitHeight(id));
    this.arrowLabelEditor = new ArrowLabelEditor(options.selectionColor ?? DEFAULT_SELECTION_COLOR);
    this.noteEditor.setHistoryHooks(
      () => this.historyRecorder.begin(),
      () => this.historyRecorder.commit(),
    );
    this.onHtmlElementMount = options.onHtmlElementMount;
    this.dropHandler = options.onDrop;
    this.history = new HistoryStack();
    this.historyRecorder = new HistoryRecorder(this.store, this.history, this.layerManager);
    const unsubRecorderEnd = this.historyRecorder.onTransactionEnd(() => {
      if (!this.pendingSelectionPrune) return;
      this.pendingSelectionPrune = false;
      this.pruneSelection();
    });
    this.selectionOps = new SelectionOps({
      store: this.store,
      recorder: this.historyRecorder,
      getSelectedIds: () => this.getSelectedIds(),
      requestRender: () => this.requestRender(),
      elementRegistry: this.elementRegistry,
    });

    this.wrapper = createWrapper();
    this.canvasEl = createCanvas();
    this.paintStack = createPaintStack();
    this.domLayer = createDomLayer();
    this.domLayer.style.zIndex = '2147483647';

    this.wrapper.appendChild(this.canvasEl);
    this.wrapper.appendChild(this.paintStack);
    this.wrapper.appendChild(this.domLayer);
    this.container.appendChild(this.wrapper);
    this.disposers.push(() => this.wrapper.remove());
    this.contextLossGuard = new ContextLossGuard(this.wrapper, () => {
      this.background.invalidate();
      this.renderLoop.markAllLayersDirty();
      this.renderLoop.requestRender();
    });
    this.background.setCanvasWatcher(this.contextLossGuard.watch);

    this._renderHooks = createRenderHooks();
    this.pluginStateManager = new PluginStateManager(() => this.suspendNotifications());
    this.pluginHost = new PluginHost({
      viewport: this,
      elementRegistry: this.elementRegistry,
      toolManager: this.toolManager,
      renderHooks: this._renderHooks,
      actionRegistry: this.actionRegistry,
      store: this.store,
      history: this.history,
      requestRender: () => this.renderLoop.requestRender(),
      pluginStateManager: this.pluginStateManager,
      getMinimap: () => this.minimap,
    });
    // Store listeners outlive plugin disposal so plugin removals still unbind arrows.
    const unsubStore: (() => void)[] = [];
    this.disposers.push(() => unsubStore.forEach((unsubscribe) => unsubscribe()));
    // Plugins dispose after the input handler and minimap release them.
    this.disposers.push(() => this.pluginHost.disposePlugins());

    this.toolContext = {
      camera: this.camera,
      store: this.store,
      requestRender: () => this.requestRender(),
      requestOverlayRender: () => this.requestOverlayRender(),
      switchTool: (name: string) => this.toolManager.setTool(name, this.toolContext),
      editElement: (id: string) => this.interactions.startEditingElement(id),
      fitNoteHeight: (id: string) => this.interactions.fitNoteHeight(id),
      setCursor: (cursor: string) => {
        this.wrapper.style.cursor = cursor;
      },
      activeLayerId: this.layerManager.activeLayerId,
      isLayerVisible: (id: string) => this.layerManager.isLayerVisible(id),
      isLayerLocked: (id: string) => this.layerManager.isLayerLocked(id),
      smartGuides: false,
      getVisibleRect: () =>
        this.camera.getVisibleRect(this.canvasEl.clientWidth, this.canvasEl.clientHeight),
      constraintService: this.constraintProxy,
      elementRegistry: this.elementRegistry,
      selectionColor: options.selectionColor,
    };

    const acceptsPointer = (e: PointerEvent): boolean =>
      this.embeddedMode?.acceptsPointer(e.pointerType) ?? true;
    this.inputHandler = new InputHandler(this.wrapper, this.camera, {
      toolManager: this.toolManager,
      toolContext: this.toolContext,
      historyRecorder: this.historyRecorder,
      historyStack: this.history,
      fitToContent: () => this.fitToContent(),
      group: () => this.groupSelection(),
      ungroup: () => this.ungroupSelection(),
      toggleLock: () => this.toggleLockSelection(),
      rotate: (direction) => this.rotateSelection(direction),
      openContextMenu: (screenPos, world) => {
        this.getSelectTool()?.selectAtPoint(world, this.toolContext);
        this.openContextMenu(screenPos);
      },
      shortcuts: options.shortcuts,
      addImage: (src, world) => this.addImage(src, world),
      getCenteredWorld: () => this.centeredPosition({ w: 300, h: 200 }),
      onPaste: options.onPaste,
      panInertia: options.panInertia,
      isOnSelectionHandle: (clientX, clientY) => {
        if (this.toolManager.activeTool?.name !== 'select') return false;
        const rect = this.wrapper.getBoundingClientRect();
        const world = this.camera.screenToWorld({ x: clientX - rect.left, y: clientY - rect.top });
        const ids = this.getSelectedIds();
        return (
          hitTestResizeHandle(world, this.toolContext, ids) !== null ||
          hitTestRotateHandle(world, this.toolContext, ids) !== null
        );
      },
      actions: this.actionRegistry,
      embeddedWheel: options.embedded,
      onWheelPassThrough: (e) => {
        for (const listener of [...this.wheelPassThroughListeners]) listener(e);
      },
      acceptsPointer,
    });
    this.disposers.push(() => this.inputHandler.destroy());
    if (options.embedded) {
      // After InputHandler, whose touch-action: none this overrides.
      const embeddedMode = new EmbeddedMode({
        wrapper: this.wrapper,
        isMenuOpen: () => this.contextMenu?.isOpen() ?? false,
        onDisengage: () => this.inputHandler.cancelTouchGestures(),
      });
      this.embeddedMode = embeddedMode;
      this.disposers.push(() => embeddedMode.destroy());
    }
    this.disposers.push(() => this.wheelPassThroughListeners.clear());

    if (options.contextMenu !== false) {
      this.contextMenu = new ContextMenu({
        onCommand: (id) => {
          this.actionRegistry.run(id, { source: 'menu' });
        },
        onClose: noop,
      });
    }
    this.disposers.push(
      () => this.contextMenu?.dispose(),
      this.toolManager.onChange(() => this.contextMenu?.close()),
      // The recorder detaches before plugins dispose so their teardown is not recorded.
      unsubRecorderEnd,
      () => this.historyRecorder.destroy(),
    );

    try {
      this.pluginHost.configurePlugins(options.plugins);
    } catch (error) {
      this.destroy();
      throw error;
    }

    if (options.minimap) {
      this.minimap = new Minimap(this.wrapper, this, {
        minimapHooks: this._renderHooks.minimap,
        getExtraBounds: () => this.pluginHost.getExtraBounds(),
      });
    }
    this.disposers.push(() => this.minimap?.destroy());

    this.domNodeManager = new DomNodeManager({
      domLayer: this.paintStack,
      onEditRequest: (id) => this.interactions.startEditingElement(id),
      isEditingElement: (id) =>
        this.noteEditor.isEditing && this.noteEditor.editingElementId === id,
      getVersion: (id) => this.store.getVersion(id),
      isInteracting: (id) => this.interactMode.interactingId === id,
      htmlPlaceholders: !options.onHtmlElementMount,
      acceptsPointer,
    });
    this.domNodeManager.setCameraTransform(this.camera.toCSSTransform());
    this.disposers.push(() => this.domNodeManager.clearDomNodes());

    this.interactMode = new InteractMode({
      getNode: (id) => this.domNodeManager.getNode(id),
      isInteractive: (id) => this.isLiveHtml(id),
    });
    this.disposers.push(() => this.interactMode.destroy());

    this.marginViewport = new MarginViewport(options.panBufferMargin ?? 256);
    this.marginViewport.setViewport(
      this.canvasEl.clientWidth || 800,
      this.canvasEl.clientHeight || 600,
      typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1,
    );
    this.layerCache = new LayerCache(this.marginViewport, this.contextLossGuard.watch);
    this.hybridSurface = new HybridRenderSurface(this.paintStack, this.contextLossGuard.watch);
    this.disposers.push(
      () => this.background.dispose(),
      () => this.layerCache.clear(),
      () => this.hybridSurface.clear(),
    );

    this.renderLoop = new RenderLoop({
      canvasEl: this.canvasEl,
      camera: this.camera,
      background: this.background,
      store: this.store,
      renderer: this.renderer,
      toolManager: this.toolManager,
      layerManager: this.layerManager,
      domNodeManager: this.domNodeManager,
      layerCache: this.layerCache,
      marginViewport: this.marginViewport,
      hybridSurface: this.hybridSurface,
      hooks: this._renderHooks,
      onFullFrame: () => this.contextLossGuard.frameComplete(),
    });
    this.disposers.push(this.contextLossGuard.watch(this.canvasEl, () => undefined));
    this.disposers.push(() => this.contextLossGuard.dispose());
    this.disposers.push(
      () => this.renderLoop.stop(),
      this.htmlPainters.onChange(() => this.onHtmlRegistryChanged()),
    );

    this.disposers.push(
      this.camera.onChange(() => {
        this.applyCameraTransform();
        this.noteEditor.updateToolbarPosition();
        this.contextMenu?.close();
        this.requestRender();
      }),
    );
    unsubStore.push(
      this.store.on('add', (el) => {
        if (el.type === 'html') {
          // Remote adds and undo re-adds arrive without DOM; rebuild it from the renderer.
          if (!this.domNodeManager.hasContent(el.id)) {
            try {
              this.buildHtmlContent(el);
            } catch (error) {
              reportFailure(error, 'html renderer failed');
            }
          }
          this.domNodeManager.reconcileHtmlRouting(this.store, this.resolveRouting);
        }
        this.renderLoop.markLayerDirty(el.layerId);
        this.requestRender();
      }),
      this.store.on('remove', (el, meta) => {
        unbindArrowsFrom(this.store, el, meta, this.elementRegistry);
        this.domNodeManager.removeDomNode(el.id);
        this.htmlDiagnostics.forget(el.id);
        this.renderLoop.markLayerDirty(el.layerId);
        this.renderLoop.forgetElement(el.id, el.layerId);
        this.requestRender();
        this.handleRemovedElement(el.id);
      }),
      this.store.on('update', ({ previous, current }) => {
        if (current.type === 'html') {
          this.stopInteractingIfLive();
          this.domNodeManager.reconcileHtmlRouting(this.store, this.resolveRouting);
        }
        this.renderLoop.noteElementUpdate(previous, current);
        this.requestRender();
      }),
      this.store.on('clear', () => {
        this.domNodeManager.clearDomNodes();
        this.htmlDiagnostics.reset();
        this.renderLoop.clearLive();
        this.renderLoop.markAllLayersDirty();
        this.requestRender();
        this.pruneSelection();
      }),
      this.store.on('batch', () => {
        this.stopInteractingIfLive();
        this.domNodeManager.reconcileHtmlRouting(this.store, this.resolveRouting);
        this.htmlDiagnostics.reset();
        this.renderLoop.clearLive();
        this.renderLoop.markAllLayersDirty();
        this.requestRender();
        this.pruneSelection();
      }),
    );

    this.disposers.push(
      this.layerManager.on('change', () => {
        this.toolContext.activeLayerId = this.layerManager.activeLayerId;
        // Snapshot loads replace layers without per-layer remove events, so prune on every change.
        this.layerCache.retain((id) => this.layerManager.getLayer(id) !== undefined);
        this.renderLoop.markAllLayersDirty();
        this.requestRender();
      }),
    );

    this.interactions = new ViewportInteractions({
      store: this.store,
      camera: this.camera,
      wrapper: this.wrapper,
      domLayer: this.domLayer,
      renderLoop: this.renderLoop,
      domNodeManager: this.domNodeManager,
      noteEditor: this.noteEditor,
      arrowLabelEditor: this.arrowLabelEditor,
      interactMode: this.interactMode,
      renderer: this.renderer,
      recorder: this.historyRecorder,
      toolContext: this.toolContext,
      requestRender: () => this.requestRender(),
      addImage: (src, position) => this.addImage(src, position),
      dropHandler: this.dropHandler,
      acceptsPointer,
    });
    // Editing commits while the recorder and store listeners are still attached.
    this.disposers.push(
      () => {
        this.noteEditor.destroy(this.store);
        this.arrowLabelEditor.cancel();
      },
      () => {
        this.activation?.dispose();
        this.activation = null;
        this.activationListeners.clear();
        this.htmlDiagnosticListeners.clear();
        this.resizeListeners.clear();
      },
    );

    try {
      this.pluginHost.startPlugins();
      this.pluginHost.validateRequiredCapabilities(options.requiredCapabilities);
    } catch (error) {
      this.destroy();
      throw error;
    }

    const emitStateChange = () => {
      for (const listener of [...this.stateChangeListeners]) {
        try {
          listener();
        } catch (error) {
          reportFailure(error, 'onStateChange listener failed');
        }
      }
    };
    this.disposers.push(
      this.store.onChange(emitStateChange),
      this.camera.onChange(emitStateChange),
      this.layerManager.on('change', emitStateChange),
      this.pluginHost.onChange(emitStateChange),
      () => this.stateChangeListeners.clear(),
    );

    const tools = options.tools === 'default' ? createDefaultTools() : (options.tools ?? []);
    for (const tool of tools) this.toolManager.register(tool);
    if (!this.toolManager.activeTool && this.toolManager.getTool('select')) {
      this.toolManager.setTool('select', this.toolContext);
    }

    const { onTapDown, onDoubleTap, onDragOver, onDrop } = this.interactions;
    this.wrapper.addEventListener('pointerdown', onTapDown);
    this.wrapper.addEventListener('pointerup', onDoubleTap);
    this.wrapper.addEventListener('dragover', onDragOver);
    this.wrapper.addEventListener('drop', onDrop);
    // Native drag from live padding would fight the board's own drag; live controls keep theirs.
    const onDragStart = (e: DragEvent): void => {
      if (
        e.target instanceof Element &&
        e.target.closest('[data-element-id]')?.hasAttribute(LIVE_NODE_ATTR) &&
        !isLiveControlTarget(e.target, this.wrapper)
      ) {
        e.preventDefault();
      }
    };
    // Focusing a control can scroll the overflow:hidden wrapper and misalign DOM and canvas.
    const onWrapperScroll = (): void => {
      if (options.embedded || this.wrapper.querySelector(`[data-element-id][${LIVE_NODE_ATTR}]`)) {
        this.wrapper.scrollTop = 0;
        this.wrapper.scrollLeft = 0;
      }
    };
    this.wrapper.addEventListener('dragstart', onDragStart);
    this.wrapper.addEventListener('scroll', onWrapperScroll);
    this.disposers.push(() => {
      this.wrapper.removeEventListener('dragstart', onDragStart);
      this.wrapper.removeEventListener('scroll', onWrapperScroll);
      this.wrapper.removeEventListener('pointerdown', onTapDown);
      this.wrapper.removeEventListener('pointerup', onDoubleTap);
      this.wrapper.removeEventListener('dragover', onDragOver);
      this.wrapper.removeEventListener('drop', onDrop);
    });
    this.observeResize();
    this.syncCanvasSize();
    this.renderLoop.start();
  }

  get ctx(): CanvasRenderingContext2D | null {
    return this.canvasEl.getContext('2d');
  }

  get plugins(): PluginStateManager {
    return this.pluginStateManager;
  }

  get renderHooks(): RenderHooks {
    return this._renderHooks;
  }

  getService<T>(key: ServiceKey<T>): T | undefined {
    return this.pluginHost.getService(key);
  }

  /** Mutations in the window arrive as one `batch` event, unrecorded in history and without origin. */
  suspendNotifications(): NotificationController {
    const controllers = [
      this.store.suspendNotifications(),
      this.layerManager.suspendNotifications(),
      this.camera.suspendNotifications(),
      this.history.suspendNotifications(),
    ];
    this.pluginHost.beginNotificationSuspend();
    let settled = false;
    const settle = (flush: boolean): void => {
      if (settled) return;
      settled = true;
      for (const controller of controllers) {
        if (flush) controller.resume();
        else controller.discard();
      }
      this.pluginHost.endNotificationSuspend(flush);
    };
    return { resume: () => settle(true), discard: () => settle(false) };
  }

  get snapToGrid(): boolean {
    return this._snapToGrid;
  }

  setSnapToGrid(enabled: boolean): void {
    this._snapToGrid = enabled;
    this.constraintProxy.setActive(enabled);
  }

  get smartGuides(): boolean {
    return this._smartGuides;
  }

  setSmartGuides(enabled: boolean): void {
    this._smartGuides = enabled;
    this.toolContext.smartGuides = enabled;
  }

  fitToContent(padding = 40): void {
    if (this.wrapper.clientWidth === 0 || this.wrapper.clientHeight === 0) return;
    const visibleElements = this.store
      .getAll()
      .filter((el) => this.layerManager.isLayerVisible(el.layerId));
    const bbox = getElementsBoundingBox(visibleElements, this.elementRegistry);
    if (!bbox) return;
    this.camera.fitToContent(bbox, this.wrapper.clientWidth, this.wrapper.clientHeight, padding);
  }

  /** World-space rectangle currently visible through the canvas. */
  getVisibleRect(): Bounds {
    return this.camera.getVisibleRect(this.canvasEl.clientWidth, this.canvasEl.clientHeight);
  }

  /**
   * Topmost element at a world point, using the same geometry selection uses
   * (rotation-aware, grid excluded, real stroke/line hit paths).
   *
   * `match` participates in the topmost-first walk rather than filtering the
   * result, so a non-matching element on top does not swallow the hit.
   * Invisible layers are never returned, in any mode.
   */
  getElementAt(world: Point, options?: HitTestOptions): CanvasElement | null {
    const ctx =
      options?.respectLayerLock === false
        ? { ...this.toolContext, isLayerLocked: () => false }
        : this.toolContext;
    return hitTest(world, ctx, options?.match);
  }

  /**
   * Size in CSS pixels of the canvas that `getVisibleRect()` measures.
   * Exposed because `canvasEl` is private: consumers can only reach the
   * wrapper (via `domLayer.parentElement`), so without this accessor the
   * canonical size behind `getVisibleRect()` is unreachable and callers
   * resort to `getVisibleRect().w * camera.zoom`. Capture and restore must
   * measure the same element or saved views do not round-trip.
   */
  getCanvasSize(): { w: number; h: number } {
    return { w: this.canvasEl.clientWidth, h: this.canvasEl.clientHeight };
  }

  /** Centers the camera on a world point without changing zoom. */
  centerCameraAt(world: Point): void {
    const z = this.camera.zoom;
    this.camera.moveTo(
      this.canvasEl.clientWidth / 2 - world.x * z,
      this.canvasEl.clientHeight / 2 - world.y * z,
    );
  }

  /**
   * Notifies after the host container resizes (ResizeObserver-driven). A resize
   * changes the visible world rect without a camera event; overlays such as the
   * minimap subscribe to stay current. Returns an idempotent unsubscribe.
   */
  onResize(listener: () => void): () => void {
    this.resizeListeners.add(listener);
    return () => this.resizeListeners.delete(listener);
  }

  requestRender(): void {
    this.renderLoop.requestRender();
  }

  /**
   * Repaints only the overlay stratum (tool overlay, registered overlays, `overlay` hooks) on the
   * next frame. Use `requestRender` for anything that changes elements, layers, the camera or
   * other hooks.
   */
  requestOverlayRender(): void {
    this.renderLoop.requestOverlayRender();
  }

  /**
   * Registers a world-space overlay drawn on every frame, regardless of the
   * active tool — the surface for remote presence visuals such as laser
   * trails, cursors, pings, and shared rulers. Overlays draw above elements
   * and DOM content, beneath the active tool's own `renderOverlay`, and never
   * touch elements, history, or persisted state. Returns an idempotent
   * unsubscribe that also erases the overlay's last frame.
   */
  registerOverlay(draw: OverlayRenderer): () => void {
    const dispose = this._renderHooks.viewport.register({
      overlay: (ctx) => {
        ctx.save();
        try {
          draw(ctx);
        } catch {
          // One faulty overlay must not take down the frame or its siblings.
        } finally {
          ctx.restore();
        }
      },
    });
    this.requestOverlayRender();
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      dispose();
      this.requestOverlayRender();
    };
  }

  exportState(): CanvasState {
    return exportCanvasState(
      this.store.snapshot(),
      this.camera,
      this.layerManager.snapshot(),
      this.layerManager.activeLayerId,
      this.pluginStateManager.exportState(),
      this.elementRegistry,
    );
  }

  exportJSON(): string {
    return JSON.stringify(this.exportState());
  }

  /**
   * Injects this viewport's own html painter registry into export options so a host
   * that registered painters via `registerHtmlPainter`/`expectCanvasHtmlTypes` gets
   * markers in exports without passing anything. An explicitly passed `htmlPainters`
   * REPLACES the viewport's registry rather than merging with it. `expectedCanvasTypes`
   * is always UNIONED with the resolved registry's own declarations — a caller's set
   * can only add expectations, never shrink the registry's own.
   */
  private withHtmlDefaults<
    T extends { htmlPainters?: HtmlPainterRegistry; expectedCanvasTypes?: ReadonlySet<string> },
  >(options?: T): T {
    const base = (options ?? {}) as T;
    const registry = base.htmlPainters ?? this.htmlPainters;
    const declared = registry.canvasTypes;
    const expected = base.expectedCanvasTypes
      ? new Set([...declared, ...base.expectedCanvasTypes]) // union only; never shrink
      : declared;
    return { ...base, htmlPainters: registry, expectedCanvasTypes: expected };
  }

  private exportOptions<T extends ExportImageOptions | ExportSvgOptions>(options?: T): T {
    return {
      ...this.withHtmlDefaults(options),
      elementRegistry: options?.elementRegistry ?? this.elementRegistry,
      renderHooks: options?.renderHooks ?? this._renderHooks,
    };
  }

  async exportImage(options?: ExportImageOptions): Promise<Blob | null> {
    return exportImage(this.store, this.exportOptions(options), this.layerManager);
  }

  async exportSVG(options?: ExportSvgOptions): Promise<string> {
    return exportSvg(this.store, this.exportOptions(options), this.layerManager);
  }

  loadState(state: ImportableCanvasState): void {
    const incoming = migrateState(
      structuredClone(state) as ImportableCanvasState,
      this.elementRegistry,
    );
    const preparedPlugins = this.pluginStateManager.prepareState(
      (incoming.extensions ?? {}) as Record<string, PersistedPluginState>,
    );
    if (!preparedPlugins.success) throw new Error(preparedPlugins.error);

    this.inputHandler.flushPendingHistory();
    const previous = {
      elements: this.store.snapshot(),
      layers: this.layerManager.snapshot(),
      activeLayerId: this.layerManager.activeLayerId,
      camera: { position: this.camera.position, zoom: this.camera.zoom },
      history: this.history.snapshot(),
    };
    const notifications = this.suspendNotifications();
    this.historyRecorder.pause();
    let pluginsCommitted = false;
    try {
      this.noteEditor.destroy(this.store);
      this.domNodeManager.clearDomNodes();
      this.applyCoreState(incoming);
      this.history.clear();
      this.camera.moveTo(incoming.camera.position.x, incoming.camera.position.y);
      this.camera.setZoom(incoming.camera.zoom);
      this.domNodeManager.reconcileHtmlRouting(this.store, this.resolveRouting);
      const pluginResult = this.pluginStateManager.commitPrepared(preparedPlugins.prepared);
      if (!pluginResult.success) throw new Error(pluginResult.error);
      pluginsCommitted = true;
      notifications.resume();
      this.historyRecorder.resume();
      for (const name of pluginResult.droppedPlugins ?? []) {
        console.warn(
          `[fieldnotes] dropped saved state of plugin "${name}": version could not be migrated`,
        );
      }
    } catch (error) {
      const rollbackErrors: string[] = [];
      if (pluginsCommitted) {
        rollbackErrors.push(...this.pluginStateManager.rollbackPrepared(preparedPlugins.prepared));
      }
      try {
        this.store.loadSnapshot(previous.elements);
        this.layerManager.loadSnapshot(previous.layers);
        this.layerManager.setActiveLayer(previous.activeLayerId);
        this.camera.moveTo(previous.camera.position.x, previous.camera.position.y);
        this.camera.setZoom(previous.camera.zoom);
        this.history.loadSnapshot(previous.history);
        this.domNodeManager.clearDomNodes();
        this.domNodeManager.reattachHtmlContent(this.store);
        this.domNodeManager.reconcileHtmlRouting(this.store, this.resolveRouting);
      } catch (rollbackError) {
        rollbackErrors.push(
          rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
        );
      } finally {
        this.historyRecorder.resume();
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

  private applyCoreState(state: CanvasState): void {
    this.store.loadSnapshot(state.elements);
    if (state.layers && state.layers.length > 0) this.layerManager.loadSnapshot(state.layers);
    if (state.activeLayerId) this.layerManager.setActiveLayer(state.activeLayerId);
    this.domNodeManager.reattachHtmlContent(this.store);
    for (const el of this.store.getElementsByType('html')) {
      if (this.domNodeManager.hasContent(el.id)) continue;
      const rebuilt = this.buildHtmlContent(el);
      if (rebuilt) this.domNodeManager.syncDomNode(el);
      if (!this.onHtmlElementMount) continue;
      if (!rebuilt) this.domNodeManager.syncDomNode(el);
      const node = this.domNodeManager.getNode(el.id);
      if (!node) continue;
      this.onHtmlElementMount(el.id, el.domId, node);
      this.domNodeManager.markHostOwnedContent(el.id);
      node.dataset['initialized'] = 'true';
      node.toggleAttribute(LIVE_NODE_ATTR, el.interactive === true);
      Object.assign(node.style, {
        overflow: 'hidden',
        pointerEvents: el.interactive ? 'auto' : 'none',
      });
    }
  }

  private buildHtmlContent(el: HtmlElement): HTMLElement | null {
    const factory = el.htmlType ? this.htmlRenderers.get(el.htmlType) : undefined;
    if (!factory) return null;
    const content = factory(el);
    this.domNodeManager.storeHtmlContent(el.id, content);
    return content;
  }

  loadJSON(json: string): void {
    this.loadState(parseState(json, this.elementRegistry));
  }

  setTool(name: string): void {
    if (!this.toolManager.getTool(name)) {
      console.warn(`[fieldnotes] setTool: no tool registered as "${name}"`);
      return;
    }
    this.toolManager.setTool(name, this.toolContext);
  }

  get actions(): ActionsApi {
    return this.actionRegistry;
  }

  private currentActionContext(): ActionContext {
    return {
      viewport: this,
      store: this.store,
      selectedIds: this.getSelectedIds(),
    };
  }

  get shortcuts(): ShortcutsApi {
    return this.inputHandler.shortcuts;
  }

  /**
   * Groups synchronous local store and layer mutations into one undo step.
   * Joins any open transaction (a nested call or a live tool gesture); a pending
   * keyboard nudge is committed first. If the callback throws, mutations
   * already applied remain undoable and the original error is rethrown.
   */
  transaction<T>(operation: () => T): T {
    if (this.transactionDepth === 0) this.inputHandler.flushPendingHistory();
    this.transactionDepth += 1;
    try {
      return this.historyRecorder.run(operation);
    } finally {
      this.transactionDepth -= 1;
    }
  }

  /** Removes existing elements as one undoable operation and returns the number removed. */
  removeElements(ids: Iterable<string>): number {
    const existingIds = [...new Set(ids)].filter((id) => this.store.getById(id) !== undefined);
    if (existingIds.length === 0) return 0;
    this.transaction(() => {
      for (const id of existingIds) this.store.remove(id);
    });
    this.requestRender();
    return existingIds.length;
  }

  undo(): boolean {
    this.inputHandler.flushPendingHistory();
    this.historyRecorder.pause();
    const result = this.history.undo(this.store);
    this.historyRecorder.resume();
    if (result) this.requestRender();
    return result;
  }

  redo(): boolean {
    this.inputHandler.flushPendingHistory();
    this.historyRecorder.pause();
    const result = this.history.redo(this.store);
    this.historyRecorder.resume();
    if (result) this.requestRender();
    return result;
  }

  addImage(src: string, position: { x: number; y: number }, size = { w: 300, h: 200 }): string {
    const image = createImage({ position, size, src, layerId: this.layerManager.activeLayerId });
    this.transaction(() => this.store.add(image));
    this.requestRender();
    return image.id;
  }

  addHtmlElement(
    dom: HTMLElement,
    position: { x: number; y: number },
    size = { w: 200, h: 150 },
    opts?: {
      htmlType?: string;
      data?: Record<string, unknown>;
      /** Host-owned element: excluded from exported state and never sent to the sync hub. */
      transient?: boolean;
      /** Non-'local' origin marks the add as external: no undo step, tagged for observers. */
      origin?: string;
      /** Controls take clicks; padding selects and moves. Persisted and synced. */
      interactive?: boolean;
    },
  ): string {
    const domId = dom.id || undefined;
    const el = createHtmlElement({
      position,
      size,
      domId,
      htmlType: opts?.htmlType,
      data: opts?.data,
      transient: opts?.transient,
      interactive: opts?.interactive,
      layerId: this.layerManager.activeLayerId,
    });
    this.domNodeManager.storeHtmlContent(el.id, dom);
    const external = opts?.origin !== undefined && opts.origin !== 'local';
    if (external) {
      this.store.add(el, { origin: opts.origin });
    } else {
      this.transaction(() => this.store.add(el));
    }
    this.requestRender();
    return el.id;
  }

  addShape(
    opts: {
      shape?: ShapeKind;
      size?: { w: number; h: number };
      position?: { x: number; y: number };
      strokeColor?: string;
      fillColor?: string;
      strokeWidth?: number;
    } = {},
  ): string {
    const size = opts.size ?? { w: 100, h: 100 };
    const position = opts.position ?? this.centeredPosition(size);
    const shape = createShape({
      position,
      size,
      shape: opts.shape,
      strokeColor: opts.strokeColor,
      strokeWidth: opts.strokeWidth,
      fillColor: opts.fillColor,
      layerId: this.layerManager.activeLayerId,
    });
    this.transaction(() => this.store.add(shape));
    this.getSelectTool()?.setSelection([shape.id]);
    this.requestRender();
    return shape.id;
  }

  private centeredPosition(size: { w: number; h: number }): { x: number; y: number } {
    const c = this.camera.screenToWorld({
      x: this.wrapper.clientWidth / 2,
      y: this.wrapper.clientHeight / 2,
    });
    return { x: c.x - size.w / 2, y: c.y - size.h / 2 };
  }

  removeLayer(id: string): void {
    this.transaction(() => this.layerManager.removeLayer(id));
  }

  registerHtmlRenderer(htmlType: string, factory: (el: HtmlElement) => HTMLElement): void {
    this.htmlRenderers.set(htmlType, factory);
  }

  updateHtmlElement(id: string, newContent: HTMLElement): void {
    const el = this.store.getById(id);
    if (!el) throw new Error(`Element not found: ${id}`);
    if (el.type !== 'html') throw new Error(`Element ${id} is not an HTML element`);
    this.domNodeManager.resetHtmlContent(id);
    this.domNodeManager.storeHtmlContent(id, newContent);
    // Content changes need the same synchronous reconciliation as registry changes: newly
    // available content for a dom-routed element must mount immediately rather than waiting
    // for the next render pass (and this method never calls store.update, so the store's own
    // 'update' listener never fires for it).
    this.domNodeManager.reconcileHtmlRouting(this.store, this.resolveRouting);
    this.requestRender();
  }

  /**
   * Declares htmlTypes that route to canvas painters even before a painter for
   * them registers, so the element renderer never treats them as DOM-backed
   * (avoiding a DOM-mount flash while a host is still loading its painter).
   * Returns an idempotent release; each `expect` call is independently reference
   * counted by the registry.
   */
  expectCanvasHtmlTypes(htmlTypes: Iterable<string>): () => void {
    return this.htmlPainters.expect(htmlTypes);
  }

  /**
   * Direct access to the viewport's live html-painter registry — the same
   * instance the viewport itself uses to route canvas-backed html elements.
   * Beyond `register`/`expectCanvasHtmlTypes` (already exposed above), this
   * hands out `getActivePainter`, `canvasTypes`, `onChange`, and `version`,
   * so a surface such as the minimap that needs to read routing state or
   * react to registry changes can do so without the viewport re-deriving or
   * proxying each capability individually.
   */
  getHtmlPainters(): HtmlPainterRegistry {
    return this.htmlPainters;
  }

  /**
   * Registers the canvas painter for `htmlType`. Later registrations for the
   * same type shadow earlier ones (LIFO); unregistering restores the previous
   * entry. Existing elements of this type reconcile synchronously — DOM nodes
   * detach and the render loop repaints on the next frame.
   */
  registerHtmlPainter(htmlType: string, painter: HtmlPainter): () => void {
    return this.htmlPainters.register(htmlType, painter);
  }

  /**
   * Subscribes to diagnostics emitted while painting canvas-routed html
   * elements (missing painter, painter threw, degenerate size). Deduped per
   * element/target/kind against the current registry and element versions, so
   * a fail -> repair -> fail-again sequence reports twice rather than being
   * suppressed forever. Returns an idempotent unsubscribe.
   */
  onHtmlPaintDiagnostic(listener: (d: HtmlPaintDiagnostic) => void): () => void {
    this.htmlDiagnosticListeners.add(listener);
    return () => this.htmlDiagnosticListeners.delete(listener);
  }

  /**
   * Enables (or replaces, or with `null` disables) pointer activation of
   * canvas-painted elements — the bridge for elements that are drawn rather than
   * mounted and so cannot receive DOM events. **Default off**, so every existing
   * consumer behaves identically.
   *
   * The controller is a passive observer: listeners are `{ passive: true }` and
   * it never calls `preventDefault`, `stopPropagation`, or takes pointer capture.
   * Changing or disabling activation resets all active and pending gestures.
   * Throws `RangeError` for a non-finite/negative `slopPx` or a non-positive
   * `doubleDelayMs`, leaving any existing activation untouched.
   *
   * The returned disposer clears **only its own generation**, so a stale
   * Strict-Mode cleanup cannot tear down a newer registration.
   */
  setActivation(options: ActivationOptions | null): () => void {
    // Construct before tearing down: a RangeError must leave the current
    // controller — and every outstanding disposer's generation — intact.
    const next = options
      ? new ElementActivation(
          {
            element: this.wrapper,
            camera: this.camera,
            store: this.store,
            resolveHtmlRouting: this.resolveRouting,
            isLayerVisible: (layerId: string) => this.layerManager.isLayerVisible(layerId),
            // Owner-side busy signal: the camera is gliding under pan inertia, or
            // this very gesture is the one that stopped the glide. Suppressing
            // both is what keeps "tap to stop a flick" from activating whatever
            // sits under the finger.
            isCameraBusy: () => this.inputHandler.isCameraCoasting(),
          },
          options,
        )
      : null;
    this.activation?.dispose();
    this.activation = next;
    next?.onActivate((e) => this.emitActivation(e));
    const generation = ++this.activationGeneration;
    return () => {
      if (this.activationGeneration !== generation) return;
      this.activation?.dispose();
      this.activation = null;
    };
  }

  /**
   * Subscribes to element activations. Persistent and independent of
   * `setActivation`: subscribing before activation is enabled, or across a
   * replacement, keeps working. Emission iterates a snapshot with per-listener
   * try/catch. Returns an idempotent unsubscribe.
   */
  onElementActivate(listener: (e: ElementActivationEvent) => void): () => void {
    this.activationListeners.add(listener);
    return () => {
      this.activationListeners.delete(listener);
    };
  }

  private emitActivation(event: ElementActivationEvent): void {
    for (const listener of [...this.activationListeners]) {
      try {
        listener(event);
      } catch {
        // One host listener's fault must not break its siblings.
      }
    }
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
  private onHtmlRegistryChanged(): void {
    this.domNodeManager.reconcileHtmlRouting(this.store, this.resolveRouting);
    this.renderLoop.markAllLayersDirty();
    this.requestRender();
  }

  private isLiveHtml(id: string): boolean {
    const el = this.store.getById(id);
    return el?.type === 'html' && el.interactive === true;
  }

  /** A live element never stays in InteractMode; its controls already take input. */
  private stopInteractingIfLive(): void {
    const id = this.interactMode.interactingId;
    if (id !== null && this.isLiveHtml(id)) this.interactMode.stopInteracting();
  }

  private getSelectTool(): SelectTool | undefined {
    return this.toolManager.getTool<SelectTool>('select');
  }

  private pruneSelection(): void {
    const tool = this.getSelectTool();
    if (!tool) return;
    const ids = tool.selectedIds;
    const filtered = ids.filter((id) => this.store.getById(id) !== undefined);
    if (filtered.length !== ids.length) tool.setSelection(filtered);
  }

  private handleRemovedElement(id: string): void {
    if (!this.getSelectedIds().includes(id)) return;
    if (this.historyRecorder.currentTransactionId !== null) {
      this.pendingSelectionPrune = true;
      return;
    }
    this.pruneSelection();
  }

  private static isSelectionSource(tool: Tool): tool is SelectTool {
    const candidate = tool as Partial<SelectTool>;
    return (
      tool.name === 'select' &&
      typeof candidate.onSelectionChange === 'function' &&
      typeof candidate.setSelection === 'function'
    );
  }

  private emitSelectionChange(): void {
    for (const listener of this.selectionListeners) {
      try {
        listener();
      } catch {
        // Selection listeners must not break each other or the caller.
      }
    }
  }

  private attachSelectionSource(tool: SelectTool): void {
    this.detachSelectionSource?.();
    this.detachSelectionSource = tool.onSelectionChange(() => this.emitSelectionChange());
  }

  /**
   * getSelectedIds() and the onSelectionChange emitter never surface stale ids:
   * once the enclosing history transaction completes, both reflect
   * the current selection.
   */
  getSelectedIds(): string[] {
    return this.getSelectTool()?.selectedIds ?? EMPTY_IDS;
  }

  runAction(action: string): void {
    this.actionRegistry.run(action, { source: 'api' });
  }

  canPaste(): boolean {
    return this.inputHandler.hasClipboard();
  }

  openContextMenu(screenPos: Point): void {
    if (!this.contextMenu) return;
    const items = buildContextMenuItems(this.actionRegistry, this.currentActionContext());
    if (items.length === 0) return;
    this.contextMenu.open(items, screenPos);
  }

  /**
   * Persistent, viewport-owned selection-change emitter. Subscribing works
   * regardless of whether a select tool is registered yet; it forwards
   * events from whichever select tool is currently attached via
   * `toolManager.onRegister`. Never delivers stale ids once the enclosing
   * history transaction completes.
   */
  onSelectionChange(listener: () => void): () => void {
    this.selectionListeners.add(listener);
    return () => {
      this.selectionListeners.delete(listener);
    };
  }

  getSelectionStyle(): ElementStyle | null {
    return this.selectionOps.getStyle();
  }

  /**
   * Unlike `getSelectionStyle()` — which returns `{}` for a style-less
   * selection — this returns `null` when no style field is applicable.
   */
  getSelectionStyleDetails(): SelectionStyleDetails | null {
    return this.selectionOps.getStyleDetails();
  }

  applyStyleToSelection(style: ElementStyle): void {
    this.transaction(() => this.selectionOps.applyStyle(style));
  }

  groupSelection(): void {
    this.transaction(() => this.selectionOps.group());
  }

  ungroupSelection(): void {
    this.transaction(() => this.selectionOps.ungroup());
  }

  toggleLockSelection(): void {
    this.transaction(() => this.selectionOps.toggleLock());
  }

  alignSelection(edge: AlignEdge): void {
    this.transaction(() => this.selectionOps.align(edge));
  }

  distributeSelection(axis: DistributeAxis): void {
    this.transaction(() => this.selectionOps.distribute(axis));
  }

  rotateSelection(direction: RotateDirection): void {
    this.transaction(() => this.selectionOps.rotateSelection(direction));
  }

  getRenderStats(): RenderStatsSnapshot {
    return this.renderLoop.getStats();
  }

  logPerformance(intervalMs = 2000): () => void {
    const id = setInterval(() => {
      const s = this.getRenderStats();
      console.log(
        `[FieldNotes] fps=${s.fps} frame=${s.avgFrameMs}ms p95=${s.p95FrameMs}ms layers=${s.layersMs}ms comp=${s.compositeMs}ms bg=${s.backgroundMs}ms overlay=${s.overlayMs}ms`,
      );
    }, intervalMs);
    return () => clearInterval(id);
  }

  /** Engages or disengages an embedded board; a no-op when not embedded or after `destroy()`. */
  setEmbeddedEngaged(engaged: boolean): void {
    this.embeddedMode?.setEngaged(engaged);
  }

  /** Whether an embedded board takes touch input; always `true` when not embedded. */
  isEmbeddedEngaged(): boolean {
    return this.embeddedMode?.isEngaged() ?? true;
  }

  /** Notifies on each engaged-state change, including Escape; never fires when not embedded. */
  onEmbeddedEngagedChange(listener: (engaged: boolean) => void): () => void {
    return this.embeddedMode?.onChange(listener) ?? noop;
  }

  /** Notifies for each plain wheel an embedded board leaves to the page; never fires otherwise. */
  onWheelPassThrough(listener: (e: WheelEvent) => void): () => void {
    this.wheelPassThroughListeners.add(listener);
    return () => this.wheelPassThroughListeners.delete(listener);
  }

  /** Fires synchronously after any change `exportState()` would reflect; returns a disposer. */
  onStateChange(listener: () => void): () => void {
    this.stateChangeListeners.add(listener);
    return () => this.stateChangeListeners.delete(listener);
  }

  destroy(): void {
    for (const dispose of this.disposers.splice(0).reverse()) dispose();
  }

  stopInteracting(): void {
    this.interactMode.stopInteracting();
  }

  private applyCameraTransform(): void {
    const transform = this.camera.toCSSTransform();
    this.domLayer.style.transform = transform;
    this.domNodeManager.setCameraTransform(transform);
  }

  private syncCanvasSize(): void {
    const dpr = typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1;
    this.renderLoop.setCanvasSize(
      this.container.clientWidth * dpr,
      this.container.clientHeight * dpr,
    );
    this.requestRender();
    this.resizeListeners.forEach((fn) => fn());
  }

  private observeResize(): void {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => this.syncCanvasSize());
    observer.observe(this.container);
    this.disposers.push(() => observer.disconnect());
  }
}
