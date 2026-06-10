import { Camera } from './camera';
import type { CameraOptions } from './camera';
import { InputHandler } from './input-handler';
import { Background } from './background';
import type { BackgroundOptions } from './background';
import { ElementStore } from '../elements/element-store';
import { ElementRenderer } from '../elements/element-renderer';
import { NoteEditor } from '../elements/note-editor';
import type { FontSizePreset } from '../elements/note-toolbar';
import type { CanvasElement, ArrowElement, GridElement } from '../elements/types';
import { findBoundArrows, getEdgeIntersection } from '../elements/arrow-binding';
import { getElementBounds } from '../elements/element-bounds';
import { getElementsBoundingBox } from '../elements/bounds';
import { getArrowTangentAngle } from '../elements/arrow-geometry';
import { ToolManager } from '../tools/tool-manager';
import type { ToolContext } from '../tools/types';
import { HistoryStack } from '../history/history-stack';
import { HistoryRecorder } from '../history/history-recorder';
import { createImage, createHtmlElement, createGrid } from '../elements/element-factory';
import { exportState as exportCanvasState, parseState } from '../core/state-serializer';
import { exportImage } from './export-image';
import type { ExportImageOptions } from './export-image';
import type { CanvasState } from '../core/state-serializer';
import { LayerManager } from '../layers/layer-manager';
import { InteractMode } from './interact-mode';
import { DomNodeManager } from './dom-node-manager';
import { DoubleTapDetector } from './double-tap-detector';
import { RenderLoop } from './render-loop';
import type { RenderStatsSnapshot } from './render-stats';
import { LayerCache } from './layer-cache';

export interface GridInfo {
  gridType: 'square' | 'hex';
  hexOrientation: 'pointy' | 'flat';
  cellSize: number;
  cellRadius: number;
}

export interface ViewportOptions {
  camera?: CameraOptions;
  background?: BackgroundOptions;
  fontSizePresets?: FontSizePreset[];
  toolbar?: boolean;
  onHtmlElementMount?: (
    elementId: string,
    domId: string | undefined,
    container: HTMLDivElement,
  ) => void;
  onDrop?: (event: DragEvent, worldPosition: { x: number; y: number }) => void;
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
  private readonly unsubStore: (() => void)[];
  private readonly inputHandler: InputHandler;
  private readonly background: Background;
  private readonly renderer: ElementRenderer;
  private readonly noteEditor: NoteEditor;
  private readonly historyRecorder: HistoryRecorder;
  readonly toolContext: ToolContext;
  private resizeObserver: ResizeObserver | null = null;
  private _snapToGrid = false;
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
  private readonly gridChangeListeners = new Set<(info: GridInfo | null) => void>();
  private readonly doubleTapDetector = new DoubleTapDetector();
  private tapDownX = 0;
  private tapDownY = 0;

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
    this.noteEditor = new NoteEditor({
      fontSizePresets: options.fontSizePresets,
      toolbar: options.toolbar,
    });
    this.noteEditor.setOnStop((id) => this.onTextEditStop(id));
    this.onHtmlElementMount = options.onHtmlElementMount;
    this.dropHandler = options.onDrop;
    this.history = new HistoryStack();
    this.historyRecorder = new HistoryRecorder(this.store, this.history, this.layerManager);

    this.wrapper = this.createWrapper();
    this.canvasEl = this.createCanvas();
    this.domLayer = this.createDomLayer();

    this.wrapper.appendChild(this.canvasEl);
    this.wrapper.appendChild(this.domLayer);
    this.container.appendChild(this.wrapper);

    this.toolContext = {
      camera: this.camera,
      store: this.store,
      requestRender: () => this.requestRender(),
      switchTool: (name: string) => this.toolManager.setTool(name, this.toolContext),
      editElement: (id: string) => this.startEditingElement(id),
      setCursor: (cursor: string) => {
        this.wrapper.style.cursor = cursor;
      },
      snapToGrid: false,
      gridSize: this._gridSize,
      activeLayerId: this.layerManager.activeLayerId,
      isLayerVisible: (id: string) => this.layerManager.isLayerVisible(id),
      isLayerLocked: (id: string) => this.layerManager.isLayerLocked(id),
    };

    this.inputHandler = new InputHandler(this.wrapper, this.camera, {
      toolManager: this.toolManager,
      toolContext: this.toolContext,
      historyRecorder: this.historyRecorder,
      historyStack: this.history,
      fitToContent: () => this.fitToContent(),
    });

    this.domNodeManager = new DomNodeManager({
      domLayer: this.domLayer,
      onEditRequest: (id) => this.startEditingElement(id),
      isEditingElement: (id) =>
        this.noteEditor.isEditing && this.noteEditor.editingElementId === id,
      getVersion: (id) => this.store.getVersion(id),
    });

