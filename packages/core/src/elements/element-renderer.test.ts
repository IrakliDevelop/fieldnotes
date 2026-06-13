// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ElementRenderer } from './element-renderer';
import { computeStrokeSegments } from './stroke-cache';
import * as GridRenderer from './grid-renderer';
import type {
  StrokeElement,
  ArrowElement,
  NoteElement,
  ShapeElement,
  ImageElement,
  GridElement,
  TemplateElement,
  HtmlElement,
  TextElement,
} from './types';
import { ElementStore } from './element-store';
import { Camera } from '../canvas/camera';

function mockCtx(): CanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    closePath: vi.fn(),
    arc: vi.fn(),
    quadraticCurveTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    ellipse: vi.fn(),
    drawImage: vi.fn(),
    setLineDash: vi.fn(),
    measureText: vi.fn().mockReturnValue({ width: 40 }),
    roundRect: vi.fn(),
    fillText: vi.fn(),
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 0,
    lineCap: '',
    lineJoin: '',
    globalAlpha: 1,
    font: '',
    textAlign: '',
    textBaseline: '',
  } as unknown as CanvasRenderingContext2D;
}

function makeStroke(overrides: Partial<StrokeElement> = {}): StrokeElement {
  return {
    id: 'stroke-1',
    type: 'stroke',
    position: { x: 0, y: 0 },
    points: [
      { x: 0, y: 0, pressure: 0.5 },
      { x: 10, y: 10, pressure: 0.5 },
      { x: 20, y: 5, pressure: 0.5 },
    ],
    color: '#000',
    width: 2,
    opacity: 1,
    zIndex: 0,
    locked: false,
    layerId: '',
    ...overrides,
  };
}

function makeArrow(overrides: Partial<ArrowElement> = {}): ArrowElement {
  return {
    id: 'arrow-1',
    type: 'arrow',
    position: { x: 0, y: 0 },
    from: { x: 0, y: 0 },
    to: { x: 100, y: 100 },
    bend: 0,
    color: '#000',
    width: 2,
    zIndex: 0,
    locked: false,
    layerId: '',
    ...overrides,
  };
}

