import { Camera } from './camera';
import type { CameraOptions } from './camera';
import { InputHandler } from './input-handler';
import type { ShortcutOptions, ShortcutsApi } from './shortcut-map';
import { Background } from './background';
import type { BackgroundOptions } from './background';
import { ElementStore } from '../elements/element-store';
import type { ElementChangeMeta } from '../elements/element-store';
import { ElementRenderer } from '../elements/element-renderer';
import { NoteEditor } from '../elements/note-editor';
import type { FontSizePreset } from '../elements/note-toolbar';
import type { CanvasElement, ArrowElement, HtmlElement, ShapeKind } from '../elements/types';
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
import { DomNodeManager } from './dom-node-manager';
import { RenderLoop } from './render-loop';
import type { OverlayRenderer } from './render-loop';
import { HtmlPainterRegistry, resolveHtmlRouting } from './html-painter-registry';
import type { HtmlPainter, HtmlRouting } from './html-painter-registry';
import { HtmlPaintDiagnosticDeduper } from '../canvas/html-paint-diagnostics';
import type { HtmlPaintDiagnostic } from '../canvas/html-paint-diagnostics';
import type { ElementRegistry } from '../elements/element-registry';
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
import type {
  NotificationController,
  PersistedPluginState,
  PluginHandle,
} from '../core/plugin-state-manager';
import type {
  PluginConfigureContext,
  PluginStartContext,
  RequiredCapabilities,
  ViewportPlugin,
} from './viewport-plugin';
import type { ServiceKey } from '../core/service-key';
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
  /** Element type registry for extension support. Domain types require explicit registration. */
  elementRegistry?: ElementRegistry;
  /** Domain plugins to install. Each plugin self-wires via the host API. */
  plugins?: ViewportPlugin[];
  /** Render capabilities that must remain installed after optional-plugin rollback. */
  requiredCapabilities?: RequiredCapabilities;
}

interface ConfiguredPlugin {
  readonly plugin: ViewportPlugin;
  readonly configureDisposers: (() => void)[];
  startDisposers: (() => void)[];
  handle?: PluginHandle;
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
  private readonly unsubCamera: () => void;
  private readonly unsubLayers: () => void;
  private readonly unsubToolChange: () => void;
  private readonly unsubStore: (() => void)[];
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
  private resizeObserver: ResizeObserver | null = null;
  private _snapToGrid = false;
  private _smartGuides = false;
  private readonly _gridSize: number;
  private readonly renderLoop: RenderLoop;
  private readonly _renderHooks: RenderHooks;
  private readonly pluginStateManager: PluginStateManager;
  private readonly installedPlugins: ConfiguredPlugin[] = [];
  private readonly services = new Map<symbol, unknown>();
  private readonly extraBoundsProviders = new Set<() => Bounds | null>();
  private readonly pluginChangeListeners = new Set<() => void>();
  private pluginNotificationDepth = 0;
  private pluginChangePending = false;
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
    this.elementRegistry = options.elementRegistry ?? getDefaultElementRegistry();
    this.store = new ElementStore(this.elementRegistry);
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
    this.renderer.setElementRegistry(this.elementRegistry);
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
      constraintService: this.constraintProxy,
      elementRegistry: this.elementRegistry,
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

    this._renderHooks = createRenderHooks();
    this.pluginStateManager = new PluginStateManager(() => this.suspendNotifications());
    try {
      this.configurePlugins(options.plugins);
    } catch (error) {
      this.inputHandler.destroy();
      this.contextMenu?.dispose();
      this.historyRecorder.destroy();
      this.noteEditor.destroy(this.store);
      this.arrowLabelEditor.cancel();
      this.unsubToolChange();
      this.unsubToolRegister();
      this.unsubRecorderEnd();
      this.wrapper.remove();
      throw error;
    }

