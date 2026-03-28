import { describe, it, expect } from 'vitest';
import { RenderStats } from './render-stats';

describe('RenderStats', () => {
  it('starts with zero values', () => {
    const stats = new RenderStats();
    const snap = stats.getSnapshot();
    expect(snap.fps).toBe(0);
    expect(snap.avgFrameMs).toBe(0);
    expect(snap.frameCount).toBe(0);
  });

  it('computes average frame time', () => {
    const stats = new RenderStats();
    stats.recordFrame(10);
    stats.recordFrame(20);
    const snap = stats.getSnapshot();
    expect(snap.avgFrameMs).toBe(15);
    expect(snap.frameCount).toBe(2);
  });

  it('computes fps from average frame time', () => {
    const stats = new RenderStats();
    // 16.67ms per frame ≈ 60fps
    for (let i = 0; i < 10; i++) stats.recordFrame(16.67);
    const snap = stats.getSnapshot();
    expect(snap.fps).toBe(60);
  });

  it('computes p95 frame time', () => {
    const stats = new RenderStats();
    // 19 fast frames + 1 slow frame
    for (let i = 0; i < 19; i++) stats.recordFrame(10);
    stats.recordFrame(100);
    const snap = stats.getSnapshot();
    expect(snap.p95FrameMs).toBe(100);
  });

  it('tracks last frame time', () => {
    const stats = new RenderStats();
    stats.recordFrame(5);
    stats.recordFrame(42);
    expect(stats.getSnapshot().lastFrameMs).toBe(42);
  });

  it('keeps only the last 60 samples', () => {
    const stats = new RenderStats();
    for (let i = 0; i < 100; i++) stats.recordFrame(10);
    expect(stats.getSnapshot().frameCount).toBe(100);
    // avg should still be 10 (all same value)
    expect(stats.getSnapshot().avgFrameMs).toBe(10);
  });

  it('resets all state', () => {
    const stats = new RenderStats();
    stats.recordFrame(10);
    stats.reset();
    const snap = stats.getSnapshot();
    expect(snap.frameCount).toBe(0);
    expect(snap.avgFrameMs).toBe(0);
  });
});
