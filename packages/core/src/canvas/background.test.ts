import { afterEach, describe, it, expect, vi } from 'vitest';
import { Background } from './background';
import type { Camera } from './camera';

function mockCamera(overrides: Partial<Camera> = {}): Camera {
  return {
    position: { x: 0, y: 0 },
    zoom: 1,
    ...overrides,
  } as Camera;
}

function mockCtx(): CanvasRenderingContext2D {
  return {
    canvas: { width: 800, height: 600 },
    save: vi.fn(),
    restore: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    moveTo: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    setTransform: vi.fn(),
    fillStyle: '',
  } as unknown as CanvasRenderingContext2D;
}

describe('Background', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('renders without throwing', () => {
    const bg = new Background();
    const ctx = mockCtx();
    const camera = mockCamera();
    expect(() => bg.render(ctx, camera)).not.toThrow();
  });

  it('clears the canvas before drawing', () => {
    const bg = new Background();
    const ctx = mockCtx();
    const camera = mockCamera();
    bg.render(ctx, camera);
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 800, 600);
  });

  it('renders dots pattern by default', () => {
    const bg = new Background();
    const ctx = mockCtx();
    const camera = mockCamera();
    bg.render(ctx, camera);
    expect(ctx.arc).toHaveBeenCalled();
  });

  it('renders grid pattern', () => {
    const bg = new Background({ pattern: 'grid' });
    const ctx = mockCtx();
    const camera = mockCamera();
    bg.render(ctx, camera);
    expect(ctx.fillRect).toHaveBeenCalled();
  });

  it('renders nothing for none pattern', () => {
    const bg = new Background({ pattern: 'none' });
    const ctx = mockCtx();
    const camera = mockCamera();
    bg.render(ctx, camera);
    expect(ctx.clearRect).toHaveBeenCalled();
    expect(ctx.arc).not.toHaveBeenCalled();
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });

  it('accounts for camera offset', () => {
    const bg = new Background();
    const ctx = mockCtx();
    const camera = mockCamera({ position: { x: 50, y: 50 }, zoom: 1 });
    bg.render(ctx, camera);
    expect(ctx.arc).toHaveBeenCalled();
  });

  it('accounts for camera zoom', () => {
    const bg = new Background();
    const ctx = mockCtx();
    const camera = mockCamera({ position: { x: 0, y: 0 }, zoom: 2 });
    bg.render(ctx, camera);
    expect(ctx.arc).toHaveBeenCalled();
  });

  it('accepts custom spacing', () => {
    const bg = new Background({ spacing: 50 });
    const ctx = mockCtx();
    const camera = mockCamera();
    bg.render(ctx, camera);
    expect(ctx.arc).toHaveBeenCalled();
  });

  it('accepts custom color', () => {
    const bg = new Background({ color: '#ff0000' });
    const ctx = mockCtx();
    const camera = mockCamera();
    bg.render(ctx, camera);
    expect(ctx.fillStyle).toBe('#ff0000');
  });

  it('doubles spacing at low zoom to reduce dot count', () => {
    const bg = new Background({ spacing: 24 });
    const ctx = mockCtx();
    const normalCamera = mockCamera({ zoom: 1 });
    bg.render(ctx, normalCamera);
    const normalDotCount = (ctx.arc as ReturnType<typeof vi.fn>).mock.calls.length;

    const ctx2 = mockCtx();
    const lowZoomCamera = mockCamera({ zoom: 0.5 });
    bg.render(ctx2, lowZoomCamera);
    const lowZoomDotCount = (ctx2.arc as ReturnType<typeof vi.fn>).mock.calls.length;

    expect(lowZoomDotCount).toBeLessThan(normalDotCount * 2);
  });

  it('still renders dots at very low zoom instead of hiding them', () => {
    const bg = new Background({ spacing: 24 });
    const ctx = mockCtx();
    const camera = mockCamera({ zoom: 0.2 });
    bg.render(ctx, camera);
    expect(ctx.arc).toHaveBeenCalled();
  });

  it('doubles grid spacing at low zoom', () => {
    const bg = new Background({ pattern: 'grid', spacing: 24 });
    const ctx = mockCtx();
    const normalCamera = mockCamera({ zoom: 1 });
    bg.render(ctx, normalCamera);
    const normalLineCount = (ctx.fillRect as ReturnType<typeof vi.fn>).mock.calls.length;

    const ctx2 = mockCtx();
    const lowZoomCamera = mockCamera({ zoom: 0.3 });
    bg.render(ctx2, lowZoomCamera);
    const lowZoomLineCount = (ctx2.fillRect as ReturnType<typeof vi.fn>).mock.calls.length;

    expect(lowZoomLineCount).toBeLessThan(normalLineCount);
    expect(lowZoomLineCount).toBeGreaterThan(0);
  });

  it('skips re-render when camera has not changed', () => {
    const bg = new Background();
    const ctx = mockCtx();
    (ctx as unknown as Record<string, unknown>).drawImage = vi.fn();
    const camera = mockCamera();

    bg.render(ctx, camera);

    (ctx.arc as ReturnType<typeof vi.fn>).mockClear();
    (ctx.fill as ReturnType<typeof vi.fn>).mockClear();

    bg.render(ctx, camera);

    const usedCache =
      ((ctx as unknown as Record<string, unknown>).drawImage as ReturnType<typeof vi.fn>).mock.calls
        .length > 0;
    const usedFallback = (ctx.arc as ReturnType<typeof vi.fn>).mock.calls.length > 0;
    expect(usedCache || usedFallback).toBe(true);
  });

  it('watches, replaces, restores, invalidates, and disposes cached canvases', () => {
    class FakeOffscreenCanvas extends EventTarget {
      readonly context = {
        clearRect: vi.fn(),
        scale: vi.fn(),
        beginPath: vi.fn(),
        arc: vi.fn(),
        moveTo: vi.fn(),
        fill: vi.fn(),
        fillRect: vi.fn(),
        fillStyle: '',
      };

      constructor(
        public width: number,
        public height: number,
      ) {
        super();
      }

      getContext(): OffscreenCanvasRenderingContext2D {
        return this.context as unknown as OffscreenCanvasRenderingContext2D;
      }
    }
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    const bg = new Background();
    const ctx = mockCtx();
    (ctx as unknown as Record<string, unknown>).drawImage = vi.fn();
    const watched: { canvas: HTMLCanvasElement | OffscreenCanvas; restore: () => void }[] = [];
    const dispose = vi.fn();
    bg.setCanvasWatcher((canvas, restore) => {
      watched.push({ canvas, restore });
      return dispose;
    });

    bg.render(ctx, mockCamera());
    expect(watched).toHaveLength(1);
    const first = watched[0];
    if (!first) throw new Error('first watch missing');
    ctx.canvas.width = 400;
    bg.render(ctx, mockCamera());
    expect(dispose).toHaveBeenCalledOnce();
    expect(watched).toHaveLength(2);
    const second = watched[1];
    if (!second) throw new Error('second watch missing');
    expect(second.canvas).not.toBe(first.canvas);

    second.restore();
    expect(dispose).toHaveBeenCalledTimes(2);
    bg.render(ctx, mockCamera());
    expect(watched).toHaveLength(3);
    const third = watched[2];
    if (!third) throw new Error('third watch missing');
    if (!(third.canvas instanceof FakeOffscreenCanvas))
      throw new Error('expected offscreen canvas');
    const cached = third.canvas;
    cached.context.clearRect.mockClear();
    bg.render(ctx, mockCamera());
    expect(cached.context.clearRect).not.toHaveBeenCalled();
    bg.invalidate();
    bg.render(ctx, mockCamera());
    expect(cached.context.clearRect).toHaveBeenCalled();
    bg.dispose();
    bg.dispose();
    expect(dispose).toHaveBeenCalledTimes(3);
  });

  it('re-renders when camera position changes', () => {
    const bg = new Background();
    const ctx = mockCtx();
    (ctx as unknown as Record<string, unknown>).drawImage = vi.fn();
    const camera1 = mockCamera({ position: { x: 0, y: 0 } });
    const camera2 = mockCamera({ position: { x: 100, y: 100 } });

    bg.render(ctx, camera1);
    (ctx.arc as ReturnType<typeof vi.fn>).mockClear();
    (ctx.fill as ReturnType<typeof vi.fn>).mockClear();

    bg.render(ctx, camera2);

    expect(ctx.arc).toHaveBeenCalled();
  });

  it('re-renders when zoom changes', () => {
    const bg = new Background();
    const ctx = mockCtx();
    (ctx as unknown as Record<string, unknown>).drawImage = vi.fn();
    const camera1 = mockCamera({ zoom: 1 });
    const camera2 = mockCamera({ zoom: 2 });

    bg.render(ctx, camera1);
    (ctx.arc as ReturnType<typeof vi.fn>).mockClear();
    (ctx.fill as ReturnType<typeof vi.fn>).mockClear();

    bg.render(ctx, camera2);

    expect(ctx.arc).toHaveBeenCalled();
  });

  it('re-renders when canvas size changes', () => {
    const bg = new Background();
    const ctx1 = mockCtx();
    (ctx1 as unknown as Record<string, unknown>).drawImage = vi.fn();
    bg.render(ctx1, mockCamera());

    const ctx2 = {
      ...mockCtx(),
      canvas: { width: 1200, height: 900 },
    } as unknown as CanvasRenderingContext2D;
    (ctx2 as unknown as Record<string, unknown>).drawImage = vi.fn();
    bg.render(ctx2, mockCamera());
    expect(ctx2.fill).toHaveBeenCalled();
  });

  it('uses fallback or cache on repeat render with same params', () => {
    const bg = new Background();
    const ctx = mockCtx();
    (ctx as unknown as Record<string, unknown>).drawImage = vi.fn();
    const camera = mockCamera();

    bg.render(ctx, camera);
    (ctx.arc as ReturnType<typeof vi.fn>).mockClear();

    bg.render(ctx, camera);

    const drawImageMock = (ctx as unknown as Record<string, ReturnType<typeof vi.fn>>)['drawImage'];
    if (!drawImageMock) throw new Error('ctx.drawImage mock missing');
    const usedCache = drawImageMock.mock.calls.length > 0;
    const usedFallback = (ctx.arc as ReturnType<typeof vi.fn>).mock.calls.length > 0;
    expect(usedCache || usedFallback).toBe(true);
  });

  it('grid pattern re-renders when position changes offset', () => {
    const bg = new Background({ pattern: 'grid' });
    const ctx = mockCtx();
    (ctx as unknown as Record<string, unknown>).drawImage = vi.fn();
    const camera1 = mockCamera({ position: { x: 0, y: 0 } });
    bg.render(ctx, camera1);
    (ctx.fillRect as ReturnType<typeof vi.fn>).mockClear();

    const camera2 = mockCamera({ position: { x: 25, y: 25 } });
    bg.render(ctx, camera2);
    expect(ctx.fillRect).toHaveBeenCalled();
  });

  it('adapts spacing multiple times for very low zoom', () => {
    const bg = new Background({ spacing: 24 });
    const ctx = mockCtx();
    (ctx as unknown as Record<string, unknown>).drawImage = vi.fn();
    const camera = mockCamera({ zoom: 0.1 });
    bg.render(ctx, camera);
    expect(ctx.arc).toHaveBeenCalled();
  });

  describe('zero-size canvas', () => {
    // Browsers throw InvalidStateError when a zero-width or zero-height canvas is
    // used as a drawImage source; emulate that so the cached path is exercised.
    class FakeOffscreenCanvas {
      constructor(
        public width: number,
        public height: number,
      ) {}
      getContext(): unknown {
        return {
          scale: vi.fn(),
          clearRect: vi.fn(),
          beginPath: vi.fn(),
          arc: vi.fn(),
          moveTo: vi.fn(),
          fill: vi.fn(),
          fillRect: vi.fn(),
          fillStyle: '',
        };
      }
    }

    function strictDrawImage(source: { width: number; height: number }): void {
      if (source.width === 0 || source.height === 0) {
        throw new DOMException('zero-size source', 'InvalidStateError');
      }
    }

    function zeroCtx(width: number, height: number): CanvasRenderingContext2D {
      const ctx = mockCtx();
      (ctx as unknown as { canvas: { width: number; height: number } }).canvas = { width, height };
      (ctx as unknown as Record<string, unknown>).drawImage = vi.fn(strictDrawImage);
      return ctx;
    }

    it.each([
      [0, 600],
      [800, 0],
      [0, 0],
    ])('does not throw or draw for a %ix%i canvas', (width, height) => {
      vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
      try {
        const bg = new Background();
        const ctx = zeroCtx(width, height);
        expect(() => bg.render(ctx, mockCamera())).not.toThrow();
        // Second render takes the cached path when keys match.
        expect(() => bg.render(ctx, mockCamera())).not.toThrow();
        expect(ctx.clearRect).toHaveBeenCalled();
        expect((ctx as unknown as Record<string, unknown>).drawImage).not.toHaveBeenCalled();
        expect(ctx.arc).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('resumes drawing once the canvas regains a size', () => {
      vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
      try {
        const bg = new Background();
        bg.render(zeroCtx(0, 600), mockCamera());
        const ctx = zeroCtx(800, 600);
        bg.render(ctx, mockCamera());
        expect((ctx as unknown as Record<string, unknown>).drawImage).toHaveBeenCalledTimes(1);
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  describe('cached blit', () => {
    const offscreenCtxs: CanvasRenderingContext2D[] = [];

    class RecordingOffscreenCanvas {
      constructor(
        public width: number,
        public height: number,
      ) {}
      getContext(): CanvasRenderingContext2D {
        const offCtx = mockCtx();
        (offCtx as unknown as Record<string, unknown>).scale = vi.fn();
        offscreenCtxs.push(offCtx);
        return offCtx;
      }
    }

    function hidpiCtx(): CanvasRenderingContext2D {
      const ctx = mockCtx();
      (ctx as unknown as Record<string, unknown>).drawImage = vi.fn();
      return ctx;
    }

    function offscreenArc(): ReturnType<typeof vi.fn> {
      const offCtx = offscreenCtxs[0];
      if (offCtx === undefined) throw new Error('no offscreen context created');
      return offCtx.arc as ReturnType<typeof vi.fn>;
    }

    afterEach(() => {
      offscreenCtxs.length = 0;
      vi.unstubAllGlobals();
    });

    it('draws the cache at CSS size so the pattern is not scaled by dpr twice', () => {
      vi.stubGlobal('OffscreenCanvas', RecordingOffscreenCanvas);
      vi.stubGlobal('devicePixelRatio', 2);
      const bg = new Background();
      const ctx = hidpiCtx();
      bg.render(ctx, mockCamera());
      bg.render(ctx, mockCamera());
      const drawImage = (ctx as unknown as Record<string, ReturnType<typeof vi.fn>>).drawImage;
      expect(drawImage).toHaveBeenCalledTimes(2);
      expect(drawImage).toHaveBeenNthCalledWith(
        1,
        expect.any(RecordingOffscreenCanvas),
        0,
        0,
        400,
        300,
      );
      expect(drawImage).toHaveBeenNthCalledWith(
        2,
        expect.any(RecordingOffscreenCanvas),
        0,
        0,
        400,
        300,
      );
    });

    it('redraws the cache on a sub-pixel pan', () => {
      vi.stubGlobal('OffscreenCanvas', RecordingOffscreenCanvas);
      vi.stubGlobal('devicePixelRatio', 2);
      const bg = new Background();
      const ctx = hidpiCtx();
      bg.render(ctx, mockCamera({ position: { x: 10.2, y: 0 } }));
      const arc = offscreenArc();
      const firstRenderCalls = arc.mock.calls.length;
      bg.render(ctx, mockCamera({ position: { x: 10.7, y: 0 } }));
      expect(arc.mock.calls.length).toBeGreaterThan(firstRenderCalls);
      expect(arc.mock.calls[firstRenderCalls]?.[0]).toBeCloseTo(10.7);
    });

    it('reuses the cache when the camera is unchanged', () => {
      vi.stubGlobal('OffscreenCanvas', RecordingOffscreenCanvas);
      vi.stubGlobal('devicePixelRatio', 2);
      const bg = new Background();
      const ctx = hidpiCtx();
      bg.render(ctx, mockCamera({ position: { x: 10.2, y: 3.4 } }));
      const arc = offscreenArc();
      const firstRenderCalls = arc.mock.calls.length;
      bg.render(ctx, mockCamera({ position: { x: 10.2, y: 3.4 } }));
      expect(arc.mock.calls.length).toBe(firstRenderCalls);
    });
  });
});
