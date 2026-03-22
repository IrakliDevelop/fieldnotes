import { Camera } from './camera';
import type { CameraOptions } from './camera';
import { InputHandler } from './input-handler';
import { Background } from './background';
import type { BackgroundOptions } from './background';
import { ElementStore } from '../elements/element-store';
import { ElementRenderer } from '../elements/element-renderer';
import { NoteEditor } from '../elements/note-editor';
import type { CanvasElement, ArrowElement } from '../elements/types';
import { findBoundArrows, getElementBounds, getEdgeIntersection } from '../elements/arrow-binding';
import { getArrowTangentAngle } from '../elements/arrow-geometry';
import { ToolManager } from '../tools/tool-manager';
import type { ToolContext } from '../tools/types';
import { HistoryStack } from '../history/history-stack';
import { HistoryRecorder } from '../history/history-recorder';
import { createImage, createHtmlElement } from '../elements/element-factory';
import { exportState, parseState } from '../core/state-serializer';
import type { CanvasState } from '../core/state-serializer';

export interface ViewportOptions {
  camera?: CameraOptions;
  background?: BackgroundOptions;
}

export class Viewport {
  readonly camera: Camera;
  readonly store: ElementStore;
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
  private animFrameId = 0;
  private needsRender = true;
  private domNodes = new Map<string, HTMLDivElement>();
  private htmlContent = new Map<string, HTMLElement>();
  private interactingElementId: string | null = null;

  constructor(
    private readonly container: HTMLElement,
    options: ViewportOptions = {},
  ) {
    this.camera = new Camera(options.camera);
    this.background = new Background(options.background);
    this.store = new ElementStore();
    this.toolManager = new ToolManager();
    this.renderer = new ElementRenderer();
    this.renderer.setStore(this.store);
    this.noteEditor = new NoteEditor();
    this.noteEditor.setOnStop((id) => this.onTextEditStop(id));
    this.history = new HistoryStack();
    this.historyRecorder = new HistoryRecorder(this.store, this.history);

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
    };

    this.inputHandler = new InputHandler(this.wrapper, this.camera, {
      toolManager: this.toolManager,
      toolContext: this.toolContext,
      historyRecorder: this.historyRecorder,
      historyStack: this.history,
    });

    this.unsubCamera = this.camera.onChange(() => {
      this.applyCameraTransform();
      this.requestRender();
    });

    this.unsubStore = [
      this.store.on('add', () => this.requestRender()),
      this.store.on('remove', (el) => {
        this.unbindArrowsFrom(el);
        this.removeDomNode(el.id);
      }),
      this.store.on('update', () => this.requestRender()),
      this.store.on('clear', () => this.clearDomNodes()),
    ];

