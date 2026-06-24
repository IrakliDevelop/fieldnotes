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
import type { CanvasElement, ArrowElement, GridElement, ShapeKind } from '../elements/types';
import type { Point } from '../core/types';
import { ContextMenu } from './context-menu';
import type { ContextMenuItem } from './context-menu';
import { createWrapper, createCanvas, createDomLayer } from './viewport-dom';
import { findBoundArrows, getEdgeIntersection } from '../elements/arrow-binding';
import { getElementBounds } from '../elements/element-bounds';
import { getElementsBoundingBox } from '../elements/bounds';
import { getArrowTangentAngle } from '../elements/arrow-geometry';
import { ArrowLabelEditor } from '../elements/arrow-label-editor';
import { ToolManager } from '../tools/tool-manager';
import type { ToolContext } from '../tools/types';
import type { SelectTool } from '../tools/select-tool';
import { HistoryStack } from '../history/history-stack';
import { HistoryRecorder } from '../history/history-recorder';
import { createImage, createHtmlElement, createShape } from '../elements/element-factory';
import { exportState as exportCanvasState, parseState } from '../core/state-serializer';
import { exportImage } from './export-image';
import type { ExportImageOptions } from './export-image';
import type { CanvasState } from '../core/state-serializer';
import { LayerManager } from '../layers/layer-manager';
import { InteractMode } from './interact-mode';
import { DomNodeManager } from './dom-node-manager';
import { RenderLoop } from './render-loop';
import type { RenderStatsSnapshot } from './render-stats';
import { LayerCache } from './layer-cache';
import { MarginViewport } from './margin-viewport';
import type { ElementStyle } from '../elements/element-style';
import { SelectionOps } from './selection-ops';
import type { AlignEdge, DistributeAxis } from './selection-ops';
import { GridController } from './grid-controller';
import type { GridInfo } from './grid-controller';
import { ViewportInteractions } from './viewport-interactions';

export type { AlignEdge, DistributeAxis } from './selection-ops';
export type { GridInfo } from './grid-controller';

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
  onImageError?: (info: { src: string; elementIds: string[]; cause?: unknown }) => void;
  /** CSS-pixel margin cached beyond the viewport. Default `256`. Set `0` to disable. */
  panBufferMargin?: number;
  /** Enable the built-in context menu. Default `true`. */
  contextMenu?: boolean;
}

export class Viewport {
  readonly camera: Camera;
  readonly store: ElementStore;
  readonly layerManager: LayerManager;
  readonly toolManager: ToolManager;
  readonly history: HistoryStack;
  readonly domLayer: HTMLDivElement;
  private readonly canvasEl: HTMLCanvasElement;
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
  private readonly selectionOps: SelectionOps;
  readonly toolContext: ToolContext;
  private readonly marginViewport: MarginViewport;
  private resizeObserver: ResizeObserver | null = null;
  private _snapToGrid = false;
  private _smartGuides = false;
  private readonly _gridSize: number;
  private readonly renderLoop: RenderLoop;
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
    this.noteEditor = new NoteEditor({
      fontSizePresets: options.fontSizePresets,
      toolbar: options.toolbar,
      placeholder: options.placeholder,
    });
    this.noteEditor.setOnStop((id) => this.interactions.onTextEditStop(id));
    this.arrowLabelEditor = new ArrowLabelEditor();
    this.noteEditor.setHistoryHooks(
      () => this.historyRecorder.begin(),
      () => this.historyRecorder.commit(),
    );
    this.onHtmlElementMount = options.onHtmlElementMount;
    this.dropHandler = options.onDrop;
    this.history = new HistoryStack();
    this.historyRecorder = new HistoryRecorder(this.store, this.history, this.layerManager);
    this.selectionOps = new SelectionOps({
      store: this.store,
      recorder: this.historyRecorder,
      getSelectedIds: () => this.getSelectedIds(),
      requestRender: () => this.requestRender(),
    });

    this.wrapper = createWrapper();
    this.canvasEl = createCanvas();
    this.domLayer = createDomLayer();

