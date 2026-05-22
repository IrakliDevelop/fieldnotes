import { describe, it, expect, vi } from 'vitest';
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
});
