import { Camera } from './camera';
import type { CameraOptions } from './camera';
import { InputHandler } from './input-handler';
import type { ShortcutOptions, ShortcutsApi } from './shortcut-map';
import { ActionRegistry } from '../actions/action-registry';
import type { ActionContext, ActionsApi } from '../actions/types';
import { createLinkActions, createToolAction } from '../actions/builtin-actions';
import { buildContextMenuItems } from '../actions/context-menu-items';
import { createEditTextAction } from '../actions/edit-text-action';
import { Background } from './background';
import type { BackgroundOptions } from './background';
import { resolveTheme } from './theme';
import type { ResolvedTheme, Theme } from './theme';
import { ElementStore } from '../elements/element-store';
import { ElementRenderer } from '../elements/element-renderer';
import { setElbowVisibleLayers } from '../elements/elbow-cache';
import { NoteEditor } from '../elements/note-editor';
import type { FontSizePreset } from '../elements/note-toolbar';
import type { CanvasElement, HtmlElement, ShapeKind } from '../elements/types';
import type { Point, Bounds } from '../core/types';
import { ContextMenu } from './context-menu';
import type { Minimap } from './minimap';
import { createWrapper, createCanvas, createDomLayer, createPaintStack } from './viewport-dom';
import { HybridRenderSurface } from './hybrid-render-surface';
import { getElementsBoundingBox } from '../elements/bounds';
import { ToolManager } from '../tools/tool-manager';
import type { ToolContext, Tool } from '../tools/types';
import type { SelectTool } from '../tools/select-tool';
import { createDefaultTools } from '../tools/default-tools';
import { hitTest, hitTestResizeHandle, hitTestRotateHandle } from '../tools/select-hit';
import { HistoryStack } from '../history/history-stack';
import { HistoryRecorder } from '../history/history-recorder';
import { InsertQueue } from './insert-queue';
import type { AssetResolver, ImageErrorInfo } from './content-inserter';
import { ContentInserter } from './content-inserter';
import { createImage, createHtmlElement, createShape } from '../elements/element-factory';
import {
  createBoundText,
  getBoundText,
  getBoundTextContainerId,
  isBoundTextContainer,
} from '../elements/bound-text';
import { isNoteContentEmpty } from '../elements/note-sanitizer';
import { exportState as exportCanvasState, parseState } from '../core/state-serializer';
import type { ExportImageOptions } from './export-image';
import type { ExportSvgOptions } from './export-svg';
import type { ExportPdfOptions } from './export-pdf';
import type { CanvasState, ImportableCanvasState } from '../core/state-serializer';
import { LayerManager } from '../layers/layer-manager';
import { InteractMode } from './interact-mode';
import { EmbeddedMode } from './embedded-mode';
import { bindWrapperEvents } from './wrapper-events';
import { DomNodeManager } from './dom-node-manager';
import { RenderLoop } from './render-loop';
import type { OverlayRenderer } from './render-loop';
import type { HtmlPainter, HtmlPainterRegistry } from './html-painter-registry';
import type { HtmlPaintDiagnostic } from '../canvas/html-paint-diagnostics';
import { HtmlElements } from './html-elements';
import { loadViewportState } from './state-loader';
import { ElementRegistry } from '../elements/element-registry';
import { getDefaultElementRegistry } from '../elements/default-registry';
import type { RenderStatsSnapshot } from './render-stats';
import { LayerCache } from './layer-cache';
import { MarginViewport } from './margin-viewport';
import type { ElementStyle } from '../elements/element-style';
import { ConstraintServiceProxy } from '../core/constraint-service';
import { SelectionOps } from './selection-ops';
import { SelectionTracker, isSelectionSource } from './selection-tracker';
import type { SelectionStyleDetails } from './selection-ops';
import type { AlignEdge, DistributeAxis } from './selection-ops';
import { FrameOps } from './frame-ops';
import { ViewportInteractions } from './viewport-interactions';
import type { RotateDirection } from './selection-rotate';
import { ActivationController } from './activation-controller';
import type { ActivationOptions, ElementActivationEvent } from './element-activation';
import { createRenderHooks } from './render-hooks';
import type { RenderHooks } from './render-hooks';
import { configureRenderer } from './renderer-setup';
import { bindStoreListeners } from './store-bindings';
import { PluginStateManager } from '../core/plugin-state-manager';
import type { NotificationController } from '../core/plugin-state-manager';
import { PluginHost } from './plugin-host';
import type { RequiredCapabilities, ViewportPlugin } from './viewport-plugin';
import type { ServiceKey } from '../core/service-key';
import { reportFailure } from '../core/report-failure';
import { ContextLossGuard } from './context-loss-guard';
import { getHierarchyClosure } from '../elements/hierarchy-ops';
import { normalizeLink } from '../elements/link';
import { LinkController } from './link-controller';
import type { PresentationApi } from './presentation';
import { coreActionsPlugin, createFeatureHost, INERT_PRESENTATION } from './feature-host';
import type { PaletteApi } from './command-palette';
import type { ShortcutsHelpApi } from './shortcuts-help';
export type {
  PluginConfigureContext,
  PluginStartContext,
  RequiredCapabilities,
  ViewportPlugin,
} from './viewport-plugin';

