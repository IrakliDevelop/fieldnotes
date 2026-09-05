import { Camera } from './camera';
import type { CameraOptions } from './camera';
import { InputHandler } from './input-handler';
import type { ShortcutOptions, ShortcutsApi } from './shortcut-map';
import { Background } from './background';
import type { BackgroundOptions } from './background';
import { ElementStore } from '../elements/element-store';
import { ElementRenderer } from '../elements/element-renderer';
import { NoteEditor } from '../elements/note-editor';
import type { FontSizePreset } from '../elements/note-toolbar';
import type {
  CanvasElement,
  ArrowElement,
  GridElement,
  HtmlElement,
  ShapeKind,
} from '../elements/types';
import type { Point, Bounds } from '../core/types';
import { ContextMenu } from './context-menu';
import type { ContextMenuItem } from './context-menu';
import { Minimap } from './minimap';
import { createWrapper, createCanvas, createDomLayer, createPaintStack } from './viewport-dom';
import { HybridRenderSurface } from './hybrid-render-surface';
import { findBoundArrows, getEdgeIntersection } from '../elements/arrow-binding';
import { getElementBounds } from '../elements/element-bounds';
import { getElementsBoundingBox } from '../elements/bounds';
import { getArrowTangentAngle } from '../elements/arrow-geometry';
import { ArrowLabelEditor } from '../elements/arrow-label-editor';
import { ToolManager } from '../tools/tool-manager';
import type { ToolContext, Tool } from '../tools/types';
import type { SelectTool } from '../tools/select-tool';
import { hitTest } from '../tools/select-hit';
import { HistoryStack } from '../history/history-stack';
import { HistoryRecorder } from '../history/history-recorder';
import { createImage, createHtmlElement, createShape } from '../elements/element-factory';
import { exportState as exportCanvasState, parseState } from '../core/state-serializer';
import { exportImage } from './export-image';
import type { ExportImageOptions } from './export-image';
import { exportSvg } from './export-svg';
import type { ExportSvgOptions } from './export-svg';
import type { CanvasState } from '../core/state-serializer';
import { LayerManager } from '../layers/layer-manager';
import { InteractMode } from './interact-mode';
import { DomNodeManager } from './dom-node-manager';
import { RenderLoop } from './render-loop';
import type { OverlayRenderer } from './render-loop';
import { HtmlPainterRegistry, resolveHtmlRouting } from './html-painter-registry';
import type { HtmlPainter, HtmlRouting } from './html-painter-registry';
import { HtmlPaintDiagnosticDeduper } from './html-paint-diagnostics';
import type { HtmlPaintDiagnostic } from './html-paint-diagnostics';
import type { RenderStatsSnapshot } from './render-stats';
import { LayerCache } from './layer-cache';
import { MarginViewport } from './margin-viewport';
import type { ElementStyle } from '../elements/element-style';
import { SelectionOps } from './selection-ops';
import type { SelectionStyleDetails } from './selection-ops';
import type { AlignEdge, DistributeAxis } from './selection-ops';
import { GridController } from './grid-controller';
import type { GridInfo } from './grid-controller';
import { ViewportInteractions } from './viewport-interactions';
import type { RotateDirection } from './selection-rotate';
import { ElementActivation } from './element-activation';
import type { ActivationOptions, ElementActivationEvent } from './element-activation';
import { FogManager } from '../fog/fog-manager';
import { FogRenderer } from '../fog/fog-renderer';
import type { FogRendererOptions } from '../fog/fog-renderer';
import { validateFogState } from '../fog/tile-codec';

export type { AlignEdge, DistributeAxis } from './selection-ops';
export type { GridInfo } from './grid-controller';
export type { RotateDirection } from './selection-rotate';

const EMPTY_IDS: string[] = [];