    this.wrapper.addEventListener('dblclick', this.onDblClick);
    this.wrapper.addEventListener('dragover', this.onDragOver);
    this.wrapper.addEventListener('drop', this.onDrop);
    this.observeResize();
    this.syncCanvasSize();
    this.startRenderLoop();
  }

  get ctx(): CanvasRenderingContext2D | null {
    return this.canvasEl.getContext('2d');
  }

  requestRender(): void {
    this.needsRender = true;
  }

  exportState(): CanvasState {
    return exportState(this.store.snapshot(), this.camera);
  }

  exportJSON(): string {
    return JSON.stringify(this.exportState());
  }

  loadState(state: CanvasState): void {
    this.historyRecorder.pause();
    this.noteEditor.destroy(this.store);
    this.clearDomNodes();
    this.store.loadSnapshot(state.elements);
    this.history.clear();
    this.historyRecorder.resume();
    this.camera.moveTo(state.camera.position.x, state.camera.position.y);
    this.camera.setZoom(state.camera.zoom);
  }

  loadJSON(json: string): void {
    this.loadState(parseState(json));
  }

  undo(): boolean {
    this.historyRecorder.pause();
    const result = this.history.undo(this.store);
    this.historyRecorder.resume();
    if (result) this.requestRender();
    return result;
  }

  redo(): boolean {
    this.historyRecorder.pause();
    const result = this.history.redo(this.store);
    this.historyRecorder.resume();
    if (result) this.requestRender();
    return result;
  }

  addImage(src: string, position: { x: number; y: number }, size = { w: 300, h: 200 }): string {
    const image = createImage({ position, size, src });
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
    const el = createHtmlElement({ position, size });
    this.htmlContent.set(el.id, dom);
    this.historyRecorder.begin();
    this.store.add(el);
    this.historyRecorder.commit();
    this.requestRender();
    return el.id;
  }

  destroy(): void {
    cancelAnimationFrame(this.animFrameId);
    this.stopInteracting();
    this.noteEditor.destroy(this.store);
    this.historyRecorder.destroy();
    this.wrapper.removeEventListener('dblclick', this.onDblClick);
    this.wrapper.removeEventListener('dragover', this.onDragOver);
    this.wrapper.removeEventListener('drop', this.onDrop);
    this.inputHandler.destroy();
    this.unsubCamera();
    this.unsubStore.forEach((fn) => fn());
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.wrapper.remove();
  }

  private startRenderLoop(): void {
    const loop = (): void => {
      if (this.needsRender) {
        this.render();
        this.needsRender = false;
      }
      this.animFrameId = requestAnimationFrame(loop);
    };
    this.animFrameId = requestAnimationFrame(loop);
  }

  private render(): void {
    const ctx = this.ctx;
    if (!ctx) return;

    const dpr = typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1;
    ctx.save();
    ctx.scale(dpr, dpr);

    this.background.render(ctx, this.camera);

    ctx.save();
    ctx.translate(this.camera.position.x, this.camera.position.y);
    ctx.scale(this.camera.zoom, this.camera.zoom);

    for (const element of this.store.getAll()) {
      if (this.renderer.isDomElement(element)) {
        this.syncDomNode(element);
      } else {
        this.renderer.renderCanvasElement(ctx, element);
      }
    }

    const activeTool = this.toolManager.activeTool;
    if (activeTool?.renderOverlay) {
      activeTool.renderOverlay(ctx);
    }

    ctx.restore();
    ctx.restore();
  }

  private startEditingElement(id: string): void {
    const element = this.store.getById(id);
    if (!element || (element.type !== 'note' && element.type !== 'text')) return;

    this.render();

    const node = this.domNodes.get(id);
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

    const node = this.domNodes.get(elementId);
    if (node && 'size' in element) {
      const measuredHeight = node.scrollHeight;
      if (measuredHeight !== element.size.h) {
        this.store.update(elementId, {
          size: { w: element.size.w, h: measuredHeight },
        });
      }
    }
  }

  private onDblClick = (e: MouseEvent): void => {
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
      this.startInteracting(hit.id);
    }
  };

  private hitTestWorld(world: { x: number; y: number }): CanvasElement | null {
    const elements = this.store.getAll().reverse();
    for (const el of elements) {
      if (!('size' in el)) continue;
      const { x, y } = el.position;
      const { w, h } = el.size;
      if (world.x >= x && world.x <= x + w && world.y >= y && world.y <= y + h) {
        return el;
      }
    }
    return null;
  }

  private startInteracting(id: string): void {
    this.stopInteracting();
    const node = this.domNodes.get(id);
    if (!node) return;

    this.interactingElementId = id;
    node.style.pointerEvents = 'auto';
    node.addEventListener('pointerdown', this.onInteractNodePointerDown);

    window.addEventListener('keydown', this.onInteractKeyDown);
    window.addEventListener('pointerdown', this.onInteractPointerDown);
  }

  stopInteracting(): void {
    if (!this.interactingElementId) return;

    const node = this.domNodes.get(this.interactingElementId);
    if (node) {
      node.style.pointerEvents = 'none';
      node.removeEventListener('pointerdown', this.onInteractNodePointerDown);
    }

    this.interactingElementId = null;
    window.removeEventListener('keydown', this.onInteractKeyDown);
    window.removeEventListener('pointerdown', this.onInteractPointerDown);
  }

  private onInteractNodePointerDown = (e: PointerEvent): void => {
    e.stopPropagation();
  };

  private onInteractKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      this.stopInteracting();
    }
  };

  private onInteractPointerDown = (e: PointerEvent): void => {
    if (!this.interactingElementId) return;
    const target = e.target as HTMLElement | null;
    if (!target) return;

    const node = this.domNodes.get(this.interactingElementId);
    if (node && !node.contains(target)) {
      this.stopInteracting();
    }
  };

  private onDragOver = (e: DragEvent): void => {
    e.preventDefault();
  };

  private onDrop = (e: DragEvent): void => {
    e.preventDefault();
    const files = e.dataTransfer?.files;
    if (!files) return;

    const rect = this.wrapper.getBoundingClientRect();

    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;

      const reader = new FileReader();
      reader.onload = () => {
        const src = reader.result;
        if (typeof src !== 'string') return;

        const screenPos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        const worldPos = this.camera.screenToWorld(screenPos);
        this.addImage(src, worldPos);
      };
      reader.readAsDataURL(file);
    }
  };

  private syncDomNode(element: CanvasElement): void {
    let node = this.domNodes.get(element.id);
    if (!node) {
      node = document.createElement('div');
      node.dataset['elementId'] = element.id;
      Object.assign(node.style, {
        position: 'absolute',
        pointerEvents: 'auto',
      });
      this.domLayer.appendChild(node);
      this.domNodes.set(element.id, node);
    }

    const size = 'size' in element ? element.size : null;
    Object.assign(node.style, {
      left: `${element.position.x}px`,
      top: `${element.position.y}px`,
      width: size ? `${size.w}px` : 'auto',
      height: size ? `${size.h}px` : 'auto',
    });

    this.renderDomContent(node, element);
  }

  private renderDomContent(node: HTMLDivElement, element: CanvasElement): void {
    if (element.type === 'note') {
      if (!node.dataset['initialized']) {
        node.dataset['initialized'] = 'true';
        Object.assign(node.style, {
          backgroundColor: element.backgroundColor,
          padding: '8px',
          borderRadius: '4px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          fontSize: '14px',
          overflow: 'hidden',
          cursor: 'default',
          userSelect: 'none',
          wordWrap: 'break-word',
        });
        node.textContent = element.text || '';

        node.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          const id = node.dataset['elementId'];
          if (id) this.startEditingElement(id);
        });
      }

      if (!this.noteEditor.isEditing || this.noteEditor.editingElementId !== element.id) {
        if (node.textContent !== element.text) {
          node.textContent = element.text || '';
        }
        node.style.backgroundColor = element.backgroundColor;
      }
    }

    if (element.type === 'image') {
      if (!node.dataset['initialized']) {
        node.dataset['initialized'] = 'true';
        const img = document.createElement('img');
        img.src = element.src;
        Object.assign(img.style, {
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          pointerEvents: 'none',
        });
        img.draggable = false;
        node.appendChild(img);
      } else {
        const img = node.querySelector('img');
        if (img && img.src !== element.src) {
          img.src = element.src;
        }
      }
    }

    if (element.type === 'html' && !node.dataset['initialized']) {
      const content = this.htmlContent.get(element.id);
      if (content) {
        node.dataset['initialized'] = 'true';
        Object.assign(node.style, {
          overflow: 'hidden',
          pointerEvents: 'none',
        });
        node.appendChild(content);
      }
    }

    if (element.type === 'text') {
      if (!node.dataset['initialized']) {
        node.dataset['initialized'] = 'true';
        Object.assign(node.style, {
          padding: '2px',
          fontSize: `${element.fontSize}px`,
          color: element.color,
          textAlign: element.textAlign,
          background: 'none',
          border: 'none',
          boxShadow: 'none',
          overflow: 'visible',
          cursor: 'default',
          userSelect: 'none',
          wordWrap: 'break-word',
          whiteSpace: 'pre-wrap',
          lineHeight: '1.4',
        });
        node.textContent = element.text || '';

        node.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          const id = node.dataset['elementId'];
          if (id) this.startEditingElement(id);
        });
      }

      if (!this.noteEditor.isEditing || this.noteEditor.editingElementId !== element.id) {
        if (node.textContent !== element.text) {
          node.textContent = element.text || '';
        }
        Object.assign(node.style, {
          fontSize: `${element.fontSize}px`,
          color: element.color,
          textAlign: element.textAlign,
        });
      }
    }
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

  private removeDomNode(id: string): void {
    this.htmlContent.delete(id);
    const node = this.domNodes.get(id);
    if (node) {
      node.remove();
      this.domNodes.delete(id);
    }
    this.requestRender();
  }

  private clearDomNodes(): void {
    this.domNodes.forEach((node) => node.remove());
    this.domNodes.clear();
    this.htmlContent.clear();
    this.requestRender();
  }

  private createWrapper(): HTMLDivElement {
    const el = document.createElement('div');
    Object.assign(el.style, {
      position: 'relative',
      width: '100%',
      height: '100%',
      overflow: 'hidden',
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
    this.canvasEl.width = rect.width * dpr;
    this.canvasEl.height = rect.height * dpr;
    this.requestRender();
  }

  private observeResize(): void {
    if (typeof ResizeObserver === 'undefined') return;
    this.resizeObserver = new ResizeObserver(() => this.syncCanvasSize());
    this.resizeObserver.observe(this.container);
  }
}