export type { AlignEdge, DistributeAxis } from './selection-ops';
export type { RotateDirection } from './selection-rotate';

/** What `exportImage`/`exportSvg`/`exportPdf` read from a viewport. */
export interface ExportDefaults {
  store: ElementStore;
  layerManager: LayerManager;
  /** `options` completed with this viewport's registry, render hooks, theme and html painters. */
  options<T extends ExportImageOptions | ExportSvgOptions | ExportPdfOptions>(options?: T): T;
}

const EMPTY_IDS: string[] = [];

const isMac = (): boolean => /Mac|iPhone|iPad|iPod/.test(navigator.platform);

function noop(): void {
  // Stable unsubscribe handle for listeners that can never fire.
}

const INERT_PALETTE: PaletteApi = {
  open: noop,
  close: noop,
  isOpen: () => false,
};

const INERT_SHORTCUTS_HELP: ShortcutsHelpApi = {
  open: noop,
  close: noop,
  isOpen: () => false,
};

export interface ViewportOptions {
  camera?: CameraOptions;
  background?: BackgroundOptions;
  /** Board theme. Default `'light'`; `'system'` follows the system preference. */
  theme?: Theme;
  fontSizePresets?: FontSizePreset[];
  toolbar?: boolean;
  placeholder?: string;
  shortcuts?: ShortcutOptions;
  onHtmlElementMount?: (
    elementId: string,
    domId: string | undefined,
    container: HTMLDivElement,
  ) => void;
  /**
   * Called for every drop before core acts; return `false` to let core handle the drop.
   * `true` or nothing means the host owns it.
   */
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- returning nothing keeps the host-owns-it contract
  onDrop?: (event: DragEvent, worldPosition: { x: number; y: number }) => boolean | void;
  /**
   * Called for every paste core would handle, before core acts; return `false` to let core
   * handle it. `true` or nothing means the host owns the paste.
   */
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- returning nothing keeps the host-owns-it contract
  onPaste?: (event: ClipboardEvent, worldPosition: { x: number; y: number }) => boolean | void;
  onImageError?: (info: ImageErrorInfo) => void;
  /** Host upload for dropped, pasted and imported images; without it images inline as base64. */
  assets?: AssetResolver;
  /** CSS-pixel margin cached beyond the viewport. Default `256`. Set `0` to disable. */
  panBufferMargin?: number;
  /** Enable the built-in context menu. Default `true`. */
  contextMenu?: boolean;
  /** Coast (inertial glide) after a pan flick. Default `true`. */
  panInertia?: boolean;
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
  /**
   * Called before every link open; return `true` to handle it yourself, for example
   * cross-board navigation. `event` is the last pointer event seen (it may be a pointermove),
   * or `null` for keyboard, menu and command palette opens.
   */
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- returning nothing lets core open the link
  onOpenLink?: (link: string, event: PointerEvent | null) => boolean | void;
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
  private presentationApi: PresentationApi | null = null;
  private commandPalette: PaletteApi | null = null;
  private shortcutsHelpDialog: ShortcutsHelpApi | null = null;
  private readonly background: Background;
  private theme: ResolvedTheme;
  private themeSpec: Theme;
  private systemMedia: MediaQueryList | null = null;
  private systemThemeDispose: (() => void) | null = null;
  private destroyed = false;
  private readonly themeListeners = new Set<(theme: ResolvedTheme) => void>();
  private readonly renderer: ElementRenderer;
  private readonly noteEditor: NoteEditor;
  readonly historyRecorder: HistoryRecorder;
  private readonly insertQueue: InsertQueue;
  private readonly inserter: ContentInserter;
  private transactionDepth = 0;
  private readonly selectionOps: SelectionOps;
  private readonly frameOps: FrameOps;
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
  private readonly dropHandler: ViewportOptions['onDrop'];
  private readonly onOpenLink: ViewportOptions['onOpenLink'];
  private readonly links: LinkController;
  readonly constraintProxy = new ConstraintServiceProxy();
  private readonly interactions: ViewportInteractions;
  private contextMenu: ContextMenu | null = null;
  private minimap: Minimap | null = null;
  private readonly html: HtmlElements;
  private readonly activationController: ActivationController;
  private readonly resizeListeners = new Set<() => void>();
  private readonly selectionTracker: SelectionTracker;
  private readonly stateChangeListeners = new Set<() => void>();