function noop(): void {
  // Stable unsubscribe handle returned when no select tool is registered.
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
  /** Fog-of-war presentation options. Enables fog rendering and the `fog` accessor. */
  fog?: FogRendererOptions;
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
  readonly domLayer: HTMLDivElement;
  private readonly canvasEl: HTMLCanvasElement;
  private readonly paintStack: HTMLDivElement;
  private readonly wrapper: HTMLDivElement;
  private readonly unsubCamera: () => void;
  private readonly unsubToolChange: () => void;
  private readonly unsubStore: (() => void)[];
  private readonly inputHandler: InputHandler;
  private readonly background: Background;
  private readonly renderer: ElementRenderer;
  private readonly noteEditor: NoteEditor;
  private readonly arrowLabelEditor: ArrowLabelEditor;
  private readonly historyRecorder: HistoryRecorder;
  private transactionDepth = 0;
  private readonly selectionOps: SelectionOps;
  readonly toolContext: ToolContext;
  private readonly marginViewport: MarginViewport;
  private resizeObserver: ResizeObserver | null = null;
  private _snapToGrid = false;
  private _smartGuides = false;
  private readonly _gridSize: number;
  private readonly renderLoop: RenderLoop;
  private readonly fogManager: FogManager;
  private readonly fogRenderer: FogRenderer;
  private readonly domNodeManager: DomNodeManager;
  private readonly interactMode: InteractMode;
  private readonly onHtmlElementMount?: (
    elementId: string,
    domId: string | undefined,
    container: HTMLDivElement,
  ) => void;
  private readonly dropHandler?: (
    event: DragEvent,
    worldPosition: { x: number; y: number },
  ) => void;
  private readonly gridController: GridController;
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
  private readonly unsubHtmlPainters: () => void;
  private activation: ElementActivation | null = null;
  private activationGeneration = 0;
  private readonly activationListeners = new Set<(e: ElementActivationEvent) => void>();
  private readonly resizeListeners = new Set<() => void>();
  private readonly selectionListeners = new Set<() => void>();
  private detachSelectionSource: (() => void) | null = null;
  private unsubToolRegister: () => void = () => {
    // Replaced synchronously in the constructor below.
  };
  private pendingSelectionPrune = false;
  private unsubRecorderEnd: () => void = () => {
    // Replaced synchronously in the constructor below.
  };

  constructor(
    private readonly container: HTMLElement,
    options: ViewportOptions = {},
  ) {
    this.camera = new Camera(options.camera);
    this.background = new Background(options.background);
    this._gridSize = options.background?.spacing ?? 24;
    this.store = new ElementStore();
    this.layerManager = new LayerManager(this.store);
    this.toolManager = new ToolManager();
    this.unsubToolRegister = this.toolManager.onRegister((tool) => {
      if (Viewport.isSelectionSource(tool)) this.attachSelectionSource(tool);
    });
    const existingSelect = this.getSelectTool();
    if (existingSelect && Viewport.isSelectionSource(existingSelect)) {
      this.attachSelectionSource(existingSelect);
    }
    this.renderer = new ElementRenderer();
    this.renderer.setStore(this.store);
    this.renderer.setCamera(this.camera);
    this.renderer.setOnImageLoad(() => {
      this.renderLoop.markAllLayersDirty();
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
    this.arrowLabelEditor = new ArrowLabelEditor();
    this.noteEditor.setHistoryHooks(
      () => this.historyRecorder.begin(),
      () => this.historyRecorder.commit(),
    );
    this.onHtmlElementMount = options.onHtmlElementMount;
    this.dropHandler = options.onDrop;
    this.history = new HistoryStack();
    this.historyRecorder = new HistoryRecorder(this.store, this.history, this.layerManager);
    this.unsubRecorderEnd = this.historyRecorder.onTransactionEnd(() => {
      if (!this.pendingSelectionPrune) return;
      this.pendingSelectionPrune = false;
      this.pruneSelection();
    });
    this.selectionOps = new SelectionOps({
      store: this.store,
      recorder: this.historyRecorder,
      getSelectedIds: () => this.getSelectedIds(),
      requestRender: () => this.requestRender(),
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

    this.toolContext = {
      camera: this.camera,
      store: this.store,
      requestRender: () => this.requestRender(),
      switchTool: (name: string) => this.toolManager.setTool(name, this.toolContext),
      editElement: (id: string) => this.interactions.startEditingElement(id),
      fitNoteHeight: (id: string) => this.interactions.fitNoteHeight(id),
      setCursor: (cursor: string) => {
        this.wrapper.style.cursor = cursor;
      },
      snapToGrid: false,
      gridSize: this._gridSize,
      activeLayerId: this.layerManager.activeLayerId,
      isLayerVisible: (id: string) => this.layerManager.isLayerVisible(id),
      isLayerLocked: (id: string) => this.layerManager.isLayerLocked(id),
      smartGuides: false,
      getVisibleRect: () =>
        this.camera.getVisibleRect(this.canvasEl.clientWidth, this.canvasEl.clientHeight),
    };

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
    });

    if (options.contextMenu !== false) {
      this.contextMenu = new ContextMenu({
        onCommand: (action) => this.runAction(action),
        onClose: noop,
      });
    }
    this.unsubToolChange = this.toolManager.onChange(() => this.contextMenu?.close());

    this.fogManager = new FogManager({
      onCommand: (cmd) => this.history.push(cmd),
    });
    this.fogRenderer = new FogRenderer(options.fog);

    if (options.minimap) {
      this.minimap = new Minimap(this.wrapper, this);
      this.minimap.setFogRenderer(this.fogRenderer);
    }

    this.domNodeManager = new DomNodeManager({
      domLayer: this.paintStack,
      onEditRequest: (id) => this.interactions.startEditingElement(id),
      isEditingElement: (id) =>
        this.noteEditor.isEditing && this.noteEditor.editingElementId === id,
      getVersion: (id) => this.store.getVersion(id),
    });
    this.domNodeManager.setCameraTransform(this.camera.toCSSTransform());

    this.interactMode = new InteractMode({
      getNode: (id) => this.domNodeManager.getNode(id),
    });

    this.marginViewport = new MarginViewport(options.panBufferMargin ?? 256);
    this.marginViewport.setViewport(
      this.canvasEl.clientWidth || 800,
      this.canvasEl.clientHeight || 600,
      typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1,
    );
    const layerCache = new LayerCache(this.marginViewport);

    this.renderLoop = new RenderLoop({
      canvasEl: this.canvasEl,
      camera: this.camera,
      background: this.background,
      store: this.store,
      renderer: this.renderer,
      toolManager: this.toolManager,
      layerManager: this.layerManager,
      domNodeManager: this.domNodeManager,
      layerCache,
      marginViewport: this.marginViewport,
      hybridSurface: new HybridRenderSurface(this.paintStack),
      fogRenderer: this.fogRenderer,
    });

    this.fogManager.on('change', () => {
      this.fogRenderer.setState(this.fogManager.getState());
      this.renderLoop.requestRender();
      this.minimap?.invalidateScene();
    });
    this.fogManager.on('view', () => {
      this.fogRenderer.setViewMode(this.fogManager.getViewMode());
      this.renderLoop.requestRender();
      this.minimap?.invalidateScene();
    });

    this.unsubHtmlPainters = this.htmlPainters.onChange(() => this.onHtmlRegistryChanged());

    this.unsubCamera = this.camera.onChange(() => {
      this.applyCameraTransform();
      this.noteEditor.updateToolbarPosition();
      this.contextMenu?.close();
      this.requestRender();
    });

    this.gridController = new GridController({
      store: this.store,
      recorder: this.historyRecorder,
      requestRender: () => this.requestRender(),
      getActiveLayerId: () => this.layerManager.activeLayerId,
      toolContext: this.toolContext,
      defaultGridSize: this._gridSize,
    });

    this.unsubStore = [
      this.store.on('add', (el) => {
        if (el.type === 'grid') this.gridController.syncContext();
        if (el.type === 'html') {
          this.domNodeManager.reconcileHtmlRouting(this.store, this.resolveRouting);
        }
        this.renderLoop.markLayerDirty(el.layerId);
        this.requestRender();
      }),
      this.store.on('remove', (el) => {
        if (el.type === 'grid') this.gridController.syncContext();
        this.unbindArrowsFrom(el);
        this.domNodeManager.removeDomNode(el.id);
        this.htmlDiagnostics.forget(el.id);
        this.renderLoop.markLayerDirty(el.layerId);
        this.requestRender();
        this.handleRemovedElement(el.id);
      }),
      this.store.on('update', ({ previous, current }) => {
        if (current.type === 'grid') this.gridController.syncContext();
        if (current.type === 'html') {
          this.domNodeManager.reconcileHtmlRouting(this.store, this.resolveRouting);
        }
        this.renderLoop.markLayerDirty(current.layerId);
        if (previous.layerId !== current.layerId) {
          this.renderLoop.markLayerDirty(previous.layerId);
        }
        this.requestRender();
      }),
      this.store.on('clear', () => {
        this.domNodeManager.clearDomNodes();
        this.htmlDiagnostics.reset();
        this.renderLoop.markAllLayersDirty();
        this.gridController.syncContext();
        this.requestRender();
        this.pruneSelection();
      }),
    ];

    this.layerManager.on('change', () => {
      this.toolContext.activeLayerId = this.layerManager.activeLayerId;
      this.renderLoop.markAllLayersDirty();
      this.requestRender();
    });

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
      requestRender: () => this.requestRender(),
      addImage: (src, position) => this.addImage(src, position),
      dropHandler: this.dropHandler,
    });

    this.wrapper.addEventListener('pointerdown', this.interactions.onTapDown);
    this.wrapper.addEventListener('pointerup', this.interactions.onDoubleTap);
    this.wrapper.addEventListener('dragover', this.interactions.onDragOver);
    this.wrapper.addEventListener('drop', this.interactions.onDrop);
    this.observeResize();
    this.syncCanvasSize();
    this.renderLoop.start();
    this.gridController.syncContext();
  }

  get ctx(): CanvasRenderingContext2D | null {
    return this.canvasEl.getContext('2d');
  }

  get fog(): FogManager {
    return this.fogManager;
  }

  setFogStyle(options: FogRendererOptions): void {
    this.fogRenderer.setOptions(options);
    this.renderLoop.requestRender();
    this.minimap?.invalidateScene();
  }

  get snapToGrid(): boolean {
    return this._snapToGrid;
  }

  setSnapToGrid(enabled: boolean): void {
    this._snapToGrid = enabled;
    this.toolContext.snapToGrid = enabled;
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
    const bbox = getElementsBoundingBox(visibleElements);
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
   * Registers a world-space overlay drawn above elements on every frame,
   * regardless of the active tool — the surface for remote presence visuals
   * such as laser trails, cursors, pings, and shared rulers. Overlays draw
   * beneath the active tool's own `renderOverlay` and never touch elements,
   * history, or persisted state. Returns an idempotent unsubscribe that also
   * erases the overlay's last frame.
   */
  registerOverlay(draw: OverlayRenderer): () => void {
    return this.renderLoop.registerOverlay(draw);
  }

  exportState(): CanvasState {
    return exportCanvasState(
      this.store.snapshot(),
      this.camera,
      this.layerManager.snapshot(),
      this.layerManager.activeLayerId,
      this.fogManager.getState(),
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

  /**
   * Carry constructor-configured fog presentation into both implicit exports and
   * explicit state/mode exports. Explicit style and legacy color overrides win.
   */
  private withFogDefaults<T extends ExportImageOptions | ExportSvgOptions>(options: T): T {
    const fog = options.fog;
    if (fog === false) return options;

    if (fog !== undefined) {
      if (fog.style !== undefined || fog.color !== undefined) return options;
      return {
        ...options,
        fog: { ...fog, style: this.fogRenderer.getResolvedStyle(fog.mode) },
      } as T;
    }

    if (!this.fogRenderer.isVisible()) return options;
    const state = this.fogManager.getState();
    if (!state) return options;
    const mode = this.fogRenderer.getViewMode() as 'editor' | 'player';
    return {
      ...options,
      fog: { state, mode, style: this.fogRenderer.getResolvedStyle(mode) },
    } as T;
  }

  async exportImage(options?: ExportImageOptions): Promise<Blob | null> {
    const opts = this.withFogDefaults(this.withHtmlDefaults(options));
    return exportImage(this.store, opts, this.layerManager);
  }

  async exportSVG(options?: ExportSvgOptions): Promise<string> {
    const opts = this.withFogDefaults(this.withHtmlDefaults(options));
    return exportSvg(this.store, opts, this.layerManager);
  }

  loadState(state: CanvasState): void {
    if (state.fog != null) {
      validateFogState(state.fog);
    }
    this.inputHandler.flushPendingHistory();
    this.historyRecorder.pause();
    this.noteEditor.destroy(this.store);
    this.domNodeManager.clearDomNodes();
    this.store.loadSnapshot(state.elements);
    if (state.layers && state.layers.length > 0) {
      this.layerManager.loadSnapshot(state.layers);
    }
    if (state.activeLayerId) {
      this.layerManager.setActiveLayer(state.activeLayerId);
    }
    this.domNodeManager.reattachHtmlContent(this.store);
    for (const el of this.store.getElementsByType('html')) {
      if (this.domNodeManager.hasContent(el.id)) continue;

      // Registry first: rebuild the embed from serialized data and mount it via the html branch
      // of renderDomContent. This stores content BEFORE the onHtmlElementMount path's hasContent
      // check, so a factory-rebuilt element never also gets an empty node from the callback path.
      const factory = el.htmlType ? this.htmlRenderers.get(el.htmlType) : undefined;
      const rebuilt = factory ? factory(el) : null;
      if (rebuilt) {
        this.domNodeManager.storeHtmlContent(el.id, rebuilt);
        this.domNodeManager.syncDomNode(el);
      }

      // Callback still fires for wiring (both fire; registry produces the node, callback wires it).
      if (this.onHtmlElementMount) {
        if (!rebuilt) this.domNodeManager.syncDomNode(el);
        const node = this.domNodeManager.getNode(el.id);
        if (node) {
          this.onHtmlElementMount(el.id, el.domId, node);
          // The host mounted its content INTO the node; nothing else records it. Without
          // this marker a routing change to canvas would detach the node and destroy the
          // host's content, and the return leg would mount a fresh, permanently empty one.
          this.domNodeManager.markHostOwnedContent(el.id);
          node.dataset['initialized'] = 'true';
          Object.assign(node.style, {
            overflow: 'hidden',
            pointerEvents: el.interactive ? 'auto' : 'none',
          });
        }
      }
    }
    this.fogManager.loadState(state.fog ?? null);
    this.history.clear();
    this.historyRecorder.resume();
    this.camera.moveTo(state.camera.position.x, state.camera.position.y);
    this.camera.setZoom(state.camera.zoom);
    this.domNodeManager.reconcileHtmlRouting(this.store, this.resolveRouting);
  }

  loadJSON(json: string): void {
    this.loadState(parseState(json));
  }

  setTool(name: string): void {
    if (!this.toolManager.getTool(name)) {
      console.warn(`[fieldnotes] setTool: no tool registered as "${name}"`);
      return;
    }
    this.toolManager.setTool(name, this.toolContext);
  }

  get shortcuts(): ShortcutsApi {
    return this.inputHandler.shortcuts;
  }

  /**
   * Groups synchronous local store and layer mutations into one undo step.
   * Nested calls join the outer transaction. If the callback throws, mutations
   * already applied remain undoable and the original error is rethrown.
   */
  transaction<T>(operation: () => T): T {
    const isOuterTransaction = this.transactionDepth === 0;
    if (isOuterTransaction) {
      this.inputHandler.flushPendingHistory();
      this.historyRecorder.begin();
    }
    this.transactionDepth += 1;
    try {
      return operation();
    } finally {
      this.transactionDepth -= 1;
      if (isOuterTransaction) this.historyRecorder.commit();
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
    this.historyRecorder.begin();
    this.store.add(image);
    this.historyRecorder.commit();
    this.requestRender();
    return image.id;
  }

  addHtmlElement(
    dom: HTMLElement,
    position: { x: number; y: number },
    size = { w: 200, h: 150 },
    opts?: { htmlType?: string; data?: Record<string, unknown> },
  ): string {
    const domId = dom.id || undefined;
    const el = createHtmlElement({
      position,
      size,
      domId,
      htmlType: opts?.htmlType,
      data: opts?.data,
      layerId: this.layerManager.activeLayerId,
    });
    this.domNodeManager.storeHtmlContent(el.id, dom);
    this.historyRecorder.begin();
    this.store.add(el);
    this.historyRecorder.commit();
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
    this.historyRecorder.begin();
    this.store.add(shape);
    this.historyRecorder.commit();
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
    this.historyRecorder.begin();
    this.layerManager.removeLayer(id);
    this.historyRecorder.commit();
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

  addGrid(input: {
    gridType?: 'square' | 'hex';
    hexOrientation?: 'pointy' | 'flat';
    cellSize?: number;
    strokeColor?: string;
    strokeWidth?: number;
    opacity?: number;
  }): string {
    return this.gridController.add(input);
  }

  updateGrid(
    updates: Partial<
      Pick<
        GridElement,
        'gridType' | 'hexOrientation' | 'cellSize' | 'strokeColor' | 'strokeWidth' | 'opacity'
      >
    >,
  ): void {
    this.gridController.update(updates);
  }

  removeGrid(): void {
    this.gridController.remove();
  }

  getGridInfo(): GridInfo | null {
    return this.gridController.getInfo();
  }

  onGridChange(listener: (info: GridInfo | null) => void): () => void {
    return this.gridController.onChange(listener);
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
    this.inputHandler.runAction(action);
  }

  canPaste(): boolean {
    return this.inputHandler.hasClipboard();
  }

  openContextMenu(screenPos: Point): void {
    if (!this.contextMenu) return;
    const ids = this.getSelectedIds();
    const items: ContextMenuItem[] = [];
    if (ids.length > 0) {
      items.push({ label: 'Cut', action: 'cut' });
      items.push({ label: 'Copy', action: 'copy' });
      if (this.canPaste()) items.push({ label: 'Paste', action: 'paste' });
      items.push({ label: 'Duplicate', action: 'duplicate' });
      items.push({ label: 'Delete', action: 'delete' });
      items.push({ label: 'Bring to Front', action: 'z-front' });
      items.push({ label: 'Bring Forward', action: 'z-forward' });
      items.push({ label: 'Send Backward', action: 'z-backward' });
      items.push({ label: 'Send to Back', action: 'z-back' });
      items.push({ label: 'Rotate 90° CW', action: 'rotate-cw' });
      items.push({ label: 'Rotate 90° CCW', action: 'rotate-ccw' });
      const allLocked = ids.every((id) => this.store.getById(id)?.locked);
      items.push({ label: allLocked ? 'Unlock' : 'Lock', action: 'toggle-lock' });
    } else if (this.canPaste()) {
      items.push({ label: 'Paste', action: 'paste' });
    }
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
    this.selectionOps.applyStyle(style);
  }

  groupSelection(): void {
    this.selectionOps.group();
  }

  ungroupSelection(): void {
    this.selectionOps.ungroup();
  }

  toggleLockSelection(): void {
    this.selectionOps.toggleLock();
  }

  alignSelection(edge: AlignEdge): void {
    this.selectionOps.align(edge);
  }

  distributeSelection(axis: DistributeAxis): void {
    this.selectionOps.distribute(axis);
  }

  rotateSelection(direction: RotateDirection): void {
    this.selectionOps.rotateSelection(direction);
  }

  getRenderStats(): RenderStatsSnapshot {
    return this.renderLoop.getStats();
  }

  logPerformance(intervalMs = 2000): () => void {
    const id = setInterval(() => {
      const s = this.getRenderStats();
      console.log(
        `[FieldNotes] fps=${s.fps} frame=${s.avgFrameMs}ms p95=${s.p95FrameMs}ms grid=${s.lastGridMs}ms layers=${s.layersMs}ms comp=${s.compositeMs}ms bg=${s.backgroundMs}ms overlay=${s.overlayMs}ms`,
      );
    }, intervalMs);
    return () => clearInterval(id);
  }

  destroy(): void {
    this.renderLoop.stop();
    this.interactMode.destroy();
    this.noteEditor.destroy(this.store);
    this.arrowLabelEditor.cancel();
    this.historyRecorder.destroy();
    this.contextMenu?.dispose();
    this.minimap?.destroy();
    this.wrapper.removeEventListener('pointerdown', this.interactions.onTapDown);
    this.wrapper.removeEventListener('pointerup', this.interactions.onDoubleTap);
    this.wrapper.removeEventListener('dragover', this.interactions.onDragOver);
    this.wrapper.removeEventListener('drop', this.interactions.onDrop);
    this.inputHandler.destroy();
    this.unsubCamera();
    this.unsubToolChange();
    this.unsubToolRegister();
    this.unsubRecorderEnd();
    this.unsubHtmlPainters();
    this.fogManager.dispose();
    this.fogRenderer.dispose();
    this.activation?.dispose();
    this.activation = null;
    this.activationListeners.clear();
    this.htmlDiagnosticListeners.clear();
    this.detachSelectionSource?.();
    this.detachSelectionSource = null;
    this.selectionListeners.clear();
    this.unsubStore.forEach((fn) => fn());
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.resizeListeners.clear();
    this.wrapper.remove();
  }

  stopInteracting(): void {
    this.interactMode.stopInteracting();
  }

  private unbindArrowsFrom(removedElement: CanvasElement): void {
    const boundArrows = findBoundArrows(removedElement.id, this.store);
    const bounds = getElementBounds(removedElement);

    for (const arrow of boundArrows) {
      const updates: Partial<ArrowElement> = {};

      if (arrow.fromBinding?.elementId === removedElement.id) {
        updates.fromBinding = undefined;
        if (bounds) {
          const angle = getArrowTangentAngle(arrow.from, arrow.to, arrow.bend, 0);
          const rayTarget = {
            x: arrow.from.x + Math.cos(angle) * 1000,
            y: arrow.from.y + Math.sin(angle) * 1000,
          };
          const edge = getEdgeIntersection(bounds, rayTarget);
          updates.from = edge;
          updates.position = edge;
        }
      }

      if (arrow.toBinding?.elementId === removedElement.id) {
        updates.toBinding = undefined;
        if (bounds) {
          const angle = getArrowTangentAngle(arrow.from, arrow.to, arrow.bend, 1);
          const rayTarget = {
            x: arrow.to.x - Math.cos(angle) * 1000,
            y: arrow.to.y - Math.sin(angle) * 1000,
          };
          updates.to = getEdgeIntersection(bounds, rayTarget);
        }
      }

      if (Object.keys(updates).length > 0) {
        this.store.update(arrow.id, updates);
      }
    }
  }

  private applyCameraTransform(): void {
    const transform = this.camera.toCSSTransform();
    this.domLayer.style.transform = transform;
    this.domNodeManager.setCameraTransform(transform);
  }

  private syncCanvasSize(): void {
    const rect = this.container.getBoundingClientRect();
    const dpr = typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1;
    this.renderLoop.setCanvasSize(rect.width * dpr, rect.height * dpr);
    this.requestRender();
    this.resizeListeners.forEach((fn) => fn());
  }

  private observeResize(): void {
    if (typeof ResizeObserver === 'undefined') return;
    this.resizeObserver = new ResizeObserver(() => this.syncCanvasSize());
    this.resizeObserver.observe(this.container);
  }
}
