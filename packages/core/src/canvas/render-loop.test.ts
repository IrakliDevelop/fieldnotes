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
import { createNote, createShape } from '../elements/element-factory';

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

    it('unwinds both main context saves when a main-canvas tool overlay throws', () => {
      const ctx = depthCtx();
      const getContextSpy = vi
        .spyOn(HTMLCanvasElement.prototype, 'getContext')
        .mockReturnValue(ctx as never);
      const depthAtBackground: number[] = [];
      (deps.background.render as ReturnType<typeof vi.fn>).mockImplementation(() => {
        depthAtBackground.push(ctx.depth);
      });
      const depthAtOverlay: number[] = [];
      let shouldThrow = true;
      (deps.toolManager as { activeTool: unknown }).activeTool = {
        renderOverlay: (overlayCtx: unknown) => {
          // No hybrid stratum is active here, so the overlay draws on the main canvas
          // under both of the frame's saves (dpr scale, then camera transform).
          expect(overlayCtx).toBe(ctx);
          depthAtOverlay.push(ctx.depth);
          if (shouldThrow) throw new Error('overlay failed');
        },
      };
      const loop = new RenderLoop(deps);
      const { rafSpy, runFrame } = captureFrames();
      try {
        loop.start();
        runFrame(loop); // throwing frame
        expect(depthAtOverlay).toEqual([2]);
        expect(ctx.depth).toBe(0);
        shouldThrow = false;
        runFrame(loop); // recovered frame
        expect(ctx.depth).toBe(0);
        expect(depthAtBackground).toEqual([1, 1]);
        expect(depthAtOverlay).toEqual([2, 2]);
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
      const hooks: RenderHooks = createRenderHooks();
      let nesting = 0;
      const loop = new RenderLoop({ ...deps, hooks });
      hooks.viewport.register({
        beforeElements: () => {
          nesting++;
          try {
            if (nesting === 1) {
              // needsRender is still set while the outer frame renders, so this re-enters.
              expect(() => loop.flush()).toThrow('inner failed');
            } else {
              throw new Error('inner failed');
            }
          } finally {
            nesting--;
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
      const hooks: RenderHooks = createRenderHooks();
      hooks.viewport.register({
        beforeElements: () => {
          throw new Error('hook failed');
        },
      });
      const loop = new RenderLoop({ ...deps, hooks });
      try {
        loop.requestRender();
        expect(() => loop.flush()).toThrow('hook failed');
        expect(ctx.depth).toBe(0);
      } finally {
        getContextSpy.mockReturnValue(mockCtx() as never);
      }
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

    it('stops drawing a layer hidden between frames once layers are marked dirty', () => {
      store.add(shape('a', 1));
      store.add(note('b', 2));
      store.add(shape('c', 3));
      frame();
      vi.mocked(deps.renderer.renderCanvasElement).mockClear();
      vi.mocked(deps.hybridSurface.beginFrame).mockClear();

      layers.setLayerVisible(layerId, false);
      renderLoop.markAllLayersDirty();
      frame();

      expect(deps.renderer.renderCanvasElement).not.toHaveBeenCalled();
      expect(deps.domNodeManager.hideDomNode).toHaveBeenCalledWith('b');
      expect(deps.hybridSurface.beginFrame).toHaveBeenCalledWith(new Set(), 300, 150);
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

    it('composites each layer at its current opacity', () => {
      store.add(shape('a', 1));
      layers.setLayerOpacity(layerId, 0.25);
      vi.mocked(deps.layerCache.isDirty).mockReturnValue(false);
      const ctx = mockCtx();
      const alphas: number[] = [];
      vi.mocked(ctx.drawImage).mockImplementation(() => {
        alphas.push(ctx.globalAlpha);
      });
      vi.spyOn(deps.canvasEl, 'getContext').mockReturnValue(ctx as never);

      frame();

      expect(alphas).toEqual([0.25]);
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

    it('does not fire hooks when no hooks provided', () => {
      const loop = new RenderLoop(deps);
      loop.requestRender();
      loop.flush();
      // No error thrown — hooks are optional
    });
  });
});