  constructor(
    private readonly container: HTMLElement,
    options: ViewportOptions = {},
  ) {
    this.themeSpec = options.theme ?? 'light';
    this.systemMedia = this.createSystemMedia(this.themeSpec);
    this.theme = resolveTheme(this.themeSpec, this.systemMedia?.matches ?? false);
    this.listenToSystemTheme();
    this.disposers.push(() => {
      this.removeSystemThemeListener();
      this.themeListeners.clear();
    });
    this.camera = new Camera(options.camera);
    this.background = new Background(options.background);
    this.background.setTheme(this.theme);
    this.elementRegistry =
      options.elementRegistry ?? new ElementRegistry(getDefaultElementRegistry());
    this.store = new ElementStore(this.elementRegistry);
    this.layerManager = new LayerManager(this.store);
    this.html = new HtmlElements({
      store: this.store,
      getDomNodeManager: () => this.domNodeManager,
      markAllLayersDirty: () => this.renderLoop.markAllLayersDirty(),
      requestRender: () => this.requestRender(),
    });
    setElbowVisibleLayers(this.store, (id) => this.layerManager.isLayerVisible(id));
    this.toolManager = new ToolManager();
    this.selectionTracker = new SelectionTracker({
      store: this.store,
      getSelectTool: () => this.getSelectTool(),
      getSelectedIds: () => this.getSelectedIds(),
      getCurrentTransactionId: () => this.historyRecorder.currentTransactionId,
    });
    this.actionRegistry = new ActionRegistry(() => this.currentActionContext());
    const unsubToolRegister = this.toolManager.onRegister((tool) => {
      if (isSelectionSource(tool)) this.selectionTracker.attach(tool);
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
    this.disposers.push(unsubToolRegister, () => this.selectionTracker.dispose());
    const existingSelect = this.getSelectTool();
    if (existingSelect && isSelectionSource(existingSelect)) {
      this.selectionTracker.attach(existingSelect);
    }
    this.renderer = new ElementRenderer();
    this.disposers.push(() => this.renderer.clearImageCache());
    const reportImageError = configureRenderer({
      renderer: this.renderer,
      theme: this.theme,
      store: this.store,
      camera: this.camera,
      elementRegistry: this.elementRegistry,
      html: this.html,
      onImageError: options.onImageError,
      markLayerDirty: (id) => this.renderLoop.markLayerDirty(id),
      requestRender: () => this.requestRender(),
    });
    this.noteEditor = new NoteEditor({
      fontSizePresets: options.fontSizePresets,
      toolbar: options.toolbar,
      placeholder: options.placeholder,
    });
    this.noteEditor.setTheme(this.theme);
    this.noteEditor.setOnInput((id) => this.interactions.liveFitHeight(id));
    this.noteEditor.setOnAbandon((id) => this.interactions.abandonEditHistory(id));
    this.noteEditor.setHistoryHooks(
      (id) => this.interactions.beginEditHistory(id),
      (id) => this.interactions.commitEditHistory(id),
    );
    this.onHtmlElementMount = options.onHtmlElementMount;
    this.dropHandler = options.onDrop;
    this.onOpenLink = options.onOpenLink;
    this.history = new HistoryStack();
    this.historyRecorder = new HistoryRecorder(this.store, this.history, this.layerManager);
    // inputHandler is assigned later in this constructor; these closures run only at insert time.
    this.insertQueue = new InsertQueue({
      recorder: this.historyRecorder,
      isGestureActive: () => this.inputHandler.isToolGestureActive,
      flushPendingHistory: () => this.inputHandler.flushPendingHistory(),
      transaction: (run) => this.transaction(run),
    });
    const unsubRecorderEnd = this.historyRecorder.onTransactionEnd(() =>
      this.selectionTracker.flushPendingPrune(),
    );
    this.selectionOps = new SelectionOps({
      store: this.store,
      recorder: this.historyRecorder,
      getSelectedIds: () => this.getSelectedIds(),
      requestRender: () => this.requestRender(),
      elementRegistry: this.elementRegistry,
    });
    this.frameOps = new FrameOps({
      store: this.store,
      elementRegistry: this.elementRegistry,
      layerManager: this.layerManager,
      transaction: (operation) => this.transaction(operation),
      requestRender: () => this.requestRender(),
      setSelection: (ids) => this.getSelectTool()?.setSelection(ids),
    });

    this.wrapper = createWrapper();
    this.wrapper.dataset.fieldnotesTheme = this.theme.base;
    this.noteEditor.setFocusReturnTarget(this.wrapper);
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
    this.activationController = new ActivationController({
      element: this.wrapper,
      camera: this.camera,
      store: this.store,
      resolveHtmlRouting: this.html.resolveRouting,
      isLayerVisible: (layerId: string) => this.layerManager.isLayerVisible(layerId),
      // Owner-side busy signal: the camera is gliding under pan inertia, or
      // this very gesture is the one that stopped the glide. Suppressing
      // both is what keeps "tap to stop a flick" from activating whatever
      // sits under the finger.
      isCameraBusy: () => this.inputHandler.isCameraCoasting(),
    });

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
    // Plugins dispose after the input handler releases them.
    this.disposers.push(() => this.pluginHost.disposePlugins());

    this.toolContext = {
      camera: this.camera,
      store: this.store,
      theme: this.theme,
      requestRender: () => this.requestRender(),
      requestOverlayRender: () => this.requestOverlayRender(),
      switchTool: (name: string) => this.toolManager.setTool(name, this.toolContext),
      setSelection: (ids: string[]) => this.getSelectTool()?.setSelection(ids),
      editElement: (id: string) => this.interactions.startEditingElement(id),
      fitNoteHeight: (id: string) => this.interactions.fitNoteHeight(id),
      setCursor: (cursor: string) => {
        this.wrapper.style.cursor = cursor;
      },
      activeLayerId: this.layerManager.activeLayerId,
      isLayerVisible: (id: string) => this.layerManager.isLayerVisible(id),
      isLayerLocked: (id: string) => this.layerManager.isLayerLocked(id),
      hasLayer: (id: string) => this.layerManager.getLayer(id) !== undefined,
      smartGuides: false,
      getVisibleRect: () =>
        this.camera.getVisibleRect(this.canvasEl.clientWidth, this.canvasEl.clientHeight),
      constraintService: this.constraintProxy,
      elementRegistry: this.elementRegistry,
      selectionColor: options.selectionColor,
      openLink: (id: string) =>
        this.interactions.openGestureLink(id, this.inputHandler.getLastPointerEvent()),
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
      getCenteredWorld: () => this.centeredPosition({ w: 0, h: 0 }),
      clipboardHost: {
        elementRegistry: this.elementRegistry,
        onPaste: options.onPaste,
        claimsFile: (f, k) => this.inserter.claimsFile(f, k),
        insertElements: (els, a) => this.inserter.insertElements(els, a),
        insertFiles: (f, a, k) => this.inserter.insertFiles(f, a, k),
        insertText: (t, a, l) => this.inserter.insertText(t, a, l),
      },
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
    this.inserter = new ContentInserter({
      store: this.store,
      elementRegistry: this.elementRegistry,
      getActiveLayerId: () => this.layerManager.activeLayerId,
      getTextStyle: () => {
        const o = this.toolManager.getTool('text')?.getOptions?.();
        return o &&
          'fontSize' in o &&
          typeof o.fontSize === 'number' &&
          'color' in o &&
          typeof o.color === 'string'
          ? { fontSize: o.fontSize, color: o.color }
          : null;
      },
      insertElements: (els, a) => this.inputHandler.insertElements(els, a),
      insertWhenIdle: (run) => this.insertQueue.insertWhenIdle(run),
      transaction: (run) => this.transaction(run),
      switchToSelect: () => {
        if (this.toolManager.activeTool?.name !== 'select') this.toolContext.switchTool?.('select');
      },
      setSelection: (ids) => this.getSelectTool()?.setSelection(ids),
      requestRender: () => this.requestRender(),
      addImage: (src, p) => this.addImage(src, p),
      assets: options.assets,
      onImageError: reportImageError,
    });
    this.links = new LinkController({
      store: this.store,
      layerManager: this.layerManager,
      elementRegistry: this.elementRegistry,
      camera: this.camera,
      container: this.container,
      wrapper: this.wrapper,
      onOpenLink: this.onOpenLink,
      getTheme: () => this.theme,
      getCanvasSize: () => this.getCanvasSize(),
      stopCameraMotion: () => this.inputHandler.stopPanInertia(),
      closeContextMenu: () => this.contextMenu?.close(),
      selectElement: (id) => {
        if (this.toolManager.activeTool?.name !== 'select') this.toolContext.switchTool?.('select');
        this.getSelectTool()?.setSelection([id]);
      },
      setLink: (ids, link) => this.setLink(ids, link),
    });
    const coreActions = [
      ...createLinkActions({
        setLink: (ids, link) => this.setLink(ids, link),
        openLink: (id) => this.links.open(id, null),
        promptLink: (ids, initial, label) => this.links.prompt(ids, initial, label),
      }),
      createEditTextAction({
        store: this.store,
        layerManager: this.layerManager,
        elementRegistry: this.elementRegistry,
        editBoundText: (id) => this.interactions.editBoundText(id),
        startEditingElement: (id) => this.interactions.startEditingElement(id),
      }),
    ];
    this.disposers.push(() => this.links.closePrompt());
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
      () => this.insertQueue.destroy(),
    );

    createFeatureHost({
      viewport: this,
      container: this.container,
      wrapper: this.wrapper,
      actions: this.actionRegistry,
      getActionContext: () => this.currentActionContext(),
      getBindings: () => this.inputHandler.shortcuts.getBindings(),
      matchShortcut: (event) => this.inputHandler.matchShortcut(event),
      stopCameraMotion: () => this.inputHandler.stopPanInertia(),
      closeContextMenu: () => this.contextMenu?.close(),
      selectionColor: () => options.selectionColor ?? this.theme.tokens.selection,
      clearSelection: () => this.getSelectTool()?.setSelection([]),
      isMac,
      getExtraBounds: () => this.pluginHost.getExtraBounds(),
      hasViewportOverlay: () =>
        (this.contextMenu?.isOpen() ?? false) || this.interactMode.isInteracting(),
      setPresentation: (api) => {
        this.presentationApi = api;
      },
      setPalette: (palette, help) => {
        this.commandPalette = palette;
        this.shortcutsHelpDialog = help;
      },
      setMinimap: (minimap) => {
        this.minimap = minimap;
      },
    });
    try {
      this.pluginHost.configurePlugins([
        coreActionsPlugin(coreActions),
        ...(options.plugins ?? []),
      ]);
    } catch (error) {
      this.destroy();
      throw error;
    }

    this.domNodeManager = new DomNodeManager({
      domLayer: this.paintStack,
      onEditRequest: (id) => this.interactions.startEditingElement(id),
      isEditingElement: (id) =>
        this.noteEditor.isEditing && this.noteEditor.editingElementId === id,
      getVersion: (id) => this.store.getVersion(id),
      isInteracting: (id) => this.interactMode.interactingId === id,
      htmlPlaceholders: !options.onHtmlElementMount,
      acceptsPointer,
      containerFill: (element) => {
        const containerId = getBoundTextContainerId(element);
        const container = containerId ? this.store.getById(containerId) : undefined;
        return container?.type === 'shape' && container.fillColor !== 'none'
          ? container.fillColor
          : null;
      },
    });
    this.domNodeManager.setTheme(this.theme);
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
    this.renderLoop.setTheme(this.theme);
    this.disposers.push(this.contextLossGuard.watch(this.canvasEl, () => undefined));
    this.disposers.push(() => this.contextLossGuard.dispose());
    this.disposers.push(
      () => this.renderLoop.stop(),
      this.html.painters.onChange(() => this.html.onRegistryChanged()),
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
      ...bindStoreListeners({
        store: this.store,
        elementRegistry: this.elementRegistry,
        domNodeManager: this.domNodeManager,
        html: this.html,
        renderLoop: this.renderLoop,
        selectionTracker: this.selectionTracker,
        requestRender: () => this.requestRender(),
        stopInteractingIfLive: () => this.stopInteractingIfLive(),
      }),
    );

    this.disposers.push(
      this.layerManager.on('change', () => {
        setElbowVisibleLayers(this.store, (id) => this.layerManager.isLayerVisible(id));
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
      interactMode: this.interactMode,
      recorder: this.historyRecorder,
      toolContext: this.toolContext,
      requestRender: () => this.requestRender(),
      dropHandler: this.dropHandler,
      insertText: (text, anchor, link) => this.inserter.insertText(text, anchor, link),
      insertFiles: (files, anchor, kind) => this.inserter.insertFiles(files, anchor, kind),
      insertWhenIdle: (run) => this.insertQueue.insertWhenIdle(run),
      acceptsPointer,
      isMac,
      activeToolName: () => this.toolManager.activeTool?.name ?? null,
      openLink: (id, e) => this.links.open(id, e),
    });
    // Editing commits while the recorder and store listeners are still attached.
    this.disposers.push(
      () => {
        this.noteEditor.destroy(this.store);
      },
      () => {
        this.activationController.dispose();
        this.html.clearDiagnosticListeners();
        this.resizeListeners.clear();
      },
    );
    this.disposers.push(() => this.links.disposeAnimator());

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

    this.disposers.push(
      bindWrapperEvents({
        wrapper: this.wrapper,
        handlers: this.interactions,
        embedded: Boolean(options.embedded),
      }),
    );
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

  /** Sets the board theme. */
  setTheme(theme: Theme): void {
    if (this.destroyed) return;
    const wasSystem = this.isSystemTheme(this.themeSpec);
    const isSystem = this.isSystemTheme(theme);
    this.themeSpec = theme;
    if (!wasSystem && isSystem) {
      this.systemMedia = this.createSystemMedia(theme);
      this.listenToSystemTheme();
    } else if (wasSystem && !isSystem) {
      this.removeSystemThemeListener();
    }
    this.setResolvedTheme(resolveTheme(theme, this.systemMedia?.matches ?? false));
  }

  /** Returns the active, resolved board theme. */
  getTheme(): ResolvedTheme {
    return this.theme;
  }

  /** Fires after the viewport resolves to a different theme. */
  onThemeChange(listener: (theme: ResolvedTheme) => void): () => void {
    if (this.destroyed) return noop;
    this.themeListeners.add(listener);
    return () => this.themeListeners.delete(listener);
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
   * Export inputs for this viewport. An explicitly passed `htmlPainters` REPLACES the viewport's
   * registry; `expectedCanvasTypes` is always UNIONED with the resolved registry's declarations.
   */
  exportDefaults(): ExportDefaults {
    return {
      store: this.store,
      layerManager: this.layerManager,
      options: <T extends ExportImageOptions | ExportSvgOptions | ExportPdfOptions>(
        options?: T,
      ): T => {
        const base = (options ?? {}) as T;
        const htmlPainters = base.htmlPainters ?? this.html.painters;
        const declared = htmlPainters.canvasTypes;
        const expectedCanvasTypes = base.expectedCanvasTypes
          ? new Set([...declared, ...base.expectedCanvasTypes]) // union only; never shrink
          : declared;
        return {
          ...base,
          htmlPainters,
          expectedCanvasTypes,
          elementRegistry: base.elementRegistry ?? this.elementRegistry,
          renderHooks: base.renderHooks ?? this._renderHooks,
          theme: base.theme ?? { base: this.theme.base, tokens: this.theme.tokens },
        };
      },
    };
  }

  loadState(state: ImportableCanvasState): void {
    loadViewportState(state, {
      elementRegistry: this.elementRegistry,
      store: this.store,
      layerManager: this.layerManager,
      camera: this.camera,
      history: this.history,
      historyRecorder: this.historyRecorder,
      pluginStateManager: this.pluginStateManager,
      noteEditor: this.noteEditor,
      domNodeManager: this.domNodeManager,
      html: this.html,
      flushPendingHistory: () => this.inputHandler.flushPendingHistory(),
      suspendNotifications: () => this.suspendNotifications(),
      onHtmlElementMount: this.onHtmlElementMount,
    });
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

  /** Presentation controls for this viewport. */
  get presentation(): PresentationApi {
    return this.presentationApi ?? INERT_PRESENTATION;
  }

  /** Command palette controls for this viewport. */
  get palette(): PaletteApi {
    return this.commandPalette ?? INERT_PALETTE;
  }

  /** Shortcuts help controls for this viewport. */
  get shortcutsHelp(): ShortcutsHelpApi {
    return this.shortcutsHelpDialog ?? INERT_SHORTCUTS_HELP;
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
    const closure = getHierarchyClosure([...ids], this.store);
    if (closure.elements.length === 0) return 0;
    this.transaction(() => {
      for (const element of [...closure.elements].reverse()) this.store.remove(element.id);
    });
    this.requestRender();
    return closure.elements.length;
  }

  /** Sets an element's direct parent, or clears its parent when passed null. */
  setParent(childId: string, parentId: string | null): void {
    this.frameOps.setParent(childId, parentId);
  }

  /** Creates a frame around selected root subtrees and returns its id. */
  frameSelection(
    ids: readonly string[],
    options?: { readonly title?: string; readonly color?: string; readonly padding?: number },
  ): string {
    return this.frameOps.frameSelection(ids, options);
  }

  /** Adds selected root subtrees as children of an existing frame. */
  addToFrame(frameId: string, ids: readonly string[]): void {
    this.frameOps.addToFrame(frameId, ids);
  }

  /** Removes selected direct children from an existing frame. */
  removeFromFrame(frameId: string, ids: readonly string[]): void {
    this.frameOps.removeFromFrame(frameId, ids);
  }

  /** Removes a frame while preserving its direct children as roots. */
  dissolveFrame(frameId: string): void {
    this.frameOps.dissolveFrame(frameId);
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

  getBoundText(containerId: string) {
    const container = this.store.getById(containerId);
    return container ? getBoundText(container, this.store) : undefined;
  }

  setBoundText(containerId: string, html: string): string | undefined {
    const container = this.store.getById(containerId);
    if (!container || !isBoundTextContainer(container, this.elementRegistry)) return undefined;
    if (container.locked || this.layerManager.isLayerLocked(container.layerId)) return undefined;
    const existing = getBoundText(container, this.store);
    this.transaction(() => {
      if (container.type === 'arrow' && container.label) {
        this.store.update(container.id, { label: undefined });
      }
      if (isNoteContentEmpty(html)) {
        if (existing) this.store.remove(existing.id);
        return;
      }
      if (existing) {
        this.store.update(existing.id, { text: html });
      } else {
        const text = createBoundText(container, { text: html }, this.elementRegistry);
        this.store.add(text);
      }
    });
    this.requestRender();
    return getBoundText(container, this.store)?.id;
  }

  editBoundText(containerId: string): boolean {
    return this.interactions.editBoundText(containerId);
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
    this.html.registerRenderer(htmlType, factory);
  }

  updateHtmlElement(id: string, newContent: HTMLElement): void {
    this.html.updateContent(id, newContent);
  }

  /**
   * Declares htmlTypes that route to canvas painters even before a painter for
   * them registers, so the element renderer never treats them as DOM-backed
   * (avoiding a DOM-mount flash while a host is still loading its painter).
   * Returns an idempotent release; each `expect` call is independently reference
   * counted by the registry.
   */
  expectCanvasHtmlTypes(htmlTypes: Iterable<string>): () => void {
    return this.html.painters.expect(htmlTypes);
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
    return this.html.painters;
  }

  /**
   * Registers the canvas painter for `htmlType`. Later registrations for the
   * same type shadow earlier ones (LIFO); unregistering restores the previous
   * entry. Existing elements of this type reconcile synchronously — DOM nodes
   * detach and the render loop repaints on the next frame.
   */
  registerHtmlPainter(htmlType: string, painter: HtmlPainter): () => void {
    return this.html.painters.register(htmlType, painter);
  }

  /**
   * Subscribes to diagnostics emitted while painting canvas-routed html
   * elements (missing painter, painter threw, degenerate size). Deduped per
   * element/target/kind against the current registry and element versions, so
   * a fail -> repair -> fail-again sequence reports twice rather than being
   * suppressed forever. Returns an idempotent unsubscribe.
   */
  onHtmlPaintDiagnostic(listener: (d: HtmlPaintDiagnostic) => void): () => void {
    return this.html.onDiagnostic(listener);
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
    return this.activationController.set(options);
  }

  /**
   * Subscribes to element activations. Persistent and independent of
   * `setActivation`: subscribing before activation is enabled, or across a
   * replacement, keeps working. Emission iterates a snapshot with per-listener
   * try/catch. Returns an idempotent unsubscribe.
   */
  onElementActivate(listener: (e: ElementActivationEvent) => void): () => void {
    return this.activationController.onActivate(listener);
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

  /**
   * getSelectedIds() and the onSelectionChange emitter never surface stale ids:
   * once the enclosing history transaction completes, both reflect
   * the current selection.
   */
  getSelectedIds(): string[] {
    return this.getSelectTool()?.selectedIds ?? EMPTY_IDS;
  }

  /** Returns whether the action ran. */
  runAction(action: string): boolean {
    return this.actionRegistry.run(action, { source: 'api' });
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
    return this.selectionTracker.onChange(listener);
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

  /** Clears authored elbow route axes and returns whether an arrow changed. */
  resetArrowRoute(id: string): boolean {
    const arrow = this.store.getById(id);
    if (arrow?.type !== 'arrow' || !arrow.fixedSegments?.length) return false;
    this.transaction(() => this.store.update(id, { fixedSegments: undefined }));
    this.requestRender();
    return true;
  }

  /** Sets or clears (null) the link on every id as one undo step; throws before mutating. */
  setLink(ids: readonly string[], link: string | null): void {
    const normalized = link === null ? null : normalizeLink(link);
    if (link !== null && normalized === null) throw new RangeError('link is not allowed');
    for (const id of ids) {
      const el = this.store.getById(id);
      if (!el) throw new Error(`Element not found: ${id}`);
      if (el.locked || this.layerManager.isLayerLocked(el.layerId)) {
        throw new Error(`Element ${id} is locked`);
      }
    }
    this.transaction(() => {
      for (const id of ids) this.store.update(id, { link: normalized ?? undefined });
    });
    this.requestRender();
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
    if (this.destroyed) return;
    this.destroyed = true;
    for (const dispose of this.disposers.splice(0).reverse()) dispose();
  }

  private createSystemMedia(theme: Theme): MediaQueryList | null {
    if (!this.isSystemTheme(theme) || typeof matchMedia !== 'function') return null;
    return matchMedia('(prefers-color-scheme: dark)');
  }

  private listenToSystemTheme(): void {
    const media = this.systemMedia;
    if (media === null) return;
    const listener = (event: MediaQueryListEvent) => {
      if (this.destroyed) return;
      this.setResolvedTheme(resolveTheme(this.themeSpec, event.matches));
    };
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', listener);
      this.systemThemeDispose = () => media.removeEventListener('change', listener);
    } else {
      media.addListener(listener);
      this.systemThemeDispose = () => media.removeListener(listener);
    }
  }

  private removeSystemThemeListener(): void {
    this.systemThemeDispose?.();
    this.systemMedia = null;
    this.systemThemeDispose = null;
  }

  private isSystemTheme(theme: Theme): boolean {
    return (
      theme === 'system' || (theme !== null && typeof theme === 'object' && theme.base === 'system')
    );
  }

  private setResolvedTheme(theme: ResolvedTheme): void {
    if (this.themesEqual(this.theme, theme)) return;
    this.theme = theme;
    this.wrapper.dataset.fieldnotesTheme = theme.base;
    this.background.setTheme(theme);
    this.renderer.setTheme(theme);
    this.toolContext.theme = theme;
    this.renderLoop.setTheme(theme);
    this.domNodeManager.setTheme(theme);
    this.noteEditor.setTheme(theme);
    this.renderLoop.markAllLayersDirty();
    this.requestRender();
    for (const listener of [...this.themeListeners]) {
      try {
        listener(theme);
      } catch {
        // One theme listener must not prevent the others from observing a change.
      }
      if (this.theme !== theme) break;
    }
  }

  private themesEqual(a: ResolvedTheme, b: ResolvedTheme): boolean {
    const bTokens = Object.values(b.tokens);
    return (
      a.base === b.base && Object.values(a.tokens).every((token, index) => token === bTokens[index])
    );
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
