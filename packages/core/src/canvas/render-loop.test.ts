/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, beforeAll, afterEach, vi } from 'vitest';
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
import { createRenderHooks } from './render-hooks';
import type { RenderHooks } from './render-hooks';
import { ElementStore as RealElementStore } from '../elements/element-store';
import { LayerManager as RealLayerManager } from '../layers/layer-manager';
import { LayerCache as RealLayerCache } from './layer-cache';
import { createNote, createShape } from '../elements/element-factory';
import type { ExtensionElementEnvelope } from '../elements/types';
import { createTestBoxRegistry } from '../test-helpers/test-box-type';

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
    isFullCanvasElement: vi.fn().mockReturnValue(false),
    renderCanvasElement: vi.fn(),
    renderExtensionWithBounds: vi.fn(),
  } as unknown as ElementRenderer;

  const toolManager = {
    activeTool: null,
  } as unknown as ToolManager;

  const layerManager = {
    isLayerVisible: vi.fn().mockReturnValue(true),
    getLayers: vi.fn().mockReturnValue([{ id: 'default', opacity: 1 }]),
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
    canvas: { width: 300, height: 150 },
  } as unknown as CanvasRenderingContext2D;
}

interface ClipState {
  clips: number;
  scale: number;
}

// A 2d context modelling the clip/scale state stack; reassigning its canvas width resets it.
function statefulCtx(canvas: { width: number; height: number } = { width: 300, height: 150 }) {
  let state: ClipState = { clips: 0, scale: 1 };
  const stack: ClipState[] = [];
  const fills: ClipState[] = [];
  let resets = 0;
  const reset = (): void => {
    resets++;
    state = { clips: 0, scale: 1 };
    stack.length = 0;
  };
  let width = canvas.width;
  Object.defineProperty(canvas, 'width', {
    configurable: true,
    get: () => width,
    set: (value: number) => {
      width = value;
      reset();
    },
  });
  const ctx = {
    ...mockCtx(),
    canvas,
    fillStyle: '',
    save: () => stack.push({ ...state }),
    restore: () => {
      state = stack.pop() ?? state;
    },
    rect: vi.fn(),
    clip: () => {
      state.clips++;
    },
    scale: (x: number) => {
      state.scale *= x;
    },
    setTransform: (a: number) => {
      state.scale = a;
    },
    fillRect: () => fills.push({ ...state }),
  } as unknown as CanvasRenderingContext2D;
  return {
    ctx,
    fills,
    depth: () => stack.length,
    state: () => ({ ...state }),
    resets: () => resets,
  };
}

