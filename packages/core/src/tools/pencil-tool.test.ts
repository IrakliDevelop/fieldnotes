import { describe, it, expect, vi } from 'vitest';
import { PencilTool } from './pencil-tool';
import { ElementStore } from '../elements/element-store';
import { Camera } from '../canvas/camera';
import type { ToolContext, PointerState } from './types';
import type { StrokeElement } from '../elements/types';

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    camera: new Camera(),
    store: new ElementStore(),
    requestRender: vi.fn(),
    ...overrides,
  };
}

function pt(x: number, y: number, pressure = 0.5): PointerState {
  return { x, y, pressure };
}

describe('PencilTool', () => {
  it('has name "pencil"', () => {
    const tool = new PencilTool();
    expect(tool.name).toBe('pencil');
  });

  it('creates a stroke element on pointer down + move + up', () => {
    const tool = new PencilTool();
    const ctx = makeCtx();

    tool.onPointerDown(pt(10, 20), ctx);
    tool.onPointerMove(pt(15, 25), ctx);
    tool.onPointerMove(pt(20, 30), ctx);
    tool.onPointerUp(pt(20, 30), ctx);

    expect(ctx.store.count).toBe(1);
    const stroke = ctx.store.getAll()[0] as StrokeElement;
    expect(stroke.type).toBe('stroke');
    expect(stroke.points.length).toBeGreaterThanOrEqual(2);
  });

  it('does not create a stroke if no movement', () => {
    const tool = new PencilTool();
    const ctx = makeCtx();

    tool.onPointerDown(pt(10, 20), ctx);
    tool.onPointerUp(pt(10, 20), ctx);

    expect(ctx.store.count).toBe(0);
  });

  it('converts screen coords to world coords', () => {
    const tool = new PencilTool();
    const camera = new Camera();
    camera.pan(-100, -100);
    const ctx = makeCtx({ camera });

    tool.onPointerDown(pt(50, 50), ctx);
    tool.onPointerMove(pt(60, 60), ctx);
    tool.onPointerUp(pt(60, 60), ctx);

    const stroke = ctx.store.getAll()[0] as StrokeElement;
    expect(stroke.points[0]?.x).not.toBe(50);
  });

  it('requests render on pointer move', () => {
    const tool = new PencilTool();
    const ctx = makeCtx();

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(10, 10), ctx);

    expect(ctx.requestRender).toHaveBeenCalled();
  });

  it('uses configured color and width', () => {
    const tool = new PencilTool({ color: '#ff0000', width: 5 });
    const ctx = makeCtx();

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(10, 10), ctx);
    tool.onPointerUp(pt(10, 10), ctx);

    const stroke = ctx.store.getAll()[0] as StrokeElement;
    expect(stroke.color).toBe('#ff0000');
    expect(stroke.width).toBe(5);
  });

  it('captures pressure data in stroke points', () => {
    const tool = new PencilTool();
    const ctx = makeCtx();

    tool.onPointerDown(pt(0, 0, 0.3), ctx);
    tool.onPointerMove(pt(10, 10, 0.7), ctx);
    tool.onPointerMove(pt(20, 20, 1.0), ctx);
    tool.onPointerUp(pt(20, 20, 1.0), ctx);

    const stroke = ctx.store.getAll()[0] as StrokeElement;
    for (const p of stroke.points) {
      expect(p.pressure).toBeGreaterThan(0);
    }
  });

  it('defaults pressure to 0.5 when reported as 0', () => {
    const tool = new PencilTool();
    const ctx = makeCtx();

    tool.onPointerDown(pt(0, 0, 0), ctx);
    tool.onPointerMove(pt(10, 10, 0), ctx);
    tool.onPointerUp(pt(10, 10, 0), ctx);

    const stroke = ctx.store.getAll()[0] as StrokeElement;
    for (const p of stroke.points) {
      expect(p.pressure).toBe(0.5);
    }
  });

  it('simplifies points on commit', () => {
    const tool = new PencilTool();
    const ctx = makeCtx();

    tool.onPointerDown(pt(0, 0), ctx);
    for (let i = 1; i <= 20; i++) {
      tool.onPointerMove(pt(i, i), ctx);
    }
    tool.onPointerUp(pt(20, 20), ctx);

    const stroke = ctx.store.getAll()[0] as StrokeElement;
    expect(stroke.points.length).toBeLessThan(21);
  });

  it('ignores pointer move when not drawing', () => {
    const tool = new PencilTool();
    const ctx = makeCtx();

    tool.onPointerMove(pt(10, 10), ctx);
    expect(ctx.requestRender).not.toHaveBeenCalled();
  });

  describe('getOptions', () => {
    it('returns current options', () => {
      const tool = new PencilTool({ color: '#ff0000', width: 5, smoothing: 2 });
      const opts = tool.getOptions();
      expect(opts.color).toBe('#ff0000');
      expect(opts.width).toBe(5);
      expect(opts.smoothing).toBe(2);
    });

    it('reflects changes from setOptions', () => {
      const tool = new PencilTool();
      tool.setOptions({ color: '#00ff00' });
      const opts = tool.getOptions();
      expect(opts.color).toBe('#00ff00');
      expect(opts.width).toBe(2);
      expect(opts.smoothing).toBe(1.5);
    });
  });

  describe('point subsampling', () => {
    it('skips points closer than minPointDistance', () => {
      const tool = new PencilTool({ minPointDistance: 5 });
      const ctx = makeCtx();

      tool.onPointerDown(pt(0, 0), ctx);
      // Move only 1 pixel — should be skipped
      tool.onPointerMove(pt(1, 0), ctx);
      // Move 10 pixels — should be added
      tool.onPointerMove(pt(10, 0), ctx);
      tool.onPointerUp(pt(10, 0), ctx);

      // Should have 2 points (start + the 10px move), not 3
      const added = ctx.store.getAll();
      expect(added.length).toBe(1);
      const stroke = added[0];
      if (!stroke || stroke.type !== 'stroke') throw new Error('expected stroke');
      expect(stroke.points.length).toBe(2);
    });

    it('always accepts the first point', () => {
      const tool = new PencilTool({ minPointDistance: 100 });
      const ctx = makeCtx();

      tool.onPointerDown(pt(0, 0), ctx);
      tool.onPointerUp(pt(0, 0), ctx);
      // Too few points for a stroke — nothing added, but no error
      expect(ctx.store.count).toBe(0);
    });

    it('exposes minPointDistance and progressiveSimplifyThreshold via getOptions', () => {
      const tool = new PencilTool({ minPointDistance: 10, progressiveSimplifyThreshold: 500 });
      const opts = tool.getOptions();
      expect(opts.minPointDistance).toBe(10);
      expect(opts.progressiveSimplifyThreshold).toBe(500);
    });

    it('updates minPointDistance via setOptions', () => {
      const tool = new PencilTool();
      tool.setOptions({ minPointDistance: 20 });
      expect(tool.getOptions().minPointDistance).toBe(20);
    });

    it('progressively simplifies long strokes to stay bounded', () => {
      const tool = new PencilTool({
        minPointDistance: 0,
        progressiveSimplifyThreshold: 20,
      });
      const ctx = makeCtx();

      tool.onPointerDown(pt(0, 0), ctx);
      for (let i = 1; i <= 50; i++) {
        tool.onPointerMove(pt(i * 10, i % 5), ctx);
      }
      tool.onPointerUp(pt(500, 0), ctx);

      const stroke = ctx.store.getAll()[0];
      if (!stroke || stroke.type !== 'stroke') throw new Error('expected stroke');
      // With threshold 20 and 51 raw points, simplification should have reduced the count
      expect(stroke.points.length).toBeLessThan(51);
      expect(stroke.points.length).toBeGreaterThan(2);
    });
  });

  describe('onOptionsChange', () => {
    it('fires listener when setOptions is called', () => {
      const tool = new PencilTool();
      const listener = vi.fn();
      tool.onOptionsChange(listener);
      tool.setOptions({ color: '#ff0000' });
      expect(listener).toHaveBeenCalledOnce();
    });

    it('returns unsubscribe function', () => {
      const tool = new PencilTool();
      const listener = vi.fn();
      const unsub = tool.onOptionsChange(listener);
      unsub();
      tool.setOptions({ color: '#ff0000' });
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('renderOverlay', () => {
    function mockCanvas(): CanvasRenderingContext2D {
      return {
        save: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        bezierCurveTo: vi.fn(),
        stroke: vi.fn(),
        strokeStyle: '',
        lineWidth: 0,
        lineCap: '',
        lineJoin: '',
        globalAlpha: 1,
      } as unknown as CanvasRenderingContext2D;
    }

    it('renders in-progress stroke while drawing', () => {
      const tool = new PencilTool();
      const ctx = makeCtx();
      const canvas = mockCanvas();

      tool.onPointerDown(pt(0, 0), ctx);
      tool.onPointerMove(pt(10, 10), ctx);
      tool.renderOverlay?.(canvas);

      expect(canvas.beginPath).toHaveBeenCalled();
      expect(canvas.stroke).toHaveBeenCalled();
    });

    it('does not render overlay when not drawing', () => {
      const tool = new PencilTool();
      const canvas = mockCanvas();

      tool.renderOverlay?.(canvas);

      expect(canvas.beginPath).not.toHaveBeenCalled();
    });
  });
});
