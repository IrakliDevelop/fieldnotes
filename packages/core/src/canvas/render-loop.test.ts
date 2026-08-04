/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { RenderLoop } from './render-loop';
import { MarginViewport } from './margin-viewport';
import type { Camera } from './camera';
import type { Background } from './background';
import type { ElementStore } from '../elements/element-store';
import type { ElementRenderer } from '../elements/element-renderer';
import type { ToolManager } from '../tools/tool-manager';
import type { LayerManager } from '../layers/layer-manager';
import type { DomNodeManager } from './dom-node-manager';
import type { LayerCache } from './layer-cache';
import type { HybridRenderSurface } from './hybrid-render-surface';

function createMockDeps() {
  const canvasEl = document.createElement('canvas');

  const camera = {
    position: { x: 0, y: 0 },
    zoom: 1,
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
    getElementsByType: vi.fn().mockReturnValue([]),
  } as unknown as ElementStore;

  const renderer = {
    setCanvasSize: vi.fn(),
    isDomElement: vi.fn(
      (el: { type: string }) => el.type === 'note' || el.type === 'html' || el.type === 'text',
    ),
    renderCanvasElement: vi.fn(),
    setGridBoundsOverride: vi.fn(),
  } as unknown as ElementRenderer;

  const toolManager = {
    activeTool: null,
  } as unknown as ToolManager;

  const layerManager = {
    isLayerVisible: vi.fn().mockReturnValue(true),
    getLayer: vi.fn().mockReturnValue({ opacity: 1 }),
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

  const marginViewport = new MarginViewport(256);
  marginViewport.setViewport(800, 600, 1);

  const hybridSurface = {
    beginFrame: vi.fn(),
    getContext: vi.fn().mockReturnValue(mockCtx()),
  } as unknown as HybridRenderSurface;

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
    marginViewport,
    hybridSurface,
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

  it('places canvas content between DOM elements in matching paint strata', () => {
    vi.mocked(deps.store.getAll).mockReturnValue([
      {
        id: 'dom-low',
        type: 'note',
        layerId: 'default',
        position: { x: 0, y: 0 },
        size: { w: 10, h: 10 },
      },
      {
        id: 'canvas-middle',
        type: 'shape',
        layerId: 'default',
        position: { x: 0, y: 0 },
        size: { w: 10, h: 10 },
      },
      {
        id: 'canvas-middle-2',
        type: 'shape',
        layerId: 'default',
        position: { x: 0, y: 0 },
        size: { w: 10, h: 10 },
      },
      {
        id: 'dom-high',
        type: 'note',
        layerId: 'default',
        position: { x: 0, y: 0 },
        size: { w: 10, h: 10 },
      },
    ] as never);

    renderLoop.requestRender();
    renderLoop.flush();

    expect(deps.domNodeManager.syncDomNode).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: 'dom-low' }),
      1,
      1,
    );
    expect(deps.hybridSurface.beginFrame).toHaveBeenCalledWith(new Set([2]), 300, 150);
    expect(deps.hybridSurface.getContext).toHaveBeenCalledWith(2);
    expect(deps.domNodeManager.syncDomNode).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: 'dom-high' }),
      4,
      1,
    );
    expect(deps.hybridSurface.getContext).toHaveBeenCalledTimes(1);
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

  describe('registered overlays', () => {
    it('draws a registered overlay even when no tool is active', () => {
      const draw = vi.fn();
      renderLoop.registerOverlay(draw);
      renderLoop.flush(); // registerOverlay itself requests a render
      expect(draw).toHaveBeenCalledTimes(1);
    });

    it('draws registered overlays beneath the active tool overlay', () => {
      const order: string[] = [];
      const draw = vi.fn(() => order.push('registered'));
      const renderOverlay = vi.fn(() => order.push('tool'));
      (deps.toolManager as { activeTool: unknown }).activeTool = { renderOverlay };
      renderLoop.registerOverlay(draw);
      renderLoop.flush();
      expect(order).toEqual(['registered', 'tool']);
    });

    it('unsubscribe stops drawing, requests an erasing render, and is idempotent', () => {
      const draw = vi.fn();
      const unsubscribe = renderLoop.registerOverlay(draw);
      renderLoop.flush();
      expect(draw).toHaveBeenCalledTimes(1);

      unsubscribe();
      renderLoop.flush(); // erasing frame triggered by unsubscribe
      unsubscribe(); // second call is a no-op
      renderLoop.flush(); // no render pending — flush does nothing
      expect(draw).toHaveBeenCalledTimes(1);
      expect(deps.background.render).toHaveBeenCalledTimes(2);
    });

    it('isolates a throwing overlay from its siblings and the tool overlay', () => {
      const bad = vi.fn(() => {
        throw new Error('boom');
      });
      const good = vi.fn();
      const renderOverlay = vi.fn();
      (deps.toolManager as { activeTool: unknown }).activeTool = { renderOverlay };
      renderLoop.registerOverlay(bad);
      renderLoop.registerOverlay(good);
      renderLoop.flush();
      expect(good).toHaveBeenCalledTimes(1);
      expect(renderOverlay).toHaveBeenCalledTimes(1);
      // The next frame still renders (loop not wedged by the throw).
      renderLoop.requestRender();
      renderLoop.flush();
      expect(good).toHaveBeenCalledTimes(2);
    });

    it('routes registered overlays through the hybrid overlay stratum without a tool overlay', () => {
      vi.mocked(deps.store.getAll).mockReturnValue([
        {
          id: 'dom-low',
          type: 'note',
          layerId: 'default',
          position: { x: 0, y: 0 },
          size: { w: 10, h: 10 },
        },
        {
          id: 'canvas-top',
          type: 'shape',
          layerId: 'default',
          position: { x: 0, y: 0 },
          size: { w: 10, h: 10 },
        },
      ] as never);
      const draw = vi.fn();
      renderLoop.registerOverlay(draw);
      renderLoop.flush();
      // overlayOrder = visibleElements.length + 1 = 3 joins the strata set
      expect(deps.hybridSurface.beginFrame).toHaveBeenCalledWith(new Set([2, 3]), 300, 150);
      expect(deps.hybridSurface.getContext).toHaveBeenCalledWith(3);
      expect(draw).toHaveBeenCalledTimes(1);
    });
  });

  it('setCanvasSize updates canvas buffer dimensions', () => {
    const setViewportSpy = vi.spyOn(deps.marginViewport, 'setViewport');
    renderLoop.setCanvasSize(1600, 1200);
    expect(deps.canvasEl.width).toBe(1600);
    expect(deps.canvasEl.height).toBe(1200);
    expect(setViewportSpy).toHaveBeenCalledWith(1600, 1200, 1);
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

    it('renders a rotated canvas element whose visual bounds enter the viewport', () => {
      const rotatedShape = {
        id: 'rotated-canvas-edge',
        type: 'shape',
        layerId: 'default',
        position: { x: 1130, y: 100 },
        size: { w: 20, h: 200 },
        rotation: Math.PI / 2,
      };
      vi.mocked(deps.store.getAll).mockReturnValue([rotatedShape] as never);

      renderLoop.requestRender();
      renderLoop.flush();

      expect(deps.renderer.renderCanvasElement).toHaveBeenCalledWith(
        expect.anything(),
        rotatedShape,
      );
    });

    it('still culls a rotated canvas element whose visual bounds remain offscreen', () => {
      const rotatedShape = {
        id: 'rotated-canvas-offscreen',
        type: 'shape',
        layerId: 'default',
        position: { x: 5000, y: 5000 },
        size: { w: 20, h: 200 },
        rotation: Math.PI / 4,
      };
      vi.mocked(deps.store.getAll).mockReturnValue([rotatedShape] as never);

      renderLoop.requestRender();
      renderLoop.flush();

      expect(deps.renderer.renderCanvasElement).not.toHaveBeenCalled();
    });

    it('renders a rotated hybrid canvas stratum whose visual bounds enter the viewport', () => {
      const note = {
        id: 'dom-low',
        type: 'note',
        layerId: 'default',
        position: { x: 0, y: 0 },
        size: { w: 20, h: 20 },
      };
      const rotatedShape = {
        id: 'rotated-hybrid-edge',
        type: 'shape',
        layerId: 'default',
        position: { x: 1130, y: 100 },
        size: { w: 20, h: 200 },
        rotation: Math.PI / 2,
      };
      vi.mocked(deps.store.getAll).mockReturnValue([note, rotatedShape] as never);

      renderLoop.requestRender();
      renderLoop.flush();

      expect(deps.hybridSurface.getContext).toHaveBeenCalledWith(2);
      expect(deps.renderer.renderCanvasElement).toHaveBeenCalledWith(
        expect.anything(),
        rotatedShape,
      );
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

    it('syncs a rotated DOM element whose visual bounds enter the viewport', () => {
      const rotatedNote = {
        id: 'rotated-dom-edge',
        type: 'note',
        layerId: 'default',
        position: { x: 1130, y: 100 },
        size: { w: 20, h: 200 },
        rotation: -Math.PI / 2,
      };
      vi.mocked(deps.store.getAll).mockReturnValue([rotatedNote] as never);

      renderLoop.requestRender();
      renderLoop.flush();

      expect(deps.domNodeManager.syncDomNode).toHaveBeenCalledWith(rotatedNote, 1, 1);
      expect(deps.domNodeManager.hideDomNode).not.toHaveBeenCalledWith(rotatedNote.id);
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

    it('applies layer opacity while compositing the cached layer', () => {
      vi.mocked(deps.layerCache.isDirty).mockReturnValue(false);
      vi.mocked(deps.layerManager.getLayer).mockReturnValue({ opacity: 0.4 } as never);
      vi.mocked(deps.store.getAll).mockReturnValue([
        {
          id: 'on-1',
          type: 'rectangle',
          layerId: 'default',
          position: { x: 50, y: 50 },
          size: { w: 100, h: 100 },
        },
      ] as never);

      renderLoop.requestRender();
      renderLoop.flush();

      const mainCtx = deps.canvasEl.getContext('2d');
      expect(mainCtx?.globalAlpha).toBe(0.4);
      expect(mainCtx?.drawImage).toHaveBeenCalled();
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

    it('markAllLayersDirty invalidates the grid cache', () => {
      vi.mocked(deps.store.getAll).mockReturnValue([
        {
          id: 'grid-1',
          type: 'grid',
          layerId: 'default',
          position: { x: 0, y: 0 },
        },
      ] as never);
      renderLoop.requestRender();
      renderLoop.flush();
      vi.mocked(deps.renderer.renderCanvasElement).mockClear();

      renderLoop.markAllLayersDirty();
      renderLoop.requestRender();
      renderLoop.flush();

      expect(deps.renderer.renderCanvasElement).toHaveBeenCalled();
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

      expect(deps.renderer.renderCanvasElement).toHaveBeenCalled();
      expect(deps.layerCache.getContext).not.toHaveBeenCalled();
    });

    it('uses grid cache on second render with same params', () => {
      Object.defineProperty(deps.canvasEl, 'clientWidth', { value: 800, configurable: true });
      Object.defineProperty(deps.canvasEl, 'clientHeight', { value: 600, configurable: true });

      const gridElement = {
        id: 'grid-1',
        type: 'grid',
        layerId: 'default',
        position: { x: 0, y: 0 },
      };
      vi.mocked(deps.store.getAll).mockReturnValue([gridElement] as never);

      renderLoop.requestRender();
      renderLoop.flush();

      vi.mocked(deps.renderer.renderCanvasElement).mockClear();

      renderLoop.requestRender();
      renderLoop.flush();

      expect(deps.renderer.renderCanvasElement).not.toHaveBeenCalled();
    });

    it('does not re-render the grid on a within-margin pan (cache reused)', () => {
      Object.defineProperty(deps.canvasEl, 'clientWidth', { value: 800, configurable: true });
      Object.defineProperty(deps.canvasEl, 'clientHeight', { value: 600, configurable: true });

      const gridElement = {
        id: 'grid-1',
        type: 'grid',
        layerId: 'default',
        position: { x: 0, y: 0 },
      };
      vi.mocked(deps.store.getAll).mockReturnValue([gridElement] as never);
      vi.mocked(deps.store.getElementsByType).mockReturnValue([gridElement] as never);

      renderLoop.requestRender();
      renderLoop.flush();

      const gridRenders = (): number =>
        (deps.renderer.renderCanvasElement as ReturnType<typeof vi.fn>).mock.calls.filter(
          (c: unknown[]) => (c[1] as { type: string } | undefined)?.type === 'grid',
        ).length;
      const before = gridRenders();
      (deps.camera as { position: { x: number; y: number } }).position = { x: 80, y: 0 }; // < 256

      renderLoop.requestRender();
      renderLoop.flush();

      expect(gridRenders()).toBe(before); // grid composited from cache, not re-rendered
    });

    it('re-renders the grid on a pan beyond the margin (recenter)', () => {
      Object.defineProperty(deps.canvasEl, 'clientWidth', { value: 800, configurable: true });
      Object.defineProperty(deps.canvasEl, 'clientHeight', { value: 600, configurable: true });

      const gridElement = {
        id: 'grid-1',
        type: 'grid',
        layerId: 'default',
        position: { x: 0, y: 0 },
      };
      vi.mocked(deps.store.getAll).mockReturnValue([gridElement] as never);
      vi.mocked(deps.store.getElementsByType).mockReturnValue([gridElement] as never);

      renderLoop.requestRender();
      renderLoop.flush();

      const gridRenders = (): number =>
        (deps.renderer.renderCanvasElement as ReturnType<typeof vi.fn>).mock.calls.filter(
          (c: unknown[]) => (c[1] as { type: string } | undefined)?.type === 'grid',
        ).length;
      const before = gridRenders();
      (deps.camera as { position: { x: number; y: number } }).position = { x: 400, y: 0 }; // > 256

      renderLoop.requestRender();
      renderLoop.flush();

      expect(gridRenders()).toBeGreaterThan(before);
    });

    it('skips grid cache when grid element reference changes', () => {
      Object.defineProperty(deps.canvasEl, 'clientWidth', { value: 800, configurable: true });
      Object.defineProperty(deps.canvasEl, 'clientHeight', { value: 600, configurable: true });

      const grid1 = {
        id: 'grid-1',
        type: 'grid',
        layerId: 'default',
        position: { x: 0, y: 0 },
      };
      vi.mocked(deps.store.getAll).mockReturnValue([grid1] as never);

      renderLoop.requestRender();
      renderLoop.flush();
      vi.mocked(deps.renderer.renderCanvasElement).mockClear();

      const grid2 = { ...grid1 };
      vi.mocked(deps.store.getAll).mockReturnValue([grid2] as never);
      renderLoop.requestRender();
      renderLoop.flush();

      expect(deps.renderer.renderCanvasElement).toHaveBeenCalled();
    });

    it('invalidates the grid cache when a later grid element reference changes', () => {
      Object.defineProperty(deps.canvasEl, 'clientWidth', { value: 800, configurable: true });
      Object.defineProperty(deps.canvasEl, 'clientHeight', { value: 600, configurable: true });

      const grid1 = {
        id: 'grid-1',
        type: 'grid',
        layerId: 'default',
        position: { x: 0, y: 0 },
      };
      const grid2 = {
        id: 'grid-2',
        type: 'grid',
        layerId: 'default',
        position: { x: 0, y: 0 },
      };
      vi.mocked(deps.store.getAll).mockReturnValue([grid1, grid2] as never);

      renderLoop.requestRender();
      renderLoop.flush();
      vi.mocked(deps.renderer.renderCanvasElement).mockClear();

      vi.mocked(deps.store.getAll).mockReturnValue([grid1, { ...grid2 }] as never);
      renderLoop.requestRender();
      renderLoop.flush();

      expect(deps.renderer.renderCanvasElement).toHaveBeenCalledTimes(2);
    });

    it('invalidates the grid cache when the same grid reference is removed and re-added', () => {
      const grid = {
        id: 'grid-1',
        type: 'grid',
        layerId: 'default',
        position: { x: 0, y: 0 },
      };
      vi.mocked(deps.store.getAll).mockReturnValue([grid] as never);

      renderLoop.requestRender();
      renderLoop.flush();

      vi.mocked(deps.store.getAll).mockReturnValue([]);
      renderLoop.requestRender();
      renderLoop.flush();
      vi.mocked(deps.renderer.renderCanvasElement).mockClear();

      vi.mocked(deps.store.getAll).mockReturnValue([grid] as never);
      renderLoop.requestRender();
      renderLoop.flush();

      expect(deps.renderer.renderCanvasElement).toHaveBeenCalledWith(expect.anything(), grid);
    });

    it('sets gridBoundsOverride to margin-inflated world bounds before rendering grid into cache, then clears it', () => {
      Object.defineProperty(deps.canvasEl, 'clientWidth', { value: 800, configurable: true });
      Object.defineProperty(deps.canvasEl, 'clientHeight', { value: 600, configurable: true });

      const gridElement = {
        id: 'grid-1',
        type: 'grid',
        layerId: 'default',
        position: { x: 0, y: 0 },
      };
      vi.mocked(deps.store.getAll).mockReturnValue([gridElement] as never);

      // First flush causes a recenter (anchor at cam 0,0 zoom 1);
      // gridCacheDirty = true so the override must be set before rendering
      renderLoop.requestRender();
      renderLoop.flush();

      const setOverrideMock = deps.renderer.setGridBoundsOverride as ReturnType<typeof vi.fn>;
      // With anchor cam (0,0) zoom 1 and margin 256:
      // cachedWorldBounds.x = (-256 - 0) / 1 = -256
      const overrideCalls = setOverrideMock.mock.calls;
      const nonNullCall = overrideCalls.find((c: unknown[]) => c[0] !== null) as
        | [{ minX: number; minY: number; maxX: number; maxY: number }]
        | undefined;
      expect(nonNullCall).toBeDefined();
      expect(nonNullCall?.[0].minX).toBeLessThanOrEqual(-256);

      // After rendering into cache, override is cleared
      const lastCall = overrideCalls[overrideCalls.length - 1] as [unknown];
      expect(lastCall[0]).toBeNull();
    });

    it('falls back to direct render when grid cache context is unavailable', () => {
      Object.defineProperty(deps.canvasEl, 'clientWidth', { value: 800, configurable: true });
      Object.defineProperty(deps.canvasEl, 'clientHeight', { value: 600, configurable: true });

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

    it('handles null context from getContext gracefully', () => {
      Object.defineProperty(deps.canvasEl, 'clientWidth', { value: 800, configurable: true });
      Object.defineProperty(deps.canvasEl, 'clientHeight', { value: 600, configurable: true });

      vi.mocked(deps.layerCache.isDirty).mockReturnValue(true);
      vi.mocked(deps.layerCache.getContext).mockReturnValue(null);

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
    });

    it('hides DOM elements on invisible layers', () => {
      Object.defineProperty(deps.canvasEl, 'clientWidth', { value: 800, configurable: true });
      Object.defineProperty(deps.canvasEl, 'clientHeight', { value: 600, configurable: true });

      vi.mocked(deps.layerManager.isLayerVisible).mockReturnValue(false);

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
    });

    it('renders elements on multiple layers into separate caches', () => {
      Object.defineProperty(deps.canvasEl, 'clientWidth', { value: 800, configurable: true });
      Object.defineProperty(deps.canvasEl, 'clientHeight', { value: 600, configurable: true });

      vi.mocked(deps.layerCache.isDirty).mockReturnValue(true);
      vi.mocked(deps.layerManager.isLayerVisible).mockReturnValue(true);

      const el1 = {
        id: 'el-1',
        type: 'stroke',
        layerId: 'default',
        position: { x: 0, y: 0 },
        points: [{ x: 0, y: 0, pressure: 1 }],
      };
      const el2 = {
        id: 'el-2',
        type: 'stroke',
        layerId: 'layer-b',
        position: { x: 10, y: 10 },
        points: [{ x: 0, y: 0, pressure: 1 }],
      };
      vi.mocked(deps.store.getAll).mockReturnValue([el1, el2] as never);

      renderLoop.requestRender();
      renderLoop.flush();

      expect(deps.layerCache.getContext).toHaveBeenCalledWith('default');
      expect(deps.layerCache.getContext).toHaveBeenCalledWith('layer-b');
    });

    it('does NOT mark all layers dirty for a pan within the margin', () => {
      Object.defineProperty(deps.canvasEl, 'clientWidth', { value: 800, configurable: true });
      Object.defineProperty(deps.canvasEl, 'clientHeight', { value: 600, configurable: true });
      renderLoop.requestRender();
      renderLoop.flush(); // first frame recenters (sets anchor)
      (deps.layerCache.markAllDirty as ReturnType<typeof vi.fn>).mockClear();
      (deps.camera as { position: { x: number; y: number } }).position = { x: 100, y: 0 }; // < 256
      renderLoop.requestRender();
      renderLoop.flush();
      expect(deps.layerCache.markAllDirty).not.toHaveBeenCalled();
    });

    it('marks all layers dirty for a pan beyond the margin', () => {
      Object.defineProperty(deps.canvasEl, 'clientWidth', { value: 800, configurable: true });
      Object.defineProperty(deps.canvasEl, 'clientHeight', { value: 600, configurable: true });
      renderLoop.requestRender();
      renderLoop.flush();
      (deps.layerCache.markAllDirty as ReturnType<typeof vi.fn>).mockClear();
      (deps.camera as { position: { x: number; y: number } }).position = { x: 300, y: 0 }; // > 256
      renderLoop.requestRender();
      renderLoop.flush();
      expect(deps.layerCache.markAllDirty).toHaveBeenCalled();
    });

    it('does NOT re-render a clean layer on a within-margin pan (cache reused)', () => {
      Object.defineProperty(deps.canvasEl, 'clientWidth', { value: 800, configurable: true });
      Object.defineProperty(deps.canvasEl, 'clientHeight', { value: 600, configurable: true });
      (deps.layerCache.isDirty as ReturnType<typeof vi.fn>).mockReturnValue(false); // layer already cached/clean
      renderLoop.requestRender();
      renderLoop.flush(); // recenter frame
      (deps.layerCache.getContext as ReturnType<typeof vi.fn>).mockClear();
      (deps.camera as { position: { x: number; y: number } }).position = { x: 100, y: 0 }; // < 256
      renderLoop.requestRender();
      renderLoop.flush();
      expect(deps.layerCache.getContext).not.toHaveBeenCalled(); // composited from cache, no re-raster
    });

    it('invalidates all layer caches on a camera change but not on a static frame', () => {
      Object.defineProperty(deps.canvasEl, 'clientWidth', { value: 800, configurable: true });
      Object.defineProperty(deps.canvasEl, 'clientHeight', { value: 600, configurable: true });

      // seed last-frame camera state (this first frame recenters)
      renderLoop.requestRender();
      renderLoop.flush();
      (deps.layerCache.markAllDirty as ReturnType<typeof vi.fn>).mockClear();

      // camera changed (zoom) -> caches invalidated
      (deps.camera as { zoom: number }).zoom = 2;
      renderLoop.requestRender();
      renderLoop.flush();
      expect(deps.layerCache.markAllDirty).toHaveBeenCalled();

      // camera unchanged -> caches survive the static frame
      (deps.layerCache.markAllDirty as ReturnType<typeof vi.fn>).mockClear();
      renderLoop.requestRender();
      renderLoop.flush();
      expect(deps.layerCache.markAllDirty).not.toHaveBeenCalled();
    });
  });

  describe('render stats', () => {
    it('getStats returns a snapshot', () => {
      const stats = renderLoop.getStats();
      expect(stats).toHaveProperty('fps');
      expect(stats).toHaveProperty('avgFrameMs');
    });
  });
});
