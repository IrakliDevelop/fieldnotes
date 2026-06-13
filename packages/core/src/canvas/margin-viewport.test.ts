import { describe, it, expect, vi } from 'vitest';
import { MarginViewport } from './margin-viewport';

function setup(margin = 256, cssW = 800, cssH = 600, dpr = 1) {
  const mv = new MarginViewport(margin);
  mv.setViewport(cssW, cssH, dpr);
  return mv;
}

describe('MarginViewport.physical size', () => {
  it('inflates by 2x margin and scales by dpr', () => {
    const mv = setup(256, 800, 600, 2);
    expect(mv.physicalWidth()).toBe(Math.round((800 + 512) * 2)); // 2624
    expect(mv.physicalHeight()).toBe(Math.round((600 + 512) * 2)); // 2224
  });
  it('margin 0 collapses to exact viewport', () => {
    const mv = setup(0, 800, 600, 1);
    expect(mv.physicalWidth()).toBe(800);
    expect(mv.physicalHeight()).toBe(600);
  });
});

describe('MarginViewport.needsRecenter', () => {
  it('is true on the first frame (sentinel anchor)', () => {
    const mv = setup();
    expect(mv.needsRecenter(0, 0, 1)).toBe(true);
  });
  it('is false for a pan strictly within the margin at the same zoom', () => {
    const mv = setup(256);
    mv.recenter(0, 0, 1);
    expect(mv.needsRecenter(200, -200, 1)).toBe(false);
    expect(mv.needsRecenter(256, 256, 1)).toBe(false);
  });
  it('is true just beyond the margin', () => {
    const mv = setup(256);
    mv.recenter(0, 0, 1);
    expect(mv.needsRecenter(257, 0, 1)).toBe(true);
    expect(mv.needsRecenter(0, -257, 1)).toBe(true);
  });
  it('is true on any zoom change', () => {
    const mv = setup(256);
    mv.recenter(0, 0, 1);
    expect(mv.needsRecenter(0, 0, 1.0001)).toBe(true);
  });
  it('is true after the viewport dimensions or dpr change', () => {
    const mv = setup(256);
    mv.recenter(0, 0, 1);
    expect(mv.needsRecenter(0, 0, 1)).toBe(false);
    mv.setViewport(1024, 600, 1);
    expect(mv.needsRecenter(0, 0, 1)).toBe(true);
  });
  it('recenter clears the viewport-dirty flag', () => {
    const mv = setup(256);
    mv.setViewport(1024, 768, 2);
    mv.recenter(10, 20, 1);
    expect(mv.needsRecenter(10, 20, 1)).toBe(false);
  });
  it('is true after setMargin changes the margin', () => {
    const mv = setup(256);
    mv.recenter(0, 0, 1);
    expect(mv.needsRecenter(0, 0, 1)).toBe(false);
    mv.setMargin(128);
    expect(mv.needsRecenter(0, 0, 1)).toBe(true);
  });
});

describe('MarginViewport.compositeOffset', () => {
  it('is (-margin*dpr) on both axes at zero pan', () => {
    const mv = setup(256, 800, 600, 2);
    mv.recenter(0, 0, 1);
    expect(mv.compositeOffset(0, 0)).toEqual({ x: -512, y: -512 });
  });
  it('tracks the pan delta in device pixels', () => {
    const mv = setup(256, 800, 600, 2);
    mv.recenter(0, 0, 1);
    expect(mv.compositeOffset(100, -50)).toEqual({ x: (100 - 256) * 2, y: (-50 - 256) * 2 });
  });
});

describe('MarginViewport.applyRenderTransform', () => {
  it('issues scale(dpr) translate(margin+anchorCam) scale(zoom)', () => {
    const mv = setup(256, 800, 600, 2);
    mv.recenter(30, 40, 1.5);
    const ctx = { scale: vi.fn(), translate: vi.fn() } as unknown as CanvasRenderingContext2D;
    mv.applyRenderTransform(ctx);
    expect((ctx.scale as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([2, 2]);
    expect((ctx.translate as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([256 + 30, 256 + 40]);
    expect((ctx.scale as ReturnType<typeof vi.fn>).mock.calls[1]).toEqual([1.5, 1.5]);
  });
});

describe('MarginViewport.cachedWorldBounds', () => {
  it('covers the margin-inflated viewport in world space at the anchor', () => {
    const mv = setup(256, 800, 600, 1);
    mv.recenter(0, 0, 2);
    const b = mv.cachedWorldBounds();
    expect(b.x).toBe((-256 - 0) / 2);
    expect(b.w).toBe((800 + 512) / 2);
  });
});
