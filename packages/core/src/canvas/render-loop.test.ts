/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { RenderLoop } from './render-loop';
import type { Camera } from './camera';
import type { Background } from './background';
import type { ElementStore } from '../elements/element-store';
import type { ElementRenderer } from '../elements/element-renderer';
import type { ToolManager } from '../tools/tool-manager';
import type { LayerManager } from '../layers/layer-manager';
import type { DomNodeManager } from './dom-node-manager';
import type { LayerCache } from './layer-cache';

function createMockDeps() {
  const canvasEl = document.createElement('canvas');

  const camera = {
    position: { x: 0, y: 0 },
    zoom: 1,
    getVisibleRect: vi.fn().mockReturnValue({ x: 0, y: 0, w: 800, h: 600 }),
    screenToWorld: vi.fn().mockReturnValue({ x: 0, y: 0 }),
  } as unknown as Camera;

  const background = {
    render: vi.fn(),
  } as unknown as Background;

  const elements = [
    {
      id: 'el-1',
      type: 'stroke',
      layerId: 'default',
      position: { x: 0, y: 0 },
      points: [{ x: 0, y: 0, pressure: 1 }],
    },
    {
      id: 'el-2',
      type: 'note',
      layerId: 'default',
      position: { x: 0, y: 0 },
      size: { w: 100, h: 100 },
    },
  ];

  const store = {
    getAll: vi.fn().mockReturnValue(elements),
  } as unknown as ElementStore;

  const renderer = {
    setCanvasSize: vi.fn(),
    isDomElement: vi.fn(
      (el: { type: string }) => el.type === 'note' || el.type === 'html' || el.type === 'text',
    ),
    renderCanvasElement: vi.fn(),
  } as unknown as ElementRenderer;

  const toolManager = {
    activeTool: null,
  } as unknown as ToolManager;

  const layerManager = {
    isLayerVisible: vi.fn().mockReturnValue(true),
  } as unknown as LayerManager;

  const domNodeManager = {
    syncDomNode: vi.fn(),
    hideDomNode: vi.fn(),
  } as unknown as DomNodeManager;

  const offCanvas = document.createElement('canvas');
  offCanvas.width = 800;
  offCanvas.height = 600;
  const offCtx = {
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    scale: vi.fn(),
    translate: vi.fn(),
    drawImage: vi.fn(),
  };

  const layerCache = {
    isDirty: vi.fn().mockReturnValue(true),
    markDirty: vi.fn(),
    markClean: vi.fn(),
    markAllDirty: vi.fn(),
    getCanvas: vi.fn().mockReturnValue(offCanvas),
    getContext: vi.fn().mockReturnValue(offCtx),
    resize: vi.fn(),
    clear: vi.fn(),
  } as unknown as LayerCache;

  return {
    canvasEl,
    camera,
    background,
    store,
    renderer,
    toolManager,
    layerManager,
    domNodeManager,
    layerCache,
  };
}

function mockCtx(): CanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    scale: vi.fn(),
    translate: vi.fn(),
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    setTransform: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

