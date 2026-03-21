import { describe, it, expect, vi } from 'vitest';
import { ArrowTool } from './arrow-tool';
import { ElementStore } from '../elements/element-store';
import { Camera } from '../canvas/camera';
import type { ToolContext, PointerState } from './types';
import type { ArrowElement } from '../elements/types';

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    camera: new Camera(),
    store: new ElementStore(),
    requestRender: vi.fn(),
    ...overrides,
  };
}

function pt(x: number, y: number): PointerState {
  return { x, y, pressure: 0.5 };
}

describe('ArrowTool', () => {
  it('has name "arrow"', () => {
    expect(new ArrowTool().name).toBe('arrow');
  });

  it('creates an arrow from drag start to end', () => {
    const tool = new ArrowTool();
    const ctx = makeCtx();

    tool.onPointerDown(pt(10, 20), ctx);
    tool.onPointerMove(pt(100, 200), ctx);
    tool.onPointerUp(pt(100, 200), ctx);

    expect(ctx.store.count).toBe(1);
    const arrow = ctx.store.getAll()[0] as ArrowElement;
    expect(arrow.type).toBe('arrow');
    expect(arrow.from).toEqual({ x: 10, y: 20 });
    expect(arrow.to).toEqual({ x: 100, y: 200 });
  });

  it('does not create arrow if start equals end', () => {
    const tool = new ArrowTool();
    const ctx = makeCtx();

    tool.onPointerDown(pt(50, 50), ctx);
    tool.onPointerUp(pt(50, 50), ctx);

    expect(ctx.store.count).toBe(0);
  });

  it('uses configured color and width', () => {
    const tool = new ArrowTool({ color: '#00ff00', width: 4 });
    const ctx = makeCtx();

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(100, 100), ctx);
    tool.onPointerUp(pt(100, 100), ctx);

    const arrow = ctx.store.getAll()[0] as ArrowElement;
    expect(arrow.color).toBe('#00ff00');
    expect(arrow.width).toBe(4);
  });

  it('updates color and width via setOptions', () => {
    const tool = new ArrowTool({ color: '#000000', width: 2 });
    const ctx = makeCtx();

    tool.setOptions({ color: '#ff0000', width: 5 });

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(100, 100), ctx);
    tool.onPointerUp(pt(100, 100), ctx);

    const arrow = ctx.store.getAll()[0] as ArrowElement;
    expect(arrow.color).toBe('#ff0000');
    expect(arrow.width).toBe(5);
  });

  it('requests render during drag', () => {
    const tool = new ArrowTool();
    const ctx = makeCtx();

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(50, 50), ctx);

    expect(ctx.requestRender).toHaveBeenCalled();
  });

  describe('renderOverlay', () => {
    function mockCanvas(): CanvasRenderingContext2D {
      return {
        save: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: vi.fn(),
        fill: vi.fn(),
        closePath: vi.fn(),
        strokeStyle: '',
        lineWidth: 0,
        lineCap: '',
        globalAlpha: 1,
        fillStyle: '',
      } as unknown as CanvasRenderingContext2D;
    }

    it('renders preview line while dragging', () => {
      const tool = new ArrowTool();
      const ctx = makeCtx();
      const canvas = mockCanvas();

      tool.onPointerDown(pt(0, 0), ctx);
      tool.onPointerMove(pt(100, 100), ctx);
      tool.renderOverlay?.(canvas);

      expect(canvas.beginPath).toHaveBeenCalled();
      expect(canvas.moveTo).toHaveBeenCalled();
      expect(canvas.lineTo).toHaveBeenCalled();
      expect(canvas.stroke).toHaveBeenCalled();
    });

    it('does not render overlay when not drawing', () => {
      const tool = new ArrowTool();
      const canvas = mockCanvas();

      tool.renderOverlay?.(canvas);

      expect(canvas.beginPath).not.toHaveBeenCalled();
    });
  });
});