function clipThenThrow(ctx: CanvasRenderingContext2D): never {
  ctx.save();
  ctx.rect(0, 0, 1, 1);
  ctx.clip();
  ctx.save();
  throw new Error('hook failed');
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

  describe('hybrid stratum layer opacity', () => {
    function recordingCtx(): {
      ctx: CanvasRenderingContext2D;
      drawImageAlphas: unknown[];
      drawImageArgs: unknown[][];
    } {
      const drawImageAlphas: unknown[] = [];
      const drawImageArgs: unknown[][] = [];
      const ctx = {
        globalAlpha: 1,
        save: vi.fn(),
        restore: vi.fn(),
        scale: vi.fn(),
        translate: vi.fn(),
        clearRect: vi.fn(),
        setTransform: vi.fn(),
        drawImage: vi.fn((...args: unknown[]) => {
          drawImageAlphas.push(ctx.globalAlpha);
          drawImageArgs.push(args);
        }),
      };
      return { ctx: ctx as unknown as CanvasRenderingContext2D, drawImageAlphas, drawImageArgs };
    }

    function hybridPair(): { note: unknown; canvasEl: unknown } {
      return {
        note: {
          id: 'dom-first',
          type: 'note',
          layerId: 'default',
          position: { x: 0, y: 0 },
          size: { w: 10, h: 10 },
        },
        canvasEl: {
          id: 'marker',
          type: 'html',
          layerId: 'default',
          position: { x: 0, y: 0 },
          size: { w: 10, h: 10 },
        },
      };
    }

    it('paints canvas-routed html at alpha 1 and composites the result at layer opacity', () => {
      // The painter contract (html-paint.ts) is that layer opacity is applied by the
      // SURFACE, never handed to the painter. Pre-multiplying on the hybrid context lets
      // any painter that assigns globalAlpha wipe the layer's opacity out, so the screen
      // would disagree with both exports and the minimap.
      const { note, canvasEl } = hybridPair();
      vi.mocked(deps.store.getAll).mockReturnValue([note, canvasEl] as never);
      vi.mocked(deps.renderer.isDomElement).mockImplementation(
        (el: { type: string }) => el.type === 'note',
      );
      vi.mocked(deps.layerManager.getLayers).mockReturnValue([
        { id: 'default', opacity: 0.5 },
      ] as never);
      const { ctx: hybridCtx, drawImageAlphas } = recordingCtx();
      vi.mocked(deps.hybridSurface.getContext).mockReturnValue(hybridCtx);
      const paintedAlphas: unknown[] = [];
      vi.mocked(deps.renderer.renderCanvasElement).mockImplementation(
        (ctx: CanvasRenderingContext2D, el: { type: string }) => {
          if (el.type === 'html') paintedAlphas.push(ctx.globalAlpha);
        },
      );

      renderLoop.requestRender();
      renderLoop.flush();

      expect(paintedAlphas).toEqual([1]);
      expect(drawImageAlphas).toEqual([0.5]);
    });

    it('leaves every non-html hybrid element pre-multiplied by layer opacity', () => {
      // Pre-existing behaviour for shapes/strokes/images: unchanged by the html carve-out.
      const { note } = hybridPair();
      const shape = {
        id: 'shape',
        type: 'shape',
        layerId: 'default',
        position: { x: 0, y: 0 },
        size: { w: 10, h: 10 },
      };
      vi.mocked(deps.store.getAll).mockReturnValue([note, shape] as never);
      vi.mocked(deps.renderer.isDomElement).mockImplementation(
        (el: { type: string }) => el.type === 'note',
      );
      vi.mocked(deps.layerManager.getLayers).mockReturnValue([
        { id: 'default', opacity: 0.5 },
      ] as never);
      const { ctx: hybridCtx, drawImageAlphas } = recordingCtx();
      vi.mocked(deps.hybridSurface.getContext).mockReturnValue(hybridCtx);
      const paintedAlphas: unknown[] = [];
      vi.mocked(deps.renderer.renderCanvasElement).mockImplementation(
        (ctx: CanvasRenderingContext2D, el: { type: string }) => {
          if (el.type === 'shape') paintedAlphas.push(ctx.globalAlpha);
        },
      );

      renderLoop.requestRender();
      renderLoop.flush();

      expect(paintedAlphas).toEqual([0.5]);
      expect(drawImageAlphas).toEqual([]); // no scratch composite for non-html
    });

    it('draws canvas-routed html straight through on a fully opaque layer', () => {
      const { note, canvasEl } = hybridPair();
      vi.mocked(deps.store.getAll).mockReturnValue([note, canvasEl] as never);
      vi.mocked(deps.renderer.isDomElement).mockImplementation(
        (el: { type: string }) => el.type === 'note',
      );
      vi.mocked(deps.layerManager.getLayers).mockReturnValue([
        { id: 'default', opacity: 1 },
      ] as never);
      const { ctx: hybridCtx, drawImageAlphas } = recordingCtx();
      vi.mocked(deps.hybridSurface.getContext).mockReturnValue(hybridCtx);
      const targets: unknown[] = [];
      vi.mocked(deps.renderer.renderCanvasElement).mockImplementation(
        (ctx: CanvasRenderingContext2D, el: { type: string }) => {
          if (el.type === 'html') targets.push(ctx);
        },
      );

      renderLoop.requestRender();
      renderLoop.flush();

      expect(targets).toEqual([hybridCtx]); // cheap path: no scratch canvas at all
      expect(drawImageAlphas).toEqual([]);
    });

    it('sizes the html scratch to the element rect under pan, zoom and dpr', () => {
      // The scratch covers only the element's own device-pixel rect, the way export-svg's
      // rasterizeCanvasRoutedHtml sizes its offscreen to the element rather than the export
      // bounds. That is exact rather than approximate because paintHtmlElement clips every
      // painter to the element's rect. The offset is whole device pixels and the blit is
      // 1:1, so the raster lands on exactly the pixels a full-canvas scratch would have used.
      const { note } = hybridPair();
      const marker = {
        id: 'marker',
        type: 'html',
        layerId: 'default',
        position: { x: 10, y: 20 },
        size: { w: 10, h: 10 },
      };
      const camera = deps.camera as unknown as { position: { x: number; y: number }; zoom: number };
      camera.position.x = 30;
      camera.position.y = 40;
      camera.zoom = 2;
      vi.mocked(deps.store.getAll).mockReturnValue([note, marker] as never);
      vi.mocked(deps.renderer.isDomElement).mockImplementation(
        (el: { type: string }) => el.type === 'note',
      );
      vi.mocked(deps.layerManager.getLayers).mockReturnValue([
        { id: 'default', opacity: 0.5 },
      ] as never);
      const { ctx: hybridCtx, drawImageArgs } = recordingCtx();
      vi.mocked(deps.hybridSurface.getContext).mockReturnValue(hybridCtx);
      // Every canvas in this file shares one mocked 2D context, so the scratch context is
      // reachable through canvasEl; clear it so only this frame's calls are asserted.
      const scratchCtx = deps.canvasEl.getContext('2d');
      if (!scratchCtx) throw new Error('expected the mocked 2D context');
      vi.mocked(scratchCtx.translate).mockClear();

      renderLoop.requestRender();
      renderLoop.flush();

      // world x 10..20 -> css (x*2 + 30) = 50..70 -> device 50..70 at dpr 1;
      // world y 20..30 -> css (y*2 + 40) = 80..100 -> device 80..100.
      expect(drawImageArgs).toEqual([[expect.anything(), 0, 0, 20, 20, 50, 80, 20, 20]]);
      // The scratch origin shift must PAIR with that destination, or the raster lands in
      // the wrong place; nothing else on this frame translates by a negative offset.
      expect(scratchCtx.translate).toHaveBeenCalledWith(-50, -80);
    });

    it('never hands a zero-dimension surface to drawImage when the canvas has no pixels', () => {
      // A host that hides the viewport (a tab panel going display:none) drives
      // canvasEl.width/height to 0 through the ResizeObserver -> syncCanvasSize path, and
      // that same path requests a render. Culling does NOT go degenerate with it: the
      // margin viewport's cached world band is (cssW + 2*256)/zoom, so a marker near the
      // camera still survives and the translucent-layer html branch still runs. Per the
      // spec's "check the usability of the image argument", a CANVAS source with a zero
      // width or height throws InvalidStateError (unlike an image source, which no-ops) —
      // and an exception escaping render() never reaches requestAnimationFrame(loop) in
      // start(), so the viewport would stop rendering for the rest of the session.
      const { note, canvasEl } = hybridPair();
      vi.mocked(deps.store.getAll).mockReturnValue([note, canvasEl] as never);
      vi.mocked(deps.renderer.isDomElement).mockImplementation(
        (el: { type: string }) => el.type === 'note',
      );
      vi.mocked(deps.layerManager.getLayers).mockReturnValue([
        { id: 'default', opacity: 0.5 },
      ] as never);
      const { ctx: hybridCtx, drawImageAlphas, drawImageArgs } = recordingCtx();
      vi.mocked(deps.hybridSurface.getContext).mockReturnValue(hybridCtx);

      deps.canvasEl.width = 0;
      deps.canvasEl.height = 0;
      renderLoop.requestRender();
      renderLoop.flush();

      const degenerate = drawImageArgs.filter((args) => {
        const source = args[0] as { width?: number; height?: number } | undefined;
        const sourceW = args[3];
        const sourceH = args[4];
        return (
          !(typeof source?.width === 'number' && source.width >= 1) ||
          !(typeof source?.height === 'number' && source.height >= 1) ||
          (typeof sourceW === 'number' && sourceW < 1) ||
          (typeof sourceH === 'number' && sourceH < 1)
        );
      });
      expect(degenerate).toEqual([]);

      // Guard against passing vacuously: the very same setup at a real canvas size must
      // still reach the scratch composite, so "no degenerate drawImage" above is the guard
      // firing and not the branch quietly never running.
      deps.canvasEl.width = 300;
      deps.canvasEl.height = 150;
      renderLoop.requestRender();
      renderLoop.flush();
      expect(drawImageAlphas).toEqual([0.5]);
    });
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

  describe('overlay stratum', () => {
    function loopWithOverlayHook(overlay: ReturnType<typeof vi.fn>): RenderLoop {
      const hooks: RenderHooks = createRenderHooks();
      hooks.viewport.register({ overlay });
      return new RenderLoop({ ...deps, hooks });
    }

    it('runs overlay hooks before the active tool overlay', () => {
      const order: string[] = [];
      const overlay = vi.fn(() => order.push('hook'));
      const renderOverlay = vi.fn(() => order.push('tool'));
      (deps.toolManager as { activeTool: unknown }).activeTool = { renderOverlay };
      const loop = loopWithOverlayHook(overlay);
      loop.requestRender();
      loop.flush();
      expect(order).toEqual(['hook', 'tool']);
    });

    it('routes overlay hooks through the hybrid overlay stratum without a tool overlay', () => {
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
      const overlay = vi.fn();
      const loop = loopWithOverlayHook(overlay);
      loop.requestRender();
      loop.flush();
      // overlayOrder = visibleElements.length + 1 = 3 joins the strata set
      expect(deps.hybridSurface.beginFrame).toHaveBeenCalledWith(new Set([2, 3]), 300, 150);
      expect(deps.hybridSurface.getContext).toHaveBeenCalledWith(3);
      expect(overlay).toHaveBeenCalledTimes(1);
    });

    it('overlay stratum exists without hybrid content', () => {
      const baseCtx = mockCtx();
      const getContextSpy = vi
        .spyOn(HTMLCanvasElement.prototype, 'getContext')
        .mockReturnValue(baseCtx as never);
      const stratumCtx = mockCtx();
      vi.mocked(deps.hybridSurface.getContext).mockReturnValue(stratumCtx);
      const renderOverlay = vi.fn();
      (deps.toolManager as { activeTool: unknown }).activeTool = { renderOverlay };
      try {
        renderLoop.requestRender();
        renderLoop.flush();
        // stroke + note, no canvas content above the note: the overlay alone is order 3
        expect(deps.hybridSurface.beginFrame).toHaveBeenCalledWith(new Set([3]), 300, 150);
        expect(deps.hybridSurface.getContext).toHaveBeenCalledWith(3);
        expect(renderOverlay).toHaveBeenCalledTimes(1);
        expect(renderOverlay).toHaveBeenCalledWith(stratumCtx);
        expect(renderOverlay).not.toHaveBeenCalledWith(baseCtx);
      } finally {
        getContextSpy.mockReturnValue(mockCtx() as never);
      }
    });

    it('overlay-only frame does not touch the base canvas or layer caches', () => {
      vi.mocked(deps.store.getAll).mockReturnValue([
        {
          id: 'stroke',
          type: 'stroke',
          layerId: 'default',
          position: { x: 0, y: 0 },
          points: [{ x: 0, y: 0, pressure: 1 }],
        },
        { id: 'grid', type: 'grid', layerId: 'default', position: { x: 0, y: 0 } },
      ] as never);
      vi.mocked(deps.renderer.isFullCanvasElement).mockImplementation(
        (el: { type: string }) => el.type === 'grid',
      );
      const overlay = vi.fn();
      const renderOverlay = vi.fn();
      (deps.toolManager as { activeTool: unknown }).activeTool = { renderOverlay };
      const loop = loopWithOverlayHook(overlay);
      loop.requestRender();
      loop.flush();
      expect(deps.background.render).toHaveBeenCalledTimes(1);
      expect(deps.layerCache.getCanvas).toHaveBeenCalled();
      expect(deps.renderer.renderExtensionWithBounds).toHaveBeenCalledTimes(1);
      vi.mocked(deps.layerCache.getCanvas).mockClear();
      vi.mocked(deps.layerCache.isDirty).mockClear();

      loop.requestOverlayRender();
      loop.flush();

      expect(deps.background.render).toHaveBeenCalledTimes(1);
      expect(deps.layerCache.isDirty).not.toHaveBeenCalled();
      expect(deps.layerCache.getCanvas).not.toHaveBeenCalled();
      expect(deps.renderer.renderExtensionWithBounds).toHaveBeenCalledTimes(1);
      expect(overlay).toHaveBeenCalledTimes(2);
      expect(renderOverlay).toHaveBeenCalledTimes(2);
    });

    it('overlay-only request before any full frame renders a full frame', () => {
      const renderOverlay = vi.fn();
      (deps.toolManager as { activeTool: unknown }).activeTool = { renderOverlay };
      renderLoop.requestOverlayRender();
      renderLoop.flush();
      expect(deps.background.render).toHaveBeenCalledTimes(1);
      expect(renderOverlay).toHaveBeenCalledTimes(1);
    });

    it('a pending full render wins over a pending overlay render', () => {
      const renderOverlay = vi.fn();
      (deps.toolManager as { activeTool: unknown }).activeTool = { renderOverlay };
      renderLoop.requestRender();
      renderLoop.flush();
      renderLoop.requestRender();
      renderLoop.requestOverlayRender();
      renderLoop.flush();
      renderLoop.flush();
      expect(deps.background.render).toHaveBeenCalledTimes(2);
      expect(renderOverlay).toHaveBeenCalledTimes(2);
    });

    it('overlay hook runs in world space', () => {
      vi.stubGlobal('devicePixelRatio', 2);
      (deps.camera as { position: { x: number; y: number }; zoom: number }).position = {
        x: 10,
        y: 20,
      };
      (deps.camera as { zoom: number }).zoom = 3;
      // Axis-aligned transform model: [scale, translateX, translateY].
      let m: [number, number, number] = [1, 0, 0];
      const stack: [number, number, number][] = [];
      const stratumCtx = {
        ...mockCtx(),
        save: () => stack.push([...m]),
        restore: () => {
          m = stack.pop() ?? m;
        },
        scale: (s: number) => {
          m = [m[0] * s, m[1], m[2]];
        },
        translate: (x: number, y: number) => {
          m = [m[0], m[1] + m[0] * x, m[2] + m[0] * y];
        },
      } as unknown as CanvasRenderingContext2D;
      vi.mocked(deps.hybridSurface.getContext).mockReturnValue(stratumCtx);
      const seen: [number, number, number][] = [];
      const loop = loopWithOverlayHook(vi.fn(() => seen.push([...m])));
      try {
        loop.requestRender();
        loop.flush();
        loop.requestOverlayRender();
        loop.flush();
        expect(seen).toEqual([
          [6, 20, 40],
          [6, 20, 40],
        ]);
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  it('setCanvasSize updates canvas buffer dimensions', () => {
    const setViewportSpy = vi.spyOn(deps.marginViewport, 'setViewport');
    renderLoop.setCanvasSize(1600, 1200);
    expect(deps.canvasEl.width).toBe(1600);
    expect(deps.canvasEl.height).toBe(1200);
    expect(setViewportSpy).toHaveBeenCalledWith(1600, 1200, 1);
  });

  it('setCanvasSize clamps the buffer to at least 1x1 and rounds fractional sizes', () => {
    renderLoop.setCanvasSize(0, 0);
    expect(deps.canvasEl.width).toBe(1);
    expect(deps.canvasEl.height).toBe(1);
    renderLoop.setCanvasSize(0.4, 333.6);
    expect(deps.canvasEl.width).toBe(1);
    expect(deps.canvasEl.height).toBe(334);
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

  describe('frame loop resilience', () => {
    // Drives the rAF loop by hand: each call runs one scheduled frame.
    function captureFrames() {
      const frames: FrameRequestCallback[] = [];
      const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        frames.push(cb);
        return frames.length;
      });
      const runFrame = (loop: RenderLoop): void => {
        loop.requestRender();
        const next = frames.shift();
        if (!next) throw new Error('loop stopped scheduling frames');
        next(0);
      };
      return { frames, rafSpy, runFrame };
    }

    // A 2d context that tracks its save-stack depth, the way a real context does.
    function depthCtx(): CanvasRenderingContext2D & { depth: number } {
      const ctx = {
        ...mockCtx(),
        depth: 0,
        save: vi.fn(() => {
          ctx.depth++;
        }),
        restore: vi.fn(() => {
          if (ctx.depth > 0) ctx.depth--;
        }),
      };
      return ctx as unknown as CanvasRenderingContext2D & { depth: number };
    }

    let reportSpy: ReturnType<typeof vi.fn>;
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      reportSpy = vi.fn();
      vi.stubGlobal('reportError', reportSpy);
      errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      errorSpy.mockRestore();
    });

    it('keeps scheduling frames after render() throws and renders the next frame', () => {
      const { frames, rafSpy, runFrame } = captureFrames();
      const bgRender = deps.background.render as ReturnType<typeof vi.fn>;
      bgRender.mockImplementationOnce(() => {
        throw new DOMException('zero-size source', 'InvalidStateError');
      });
      try {
        renderLoop.start();
        runFrame(renderLoop);
        expect(frames).toHaveLength(1);
        expect(reportSpy).toHaveBeenCalledTimes(1);

        runFrame(renderLoop);
        expect(bgRender).toHaveBeenCalledTimes(2);
        expect(frames).toHaveLength(1);
      } finally {
        renderLoop.stop();
        rafSpy.mockRestore();
      }
    });

    it('reports a persistently failing render once, not every frame', () => {
      const { frames, rafSpy, runFrame } = captureFrames();
      (deps.background.render as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('boom');
      });
      try {
        renderLoop.start();
        for (let i = 0; i < 5; i++) runFrame(renderLoop);
        expect(frames).toHaveLength(1);
        expect(reportSpy).toHaveBeenCalledTimes(1);
      } finally {
        renderLoop.stop();
        rafSpy.mockRestore();
      }
    });

    it('reports again after a successful frame ends the failure streak', () => {
      const { rafSpy, runFrame } = captureFrames();
      const first = new Error('first');
      const second = new Error('second');
      const bgRender = deps.background.render as ReturnType<typeof vi.fn>;
      bgRender
        .mockImplementationOnce(() => {
          throw first;
        })
        .mockImplementationOnce(() => undefined)
        .mockImplementationOnce(() => {
          throw second;
        });
      try {
        renderLoop.start();
        runFrame(renderLoop);
        runFrame(renderLoop);
        runFrame(renderLoop);
        expect(reportSpy).toHaveBeenCalledTimes(2);
        expect(reportSpy).toHaveBeenNthCalledWith(1, first);
        expect(reportSpy).toHaveBeenNthCalledWith(2, second);
      } finally {
        renderLoop.stop();
        rafSpy.mockRestore();
      }
    });

    it('routes the error through reportError so host error monitoring sees it', () => {
      const { rafSpy, runFrame } = captureFrames();
      const error = new Error('boom');
      (deps.background.render as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
        throw error;
      });
      try {
        renderLoop.start();
        runFrame(renderLoop);
        expect(reportSpy).toHaveBeenCalledWith(error);
        expect(errorSpy).not.toHaveBeenCalled();
      } finally {
        renderLoop.stop();
        rafSpy.mockRestore();
      }
    });

    it('falls back to console.error when reportError is unavailable', () => {
      vi.stubGlobal('reportError', undefined);
      const { rafSpy, runFrame } = captureFrames();
      const error = new Error('boom');
      (deps.background.render as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
        throw error;
      });
      try {
        renderLoop.start();
        runFrame(renderLoop);
        expect(errorSpy).toHaveBeenCalledTimes(1);
        expect(errorSpy).toHaveBeenCalledWith('[fieldnotes] render failed', error);
      } finally {
        renderLoop.stop();
        rafSpy.mockRestore();
      }
    });

    it('unwinds the main context save stack when a beforeElements hook throws', () => {
      const ctx = depthCtx();
      const getContextSpy = vi
        .spyOn(HTMLCanvasElement.prototype, 'getContext')
        .mockReturnValue(ctx as never);
      const depthAtBackground: number[] = [];
      (deps.background.render as ReturnType<typeof vi.fn>).mockImplementation(() => {
        depthAtBackground.push(ctx.depth);
      });
      const hooks: RenderHooks = createRenderHooks();
      let shouldThrow = false;
      hooks.viewport.register({
        beforeElements: () => {
          if (shouldThrow) throw new Error('hook failed');
        },
      });
      const loop = new RenderLoop({ ...deps, hooks });
      const { rafSpy, runFrame } = captureFrames();
      try {
        loop.start();
        runFrame(loop); // clean frame
        expect(ctx.depth).toBe(0);
        shouldThrow = true;
        runFrame(loop); // throwing frame
        expect(ctx.depth).toBe(0);
        shouldThrow = false;
        runFrame(loop); // recovered frame
        expect(ctx.depth).toBe(0);
        // The recovered frame starts from the same state as the clean one.
        expect(depthAtBackground).toEqual([1, 1, 1]);
      } finally {
        loop.stop();
        rafSpy.mockRestore();
        getContextSpy.mockReturnValue(mockCtx() as never);
      }
    });

    it('unwinds a hybrid stratum context when an afterElements hook throws', () => {
      const hookCtx = depthCtx();
      vi.mocked(deps.hybridSurface.getContext).mockReturnValue(hookCtx);
      const hooks: RenderHooks = createRenderHooks();
      hooks.viewport.register({
        afterElements: () => {
          throw new Error('fog failed');
        },
      });
      const loop = new RenderLoop({ ...deps, hooks });
      const { rafSpy, runFrame } = captureFrames();
      try {
        loop.start();
        runFrame(loop);
        expect(hookCtx.depth).toBe(0);
        runFrame(loop);
        expect(hookCtx.depth).toBe(0);
      } finally {
        loop.stop();
        rafSpy.mockRestore();
      }
    });

    it('unwinds the main and overlay stratum saves when a tool overlay throws', () => {
      const ctx = depthCtx();
      const getContextSpy = vi
        .spyOn(HTMLCanvasElement.prototype, 'getContext')
        .mockReturnValue(ctx as never);
      const stratumCtx = depthCtx();
      vi.mocked(deps.hybridSurface.getContext).mockReturnValue(stratumCtx);
      const depthAtBackground: number[] = [];
      (deps.background.render as ReturnType<typeof vi.fn>).mockImplementation(() => {
        depthAtBackground.push(ctx.depth);
      });
      const depthAtOverlay: number[][] = [];
      let shouldThrow = true;
      (deps.toolManager as { activeTool: unknown }).activeTool = {
        renderOverlay: (overlayCtx: unknown) => {
          // The overlay draws on its own stratum while the main canvas holds both frame saves.
          expect(overlayCtx).toBe(stratumCtx);
          depthAtOverlay.push([ctx.depth, stratumCtx.depth]);
          if (shouldThrow) throw new Error('overlay failed');
        },
      };
      const loop = new RenderLoop(deps);
      const { rafSpy, runFrame } = captureFrames();
      try {
        loop.start();
        runFrame(loop); // throwing frame
        expect(depthAtOverlay).toEqual([[2, 1]]);
        expect(ctx.depth).toBe(0);
        expect(stratumCtx.depth).toBe(0);
        shouldThrow = false;
        runFrame(loop); // recovered frame
        expect(ctx.depth).toBe(0);
        expect(stratumCtx.depth).toBe(0);
        expect(depthAtBackground).toEqual([1, 1]);
        expect(depthAtOverlay).toEqual([
          [2, 1],
          [2, 1],
        ]);
      } finally {
        loop.stop();
        rafSpy.mockRestore();
        getContextSpy.mockReturnValue(mockCtx() as never);
      }
    });

    it('a re-entrant flush that throws unwinds only its own saves, not the outer frame', () => {
      const ctx = depthCtx();
      const getContextSpy = vi
        .spyOn(HTMLCanvasElement.prototype, 'getContext')
        .mockReturnValue(ctx as never);
      (deps.background.render as ReturnType<typeof vi.fn>)
        .mockImplementationOnce(() => undefined)
        .mockImplementationOnce(() => {
          throw new Error('inner failed');
        });
      const hooks: RenderHooks = createRenderHooks();
      const loop = new RenderLoop({ ...deps, hooks });
      let innerError: unknown;
      hooks.viewport.register({
        beforeElements: () => {
          try {
            loop.requestRender();
            loop.flush();
          } catch (error) {
            innerError = error;
          }
        },
      });
      const depthAtOverlay: number[] = [];
      (deps.toolManager as { activeTool: unknown }).activeTool = {
        renderOverlay: () => {
          depthAtOverlay.push(ctx.depth);
        },
      };
      try {
        loop.requestRender();
        loop.flush();
        expect(innerError).toEqual(new Error('inner failed'));
        // The outer frame still holds both of its saves when it reaches the overlay.
        expect(depthAtOverlay).toEqual([2]);
        expect(ctx.depth).toBe(0);
      } finally {
        getContextSpy.mockReturnValue(mockCtx() as never);
      }
    });

    it('leaves contexts balanced when flush() throws, and still rethrows to the caller', () => {
      const ctx = depthCtx();
      const getContextSpy = vi
        .spyOn(HTMLCanvasElement.prototype, 'getContext')
        .mockReturnValue(ctx as never);
      (deps.toolManager as { activeTool: unknown }).activeTool = {
        renderOverlay: () => {
          throw new Error('overlay failed');
        },
      };
      try {
        renderLoop.requestRender();
        expect(() => renderLoop.flush()).toThrow('overlay failed');
        expect(ctx.depth).toBe(0);
      } finally {
        getContextSpy.mockReturnValue(mockCtx() as never);
      }
    });

    it('resets the main context and re-renders after a beforeElements hook clips then throws', () => {
      vi.stubGlobal('devicePixelRatio', 2);
      const main = statefulCtx(deps.canvasEl);
      const getContextSpy = vi
        .spyOn(HTMLCanvasElement.prototype, 'getContext')
        .mockReturnValue(main.ctx as never);
      const atBackground: ClipState[] = [];
      (deps.background.render as ReturnType<typeof vi.fn>).mockImplementation(() => {
        atBackground.push(main.state());
      });
      const hooks: RenderHooks = createRenderHooks();
      hooks.viewport.register({ beforeElements: clipThenThrow });
      const loop = new RenderLoop({ ...deps, hooks });
      try {
        loop.requestRender();
        loop.flush();
        loop.flush();
        expect(atBackground).toEqual([
          { clips: 0, scale: 2 },
          { clips: 0, scale: 2 },
        ]);
        expect(main.depth()).toBe(0);
      } finally {
        getContextSpy.mockReturnValue(mockCtx() as never);
      }
    });

    it('runs a full frame for an overlay request after an aborted frame left a stale canvas', () => {
      const hooks: RenderHooks = createRenderHooks();
      hooks.viewport.register({ beforeElements: clipThenThrow });
      let shouldThrow = true;
      const renderOverlay = vi.fn(() => {
        if (shouldThrow) throw new Error('overlay failed');
      });
      (deps.toolManager as { activeTool: unknown }).activeTool = { renderOverlay };
      const loop = new RenderLoop({ ...deps, hooks });
      loop.requestRender();
      expect(() => loop.flush()).toThrow('overlay failed');
      shouldThrow = false;
      loop.requestOverlayRender();
      loop.flush();
      expect(deps.background.render).toHaveBeenCalledTimes(2);
    });

    it('keeps rendering the frame when an afterElements hook throws, reporting it once', () => {
      const { rafSpy, runFrame } = captureFrames();
      const hooks: RenderHooks = createRenderHooks();
      hooks.viewport.register({
        afterElements: () => {
          throw new Error('fog failed');
        },
      });
      const afterAll = vi.fn();
      hooks.viewport.register({ afterAll });
      const renderOverlay = vi.fn();
      (deps.toolManager as { activeTool: unknown }).activeTool = { renderOverlay };
      const loop = new RenderLoop({ ...deps, hooks });
      try {
        loop.start();
        runFrame(loop);
        runFrame(loop);
        expect(afterAll).toHaveBeenCalledTimes(2);
        expect(renderOverlay).toHaveBeenCalledTimes(2);
        expect(reportSpy).toHaveBeenCalledTimes(1);
        expect(reportSpy).toHaveBeenCalledWith(new Error('fog failed'));
      } finally {
        loop.stop();
        rafSpy.mockRestore();
      }
    });
  });

  describe('fail-closed mask', () => {
    function stratumContexts(): Map<number, CanvasRenderingContext2D & { fillStyle: string }> {
      const contexts = new Map<number, CanvasRenderingContext2D & { fillStyle: string }>();
      vi.mocked(deps.hybridSurface.getContext).mockImplementation((order: number) => {
        let ctx = contexts.get(order);
        if (!ctx) {
          const fillRect = vi.fn(() => {
            fillStyles.push(ctx?.fillStyle ?? '');
          });
          const fillStyles: string[] = [];
          ctx = { ...mockCtx(), fillStyle: '', fillRect, fillStyles } as never;
          contexts.set(order, ctx as CanvasRenderingContext2D & { fillStyle: string });
        }
        return ctx as CanvasRenderingContext2D;
      });
      return contexts;
    }

    beforeEach(() => {
      Object.defineProperty(deps.canvasEl, 'clientWidth', { value: 640, configurable: true });
      Object.defineProperty(deps.canvasEl, 'clientHeight', { value: 480, configurable: true });
    });

    it('fills the afterElements stratum opaque when a required capability is missing', () => {
      const contexts = stratumContexts();
      const hooks: RenderHooks = createRenderHooks();
      hooks.viewport.setRequiredCapabilities(['x']);
      const afterAll = vi.fn();
      hooks.viewport.register({ afterAll });
      const loop = new RenderLoop({ ...deps, hooks });

      loop.requestRender();
      loop.flush();

      // Two visible elements: afterElements is order 3, afterAll order 5.
      expect(deps.hybridSurface.beginFrame).toHaveBeenCalledWith(new Set([3, 5]), 300, 150);
      const stratum = contexts.get(3) as unknown as {
        fillRect: ReturnType<typeof vi.fn>;
        fillStyles: string[];
      };
      expect(stratum.fillRect).toHaveBeenCalledWith(0, 0, 640, 480);
      expect(stratum.fillStyles).toEqual(['#000']);
      expect(afterAll).toHaveBeenCalledTimes(1);
    });

    it('draws no mask when the required capability has an enabled satisfier', () => {
      const contexts = stratumContexts();
      const hooks: RenderHooks = createRenderHooks();
      hooks.viewport.setRequiredCapabilities(['x']);
      hooks.viewport.register({ afterElements: vi.fn() }, { satisfies: ['x'] });
      const loop = new RenderLoop({ ...deps, hooks });

      loop.requestRender();
      loop.flush();

      const stratum = contexts.get(3) as unknown as { fillRect: ReturnType<typeof vi.fn> };
      expect(stratum.fillRect).not.toHaveBeenCalled();
    });

    it('requests no further frame after a healthy frame with hooks registered', () => {
      stratumContexts();
      const hooks: RenderHooks = createRenderHooks();
      hooks.viewport.setRequiredCapabilities(['x']);
      const afterElements = vi.fn();
      hooks.viewport.register({ afterElements }, { satisfies: ['x'] });
      const loop = new RenderLoop({ ...deps, hooks });

      loop.requestRender();
      loop.flush();
      loop.flush();

      expect(afterElements).toHaveBeenCalledTimes(1);
    });

    it('masks the frame in which a satisfying hook first throws', () => {
      vi.stubGlobal('reportError', vi.fn());
      const contexts = stratumContexts();
      const hooks: RenderHooks = createRenderHooks();
      hooks.viewport.setRequiredCapabilities(['x']);
      hooks.viewport.register(
        {
          afterElements: () => {
            throw new Error('fog failed');
          },
        },
        { satisfies: ['x'] },
      );
      const loop = new RenderLoop({ ...deps, hooks });

      try {
        loop.requestRender();
        loop.flush();
      } finally {
        vi.unstubAllGlobals();
      }

      const stratum = contexts.get(3) as unknown as { fillRect: ReturnType<typeof vi.fn> };
      expect(stratum.fillRect).toHaveBeenCalledWith(0, 0, 640, 480);
    });
    it('masks an afterElements clip-then-throw with a full unclipped fill and leaks nothing', () => {
      vi.stubGlobal('reportError', vi.fn());
      vi.stubGlobal('devicePixelRatio', 2);
      const stratum = statefulCtx();
      vi.mocked(deps.hybridSurface.getContext).mockReturnValue(stratum.ctx);
      const hooks: RenderHooks = createRenderHooks();
      hooks.viewport.setRequiredCapabilities(['x']);
      hooks.viewport.register({ afterElements: clipThenThrow }, { satisfies: ['x'] });
      const probed: ClipState[] = [];
      hooks.viewport.register(
        { afterElements: () => probed.push(stratum.state()) },
        { priority: 1 },
      );
      const loop = new RenderLoop({ ...deps, hooks });

      try {
        loop.requestRender();
        loop.flush();
        expect(stratum.depth()).toBe(0);
        loop.requestRender();
        loop.flush();
      } finally {
        vi.unstubAllGlobals();
      }

      expect(stratum.fills).toEqual([
        { clips: 0, scale: 2 },
        { clips: 0, scale: 2 },
      ]);
      expect(probed.at(-1)).toEqual({ clips: 0, scale: 2 });
      expect(stratum.depth()).toBe(0);
    });

    it('keeps sibling fog pixels for the frame a non-satisfying afterElements hook throws', () => {
      vi.stubGlobal('reportError', vi.fn());
      const stratum = statefulCtx();
      vi.mocked(deps.hybridSurface.getContext).mockReturnValue(stratum.ctx);
      const hooks: RenderHooks = createRenderHooks();
      hooks.viewport.setRequiredCapabilities(['x']);
      hooks.viewport.register(
        { afterElements: (ctx) => ctx.fillRect(0, 0, 1, 1) },
        { satisfies: ['x'] },
      );
      hooks.viewport.register({ afterElements: clipThenThrow }, { priority: 1 });
      const loop = new RenderLoop({ ...deps, hooks });

      try {
        loop.requestRender();
        loop.flush();
        expect(stratum.resets()).toBe(0);
        loop.flush();
      } finally {
        vi.unstubAllGlobals();
      }

      expect(stratum.resets()).toBe(1);
      expect(stratum.fills).toHaveLength(2);
      expect(stratum.depth()).toBe(0);
    });

    it('masks the next rAF tick without a request after an afterAll satisfier throws', () => {
      vi.stubGlobal('reportError', vi.fn());
      const frames: FrameRequestCallback[] = [];
      const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        frames.push(cb);
        return frames.length;
      });
      const contexts = stratumContexts();
      const hooks: RenderHooks = createRenderHooks();
      hooks.viewport.setRequiredCapabilities(['x']);
      hooks.viewport.register(
        {
          afterAll: () => {
            throw new Error('fog failed');
          },
        },
        { satisfies: ['x'] },
      );
      const loop = new RenderLoop({ ...deps, hooks });

      try {
        loop.start();
        loop.requestRender();
        frames.shift()?.(0);
        frames.shift()?.(0);
      } finally {
        loop.stop();
        rafSpy.mockRestore();
        vi.unstubAllGlobals();
      }

      const stratum = contexts.get(3) as unknown as { fillRect: ReturnType<typeof vi.fn> };
      expect(stratum.fillRect).toHaveBeenCalledWith(0, 0, 640, 480);
    });
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

    it('routes full-canvas elements through renderExtensionWithBounds', () => {
      const gridElement = {
        id: 'grid-1',
        type: 'grid',
        layerId: 'default',
        position: { x: 0, y: 0 },
      };
      vi.mocked(deps.store.getAll).mockReturnValue([gridElement] as never);
      vi.mocked(deps.renderer.isFullCanvasElement).mockReturnValue(true);

      renderLoop.requestRender();
      renderLoop.flush();

      expect(deps.renderer.renderExtensionWithBounds).toHaveBeenCalled();
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
      vi.mocked(deps.layerManager.getLayers).mockReturnValue([
        { id: 'default', opacity: 0.4 },
      ] as never);
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

  describe('frame structure cache', () => {
    let store: RealElementStore;
    let layers: RealLayerManager;
    let layerId: string;

    beforeEach(() => {
      Object.defineProperty(deps.canvasEl, 'clientWidth', { value: 800, configurable: true });
      Object.defineProperty(deps.canvasEl, 'clientHeight', { value: 600, configurable: true });
      store = new RealElementStore();
      layers = new RealLayerManager(store);
      layerId = layers.activeLayerId;
      layers.createLayer(); // a fallback layer, so the active layer can be hidden
      renderLoop = new RenderLoop({ ...deps, store, layerManager: layers });
    });

    function frame(): void {
      renderLoop.requestRender();
      renderLoop.flush();
    }

    function shape(id: string, zIndex: number) {
      return {
        ...createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 }, layerId, zIndex }),
        id,
      };
    }

    function note(id: string, zIndex: number) {
      return {
        ...createNote({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 }, layerId, zIndex }),
        id,
      };
    }

    it('checks layer visibility at most once per element on a frame with an unchanged store', () => {
      store.add(shape('a', 1));
      store.add(note('b', 2));
      store.add(shape('c', 3));
      frame();
      const spy = vi.spyOn(layers, 'isLayerVisible');

      frame();

      expect(spy).toHaveBeenCalledTimes(3);
    });

    it('routes canvas content to the layer cache once the only DOM layer is hidden between frames', () => {
      const noteLayerId = layers.createLayer().id;
      const topLayerId = layers.createLayer().id;
      store.add(shape('a', 1));
      store.add({ ...note('b', 1), layerId: noteLayerId });
      store.add({ ...shape('c', 1), layerId: topLayerId });
      store.add({ ...shape('d', 2), layerId: topLayerId });
      frame();
      expect(deps.hybridSurface.beginFrame).toHaveBeenLastCalledWith(new Set([3]), 300, 150);
      vi.mocked(deps.renderer.renderCanvasElement).mockClear();

      layers.setLayerVisible(noteLayerId, false);
      renderLoop.markAllLayersDirty();
      frame();

      expect(deps.hybridSurface.beginFrame).toHaveBeenLastCalledWith(new Set(), 300, 150);
      const offCtx = deps.layerCache.getContext(topLayerId);
      expect(vi.mocked(deps.renderer.renderCanvasElement).mock.calls).toEqual([
        [offCtx, expect.objectContaining({ id: 'a' })],
        [offCtx, expect.objectContaining({ id: 'c' })],
        [offCtx, expect.objectContaining({ id: 'd' })],
      ]);
      expect(deps.domNodeManager.hideDomNode).toHaveBeenCalledWith('b');
    });

    it('activates the hybrid stratum when a DOM element is added beneath canvas content', () => {
      store.add(shape('a', 2));
      frame();
      expect(deps.hybridSurface.beginFrame).toHaveBeenLastCalledWith(new Set(), 300, 150);

      store.add(note('b', 1));
      frame();

      expect(deps.hybridSurface.beginFrame).toHaveBeenLastCalledWith(new Set([2]), 300, 150);
      expect(deps.domNodeManager.syncDomNode).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'b' }),
        1,
        1,
      );
    });

    it('composites a layer at the opacity it was changed to between frames', () => {
      store.add(shape('a', 1));
      vi.mocked(deps.layerCache.isDirty).mockReturnValue(false);
      const ctx = mockCtx();
      const alphas: number[] = [];
      vi.mocked(ctx.drawImage).mockImplementation(() => {
        alphas.push(ctx.globalAlpha);
      });
      vi.spyOn(deps.canvasEl, 'getContext').mockReturnValue(ctx as never);

      frame();
      layers.setLayerOpacity(layerId, 0.25);
      renderLoop.markAllLayersDirty();
      frame();

      expect(alphas).toEqual([1, 0.25]);
    });

    it('culls extension elements with the bounds of the store element registry', () => {
      const registry = createTestBoxRegistry();
      const box = (id: string, x: number): ExtensionElementEnvelope => ({
        id,
        type: 'extension',
        extensionType: 'test:box',
        position: { x, y: 0 },
        zIndex: 0,
        locked: false,
        layerId,
        data: {},
      });
      store.setElementRegistry(registry);
      store.add(box('inside', 10));
      store.add(box('outside', 100_000));
      renderLoop = new RenderLoop({ ...deps, store, layerManager: layers });

      frame();

      expect(vi.mocked(deps.renderer.renderCanvasElement).mock.calls).toEqual([
        [deps.layerCache.getContext(layerId), expect.objectContaining({ id: 'inside' })],
      ]);
    });
  });

  describe('live elements', () => {
    let store: RealElementStore;
    let layers: RealLayerManager;
    let layerId: string;
    let cache: RealLayerCache;
    let now: number;
    let restoreGetContext: () => void;

    beforeEach(() => {
      Object.defineProperty(deps.canvasEl, 'clientWidth', { value: 800, configurable: true });
      Object.defineProperty(deps.canvasEl, 'clientHeight', { value: 600, configurable: true });
      now = 1000;
      vi.spyOn(performance, 'now').mockImplementation(() => now);
      // One distinct context per canvas, so cache parts and the main canvas are told apart.
      const getContext = vi.mocked(HTMLCanvasElement.prototype.getContext);
      const previous = getContext.getMockImplementation();
      const contexts = new WeakMap<object, CanvasRenderingContext2D>();
      getContext.mockImplementation(function (this: HTMLCanvasElement) {
        let ctx = contexts.get(this);
        if (!ctx) {
          ctx = mockCtx();
          contexts.set(this, ctx);
        }
        return ctx as never;
      });
      restoreGetContext = () => getContext.mockImplementation(previous ?? (() => null));
      store = new RealElementStore();
      layers = new RealLayerManager(store);
      layerId = layers.activeLayerId;
      cache = new RealLayerCache(deps.marginViewport);
      renderLoop = new RenderLoop({ ...deps, store, layerManager: layers, layerCache: cache });
      store.on('update', ({ previous: before, current }) =>
        renderLoop.noteElementUpdate(before, current),
      );
    });

    afterEach(() => {
      vi.mocked(performance.now).mockRestore();
      restoreGetContext();
    });

    function shape(id: string, zIndex: number, onLayer = layerId) {
      return {
        ...createShape({
          position: { x: 0, y: 0 },
          size: { w: 10, h: 10 },
          layerId: onLayer,
          zIndex,
        }),
        id,
      };
    }

    /** Renders one frame and reports whether it rasterised any layer cache part. */
    function frame(): boolean {
      const clean = vi.spyOn(cache, 'markClean');
      renderLoop.requestRender();
      renderLoop.flush();
      const rasterised = clean.mock.calls.length > 0;
      clean.mockRestore();
      return rasterised;
    }

    function move(id: string, x: number): void {
      store.update(id, { position: { x, y: 0 } });
    }

    function drawnIds(ctx: unknown): string[] {
      return vi
        .mocked(deps.renderer.renderCanvasElement)
        .mock.calls.filter(([target]) => target === ctx)
        .map(([, el]) => el.id);
    }

    it('re-rasterises the layer only on lift and on cool-down while an element is dragged', () => {
      for (let i = 0; i < 5; i++) store.add(shape(`s${i}`, i));
      const rasterFrames: boolean[] = [frame()];
      for (let i = 1; i <= 10; i++) {
        move('s2', i);
        now += 16;
        rasterFrames.push(frame());
      }
      expect(rasterFrames.filter(Boolean)).toHaveLength(3);

      now += 250;
      const clean = vi.spyOn(cache, 'markClean');
      renderLoop.flush();
      expect(clean).toHaveBeenCalledTimes(1);
      expect(clean).toHaveBeenCalledWith(layerId);
      clean.mockRestore();
      expect(frame()).toBe(false);
    });

    it('keeps paint order', () => {
      store.add(shape('A', 1));
      store.add(shape('B', 2));
      store.add(shape('C', 3));
      frame();
      move('B', 1);
      move('B', 2);
      vi.mocked(deps.renderer.renderCanvasElement).mockClear();

      frame();

      const main = deps.canvasEl.getContext('2d');
      const under = cache.getContext(layerId, 'under');
      const over = cache.getContext(layerId, 'over');
      expect(vi.mocked(deps.renderer.renderCanvasElement).mock.calls).toEqual([
        [under, expect.objectContaining({ id: 'A' })],
        [main, expect.objectContaining({ id: 'B' })],
        [over, expect.objectContaining({ id: 'C' })],
      ]);
    });

    it('zIndex or layer change is not lifted', () => {
      const otherLayerId = layers.createLayer().id;
      store.add(shape('A', 1));
      store.add(shape('B', 2));
      frame();
      const rasterFrames: boolean[] = [];
      for (let i = 3; i < 7; i++) {
        store.update('B', { zIndex: i });
        rasterFrames.push(frame());
      }
      for (let i = 0; i < 4; i++) {
        store.update('B', { layerId: i % 2 === 0 ? otherLayerId : layerId });
        rasterFrames.push(frame());
      }
      expect(rasterFrames).toEqual(Array(8).fill(true));
      expect(drawnIds(deps.canvasEl.getContext('2d'))).toEqual([]);
    });

    it('layer opacity < 1 is not lifted', () => {
      layers.setLayerOpacity(layerId, 0.5);
      store.add(shape('A', 1));
      store.add(shape('B', 2));
      frame();
      const rasterFrames: boolean[] = [];
      for (let i = 1; i <= 4; i++) {
        move('B', i);
        rasterFrames.push(frame());
      }
      expect(rasterFrames).toEqual([true, true, true, true]);
      expect(drawnIds(deps.canvasEl.getContext('2d'))).toEqual([]);
    });

    it('DOM element not lifted', () => {
      store.add(shape('A', 1));
      store.add({
        ...createNote({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 }, layerId, zIndex: 2 }),
        id: 'N',
      });
      frame();
      const rasterFrames: boolean[] = [];
      for (let i = 1; i <= 4; i++) {
        move('N', i);
        rasterFrames.push(frame());
      }
      expect(rasterFrames).toEqual([true, true, true, true]);
    });

    it('removing a live element drops it and re-merges', () => {
      store.on('remove', (el) => renderLoop.forgetElement(el.id, el.layerId));
      store.add(shape('A', 1));
      store.add(shape('B', 2));
      store.add(shape('C', 3));
      frame();
      move('B', 1);
      move('B', 2);
      frame();
      vi.mocked(deps.renderer.renderCanvasElement).mockClear();

      store.remove('B');
      frame();

      const base = cache.getContext(layerId);
      expect(vi.mocked(deps.renderer.renderCanvasElement).mock.calls).toEqual([
        [base, expect.objectContaining({ id: 'A' })],
        [base, expect.objectContaining({ id: 'C' })],
      ]);
      vi.mocked(deps.background.render).mockClear();
      renderLoop.flush();
      expect(deps.background.render).not.toHaveBeenCalled();
    });
  });

  describe('render stats', () => {
    it('getStats returns a snapshot', () => {
      const stats = renderLoop.getStats();
      expect(stats).toHaveProperty('fps');
      expect(stats).toHaveProperty('avgFrameMs');
    });
  });

  describe('render hooks', () => {
    it('fires afterElements hooks during render', () => {
      const hooks: RenderHooks = createRenderHooks();
      const afterElements = vi.fn();
      const hookCtx = mockCtx();
      vi.mocked(deps.hybridSurface.getContext).mockReturnValue(hookCtx);
      hooks.viewport.register({ afterElements }, { slot: 'afterSceneBeforeOverlay' });

      const loopWithHooks = new RenderLoop({ ...deps, hooks });
      loopWithHooks.requestRender();
      loopWithHooks.flush();

      expect(afterElements).toHaveBeenCalledTimes(1);
      expect(afterElements).toHaveBeenCalledWith(
        hookCtx,
        deps.camera,
        expect.objectContaining({
          width: expect.any(Number),
          height: expect.any(Number),
          dpr: expect.any(Number),
        }),
      );
      expect(deps.hybridSurface.beginFrame).toHaveBeenCalledWith(new Set([3]), 300, 150);
      expect(deps.hybridSurface.getContext).toHaveBeenCalledWith(3);
    });

    it('places overlays above the afterElements privacy stratum', () => {
      const hooks: RenderHooks = createRenderHooks();
      hooks.viewport.register({ afterElements: vi.fn() });
      (deps.toolManager as { activeTool: unknown }).activeTool = { renderOverlay: vi.fn() };

      const loopWithHooks = new RenderLoop({ ...deps, hooks });
      loopWithHooks.requestRender();
      loopWithHooks.flush();

      expect(deps.hybridSurface.beginFrame).toHaveBeenCalledWith(new Set([3, 4]), 300, 150);
      expect(deps.hybridSurface.getContext).toHaveBeenNthCalledWith(1, 3);
      expect(deps.hybridSurface.getContext).toHaveBeenNthCalledWith(2, 4);
    });

    it('fires afterAll hooks during render', () => {
      const hooks: RenderHooks = createRenderHooks();
      const afterAll = vi.fn();
      hooks.viewport.register({ afterAll });

      const loopWithHooks = new RenderLoop({ ...deps, hooks });
      loopWithHooks.requestRender();
      loopWithHooks.flush();

      expect(afterAll).toHaveBeenCalledTimes(1);
    });

    it('fires afterElements before afterAll', () => {
      const hooks: RenderHooks = createRenderHooks();
      const order: string[] = [];
      hooks.viewport.register({
        afterElements: () => {
          order.push('afterElements');
        },
        afterAll: () => {
          order.push('afterAll');
        },
      });

      const loopWithHooks = new RenderLoop({ ...deps, hooks });
      loopWithHooks.requestRender();
      loopWithHooks.flush();

      expect(order).toEqual(['afterElements', 'afterAll']);
    });

    describe('afterLayer hook', () => {
      let store: RealElementStore;
      let layers: RealLayerManager;
      let hooks: RenderHooks;

      beforeEach(() => {
        Object.defineProperty(deps.canvasEl, 'clientWidth', { value: 800, configurable: true });
        Object.defineProperty(deps.canvasEl, 'clientHeight', { value: 600, configurable: true });
        store = new RealElementStore();
        layers = new RealLayerManager(store);
        hooks = createRenderHooks();
      });

      afterEach(() => {
        vi.unstubAllGlobals();
      });

      function frame(): void {
        const loop = new RenderLoop({ ...deps, store, layerManager: layers, hooks });
        loop.requestRender();
        loop.flush();
      }

      function shapeOn(id: string, layerId: string) {
        return {
          ...createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 }, layerId }),
          id,
        };
      }

      it('calls afterLayer after each visible layer in paint order, including empty layers', () => {
        const l1 = layers.activeLayerId;
        const l2 = layers.createLayer().id;
        const l3 = layers.createLayer().id;
        const l4 = layers.createLayer().id;
        layers.setLayerVisible(l3, false);
        store.add(shapeOn('a', l1));
        store.add(shapeOn('b', l2));
        store.add(shapeOn('hidden', l3));
        const events: string[] = [];
        vi.mocked(deps.renderer.renderCanvasElement).mockImplementation((_ctx, el) => {
          events.push(`draw ${el.id}`);
        });
        hooks.viewport.register({
          afterLayer: (_ctx, _camera, _dims, layerId) => {
            events.push(`hook ${layerId}`);
          },
        });

        frame();

        expect(events).toEqual(['draw a', `hook ${l1}`, 'draw b', `hook ${l2}`, `hook ${l4}`]);
      });

      it('draws elements on an unlisted layer before the first listed layer', () => {
        store.add(shapeOn('orphan', 'unknown-layer'));
        store.add(shapeOn('a', layers.activeLayerId));
        const drawn: string[] = [];
        vi.mocked(deps.renderer.renderCanvasElement).mockImplementation((_ctx, el) => {
          drawn.push(el.id);
        });

        frame();

        expect(drawn).toEqual(['orphan', 'a']);
      });

      it('afterLayer draws in screen space', () => {
        vi.stubGlobal('devicePixelRatio', 2);
        Object.assign(deps.camera, { position: { x: 30, y: 40 }, zoom: 3 });
        // Tracks an axis-aligned transform (scale a/d, translation e/f) through save/restore.
        let m = { a: 1, d: 1, e: 0, f: 0 };
        const stack: (typeof m)[] = [];
        const ctx = {
          ...mockCtx(),
          save: () => stack.push({ ...m }),
          restore: () => {
            m = stack.pop() ?? m;
          },
          scale: (x: number, y: number) => {
            m = { ...m, a: m.a * x, d: m.d * y };
          },
          translate: (x: number, y: number) => {
            m = { ...m, e: m.e + m.a * x, f: m.f + m.d * y };
          },
          setTransform: (a: number, _b: number, _c: number, d: number, e: number, f: number) => {
            m = { a, d, e, f };
          },
        } as unknown as CanvasRenderingContext2D;
        const getContextSpy = vi
          .spyOn(HTMLCanvasElement.prototype, 'getContext')
          .mockReturnValue(ctx as never);
        const seen: (typeof m)[] = [];
        hooks.viewport.register({ afterLayer: () => seen.push({ ...m }) });
        try {
          frame();
        } finally {
          getContextSpy.mockReturnValue(mockCtx() as never);
        }

        expect(seen).toEqual([{ a: 2, d: 2, e: 0, f: 0 }]);
      });

      it('a throwing afterLayer hook is quarantined and the base canvas is reset next frame', () => {
        vi.stubGlobal('reportError', vi.fn());
        const main = statefulCtx(deps.canvasEl);
        const getContextSpy = vi
          .spyOn(HTMLCanvasElement.prototype, 'getContext')
          .mockReturnValue(main.ctx as never);
        const afterLayer = vi.fn(clipThenThrow);
        hooks.viewport.register({ afterLayer });
        const loop = new RenderLoop({ ...deps, store, layerManager: layers, hooks });
        try {
          loop.requestRender();
          loop.flush();
          expect(main.resets()).toBe(0);
          loop.flush();
          expect(main.resets()).toBe(1);
          expect(afterLayer).toHaveBeenCalledTimes(1);
          expect(main.depth()).toBe(0);
        } finally {
          getContextSpy.mockReturnValue(mockCtx() as never);
        }
      });
    });

    it('does not fire hooks when no hooks provided', () => {
      const loop = new RenderLoop(deps);
      loop.requestRender();
      loop.flush();
      // No error thrown — hooks are optional
    });
  });
});