describe('RenderLoop', () => {
  let deps: ReturnType<typeof createMockDeps>;
  let renderLoop: RenderLoop;

  beforeAll(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(mockCtx() as never);
  });

  beforeEach(() => {
    deps = createMockDeps();
    renderLoop = new RenderLoop(deps);
  });

  it('requestRender marks as dirty', () => {
    renderLoop.requestRender();
    renderLoop.flush();
    expect(deps.background.render).toHaveBeenCalled();
  });

  it('flush does nothing when not dirty', () => {
    renderLoop.flush();
    expect(deps.background.render).not.toHaveBeenCalled();
  });

  it('renders background', () => {
    renderLoop.requestRender();
    renderLoop.flush();
    expect(deps.background.render).toHaveBeenCalledWith(expect.anything(), deps.camera);
  });

  it('calls renderCanvasElement for non-DOM elements', () => {
    renderLoop.requestRender();
    renderLoop.flush();
    expect(deps.renderer.renderCanvasElement).toHaveBeenCalled();
  });

  it('calls domNodeManager.syncDomNode for DOM elements', () => {
    renderLoop.requestRender();
    renderLoop.flush();
    expect(deps.domNodeManager.syncDomNode).toHaveBeenCalled();
  });

  it('calls domNodeManager.hideDomNode for invisible layer DOM elements', () => {
    vi.mocked(deps.layerManager.isLayerVisible).mockReturnValue(false);
    renderLoop.requestRender();
    renderLoop.flush();
    expect(deps.domNodeManager.hideDomNode).toHaveBeenCalledWith('el-2');
  });

  it('draws tool overlay when active tool has renderOverlay', () => {
    const renderOverlay = vi.fn();
    (deps.toolManager as { activeTool: unknown }).activeTool = { renderOverlay };
    renderLoop.requestRender();
    renderLoop.flush();
    expect(renderOverlay).toHaveBeenCalled();
  });

  it('setCanvasSize updates canvas buffer dimensions', () => {
    renderLoop.setCanvasSize(1600, 1200);
    expect(deps.canvasEl.width).toBe(1600);
    expect(deps.canvasEl.height).toBe(1200);
  });

  it('start and stop control the rAF loop', () => {
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    const cafSpy = vi.spyOn(window, 'cancelAnimationFrame').mockReturnValue(undefined);
    renderLoop.start();
    expect(rafSpy).toHaveBeenCalled();
    renderLoop.stop();
    expect(cafSpy).toHaveBeenCalled();
    rafSpy.mockRestore();
    cafSpy.mockRestore();
  });

  describe('viewport culling', () => {
    beforeEach(() => {
      Object.defineProperty(deps.canvasEl, 'clientWidth', { value: 800, configurable: true });
      Object.defineProperty(deps.canvasEl, 'clientHeight', { value: 600, configurable: true });
    });

    it('skips canvas elements outside the visible viewport', () => {
      const offScreenStroke = {
        id: 'off-1',
        type: 'stroke',
        layerId: 'default',
        position: { x: 5000, y: 5000 },
        points: [{ x: 0, y: 0, pressure: 1 }],
      };
      vi.mocked(deps.store.getAll).mockReturnValue([offScreenStroke] as never);

      renderLoop.requestRender();
      renderLoop.flush();

      expect(deps.renderer.renderCanvasElement).not.toHaveBeenCalled();
    });

    it('renders canvas elements inside the visible viewport', () => {
      const onScreenRect = {
        id: 'on-1',
        type: 'rectangle',
        layerId: 'default',
        position: { x: 50, y: 50 },
        size: { w: 100, h: 100 },
      };
      vi.mocked(deps.store.getAll).mockReturnValue([onScreenRect] as never);

      renderLoop.requestRender();
      renderLoop.flush();

      expect(deps.renderer.renderCanvasElement).toHaveBeenCalled();
    });

    it('hides DOM elements outside the visible viewport', () => {
      const offScreenNote = {
        id: 'off-note',
        type: 'note',
        layerId: 'default',
        position: { x: 5000, y: 5000 },
        size: { w: 200, h: 200 },
      };
      vi.mocked(deps.store.getAll).mockReturnValue([offScreenNote] as never);

      renderLoop.requestRender();
      renderLoop.flush();

      expect(deps.domNodeManager.hideDomNode).toHaveBeenCalledWith('off-note');
      expect(deps.domNodeManager.syncDomNode).not.toHaveBeenCalled();
    });

    it('always renders grid elements regardless of position', () => {
      const gridElement = {
        id: 'grid-1',
        type: 'grid',
        layerId: 'default',
        position: { x: 0, y: 0 },
      };
      vi.mocked(deps.store.getAll).mockReturnValue([gridElement] as never);

      renderLoop.requestRender();
      renderLoop.flush();

      expect(deps.renderer.renderCanvasElement).toHaveBeenCalled();
    });
  });

  describe('layer caching', () => {
    beforeEach(() => {
      Object.defineProperty(deps.canvasEl, 'clientWidth', { value: 800, configurable: true });
      Object.defineProperty(deps.canvasEl, 'clientHeight', { value: 600, configurable: true });
    });

    it('composites clean layers via drawImage instead of re-rendering', () => {
      vi.mocked(deps.layerCache.isDirty).mockReturnValue(false);
      const onScreenRect = {
        id: 'on-1',
        type: 'rectangle',
        layerId: 'default',
        position: { x: 50, y: 50 },
        size: { w: 100, h: 100 },
      };
      vi.mocked(deps.store.getAll).mockReturnValue([onScreenRect] as never);

      renderLoop.requestRender();
      renderLoop.flush();

      expect(deps.renderer.renderCanvasElement).not.toHaveBeenCalled();
      expect(deps.layerCache.getCanvas).toHaveBeenCalledWith('default');
    });

    it('re-renders dirty layers to offscreen canvas', () => {
      vi.mocked(deps.layerCache.isDirty).mockReturnValue(true);
      const onScreenRect = {
        id: 'on-1',
        type: 'rectangle',
        layerId: 'default',
        position: { x: 50, y: 50 },
        size: { w: 100, h: 100 },
      };
      vi.mocked(deps.store.getAll).mockReturnValue([onScreenRect] as never);

      renderLoop.requestRender();
      renderLoop.flush();

      expect(deps.layerCache.getContext).toHaveBeenCalledWith('default');
      expect(deps.renderer.renderCanvasElement).toHaveBeenCalled();
      expect(deps.layerCache.markClean).toHaveBeenCalledWith('default');
    });

    it('marks all layers dirty when zoom changes', () => {
      (deps.camera as { zoom: number }).zoom = 2;

      renderLoop.requestRender();
      renderLoop.flush();

      expect(deps.layerCache.markAllDirty).toHaveBeenCalled();
    });

    it('freezes active drawing layer by compositing cache', () => {
      vi.mocked(deps.layerCache.isDirty).mockReturnValue(true);
      renderLoop.setActiveDrawingLayer('default');

      const stroke = {
        id: 'stroke-1',
        type: 'stroke',
        layerId: 'default',
        position: { x: 0, y: 0 },
        points: [{ x: 0, y: 0, pressure: 1 }],
      };
      vi.mocked(deps.store.getAll).mockReturnValue([stroke] as never);

      renderLoop.requestRender();
      renderLoop.flush();

      expect(deps.renderer.renderCanvasElement).not.toHaveBeenCalled();
      expect(deps.layerCache.getCanvas).toHaveBeenCalledWith('default');
    });

    it('setCanvasSize resizes the layer cache', () => {
      renderLoop.setCanvasSize(1600, 1200);
      expect(deps.layerCache.resize).toHaveBeenCalled();
    });

    it('markLayerDirty delegates to layerCache', () => {
      renderLoop.markLayerDirty('layer1');
      expect(deps.layerCache.markDirty).toHaveBeenCalledWith('layer1');
    });

    it('markAllLayersDirty delegates to layerCache', () => {
      renderLoop.markAllLayersDirty();
      expect(deps.layerCache.markAllDirty).toHaveBeenCalled();
    });

    it('renders grid elements directly to main canvas, not through layer cache', () => {
      vi.mocked(deps.layerCache.isDirty).mockReturnValue(true);
      const gridElement = {
        id: 'grid-1',
        type: 'grid',
        layerId: 'default',
        position: { x: 0, y: 0 },
      };
      vi.mocked(deps.store.getAll).mockReturnValue([gridElement] as never);

      renderLoop.requestRender();
      renderLoop.flush();

      // Grid should be rendered directly, not sent to the offscreen layer cache
      expect(deps.renderer.renderCanvasElement).toHaveBeenCalled();
      expect(deps.layerCache.getContext).not.toHaveBeenCalled();
    });
  });
});
