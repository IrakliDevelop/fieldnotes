/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { LayerCache } from './layer-cache';

describe('LayerCache', () => {
  let cache: LayerCache;

  beforeEach(() => {
    cache = new LayerCache(800, 600);
  });

  it('marks a specific layer dirty', () => {
    expect(cache.isDirty('layer1')).toBe(true);
    cache.markClean('layer1');
    expect(cache.isDirty('layer1')).toBe(false);
    cache.markDirty('layer1');
    expect(cache.isDirty('layer1')).toBe(true);
  });

  it('marks all layers dirty', () => {
    cache.markClean('layer1');
    cache.markClean('layer2');
    cache.markAllDirty();
    expect(cache.isDirty('layer1')).toBe(true);
    expect(cache.isDirty('layer2')).toBe(true);
  });

  it('returns a canvas for a layer', () => {
    const canvas = cache.getCanvas('layer1');
    expect(canvas).toBeDefined();
    expect(canvas.width).toBeGreaterThan(0);
    expect(canvas.height).toBeGreaterThan(0);
  });

  it('returns the same canvas on subsequent calls', () => {
    const c1 = cache.getCanvas('layer1');
    const c2 = cache.getCanvas('layer1');
    expect(c1).toBe(c2);
  });

  it('resizes all canvases', () => {
    cache.getCanvas('layer1');
    cache.resize(1024, 768);
    const canvas = cache.getCanvas('layer1');
    expect(canvas.width).toBeGreaterThan(0);
  });

  it('clears all state', () => {
    cache.getCanvas('layer1');
    cache.markClean('layer1');
    cache.clear();
    expect(cache.isDirty('layer1')).toBe(true);
  });

  it('returns a context for a layer', () => {
    const ctx = cache.getContext('layer1');
    expect(ctx).toBeDefined();
  });

  it('marks newly created canvases as dirty', () => {
    cache.getCanvas('new-layer');
    expect(cache.isDirty('new-layer')).toBe(true);
  });

  it('marks all canvases dirty after resize', () => {
    cache.getCanvas('layer1');
    cache.markClean('layer1');
    expect(cache.isDirty('layer1')).toBe(false);
    cache.resize(1024, 768);
    expect(cache.isDirty('layer1')).toBe(true);
  });
});
