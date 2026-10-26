// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { HybridRenderSurface } from './hybrid-render-surface';

describe('HybridRenderSurface', () => {
  it('creates, reuses, sizes, and removes canvas strata by paint order', () => {
    const root = document.createElement('div');
    const surface = new HybridRenderSurface(root);
    const context = {} as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);

    surface.beginFrame(new Set([2, 4]), 800, 600);
    const first = root.querySelector<HTMLCanvasElement>('canvas[data-paint-order="2"]');
    expect(first?.width).toBe(800);
    expect(first?.height).toBe(600);
    expect(first?.style.zIndex).toBe('2');
    expect(surface.getContext(2)).toBe(context);

    surface.beginFrame(new Set([2]), 1600, 1200);
    expect(root.querySelector('canvas[data-paint-order="2"]')).toBe(first);
    expect(first?.width).toBe(1600);
    expect(root.querySelector('canvas[data-paint-order="4"]')).toBeNull();
  });

  it('disposes watches when canvases leave a frame, restore, or clear', () => {
    const root = document.createElement('div');
    const dispose = vi.fn();
    let restore: (() => void) | undefined;
    const surface = new HybridRenderSurface(root, (_canvas, callback) => {
      restore = callback;
      return dispose;
    });
    surface.beginFrame(new Set([2]), 800, 600);
    restore?.();
    expect(dispose).toHaveBeenCalledOnce();
    expect(root.querySelector('canvas')).toBeNull();
    surface.beginFrame(new Set([4]), 800, 600);
    surface.beginFrame(new Set(), 800, 600);
    expect(dispose).toHaveBeenCalledTimes(2);
    surface.beginFrame(new Set([6]), 800, 600);
    expect(root.querySelector('canvas[data-paint-order="6"]')).not.toBeNull();
    surface.clear();
    expect(dispose).toHaveBeenCalledTimes(3);
  });
});
