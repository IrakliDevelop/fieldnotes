import { describe, it, expect, vi } from 'vitest';
import { Camera } from './camera';

describe('Camera', () => {
  it('initializes at origin with zoom 1', () => {
    const camera = new Camera();
    expect(camera.position).toEqual({ x: 0, y: 0 });
    expect(camera.zoom).toBe(1);
  });

  it('pans by a delta', () => {
    const camera = new Camera();
    camera.pan(100, -50);
    expect(camera.position).toEqual({ x: 100, y: -50 });
  });

  it('accumulates multiple pans', () => {
    const camera = new Camera();
    camera.pan(10, 20);
    camera.pan(30, 40);
    expect(camera.position).toEqual({ x: 40, y: 60 });
  });

  it('moves to an absolute position', () => {
    const camera = new Camera();
    camera.pan(100, 100);
    camera.moveTo(0, 0);
    expect(camera.position).toEqual({ x: 0, y: 0 });
  });

  it('zooms within bounds', () => {
    const camera = new Camera();
    camera.setZoom(2);
    expect(camera.zoom).toBe(2);
  });

  it('clamps zoom to min', () => {
    const camera = new Camera({ minZoom: 0.1 });
    camera.setZoom(0.01);
    expect(camera.zoom).toBe(0.1);
  });

  it('clamps zoom to max', () => {
    const camera = new Camera({ maxZoom: 5 });
    camera.setZoom(10);
    expect(camera.zoom).toBe(5);
  });

  it('zooms at a point, keeping that point stationary', () => {
    const camera = new Camera();
    camera.zoomAt(2, { x: 100, y: 100 });

    expect(camera.zoom).toBe(2);
    expect(camera.position.x).toBeCloseTo(-100);
    expect(camera.position.y).toBeCloseTo(-100);
  });

  it('converts screen coords to world coords', () => {
    const camera = new Camera();
    camera.pan(-50, -50);
    camera.setZoom(2);

    const world = camera.screenToWorld({ x: 100, y: 100 });
    expect(world.x).toBeCloseTo(75);
    expect(world.y).toBeCloseTo(75);
  });

  it('converts world coords to screen coords', () => {
    const camera = new Camera();
    camera.pan(-50, -50);
    camera.setZoom(2);

    const screen = camera.worldToScreen({ x: 75, y: 75 });
    expect(screen.x).toBeCloseTo(100);
    expect(screen.y).toBeCloseTo(100);
  });

  it('round-trips screen -> world -> screen', () => {
    const camera = new Camera();
    camera.pan(123, -456);
    camera.setZoom(1.7);

    const original = { x: 300, y: 250 };
    const world = camera.screenToWorld(original);
    const back = camera.worldToScreen(world);

    expect(back.x).toBeCloseTo(original.x);
    expect(back.y).toBeCloseTo(original.y);
  });

  it('emits change event with panned=true on pan', () => {
    const camera = new Camera();
    const listener = vi.fn();
    camera.onChange(listener);

    camera.pan(10, 10);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({ panned: true, zoomed: false });
  });

  it('emits change event with zoomed=true on setZoom', () => {
    const camera = new Camera();
    const listener = vi.fn();
    camera.onChange(listener);

    camera.setZoom(2);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({ panned: false, zoomed: true });
  });

  it('emits change event with panned=true on moveTo', () => {
    const camera = new Camera();
    const listener = vi.fn();
    camera.onChange(listener);

    camera.moveTo(50, 50);
    expect(listener).toHaveBeenCalledWith({ panned: true, zoomed: false });
  });

  it('emits change event with panned and zoomed on zoomAt', () => {
    const camera = new Camera();
    const listener = vi.fn();
    camera.onChange(listener);

    camera.zoomAt(2, { x: 100, y: 100 });
    expect(listener).toHaveBeenCalledWith({ panned: true, zoomed: true });
  });

  it('returns visible rect at default camera state', () => {
    const camera = new Camera();
    const rect = camera.getVisibleRect(800, 600);
    expect(rect).toEqual({ x: 0, y: 0, w: 800, h: 600 });
  });

  it('returns visible rect after panning', () => {
    const camera = new Camera();
    camera.pan(-100, -50);
    const rect = camera.getVisibleRect(800, 600);
    expect(rect.x).toBeCloseTo(100);
    expect(rect.y).toBeCloseTo(50);
    expect(rect.w).toBeCloseTo(800);
    expect(rect.h).toBeCloseTo(600);
  });

  it('returns visible rect after zooming', () => {
    const camera = new Camera();
    camera.setZoom(2);
    const rect = camera.getVisibleRect(800, 600);
    expect(rect.x).toBeCloseTo(0);
    expect(rect.y).toBeCloseTo(0);
    expect(rect.w).toBeCloseTo(400);
    expect(rect.h).toBeCloseTo(300);
  });

  it('provides a CSS transform string', () => {
    const camera = new Camera();
    camera.pan(50, -30);
    camera.setZoom(1.5);

    const transform = camera.toCSSTransform();
    expect(transform).toBe('translate3d(50px, -30px, 0) scale(1.5)');
  });

  describe('fitToContent', () => {
    it('centers a bounding box in the viewport', () => {
      const camera = new Camera();
      camera.fitToContent({ x: 100, y: 100, w: 200, h: 100 }, 800, 600);

      const zoom = camera.zoom;
      expect(zoom).toBeCloseTo(800 / 280);

      const expectedX = (800 - 200 * zoom) / 2 - 100 * zoom;
      const expectedY = (600 - 100 * zoom) / 2 - 100 * zoom;
      expect(camera.position.x).toBeCloseTo(expectedX);
      expect(camera.position.y).toBeCloseTo(expectedY);
    });

    it('respects custom padding', () => {
      const camera = new Camera();
      camera.fitToContent({ x: 0, y: 0, w: 400, h: 300 }, 800, 600, 100);

      expect(camera.zoom).toBeCloseTo(1.2);
    });

    it('clamps zoom to maxZoom', () => {
      const camera = new Camera({ maxZoom: 2 });
      camera.fitToContent({ x: 0, y: 0, w: 10, h: 10 }, 800, 600);
      expect(camera.zoom).toBe(2);
    });

    it('clamps zoom to minZoom', () => {
      const camera = new Camera({ minZoom: 0.5 });
      camera.fitToContent({ x: 0, y: 0, w: 10000, h: 10000 }, 800, 600);
      expect(camera.zoom).toBe(0.5);
    });

    it('is a no-op for zero-size bounding box', () => {
      const camera = new Camera();
      camera.pan(50, 50);
      camera.setZoom(2);
      camera.fitToContent({ x: 100, y: 100, w: 0, h: 0 }, 800, 600);
      expect(camera.position).toEqual({ x: 50, y: 50 });
      expect(camera.zoom).toBe(2);
    });

    it('notifies listeners with panned and zoomed', () => {
      const camera = new Camera();
      const listener = vi.fn();
      camera.onChange(listener);
      camera.fitToContent({ x: 0, y: 0, w: 200, h: 100 }, 800, 600);
      expect(listener).toHaveBeenCalledWith({ panned: true, zoomed: true });
    });
  });

  describe('edge cases', () => {
    it('clamps zoom to maxZoom when given very large value', () => {
      const camera = new Camera({ maxZoom: 5 });
      camera.setZoom(1e10);
      expect(camera.zoom).toBe(5);
    });

    it('clamps zoom to minZoom when given very small value', () => {
      const camera = new Camera({ minZoom: 0.2 });
      camera.setZoom(1e-10);
      expect(camera.zoom).toBe(0.2);
    });

    it('handles pan with very large values without crashing', () => {
      const camera = new Camera();
      camera.pan(1e10, 1e10);
      expect(camera.position).toEqual({ x: 1e10, y: 1e10 });
      expect(Number.isFinite(camera.position.x)).toBe(true);
      expect(Number.isFinite(camera.position.y)).toBe(true);
    });

    it('does not allow zoom below minZoom with negative value', () => {
      const camera = new Camera({ minZoom: 0.1 });
      camera.setZoom(-5);
      expect(camera.zoom).toBe(0.1);
    });
  });

  describe('constraints', () => {
    it('rejects invalid zoom bounds and clamps its initial zoom', () => {
      for (const options of [
        { minZoom: 0 },
        { maxZoom: 0 },
        { minZoom: -1 },
        { maxZoom: -1 },
        { minZoom: Number.NaN },
        { maxZoom: Number.POSITIVE_INFINITY },
        { minZoom: 2, maxZoom: 1 },
      ]) {
        expect(() => new Camera(options)).toThrow();
      }
      expect(new Camera({ minZoom: 2, maxZoom: 4 }).zoom).toBe(2);
      expect(new Camera({ minZoom: 0.1, maxZoom: 0.5 }).zoom).toBe(0.5);
    });

    it('composes constraints in registration order against one committed previous state', () => {
      const camera = new Camera();
      const seen: { next: number; previous: number }[] = [];
      camera.addConstraint((next, previous) => {
        seen.push({ next: next.position.x, previous: previous.position.x });
        return { position: { x: next.position.x + 10, y: next.position.y }, zoom: next.zoom };
      });
      camera.addConstraint((next, previous) => {
        seen.push({ next: next.position.x, previous: previous.position.x });
        return { position: { x: next.position.x * 2, y: next.position.y }, zoom: next.zoom };
      });

      camera.moveTo(3, 4);

      expect(seen).toEqual([
        { next: 3, previous: 0 },
        { next: 13, previous: 0 },
      ]);
      expect(camera.position).toEqual({ x: 26, y: 4 });
    });

    it('keeps duplicate registrations independent and snapshots the chain per write', () => {
      const camera = new Camera();
      const add = vi.fn((next) => ({
        ...next,
        position: { x: next.position.x + 1, y: next.position.y },
      }));
      const first = camera.addConstraint(add);
      const second = camera.addConstraint(add);
      first();
      first();
      camera.moveTo(0, 0);
      expect(add).toHaveBeenCalledOnce();

      let removeLater: () => void = () => undefined;
      const later = vi.fn((next) => next);
      camera.addConstraint((next) => {
        removeLater();
        camera.addConstraint(later);
        return next;
      });
      removeLater = camera.addConstraint(later);
      camera.moveTo(2, 0);
      expect(later).toHaveBeenCalledTimes(1);
      camera.moveTo(3, 0);
      expect(later).toHaveBeenCalledTimes(2);
      second();
    });

    it('sends every camera write path through constraints', () => {
      const camera = new Camera();
      const constraint = vi.fn((next) => next);
      camera.addConstraint(constraint);
      camera.pan(1, 2);
      camera.moveTo(3, 4);
      camera.setZoom(2);
      camera.zoomAt(3, { x: 20, y: 30 });
      camera.fitToContent({ x: 0, y: 0, w: 100, h: 50 }, 500, 400);
      expect(constraint).toHaveBeenCalledTimes(5);
    });

    it('builds zoomAt anchoring before constraints and clamps before and after them', () => {
      const camera = new Camera({ minZoom: 0.5, maxZoom: 2 });
      const values: { position: { x: number; y: number }; zoom: number }[] = [];
      camera.addConstraint((next) => {
        values.push({ position: { ...next.position }, zoom: next.zoom });
        return { ...next, zoom: 99 };
      });
      camera.zoomAt(10, { x: 40, y: 20 });
      expect(values).toEqual([{ position: { x: -40, y: -20 }, zoom: 2 }]);
      expect(camera.zoom).toBe(2);
    });

    it('rolls back invalid direct writes and failed constraint results without notification', () => {
      const camera = new Camera();
      camera.moveTo(5, 6);
      camera.setZoom(2);
      const listener = vi.fn();
      camera.onChange(listener);
      expect(() => camera.moveTo(Number.NaN, 0)).toThrow();
      camera.addConstraint(() => ({ position: { x: Infinity, y: 0 }, zoom: 1 }));
      expect(() => camera.pan(1, 1)).toThrow();
      expect(camera.position).toEqual({ x: 5, y: 6 });
      expect(camera.zoom).toBe(2);
      expect(listener).not.toHaveBeenCalled();
    });

    it('rolls back non-positive and non-finite constraint zoom outputs', () => {
      for (const zoom of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        const camera = new Camera();
        const listener = vi.fn();
        camera.onChange(listener);
        camera.addConstraint((next) => ({ ...next, zoom }));
        expect(() => camera.setZoom(2)).toThrow();
        expect(camera.zoom).toBe(1);
        expect(listener).not.toHaveBeenCalled();
      }
    });

    it('copies returned states before committing them', () => {
      const camera = new Camera();
      const returned = { position: { x: 12, y: 34 }, zoom: 2 };
      camera.addConstraint(() => returned);
      camera.pan(1, 1);
      returned.position.x = 999;
      returned.zoom = 9;
      expect(camera.position).toEqual({ x: 12, y: 34 });
      expect(camera.zoom).toBe(2);
    });

    it('rolls back a thrown constraint and makes equal writes silent', () => {
      const camera = new Camera();
      const listener = vi.fn();
      camera.onChange(listener);
      camera.addConstraint(() => {
        throw new Error('nope');
      });
      expect(() => camera.setZoom(2)).toThrow('nope');
      expect(listener).not.toHaveBeenCalled();

      const quiet = new Camera();
      const quietListener = vi.fn();
      quiet.onChange(quietListener);
      quiet.addConstraint((next) => ({ position: { ...next.position }, zoom: next.zoom }));
      quiet.moveTo(0, 0);
      expect(quietListener).not.toHaveBeenCalled();
    });

    it('reports flags from the committed result rather than the requested operation', () => {
      const camera = new Camera();
      const listener = vi.fn();
      camera.onChange(listener);
      camera.addConstraint((next) => ({
        position: { x: next.position.x, y: next.position.y + 9 },
        zoom: next.zoom + 1,
      }));
      camera.pan(2, 0);
      expect(listener).toHaveBeenCalledWith({ panned: true, zoomed: true });
    });
  });
});