    if (options.minimap) {
      this.minimap = new Minimap(this.wrapper, this, {
        minimapHooks: this._renderHooks.minimap,
        getExtraBounds: () => {
          let combined: Bounds | null = null;
          for (const provider of this.extraBoundsProviders) {
            const b = provider();
            if (!b) continue;
            if (!combined) {
              combined = { ...b };
            } else {
              const minX = Math.min(combined.x, b.x);
              const minY = Math.min(combined.y, b.y);
              const maxR = Math.max(combined.x + combined.w, b.x + b.w);
              const maxB = Math.max(combined.y + combined.h, b.y + b.h);
              combined = { x: minX, y: minY, w: maxR - minX, h: maxB - minY };
            }
          }
          return combined;
        },
      });
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
      hooks: this._renderHooks,
    });

    this.unsubHtmlPainters = this.htmlPainters.onChange(() => this.onHtmlRegistryChanged());

    this.unsubCamera = this.camera.onChange(() => {
      this.applyCameraTransform();
      this.noteEditor.updateToolbarPosition();
      this.contextMenu?.close();
      this.requestRender();
    });

    this.unsubStore = [
      this.store.on('add', (el) => {
        if (el.type === 'html') {
          this.domNodeManager.reconcileHtmlRouting(this.store, this.resolveRouting);
        }
        this.renderLoop.markLayerDirty(el.layerId);
        this.requestRender();
      }),
      this.store.on('remove', (el, meta) => {
        this.unbindArrowsFrom(el, meta);
        this.domNodeManager.removeDomNode(el.id);
        this.htmlDiagnostics.forget(el.id);
        this.renderLoop.markLayerDirty(el.layerId);
        this.requestRender();
        this.handleRemovedElement(el.id);
      }),
      this.store.on('update', ({ previous, current }) => {
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
        this.requestRender();
        this.pruneSelection();
      }),
      this.store.on('batch', () => {
        this.domNodeManager.reconcileHtmlRouting(this.store, this.resolveRouting);
        this.htmlDiagnostics.reset();
        this.renderLoop.markAllLayersDirty();
        this.requestRender();
        this.pruneSelection();
      }),
    ];

    this.unsubLayers = this.layerManager.on('change', () => {
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

    try {
      this.startPlugins();
      this.validateRequiredCapabilities(options.requiredCapabilities);
    } catch (error) {
      this.disposePlugins();
      this.domNodeManager.clearDomNodes();
      this.renderLoop.stop();
      this.interactMode.destroy();
      this.noteEditor.destroy(this.store);
      this.arrowLabelEditor.cancel();
      this.historyRecorder.destroy();
      this.contextMenu?.dispose();
      this.minimap?.destroy();
      this.inputHandler.destroy();
      this.unsubCamera();
      this.unsubLayers();
      this.unsubToolChange();
      this.unsubToolRegister();
      this.unsubRecorderEnd();
      this.unsubHtmlPainters();
      this.unsubStore.forEach((unsubscribe) => unsubscribe());
      this.wrapper.remove();
      throw error;
    }

    this.wrapper.addEventListener('pointerdown', this.interactions.onTapDown);
    this.wrapper.addEventListener('pointerup', this.interactions.onDoubleTap);
    this.wrapper.addEventListener('dragover', this.interactions.onDragOver);
    this.wrapper.addEventListener('drop', this.interactions.onDrop);
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
    return this.services.get(key.id) as T | undefined;
  }

  suspendNotifications(): NotificationController {
    const controllers = [
      this.store.suspendNotifications(),
      this.layerManager.suspendNotifications(),
      this.camera.suspendNotifications(),
      this.history.suspendNotifications(),
    ];
    this.pluginNotificationDepth += 1;
    let settled = false;
    const settle = (flush: boolean): void => {
      if (settled) return;
      settled = true;
      for (const controller of controllers) {
        if (flush) controller.resume();
        else controller.discard();
      }
      this.pluginNotificationDepth = Math.max(0, this.pluginNotificationDepth - 1);
      if (!flush) this.pluginChangePending = false;
      if (flush && this.pluginNotificationDepth === 0 && this.pluginChangePending) {
        this.pluginChangePending = false;
        for (const listener of this.pluginChangeListeners) {
          try {
            listener();
          } catch (error) {
            console.error('[fieldnotes] plugin change listener failed', error);
          }
        }
      }
    };
    return { resume: () => settle(true), discard: () => settle(false) };
  }

  get snapToGrid(): boolean {
    return this._snapToGrid;
  }

  setSnapToGrid(enabled: boolean): void {
    this._snapToGrid = enabled;
    this.toolContext.snapToGrid = enabled;
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
      this.pluginStateManager.exportState(),
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

  async exportImage(options?: ExportImageOptions): Promise<Blob | null> {
    const opts = {
      ...this.withHtmlDefaults(options),
      elementRegistry: options?.elementRegistry ?? this.elementRegistry,
      renderHooks: options?.renderHooks ?? this._renderHooks,
    };
    return exportImage(this.store, opts, this.layerManager);
  }

  async exportSVG(options?: ExportSvgOptions): Promise<string> {
    const opts = {
      ...this.withHtmlDefaults(options),
      elementRegistry: options?.elementRegistry ?? this.elementRegistry,
      renderHooks: options?.renderHooks ?? this._renderHooks,
    };
    return exportSvg(this.store, opts, this.layerManager);
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
      const factory = el.htmlType ? this.htmlRenderers.get(el.htmlType) : undefined;
      const rebuilt = factory ? factory(el) : null;
      if (rebuilt) {
        this.domNodeManager.storeHtmlContent(el.id, rebuilt);
        this.domNodeManager.syncDomNode(el);
      }
      if (!this.onHtmlElementMount) continue;
      if (!rebuilt) this.domNodeManager.syncDomNode(el);
      const node = this.domNodeManager.getNode(el.id);
      if (!node) continue;
      this.onHtmlElementMount(el.id, el.domId, node);
      this.domNodeManager.markHostOwnedContent(el.id);
      node.dataset['initialized'] = 'true';
      Object.assign(node.style, {
        overflow: 'hidden',
        pointerEvents: el.interactive ? 'auto' : 'none',
      });
    }
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
        `[FieldNotes] fps=${s.fps} frame=${s.avgFrameMs}ms p95=${s.p95FrameMs}ms layers=${s.layersMs}ms comp=${s.compositeMs}ms bg=${s.backgroundMs}ms overlay=${s.overlayMs}ms`,
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
    this.unsubLayers();
    this.unsubToolChange();
    this.unsubToolRegister();
    this.unsubRecorderEnd();
    this.unsubHtmlPainters();
    this.disposePlugins();
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

  private unbindArrowsFrom(removedElement: CanvasElement, meta?: ElementChangeMeta): void {
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
        this.store.update(arrow.id, updates, meta);
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

  private configurePlugins(plugins?: ViewportPlugin[]): void {
    if (!plugins?.length) return;
    const names = new Set<string>();
    const ordered = plugins
      .map((plugin, index) => ({ plugin, index }))
      .sort((a, b) => (a.plugin.priority ?? 0) - (b.plugin.priority ?? 0) || a.index - b.index);
    for (const { plugin } of ordered) {
      if (names.has(plugin.name)) continue;
      names.add(plugin.name);
      const configureDisposers: (() => void)[] = [];
      const track = (dispose: () => void): void => {
        configureDisposers.push(dispose);
      };
      const context: PluginConfigureContext = {
        elementRegistry: this.elementRegistry,
        toolManager: this.toolManager,
        registerElementType: (definition) => {
          this.elementRegistry.register(definition);
          track(() => this.elementRegistry.unregister(definition.type));
        },
        registerTool: (tool) => track(this.toolManager.register(tool)),
        registerViewportHooks: (hooks, options) =>
          track(this._renderHooks.viewport.register(hooks, options)),
        registerMinimapHooks: (hooks, options) =>
          track(this._renderHooks.minimap.register(hooks, options)),
        registerImageExportHooks: (hooks, options) =>
          track(this._renderHooks.imageExport.register(hooks, options)),
        registerSvgExportHooks: (hooks, options) =>
          track(this._renderHooks.svgExport.register(hooks, options)),
      };
      try {
        plugin.configure?.(context);
        this.installedPlugins.push({ plugin, configureDisposers, startDisposers: [] });
      } catch (error) {
        for (const dispose of configureDisposers.reverse()) safelyDispose(dispose);
        if (plugin.required) {
          this.disposePlugins();
          throw error;
        }
      }
    }
  }

  private startPlugins(): void {
    for (const configured of [...this.installedPlugins]) {
      const startDisposers: (() => void)[] = [];
      const registeredServices: { key: symbol; previous: unknown; hadPrevious: boolean }[] = [];
      const context: PluginStartContext = {
        viewport: this,
        store: this.store,
        pushHistory: (command) => this.history.push(command),
        requestRender: () => this.renderLoop.requestRender(),
        invalidateMinimap: () => this.minimap?.invalidateScene(),
        registerService: (key, service) => {
          registeredServices.push({
            key: key.id,
            previous: this.services.get(key.id),
            hadPrevious: this.services.has(key.id),
          });
          this.services.set(key.id, service);
        },
        addDisposer: (dispose) => startDisposers.push(dispose),
        registerExtraBounds: (provider) => {
          this.extraBoundsProviders.add(provider);
          this.minimap?.invalidateScene();
          const dispose = () => {
            this.extraBoundsProviders.delete(provider);
            this.minimap?.invalidateScene();
          };
          startDisposers.push(dispose);
          return dispose;
        },
        onChange: (listener) => {
          this.pluginChangeListeners.add(listener);
          const dispose = () => this.pluginChangeListeners.delete(listener);
          startDisposers.push(dispose);
          return dispose;
        },
        notifyChange: () => {
          if (this.pluginNotificationDepth > 0) {
            this.pluginChangePending = true;
            return;
          }
          for (const listener of this.pluginChangeListeners) {
            try {
              listener();
            } catch (error) {
              console.error('[fieldnotes] plugin change listener failed', error);
            }
          }
        },
      };
      try {
        const handle = configured.plugin.start?.(context);
        configured.startDisposers = startDisposers;
        if (handle) {
          configured.handle = handle;
          this.pluginStateManager.registerPlugin(configured.plugin.name, handle);
        }
      } catch (error) {
        for (const dispose of startDisposers.reverse()) safelyDispose(dispose);
        for (const service of registeredServices.reverse()) {
          if (service.hadPrevious) this.services.set(service.key, service.previous);
          else this.services.delete(service.key);
        }
        for (const dispose of configured.configureDisposers.reverse()) safelyDispose(dispose);
        this.installedPlugins.splice(this.installedPlugins.indexOf(configured), 1);
        if (configured.plugin.required) {
          this.disposePlugins();
          throw error;
        }
      }
    }
  }

  private validateRequiredCapabilities(required?: RequiredCapabilities): void {
    if (!required) return;
    const bySurface: Exclude<RequiredCapabilities, readonly string[]> = Array.isArray(required)
      ? {
          viewport: required,
          minimap: required,
          imageExport: required,
          svgExport: required,
        }
      : (required as Exclude<RequiredCapabilities, readonly string[]>);
    const surfaces = ['viewport', 'minimap', 'imageExport', 'svgExport'] as const;
    const missing: string[] = [];
    for (const surface of surfaces) {
      const satisfied = new Set(this._renderHooks[surface].getSatisfiedCapabilities());
      for (const capability of bySurface[surface] ?? []) {
        if (!satisfied.has(capability)) missing.push(`${surface}:${capability}`);
      }
    }
    if (missing.length > 0) {
      throw new Error(`Required plugin capabilities are missing: ${missing.join(', ')}`);
    }
  }

  private disposePlugins(): void {
    for (const configured of [...this.installedPlugins].reverse()) {
      if (configured.handle) {
        this.pluginStateManager.unregisterPlugin(configured.plugin.name, configured.handle);
        safelyDispose(() => configured.handle?.dispose());
      }
      for (const dispose of [...configured.startDisposers].reverse()) safelyDispose(dispose);
      for (const dispose of [...configured.configureDisposers].reverse()) safelyDispose(dispose);
    }
    this.installedPlugins.length = 0;
    this.services.clear();
  }
}

function safelyDispose(dispose: () => void): void {
  try {
    dispose();
  } catch {
    // Cleanup remains best-effort so later resources are still released.
  }
}