    this.wrapper.appendChild(this.canvasEl);
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
      openContextMenu: (screenPos, world) => {
        this.getSelectTool()?.selectAtPoint(world, this.toolContext);
        this.openContextMenu(screenPos);
      },
      shortcuts: options.shortcuts,
    });

    if (options.contextMenu !== false) {
      this.contextMenu = new ContextMenu({
        onCommand: (action) => this.runAction(action),
        onClose: noop,
      });
    }
    this.unsubToolChange = this.toolManager.onChange(() => this.contextMenu?.close());

    this.domNodeManager = new DomNodeManager({
      domLayer: this.domLayer,
      onEditRequest: (id) => this.interactions.startEditingElement(id),
      isEditingElement: (id) =>
        this.noteEditor.isEditing && this.noteEditor.editingElementId === id,
      getVersion: (id) => this.store.getVersion(id),
    });

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
    });

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
        this.renderLoop.markLayerDirty(el.layerId);
        this.requestRender();
      }),
      this.store.on('remove', (el) => {
        if (el.type === 'grid') this.gridController.syncContext();
        this.unbindArrowsFrom(el);
        this.domNodeManager.removeDomNode(el.id);
        this.renderLoop.markLayerDirty(el.layerId);
        this.requestRender();
      }),
      this.store.on('update', ({ previous, current }) => {
        if (current.type === 'grid') this.gridController.syncContext();
        this.renderLoop.markLayerDirty(current.layerId);
        if (previous.layerId !== current.layerId) {
          this.renderLoop.markLayerDirty(previous.layerId);
        }
        this.requestRender();
      }),
      this.store.on('clear', () => {
        this.domNodeManager.clearDomNodes();
        this.renderLoop.markAllLayersDirty();
        this.gridController.syncContext();
        this.requestRender();
      }),
    ];

    this.layerManager.on('change', () => {
      this.toolContext.activeLayerId = this.layerManager.activeLayerId;
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

  requestRender(): void {
    this.renderLoop.requestRender();
  }

  exportState(): CanvasState {
    return exportCanvasState(
      this.store.snapshot(),
      this.camera,
      this.layerManager.snapshot(),
      this.layerManager.activeLayerId,
    );
  }

  exportJSON(): string {
    return JSON.stringify(this.exportState());
  }

  async exportImage(options?: ExportImageOptions): Promise<Blob | null> {
    return exportImage(this.store, options, this.layerManager);
  }

  loadState(state: CanvasState): void {
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
    if (this.onHtmlElementMount) {
      for (const el of this.store.getElementsByType('html')) {
        if (!this.domNodeManager.hasContent(el.id)) {
          this.domNodeManager.syncDomNode(el);
          const node = this.domNodeManager.getNode(el.id);
          if (node) {
            this.onHtmlElementMount(el.id, el.domId, node);
            node.dataset['initialized'] = 'true';
            Object.assign(node.style, {
              overflow: 'hidden',
              pointerEvents: el.interactive ? 'auto' : 'none',
            });
          }
        }
      }
    }
    this.history.clear();
    this.historyRecorder.resume();
    this.camera.moveTo(state.camera.position.x, state.camera.position.y);
    this.camera.setZoom(state.camera.zoom);
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
  ): string {
    const domId = dom.id || undefined;
    const el = createHtmlElement({
      position,
      size,
      domId,
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

  updateHtmlElement(id: string, newContent: HTMLElement): void {
    const el = this.store.getById(id);
    if (!el) throw new Error(`Element not found: ${id}`);
    if (el.type !== 'html') throw new Error(`Element ${id} is not an HTML element`);
    this.domNodeManager.resetHtmlContent(id);
    this.domNodeManager.storeHtmlContent(id, newContent);
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
      const allLocked = ids.every((id) => this.store.getById(id)?.locked);
      items.push({ label: allLocked ? 'Unlock' : 'Lock', action: 'toggle-lock' });
    } else if (this.canPaste()) {
      items.push({ label: 'Paste', action: 'paste' });
    }
    if (items.length === 0) return;
    this.contextMenu.open(items, screenPos);
  }

  onSelectionChange(listener: () => void): () => void {
    const tool = this.getSelectTool();
    return tool ? tool.onSelectionChange(listener) : noop;
  }

  getSelectionStyle(): ElementStyle | null {
    return this.selectionOps.getStyle();
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
    this.wrapper.removeEventListener('pointerdown', this.interactions.onTapDown);
    this.wrapper.removeEventListener('pointerup', this.interactions.onDoubleTap);
    this.wrapper.removeEventListener('dragover', this.interactions.onDragOver);
    this.wrapper.removeEventListener('drop', this.interactions.onDrop);
    this.inputHandler.destroy();
    this.unsubCamera();
    this.unsubToolChange();
    this.unsubStore.forEach((fn) => fn());
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.wrapper.remove();
  }

  stopInteracting(): void {
    this.interactMode.stopInteracting();
  }

  startEditingElement(id: string): void {
    this.interactions.startEditingElement(id);
  }

  fitNoteHeight(elementId: string): void {
    this.interactions.fitNoteHeight(elementId);
  }

  onTextEditStop(elementId: string): void {
    this.interactions.onTextEditStop(elementId);
  }

  findArrowAt(world: { x: number; y: number }): ArrowElement | undefined {
    return this.interactions.findArrowAt(world);
  }

  startArrowLabelEdit(arrow: ArrowElement): void {
    this.interactions.startArrowLabelEdit(arrow);
  }

  onDrop = (e: DragEvent): void => {
    this.interactions.onDrop(e);
  };

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
    this.domLayer.style.transform = this.camera.toCSSTransform();
  }

  private syncCanvasSize(): void {
    const rect = this.container.getBoundingClientRect();
    const dpr = typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1;
    this.renderLoop.setCanvasSize(rect.width * dpr, rect.height * dpr);
    this.requestRender();
  }

  private observeResize(): void {
    if (typeof ResizeObserver === 'undefined') return;
    this.resizeObserver = new ResizeObserver(() => this.syncCanvasSize());
    this.resizeObserver.observe(this.container);
  }
}