describe('ElementRenderer', () => {
  describe('renderStroke', () => {
    it('draws curved segments through points', () => {
      const renderer = new ElementRenderer();
      const ctx = mockCtx();
      renderer.renderCanvasElement(ctx, makeStroke());

      expect(ctx.beginPath).toHaveBeenCalled();
      expect(ctx.moveTo).toHaveBeenCalled();
      expect(ctx.bezierCurveTo).toHaveBeenCalled();
      expect(ctx.stroke).toHaveBeenCalled();
    });

    it('applies stroke style', () => {
      const renderer = new ElementRenderer();
      const ctx = mockCtx();
      renderer.renderCanvasElement(ctx, makeStroke({ color: '#ff0000', width: 5, opacity: 0.5 }));

      expect(ctx.strokeStyle).toBe('#ff0000');
      expect(ctx.globalAlpha).toBe(0.5);
      expect(ctx.lineWidth).toBeGreaterThan(0);
    });

    it('skips strokes with fewer than 2 points', () => {
      const renderer = new ElementRenderer();
      const ctx = mockCtx();
      renderer.renderCanvasElement(ctx, makeStroke({ points: [{ x: 0, y: 0, pressure: 0.5 }] }));

      expect(ctx.beginPath).not.toHaveBeenCalled();
    });

    it('saves and restores context', () => {
      const renderer = new ElementRenderer();
      const ctx = mockCtx();
      renderer.renderCanvasElement(ctx, makeStroke());

      expect(ctx.save).toHaveBeenCalled();
      expect(ctx.restore).toHaveBeenCalled();
    });
  });

  describe('bucketed stroke rendering', () => {
    class FakePath2D {
      moveTo(_x: number, _y: number): void {
        // no-op stub
      }
      bezierCurveTo(
        _cp1x: number,
        _cp1y: number,
        _cp2x: number,
        _cp2y: number,
        _x: number,
        _y: number,
      ): void {
        // no-op stub
      }
    }

    beforeEach(() => {
      (globalThis as Record<string, unknown>).Path2D = FakePath2D;
    });
    afterEach(() => {
      delete (globalThis as Record<string, unknown>).Path2D;
    });

    it('renders bucketed strokes via ctx.stroke(path) per bucket, no per-segment paths', () => {
      const stroke = makeStroke({
        points: [
          { x: 0, y: 0, pressure: 0.2 },
          { x: 10, y: 5, pressure: 0.5 },
          { x: 20, y: 0, pressure: 0.9 },
          { x: 30, y: 5, pressure: 0.4 },
        ],
        width: 4,
      });
      const renderer = new ElementRenderer();
      const data = computeStrokeSegments(stroke);
      const bucketCount = (data.buckets ?? []).length;
      expect(bucketCount).toBeGreaterThan(0);

      const ctx = mockCtx();
      renderer.renderCanvasElement(ctx, stroke);

      const strokeCalls = (ctx.stroke as ReturnType<typeof vi.fn>).mock.calls;
      const pathCalls = strokeCalls.filter((c) => c[0] instanceof FakePath2D);
      expect(pathCalls.length).toBe(bucketCount);
      expect(ctx.beginPath).not.toHaveBeenCalled();
    });
  });

  describe('renderArrow', () => {
    it('draws a line from start to end', () => {
      const renderer = new ElementRenderer();
      const ctx = mockCtx();
      renderer.renderCanvasElement(ctx, makeArrow());

      expect(ctx.moveTo).toHaveBeenCalledWith(0, 0);
      expect(ctx.lineTo).toHaveBeenCalledWith(100, 100);
      expect(ctx.stroke).toHaveBeenCalled();
    });

    it('draws an arrowhead', () => {
      const renderer = new ElementRenderer();
      const ctx = mockCtx();
      renderer.renderCanvasElement(ctx, makeArrow());

      expect(ctx.fill).toHaveBeenCalled();
    });
  });

  describe('isDomElement', () => {
    it('identifies note as a DOM element', () => {
      const renderer = new ElementRenderer();
      const note: NoteElement = {
        id: 'note-1',
        type: 'note',
        position: { x: 0, y: 0 },
        size: { w: 200, h: 100 },
        text: 'Hi',
        backgroundColor: '#ffeb3b',
        zIndex: 0,
        locked: false,
        layerId: '',
        textColor: '',
      };
      expect(renderer.isDomElement(note)).toBe(true);
    });

    it('identifies stroke as a canvas element', () => {
      const renderer = new ElementRenderer();
      expect(renderer.isDomElement(makeStroke())).toBe(false);
    });

    it('identifies html as a DOM element', () => {
      const renderer = new ElementRenderer();
      const html: HtmlElement = {
        id: 'html-1',
        type: 'html',
        position: { x: 0, y: 0 },
        size: { w: 200, h: 100 },
        zIndex: 0,
        locked: false,
        layerId: '',
      };
      expect(renderer.isDomElement(html)).toBe(true);
    });

    it('identifies text as a DOM element', () => {
      const renderer = new ElementRenderer();
      const text: TextElement = {
        id: 'text-1',
        type: 'text',
        position: { x: 0, y: 0 },
        size: { w: 200, h: 28 },
        text: 'Hello',
        fontSize: 16,
        color: '#000',
        textAlign: 'left',
        zIndex: 0,
        locked: false,
        layerId: '',
      };
      expect(renderer.isDomElement(text)).toBe(true);
    });
  });

  describe('renderArrow — bend', () => {
    it('uses quadraticCurveTo when bend is non-zero', () => {
      const renderer = new ElementRenderer();
      const ctx = mockCtx();
      renderer.renderCanvasElement(ctx, makeArrow({ bend: 0.5 }));

      expect(ctx.quadraticCurveTo).toHaveBeenCalled();
    });

    it('uses cached control point when available', () => {
      const renderer = new ElementRenderer();
      const ctx = mockCtx();
      renderer.renderCanvasElement(
        ctx,
        makeArrow({
          bend: 0.5,
          cachedControlPoint: { x: 50, y: -20 },
        }),
      );

      expect(ctx.quadraticCurveTo).toHaveBeenCalledWith(50, -20, 100, 100);
    });

    it('applies dashed line when fromBinding is set', () => {
      const store = new ElementStore();
      const note: NoteElement = {
        id: 'note-bound',
        type: 'note',
        position: { x: -50, y: -50 },
        size: { w: 100, h: 100 },
        text: '',
        backgroundColor: '#fff',
        textColor: '#000',
        zIndex: 0,
        locked: false,
        layerId: '',
      };
      store.add(note);

      const renderer = new ElementRenderer();
      renderer.setStore(store);
      const ctx = mockCtx();
      renderer.renderCanvasElement(
        ctx,
        makeArrow({
          fromBinding: { elementId: 'note-bound' },
        }),
      );

      expect(ctx.setLineDash).toHaveBeenCalledWith([8, 4]);
    });

    it('applies dashed line when toBinding is set', () => {
      const store = new ElementStore();
      const note: NoteElement = {
        id: 'note-bound',
        type: 'note',
        position: { x: 80, y: 80 },
        size: { w: 40, h: 40 },
        text: '',
        backgroundColor: '#fff',
        textColor: '#000',
        zIndex: 0,
        locked: false,
        layerId: '',
      };
      store.add(note);

      const renderer = new ElementRenderer();
      renderer.setStore(store);
      const ctx = mockCtx();
      renderer.renderCanvasElement(
        ctx,
        makeArrow({
          toBinding: { elementId: 'note-bound' },
        }),
      );

      expect(ctx.setLineDash).toHaveBeenCalledWith([8, 4]);
    });

    it('computes visual endpoints from bound elements', () => {
      const store = new ElementStore();
      const note: NoteElement = {
        id: 'note-from',
        type: 'note',
        position: { x: -50, y: -50 },
        size: { w: 100, h: 100 },
        text: '',
        backgroundColor: '#fff',
        textColor: '#000',
        zIndex: 0,
        locked: false,
        layerId: '',
      };
      store.add(note);

      const renderer = new ElementRenderer();
      renderer.setStore(store);
      const ctx = mockCtx();
      renderer.renderCanvasElement(
        ctx,
        makeArrow({
          fromBinding: { elementId: 'note-from' },
        }),
      );

      expect(ctx.moveTo).toHaveBeenCalled();
      const moveCall = (ctx.moveTo as ReturnType<typeof vi.fn>).mock.calls[0] as [number, number];
      expect(moveCall[0]).not.toBe(0);
    });

    it('ignores binding when bound element not found', () => {
      const store = new ElementStore();
      const renderer = new ElementRenderer();
      renderer.setStore(store);
      const ctx = mockCtx();
      renderer.renderCanvasElement(
        ctx,
        makeArrow({
          fromBinding: { elementId: 'nonexistent' },
          toBinding: { elementId: 'nonexistent' },
        }),
      );

      expect(ctx.moveTo).toHaveBeenCalledWith(0, 0);
    });
  });

  describe('renderShape', () => {
    function makeShape(overrides: Partial<ShapeElement> = {}): ShapeElement {
      return {
        id: 'shape-1',
        type: 'shape',
        position: { x: 10, y: 20 },
        size: { w: 100, h: 50 },
        shape: 'rectangle',
        strokeColor: '#000',
        strokeWidth: 2,
        fillColor: '#ff0000',
        zIndex: 0,
        locked: false,
        layerId: '',
        ...overrides,
      };
    }

    it('fills rectangle with fillColor', () => {
      const renderer = new ElementRenderer();
      const ctx = mockCtx();
      renderer.renderCanvasElement(ctx, makeShape());

      expect(ctx.fillRect).toHaveBeenCalledWith(10, 20, 100, 50);
      expect(ctx.fillStyle).toBe('#ff0000');
    });

    it('strokes rectangle with strokeColor and strokeWidth', () => {
      const renderer = new ElementRenderer();
      const ctx = mockCtx();
      renderer.renderCanvasElement(ctx, makeShape());

      expect(ctx.strokeRect).toHaveBeenCalledWith(10, 20, 100, 50);
      expect(ctx.strokeStyle).toBe('#000');
    });

    it('skips fill when fillColor is none', () => {
      const renderer = new ElementRenderer();
      const ctx = mockCtx();
      renderer.renderCanvasElement(ctx, makeShape({ fillColor: 'none' }));

      expect(ctx.fillRect).not.toHaveBeenCalled();
    });

    it('skips stroke when strokeWidth is 0', () => {
      const renderer = new ElementRenderer();
      const ctx = mockCtx();
      renderer.renderCanvasElement(ctx, makeShape({ strokeWidth: 0 }));

      expect(ctx.strokeRect).not.toHaveBeenCalled();
    });

    it('fills ellipse', () => {
      const renderer = new ElementRenderer();
      const ctx = mockCtx();
      renderer.renderCanvasElement(ctx, makeShape({ shape: 'ellipse' }));

      expect(ctx.ellipse).toHaveBeenCalledWith(60, 45, 50, 25, 0, 0, Math.PI * 2);
      expect(ctx.fill).toHaveBeenCalled();
    });

    it('strokes ellipse', () => {
      const renderer = new ElementRenderer();
      const ctx = mockCtx();
      renderer.renderCanvasElement(ctx, makeShape({ shape: 'ellipse' }));

      expect(ctx.ellipse).toHaveBeenCalled();
      expect(ctx.stroke).toHaveBeenCalled();
    });
  });

  describe('renderImage', () => {
    function makeImage(overrides: Partial<ImageElement> = {}): ImageElement {
      return {
        id: 'img-1',
        type: 'image',
        position: { x: 10, y: 20 },
        size: { w: 200, h: 150 },
        src: 'test.png',
        zIndex: 0,
        locked: false,
        layerId: '',
        ...overrides,
      };
    }

    it('does not draw before image is loaded', () => {
      const renderer = new ElementRenderer();
      const ctx = mockCtx();
      renderer.renderCanvasElement(ctx, makeImage());

      expect(ctx.drawImage).not.toHaveBeenCalled();
    });

    it('calls onImageLoad callback', () => {
      const renderer = new ElementRenderer();
      const cb = vi.fn();
      renderer.setOnImageLoad(cb);
      const ctx = mockCtx();
      renderer.renderCanvasElement(ctx, makeImage());

      expect(ctx.drawImage).not.toHaveBeenCalled();
    });

    it('returns null on second call before image loads', () => {
      const renderer = new ElementRenderer();
      const ctx = mockCtx();
      renderer.renderCanvasElement(ctx, makeImage());
      renderer.renderCanvasElement(ctx, makeImage());

      expect(ctx.drawImage).not.toHaveBeenCalled();
    });

    it('draws image when pre-cached and complete', () => {
      const renderer = new ElementRenderer();
      const ctx = mockCtx();

      renderer.renderCanvasElement(ctx, makeImage({ src: 'cached.png' }));

      const img = new Image();
      img.src = 'cached.png';
      Object.defineProperty(img, 'complete', { value: true });

      (renderer as unknown as { imageCache: Map<string, HTMLImageElement> }).imageCache.set(
        'cached.png',
        img,
      );

      renderer.renderCanvasElement(ctx, makeImage({ src: 'cached.png' }));
      expect(ctx.drawImage).toHaveBeenCalled();
    });

    function failImage(renderer: ElementRenderer, src: string): void {
      const cache = (renderer as unknown as { imageCache: Map<string, unknown> }).imageCache;
      const img = cache.get(src);
      if (img instanceof HTMLImageElement) {
        img.onerror?.(new Event('error') as never);
      }
    }

    it('fires onImageError and renders a placeholder after a failed load', () => {
      const onError = vi.fn();
      const renderer = new ElementRenderer();
      renderer.setOnImageError(onError);
      const ctx = mockCtx();
      const image = makeImage({ src: 'https://broken.example/x.png' });

      renderer.renderCanvasElement(ctx, image);
      failImage(renderer, image.src);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(image.src);

      renderer.renderCanvasElement(ctx, image);
      expect(ctx.drawImage).not.toHaveBeenCalled();
      expect(ctx.fillRect).toHaveBeenCalled();
      expect(ctx.strokeRect).toHaveBeenCalled();
      expect(ctx.arc).toHaveBeenCalled();
    });

    it('does not refire the error on subsequent renders of a failed src', () => {
      const onError = vi.fn();
      const renderer = new ElementRenderer();
      renderer.setOnImageError(onError);
      const ctx = mockCtx();
      const image = makeImage({ src: 'https://broken.example/y.png' });

      renderer.renderCanvasElement(ctx, image);
      failImage(renderer, image.src);
      renderer.renderCanvasElement(ctx, image);
      renderer.renderCanvasElement(ctx, image);

      expect(onError).toHaveBeenCalledTimes(1);
    });

    it('triggers a re-render via onImageLoad when the load fails', () => {
      const onLoad = vi.fn();
      const renderer = new ElementRenderer();
      renderer.setOnImageLoad(onLoad);
      const ctx = mockCtx();
      const image = makeImage({ src: 'https://broken.example/z.png' });

      renderer.renderCanvasElement(ctx, image);
      failImage(renderer, image.src);
      expect(onLoad).toHaveBeenCalledTimes(1);
    });
  });

  describe('renderGrid', () => {
    function makeGrid(overrides: Partial<GridElement> = {}): GridElement {
      return {
        id: 'grid-1',
        type: 'grid',
        position: { x: 0, y: 0 },
        gridType: 'square',
        hexOrientation: 'pointy',
        cellSize: 40,
        strokeColor: '#ccc',
        strokeWidth: 1,
        opacity: 0.5,
        zIndex: 0,
        locked: false,
        layerId: '',
        ...overrides,
      };
    }

    it('does nothing without canvas size', () => {
      const renderer = new ElementRenderer();
      const ctx = mockCtx();
      renderer.renderCanvasElement(ctx, makeGrid());

      expect(ctx.save).not.toHaveBeenCalled();
    });

    it('does nothing without camera', () => {
      const renderer = new ElementRenderer();
      renderer.setCanvasSize(800, 600);
      const ctx = mockCtx();
      renderer.renderCanvasElement(ctx, makeGrid());

      expect(ctx.save).not.toHaveBeenCalled();
    });

    it('renders square grid with camera and canvas size set', () => {
      const renderer = new ElementRenderer();
      const camera = new Camera();
      renderer.setCamera(camera);
      renderer.setCanvasSize(800, 600);
      const ctx = mockCtx();
      renderer.renderCanvasElement(ctx, makeGrid({ gridType: 'square' }));

      expect(ctx.save).toHaveBeenCalled();
      expect(ctx.restore).toHaveBeenCalled();
      expect(ctx.stroke).toHaveBeenCalled();
    });

    it('renders hex grid with fallback when tile creation fails', () => {
      const renderer = new ElementRenderer();
      const camera = new Camera();
      renderer.setCamera(camera);
      renderer.setCanvasSize(800, 600);
      const ctx = mockCtx();
      renderer.renderCanvasElement(ctx, makeGrid({ gridType: 'hex', hexOrientation: 'pointy' }));

      expect(ctx.save).toHaveBeenCalled();
      expect(ctx.closePath).toHaveBeenCalled();
    });

    describe('gridBoundsOverride', () => {
      beforeEach(() => {
        vi.restoreAllMocks();
      });

      it('passes camera-derived bounds to renderSquareGrid when no override is set', () => {
        const spy = vi.spyOn(GridRenderer, 'renderSquareGrid');
        const renderer = new ElementRenderer();
        const camera = new Camera();
        camera.moveTo(-100, -50);
        camera.setZoom(2);
        renderer.setCamera(camera);
        renderer.setCanvasSize(800, 600);
        const ctx = mockCtx();
        renderer.renderCanvasElement(ctx, makeGrid({ gridType: 'square' }));

        expect(spy).toHaveBeenCalledTimes(1);
        const bounds = (
          spy.mock.calls[0] as [CanvasRenderingContext2D, GridRenderer.VisibleBounds, ...unknown[]]
        )[1];
        // camera-derived: screenToWorld(0,0) and screenToWorld(800,600)
        // screenToWorld: (screen.x - camX) / zoom
        expect(bounds.minX).toBeCloseTo(50); // (0 - (-100)) / 2 = 50
        expect(bounds.minY).toBeCloseTo(25); // (0 - (-50)) / 2 = 25
        expect(bounds.maxX).toBeCloseTo(450); // (800 - (-100)) / 2 = 450
        expect(bounds.maxY).toBeCloseTo(325); // (600 - (-50)) / 2 = 325
      });

      it('passes override bounds to renderSquareGrid when setGridBoundsOverride is called', () => {
        const spy = vi.spyOn(GridRenderer, 'renderSquareGrid');
        const renderer = new ElementRenderer();
        const camera = new Camera();
        renderer.setCamera(camera);
        renderer.setCanvasSize(800, 600);
        renderer.setGridBoundsOverride({ minX: -999, minY: -888, maxX: 999, maxY: 888 });
        const ctx = mockCtx();
        renderer.renderCanvasElement(ctx, makeGrid({ gridType: 'square' }));

        expect(spy).toHaveBeenCalledTimes(1);
        const bounds = (
          spy.mock.calls[0] as [CanvasRenderingContext2D, GridRenderer.VisibleBounds, ...unknown[]]
        )[1];
        expect(bounds.minX).toBe(-999);
        expect(bounds.minY).toBe(-888);
        expect(bounds.maxX).toBe(999);
        expect(bounds.maxY).toBe(888);
      });

      it('passes override bounds to renderHexGrid fallback when setGridBoundsOverride is called', () => {
        const spy = vi.spyOn(GridRenderer, 'renderHexGrid');
        // Force tile creation to fail by ensuring createHexGridTile returns null
        vi.spyOn(GridRenderer, 'createHexGridTile').mockReturnValue(null);
        const renderer = new ElementRenderer();
        const camera = new Camera();
        renderer.setCamera(camera);
        renderer.setCanvasSize(800, 600);
        renderer.setGridBoundsOverride({ minX: -999, minY: -888, maxX: 999, maxY: 888 });
        const ctx = mockCtx();
        renderer.renderCanvasElement(ctx, makeGrid({ gridType: 'hex' }));

        expect(spy).toHaveBeenCalledTimes(1);
        const bounds = (
          spy.mock.calls[0] as [CanvasRenderingContext2D, GridRenderer.VisibleBounds, ...unknown[]]
        )[1];
        expect(bounds.minX).toBe(-999);
        expect(bounds.minY).toBe(-888);
        expect(bounds.maxX).toBe(999);
        expect(bounds.maxY).toBe(888);
      });

      it('passes override bounds to renderHexGridTiled (tiled path)', () => {
        vi.spyOn(GridRenderer, 'createHexGridTile').mockReturnValue({
          canvas: document.createElement('canvas'),
          tileW: 40,
          tileH: 40,
        });
        const tiledSpy = vi.spyOn(GridRenderer, 'renderHexGridTiled').mockReturnValue(undefined);
        const renderer = new ElementRenderer();
        const camera = new Camera();
        renderer.setCamera(camera);
        renderer.setCanvasSize(800, 600);
        renderer.setGridBoundsOverride({ minX: -999, minY: -888, maxX: 999, maxY: 888 });
        const ctx = mockCtx();
        renderer.renderCanvasElement(ctx, makeGrid({ gridType: 'hex' }));

        expect(tiledSpy).toHaveBeenCalled();
        const boundsArg = (
          tiledSpy.mock.calls[0] as [
            CanvasRenderingContext2D,
            GridRenderer.VisibleBounds,
            ...unknown[],
          ]
        )[1];
        expect(boundsArg).toEqual({ minX: -999, minY: -888, maxX: 999, maxY: 888 });
        vi.restoreAllMocks();
      });

      it('clears override after setGridBoundsOverride(null) and uses camera bounds', () => {
        const spy = vi.spyOn(GridRenderer, 'renderSquareGrid');
        const renderer = new ElementRenderer();
        const camera = new Camera();
        renderer.setCamera(camera);
        renderer.setCanvasSize(800, 600);
        renderer.setGridBoundsOverride({ minX: -999, minY: -888, maxX: 999, maxY: 888 });
        renderer.setGridBoundsOverride(null);
        const ctx = mockCtx();
        renderer.renderCanvasElement(ctx, makeGrid({ gridType: 'square' }));

        expect(spy).toHaveBeenCalledTimes(1);
        const bounds = (
          spy.mock.calls[0] as [CanvasRenderingContext2D, GridRenderer.VisibleBounds, ...unknown[]]
        )[1];
        // After clearing, should use camera-derived bounds (camera at origin, zoom 1)
        expect(bounds.minX).toBeCloseTo(0);
        expect(bounds.minY).toBeCloseTo(0);
        expect(bounds.maxX).toBeCloseTo(800);
        expect(bounds.maxY).toBeCloseTo(600);
      });
    });
  });

  describe('renderTemplate', () => {
    function makeTemplate(overrides: Partial<TemplateElement> = {}): TemplateElement {
      return {
        id: 'tpl-1',
        type: 'template',
        position: { x: 100, y: 100 },
        templateShape: 'circle',
        radius: 50,
        angle: 0,
        fillColor: 'rgba(255, 0, 0, 0.3)',
        strokeColor: '#ff0000',
        strokeWidth: 2,
        opacity: 0.6,
        zIndex: 0,
        locked: false,
        layerId: '',
        ...overrides,
      };
    }

    it('renders geometric circle template', () => {
      const renderer = new ElementRenderer();
      const ctx = mockCtx();
      renderer.renderCanvasElement(ctx, makeTemplate());

      expect(ctx.arc).toHaveBeenCalledWith(100, 100, 50, 0, Math.PI * 2);
      expect(ctx.fill).toHaveBeenCalled();
      expect(ctx.stroke).toHaveBeenCalled();
    });

    it('renders circle template with radius marker', () => {
      const renderer = new ElementRenderer();
      const ctx = mockCtx();
      renderer.renderCanvasElement(ctx, makeTemplate({ radiusFeet: 30 }));

      expect(ctx.setLineDash).toHaveBeenCalledWith([4, 4]);
      expect(ctx.fillText).toHaveBeenCalled();
    });

    it('renders square template', () => {
      const renderer = new ElementRenderer();
      const ctx = mockCtx();
      renderer.renderCanvasElement(ctx, makeTemplate({ templateShape: 'square' }));

      expect(ctx.fillRect).toHaveBeenCalled();
      expect(ctx.strokeRect).toHaveBeenCalled();
    });

    it('renders cone template', () => {
      const renderer = new ElementRenderer();
      const ctx = mockCtx();
      renderer.renderCanvasElement(
        ctx,
        makeTemplate({ templateShape: 'cone', angle: Math.PI / 4 }),
      );

      expect(ctx.arc).toHaveBeenCalled();
      expect(ctx.closePath).toHaveBeenCalled();
      expect(ctx.fill).toHaveBeenCalled();
    });

    it('renders line template', () => {
      const renderer = new ElementRenderer();
      const ctx = mockCtx();
      renderer.renderCanvasElement(
        ctx,
        makeTemplate({ templateShape: 'line', angle: 0, radius: 60 }),
      );

      expect(ctx.moveTo).toHaveBeenCalled();
      expect(ctx.closePath).toHaveBeenCalled();
      expect(ctx.fill).toHaveBeenCalled();
    });

    it('renders hex template when grid exists', () => {
      const store = new ElementStore();
      const grid: GridElement = {
        id: 'grid-1',
        type: 'grid',
        position: { x: 0, y: 0 },
        gridType: 'hex',
        hexOrientation: 'pointy',
        cellSize: 30,
        strokeColor: '#000',
        strokeWidth: 1,
        opacity: 1,
        zIndex: 0,
        locked: false,
        layerId: '',
      };
      store.add(grid);

      const renderer = new ElementRenderer();
      renderer.setStore(store);
      const ctx = mockCtx();
      renderer.renderCanvasElement(ctx, makeTemplate());

      expect(ctx.fill).toHaveBeenCalled();
      expect(ctx.stroke).toHaveBeenCalled();
    });

    it('renders hex cone template', () => {
      const store = new ElementStore();
      const grid: GridElement = {
        id: 'grid-1',
        type: 'grid',
        position: { x: 0, y: 0 },
        gridType: 'hex',
        hexOrientation: 'pointy',
        cellSize: 30,
        strokeColor: '#000',
        strokeWidth: 1,
        opacity: 1,
        zIndex: 0,
        locked: false,
        layerId: '',
      };
      store.add(grid);

      const renderer = new ElementRenderer();
      renderer.setStore(store);
      const ctx = mockCtx();
      renderer.renderCanvasElement(ctx, makeTemplate({ templateShape: 'cone', angle: 0 }));

      expect(ctx.fill).toHaveBeenCalled();
    });

    it('renders hex line template', () => {
      const store = new ElementStore();
      const grid: GridElement = {
        id: 'grid-1',
        type: 'grid',
        position: { x: 0, y: 0 },
        gridType: 'hex',
        hexOrientation: 'pointy',
        cellSize: 30,
        strokeColor: '#000',
        strokeWidth: 1,
        opacity: 1,
        zIndex: 0,
        locked: false,
        layerId: '',
      };
      store.add(grid);

      const renderer = new ElementRenderer();
      renderer.setStore(store);
      const ctx = mockCtx();
      renderer.renderCanvasElement(ctx, makeTemplate({ templateShape: 'line', angle: 0 }));

      expect(ctx.fill).toHaveBeenCalled();
    });

    it('renders hex square template', () => {
      const store = new ElementStore();
      const grid: GridElement = {
        id: 'grid-1',
        type: 'grid',
        position: { x: 0, y: 0 },
        gridType: 'hex',
        hexOrientation: 'pointy',
        cellSize: 30,
        strokeColor: '#000',
        strokeWidth: 1,
        opacity: 1,
        zIndex: 0,
        locked: false,
        layerId: '',
      };
      store.add(grid);

      const renderer = new ElementRenderer();
      renderer.setStore(store);
      const ctx = mockCtx();
      renderer.renderCanvasElement(ctx, makeTemplate({ templateShape: 'square' }));

      expect(ctx.fill).toHaveBeenCalled();
    });

    it('renders hex circle template with radius marker', () => {
      const store = new ElementStore();
      const grid: GridElement = {
        id: 'grid-1',
        type: 'grid',
        position: { x: 0, y: 0 },
        gridType: 'hex',
        hexOrientation: 'pointy',
        cellSize: 30,
        strokeColor: '#000',
        strokeWidth: 1,
        opacity: 1,
        zIndex: 0,
        locked: false,
        layerId: '',
      };
      store.add(grid);

      const renderer = new ElementRenderer();
      renderer.setStore(store);
      const ctx = mockCtx();
      renderer.renderCanvasElement(ctx, makeTemplate({ radiusFeet: 20 }));

      expect(ctx.setLineDash).toHaveBeenCalled();
      expect(ctx.fillText).toHaveBeenCalled();
    });

    it('sets globalAlpha from template opacity', () => {
      const renderer = new ElementRenderer();
      const ctx = mockCtx();
      renderer.renderCanvasElement(ctx, makeTemplate({ opacity: 0.3 }));

      expect(ctx.globalAlpha).toBe(0.3);
    });
  });

  describe('setters', () => {
    it('setCanvasSize stores dimensions', () => {
      const renderer = new ElementRenderer();
      renderer.setCanvasSize(800, 600);
      const ctx = mockCtx();
      const grid: GridElement = {
        id: 'grid-1',
        type: 'grid',
        position: { x: 0, y: 0 },
        gridType: 'square',
        hexOrientation: 'pointy',
        cellSize: 40,
        strokeColor: '#ccc',
        strokeWidth: 1,
        opacity: 1,
        zIndex: 0,
        locked: false,
        layerId: '',
      };
      renderer.renderCanvasElement(ctx, grid);
      expect(ctx.save).not.toHaveBeenCalled();
    });
  });
});
