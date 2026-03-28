import type { Camera } from './camera';
import type { Background } from './background';
import type { ElementStore } from '../elements/element-store';
import type { ElementRenderer } from '../elements/element-renderer';
import type { ToolManager } from '../tools/tool-manager';
import type { LayerManager } from '../layers/layer-manager';
import type { DomNodeManager } from './dom-node-manager';
import type { Bounds } from '../core/types';
import { getElementBounds, boundsIntersect } from '../elements/element-bounds';

export interface RenderLoopDeps {
  canvasEl: HTMLCanvasElement;
  camera: Camera;
  background: Background;
  store: ElementStore;
  renderer: ElementRenderer;
  toolManager: ToolManager;
  layerManager: LayerManager;
  domNodeManager: DomNodeManager;
}

export class RenderLoop {
  private needsRender = false;
  private animFrameId = 0;
  private readonly canvasEl: HTMLCanvasElement;
  private readonly camera: Camera;
  private readonly background: Background;
  private readonly store: ElementStore;
  private readonly renderer: ElementRenderer;
  private readonly toolManager: ToolManager;
  private readonly layerManager: LayerManager;
  private readonly domNodeManager: DomNodeManager;

  constructor(deps: RenderLoopDeps) {
    this.canvasEl = deps.canvasEl;
    this.camera = deps.camera;
    this.background = deps.background;
    this.store = deps.store;
    this.renderer = deps.renderer;
    this.toolManager = deps.toolManager;
    this.layerManager = deps.layerManager;
    this.domNodeManager = deps.domNodeManager;
  }

  requestRender(): void {
    this.needsRender = true;
  }

  flush(): void {
    if (this.needsRender) {
      this.render();
      this.needsRender = false;
    }
  }

  start(): void {
    const loop = (): void => {
      if (this.needsRender) {
        this.render();
        this.needsRender = false;
      }
      this.animFrameId = requestAnimationFrame(loop);
    };
    this.animFrameId = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.animFrameId);
  }

  setCanvasSize(width: number, height: number): void {
    this.canvasEl.width = width;
    this.canvasEl.height = height;
  }

  private render(): void {
    const ctx = this.canvasEl.getContext('2d');
    if (!ctx) return;

    const dpr = typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1;
    ctx.save();
    ctx.scale(dpr, dpr);

    this.renderer.setCanvasSize(this.canvasEl.clientWidth, this.canvasEl.clientHeight);
    this.background.render(ctx, this.camera);

    ctx.save();
    ctx.translate(this.camera.position.x, this.camera.position.y);
    ctx.scale(this.camera.zoom, this.camera.zoom);

    const visibleRect = this.camera.getVisibleRect(
      this.canvasEl.clientWidth,
      this.canvasEl.clientHeight,
    );
    const margin = Math.max(visibleRect.w, visibleRect.h) * 0.1;
    const cullingRect: Bounds = {
      x: visibleRect.x - margin,
      y: visibleRect.y - margin,
      w: visibleRect.w + margin * 2,
      h: visibleRect.h + margin * 2,
    };

    const allElements = this.store.getAll();
    let domZIndex = 0;
    for (const element of allElements) {
      if (!this.layerManager.isLayerVisible(element.layerId)) {
        if (this.renderer.isDomElement(element)) {
          this.domNodeManager.hideDomNode(element.id);
        }
        continue;
      }

      const elBounds = getElementBounds(element);
      if (elBounds && !boundsIntersect(elBounds, cullingRect)) {
        if (this.renderer.isDomElement(element)) {
          this.domNodeManager.hideDomNode(element.id);
        }
        continue;
      }

      if (this.renderer.isDomElement(element)) {
        this.domNodeManager.syncDomNode(element, domZIndex++);
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
}