    this.interactMode = new InteractMode({
      getNode: (id) => this.domNodeManager.getNode(id),
    });

    const layerCache = new LayerCache(
      this.canvasEl.clientWidth || 800,
      this.canvasEl.clientHeight || 600,
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
      layerCache,
    });

    this.unsubCamera = this.camera.onChange(() => {
      this.applyCameraTransform();
      this.noteEditor.updateToolbarPosition();
      this.requestRender();
    });

    this.unsubStore = [
      this.store.on('add', (el) => {
        if (el.type === 'grid') this.syncGridContext();
        this.renderLoop.markLayerDirty(el.layerId);
        this.requestRender();
      }),
      this.store.on('remove', (el) => {
        if (el.type === 'grid') this.syncGridContext();
        this.unbindArrowsFrom(el);
        this.domNodeManager.removeDomNode(el.id);
        this.renderLoop.markLayerDirty(el.layerId);
        this.requestRender();
      }),
      this.store.on('update', ({ previous, current }) => {
        if (current.type === 'grid') this.syncGridContext();
        this.renderLoop.markLayerDirty(current.layerId);
        if (previous.layerId !== current.layerId) {
          this.renderLoop.markLayerDirty(previous.layerId);
        }
        this.requestRender();
      }),
      this.store.on('clear', () => {
        this.domNodeManager.clearDomNodes();
        this.renderLoop.markAllLayersDirty();
        this.syncGridContext();
        this.requestRender();
      }),
    ];

    this.layerManager.on('change', () => {
      this.toolContext.activeLayerId = this.layerManager.activeLayerId;
      this.requestRender();
    });

    this.wrapper.addEventListener('pointerdown', this.onTapDown);
    this.wrapper.addEventListener('pointerup', this.onDoubleTap);
    this.wrapper.addEventListener('dragover', this.onDragOver);
    this.wrapper.addEventListener('drop', this.onDrop);
    this.observeResize();
    this.syncCanvasSize();
    this.renderLoop.start();
    this.syncGridContext();
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
    const existing = this.store.getElementsByType('grid')[0];
    this.historyRecorder.begin();
    if (existing) {
      this.store.remove(existing.id);
    }
    const grid = createGrid({ ...input, layerId: this.layerManager.activeLayerId });
    this.store.add(grid);
    this.historyRecorder.commit();
    this.requestRender();
    return grid.id;
  }

  updateGrid(
    updates: Partial<
      Pick<
        GridElement,
        'gridType' | 'hexOrientation' | 'cellSize' | 'strokeColor' | 'strokeWidth' | 'opacity'
      >
    >,
  ): void {
    const grid = this.store.getElementsByType('grid')[0];
    if (!grid) return;
    this.historyRecorder.begin();
    this.store.update(grid.id, updates);
    this.historyRecorder.commit();
    this.requestRender();
  }

  removeGrid(): void {
    const grid = this.store.getElementsByType('grid')[0];
    if (!grid) return;
    this.historyRecorder.begin();
    this.store.remove(grid.id);
    this.historyRecorder.commit();
    this.requestRender();
  }

  getGridInfo(): GridInfo | null {
    const grid = this.store.getElementsByType('grid')[0];
    if (!grid) return null;
    return {
      gridType: grid.gridType,
      hexOrientation: grid.hexOrientation,
      cellSize: grid.cellSize,
      cellRadius: grid.gridType === 'hex' ? grid.cellSize : grid.cellSize / 2,
    };
  }

  onGridChange(listener: (info: GridInfo | null) => void): () => void {
    this.gridChangeListeners.add(listener);
    return () => {
      this.gridChangeListeners.delete(listener);
    };
  }

  getRenderStats(): RenderStatsSnapshot {
    return this.renderLoop.getStats();
  }

  logPerformance(intervalMs = 2000): () => void {
    const id = setInterval(() => {
      const s = this.getRenderStats();
      console.log(
        `[FieldNotes] fps=${s.fps} frame=${s.avgFrameMs}ms p95=${s.p95FrameMs}ms grid=${s.lastGridMs}ms`,
      );
    }, intervalMs);
    return () => clearInterval(id);
  }

  destroy(): void {
    this.renderLoop.stop();
    this.interactMode.destroy();
    this.noteEditor.destroy(this.store);
    this.historyRecorder.destroy();
    this.wrapper.removeEventListener('pointerdown', this.onTapDown);
    this.wrapper.removeEventListener('pointerup', this.onDoubleTap);
    this.wrapper.removeEventListener('dragover', this.onDragOver);
    this.wrapper.removeEventListener('drop', this.onDrop);
    this.inputHandler.destroy();
    this.unsubCamera();
    this.unsubStore.forEach((fn) => fn());
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.wrapper.remove();
  }

  private startEditingElement(id: string): void {
    const element = this.store.getById(id);
    if (!element || (element.type !== 'note' && element.type !== 'text')) return;

    this.renderLoop.flush();

    const node = this.domNodeManager.getNode(id);
    if (node) {
      this.noteEditor.startEditing(node, id, this.store);
    }
  }

  private onTextEditStop(elementId: string): void {
    const element = this.store.getById(elementId);
    if (!element || element.type !== 'text') return;

    if (!element.text || element.text.trim() === '') {
      this.historyRecorder.begin();
      this.store.remove(elementId);
      this.historyRecorder.commit();
      return;
    }

    const node = this.domNodeManager.getNode(elementId);
    if (node && 'size' in element) {
      const measuredHeight = node.scrollHeight;
      if (measuredHeight !== element.size.h) {
        this.store.update(elementId, {
          size: { w: element.size.w, h: measuredHeight },
        });
      }
    }
  }

  private onTapDown = (e: PointerEvent): void => {
    this.tapDownX = e.clientX;
    this.tapDownY = e.clientY;
  };

  private onDoubleTap = (e: PointerEvent): void => {
    const dx = e.clientX - this.tapDownX;
    const dy = e.clientY - this.tapDownY;
    const moved = Math.sqrt(dx * dx + dy * dy);
    if (moved > 10) return;

    if (!this.doubleTapDetector.feed(e)) return;
    if (typeof document.elementFromPoint !== 'function') return;

    const el = document.elementFromPoint(e.clientX, e.clientY);

    const nodeEl = (el as HTMLElement | null)?.closest<HTMLDivElement>('[data-element-id]');
    if (nodeEl) {
      const elementId = nodeEl.dataset['elementId'];
      if (elementId) {
        const element = this.store.getById(elementId);
        if (element?.type === 'note' || element?.type === 'text') {
          this.startEditingElement(elementId);
          return;
        }
      }
    }

    const rect = this.wrapper.getBoundingClientRect();
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const world = this.camera.screenToWorld(screen);
    const hit = this.hitTestWorld(world);
    if (hit?.type === 'html') {
      this.interactMode.startInteracting(hit.id);
    }
  };

  private hitTestWorld(world: { x: number; y: number }): CanvasElement | null {
    const candidates = this.store.queryPoint(world).reverse();
    for (const el of candidates) {
      if (!('size' in el)) continue;
      const { x, y } = el.position;
      const { w, h } = el.size;
      if (world.x >= x && world.x <= x + w && world.y >= y && world.y <= y + h) {
        return el;
      }
    }
    return null;
  }

  stopInteracting(): void {
    this.interactMode.stopInteracting();
  }

  private onDragOver = (e: DragEvent): void => {
    e.preventDefault();
  };

  private onDrop = (e: DragEvent): void => {
    e.preventDefault();
    const rect = this.wrapper.getBoundingClientRect();
    const screenPos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const worldPos = this.camera.screenToWorld(screenPos);

    if (this.dropHandler) {
      this.dropHandler(e, worldPos);
      return;
    }

    const files = e.dataTransfer?.files;
    if (!files) return;

    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;

      const reader = new FileReader();
      reader.onload = () => {
        const src = reader.result;
        if (typeof src !== 'string') return;
        this.addImage(src, worldPos);
      };
      reader.readAsDataURL(file);
    }
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

  private createWrapper(): HTMLDivElement {
    const el = document.createElement('div');
    Object.assign(el.style, {
      position: 'relative',
      width: '100%',
      height: '100%',
      overflow: 'hidden',
      overscrollBehavior: 'none',
      userSelect: 'none',
      webkitUserSelect: 'none',
    });
    return el;
  }

  private createCanvas(): HTMLCanvasElement {
    const el = document.createElement('canvas');
    Object.assign(el.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
    });
    return el;
  }

  private createDomLayer(): HTMLDivElement {
    const el = document.createElement('div');
    Object.assign(el.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      transformOrigin: '0 0',
    });
    return el;
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

  private syncGridContext(): void {
    const grid = this.store.getElementsByType('grid')[0];
    if (grid) {
      this.toolContext.gridSize = grid.cellSize;
      this.toolContext.gridType = grid.gridType;
      this.toolContext.hexOrientation = grid.hexOrientation;
    } else {
      this.toolContext.gridSize = this._gridSize;
      this.toolContext.gridType = undefined;
      this.toolContext.hexOrientation = undefined;
    }
    this.notifyGridChangeListeners();
  }

  private notifyGridChangeListeners(): void {
    const info = this.getGridInfo();
    for (const listener of this.gridChangeListeners) {
      listener(info);
    }
  }

  private observeResize(): void {
    if (typeof ResizeObserver === 'undefined') return;
    this.resizeObserver = new ResizeObserver(() => this.syncCanvasSize());
    this.resizeObserver.observe(this.container);
  }
}
