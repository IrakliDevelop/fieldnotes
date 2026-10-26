/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LayerCache } from './layer-cache';
import { MarginViewport } from './margin-viewport';

describe('LayerCache', () => {
  let cache: LayerCache;
  let mv: MarginViewport;

  beforeEach(() => {
    mv = new MarginViewport(256);
    mv.setViewport(800, 600, 1);
    cache = new LayerCache(mv);
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
    mv.setViewport(1024, 768, 1);
    cache.resize();
    const canvas = cache.getCanvas('layer1');
    expect(canvas.width).toBeGreaterThan(0);
  });

  it('clears all state', () => {
    cache.getCanvas('layer1');
    cache.markClean('layer1');
    cache.clear();
    expect(cache.isDirty('layer1')).toBe(true);
  });

  it('retain drops only the canvases of rejected layers', () => {
    const removed = cache.getCanvas('layer1');
    const kept = cache.getCanvas('layer2');
    cache.markClean('layer2');
    cache.retain((id) => id === 'layer2');
    expect(cache.getCanvas('layer1')).not.toBe(removed);
    expect(cache.getCanvas('layer2')).toBe(kept);
    expect(cache.isDirty('layer2')).toBe(false);
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
    mv.setViewport(1024, 768, 1);
    cache.resize();
    expect(cache.isDirty('layer1')).toBe(true);
  });

  it('keeps a separate canvas and dirty flag per part', () => {
    const under = cache.getCanvas('layer1', 'under');
    const over = cache.getCanvas('layer1', 'over');
    expect(under).not.toBe(over);
    expect(under).not.toBe(cache.getCanvas('layer1'));
    cache.markClean('layer1', 'under');
    expect(cache.isDirty('layer1', 'under')).toBe(false);
    expect(cache.isDirty('layer1', 'over')).toBe(true);
  });

  it('markDirty dirties every part of the layer', () => {
    cache.getCanvas('layer1', 'under');
    cache.getCanvas('layer1', 'over');
    cache.markClean('layer1', 'under');
    cache.markClean('layer1', 'over');
    cache.markDirty('layer1');
    expect(cache.isDirty('layer1', 'under')).toBe(true);
    expect(cache.isDirty('layer1', 'over')).toBe(true);
  });

  it('frees the split parts once the whole layer is rasterised again', () => {
    const under = cache.getCanvas('layer1', 'under');
    cache.markClean('layer1', 'under');
    cache.markClean('layer1');
    expect(cache.isDirty('layer1', 'under')).toBe(true);
    expect(cache.getCanvas('layer1', 'under')).not.toBe(under);
  });

  it('retain and clear drop every part', () => {
    const under = cache.getCanvas('layer1', 'under');
    cache.retain(() => false);
    expect(cache.getCanvas('layer1', 'under')).not.toBe(under);
    const over = cache.getCanvas('layer1', 'over');
    cache.clear();
    expect(cache.getCanvas('layer1', 'over')).not.toBe(over);
  });

  it('allocates canvases at the MarginViewport physical size', () => {
    const testMv = new MarginViewport(256);
    testMv.setViewport(800, 600, 1);
    const testCache = new LayerCache(testMv);
    const canvas = testCache.getCanvas('layer1');
    expect(canvas.width).toBe(testMv.physicalWidth()); // 1312
    expect(canvas.height).toBe(testMv.physicalHeight()); // 1112
  });

  it('disposes watches when split parts are superseded, retained, cleared, or restored', () => {
    const dispose = vi.fn();
    let restore: (() => void) | undefined;
    const watched = new LayerCache(mv, (_canvas, callback) => {
      restore = callback;
      return dispose;
    });
    watched.getCanvas('one', 'under');
    watched.markClean('one');
    expect(dispose).toHaveBeenCalledOnce();
    watched.getCanvas('two');
    watched.retain(() => false);
    expect(dispose).toHaveBeenCalledTimes(2);
    watched.getCanvas('three');
    const restored = watched.getCanvas('three');
    restore?.();
    expect(dispose).toHaveBeenCalledTimes(3);
    expect(watched.getCanvas('three')).not.toBe(restored);
    watched.clear();
    expect(dispose).toHaveBeenCalledTimes(4);
  });
});
