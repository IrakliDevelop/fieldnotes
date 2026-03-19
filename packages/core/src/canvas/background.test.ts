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
});
