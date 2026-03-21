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
