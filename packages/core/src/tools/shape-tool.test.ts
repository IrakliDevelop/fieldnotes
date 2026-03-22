import { describe, it, expect, vi } from 'vitest';
import { ShapeTool } from './shape-tool';
import { ElementStore } from '../elements/element-store';
import { Camera } from '../canvas/camera';
import type { ToolContext, PointerState } from './types';

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    camera: new Camera(),
    store: new ElementStore(),
    requestRender: vi.fn(),
    switchTool: vi.fn(),
    ...overrides,
  };
}

function pt(x: number, y: number): PointerState {
  return { x, y, pressure: 0.5 };
}

describe('ShapeTool', () => {
  it('has name "shape"', () => {
    expect(new ShapeTool().name).toBe('shape');
  });

  it('creates a rectangle from drag', () => {
    const tool = new ShapeTool();
    const ctx = makeCtx();

    tool.onPointerDown(pt(10, 20), ctx);
    tool.onPointerMove(pt(110, 120), ctx);
    tool.onPointerUp(pt(110, 120), ctx);

    const shapes = ctx.store.getElementsByType('shape');
    expect(shapes).toHaveLength(1);
    expect(shapes[0]?.shape).toBe('rectangle');
    expect(shapes[0]?.position).toEqual({ x: 10, y: 20 });
    expect(shapes[0]?.size).toEqual({ w: 100, h: 100 });
  });

  it('creates an ellipse when shape option is set', () => {
    const tool = new ShapeTool({ shape: 'ellipse' });
    const ctx = makeCtx();

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(200, 100), ctx);
    tool.onPointerUp(pt(200, 100), ctx);

    const shapes = ctx.store.getElementsByType('shape');
    expect(shapes).toHaveLength(1);
    expect(shapes[0]?.shape).toBe('ellipse');
  });

  it('does not create shape on zero-drag', () => {
    const tool = new ShapeTool();
    const ctx = makeCtx();

    tool.onPointerDown(pt(50, 50), ctx);
    tool.onPointerUp(pt(50, 50), ctx);

    expect(ctx.store.getElementsByType('shape')).toHaveLength(0);
  });

  it('switches to select tool after creation', () => {
    const tool = new ShapeTool();
    const ctx = makeCtx();

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(100, 100), ctx);
    tool.onPointerUp(pt(100, 100), ctx);

    expect(ctx.switchTool).toHaveBeenCalledWith('select');
  });

  it('handles drag in any direction (normalizes negative width/height)', () => {
    const tool = new ShapeTool();
    const ctx = makeCtx();

    tool.onPointerDown(pt(200, 200), ctx);
    tool.onPointerMove(pt(100, 150), ctx);
    tool.onPointerUp(pt(100, 150), ctx);

    const shapes = ctx.store.getElementsByType('shape');
    expect(shapes).toHaveLength(1);
    expect(shapes[0]?.position).toEqual({ x: 100, y: 150 });
    expect(shapes[0]?.size).toEqual({ w: 100, h: 50 });
  });

  it('uses configured stroke and fill options', () => {
    const tool = new ShapeTool({
      strokeColor: '#ff0000',
      strokeWidth: 4,
      fillColor: '#0000ff',
    });
    const ctx = makeCtx();

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(50, 50), ctx);
    tool.onPointerUp(pt(50, 50), ctx);

    const shapes = ctx.store.getElementsByType('shape');
    expect(shapes[0]?.strokeColor).toBe('#ff0000');
    expect(shapes[0]?.strokeWidth).toBe(4);
    expect(shapes[0]?.fillColor).toBe('#0000ff');
  });

  it('updates shape kind via setOptions', () => {
    const tool = new ShapeTool();
    tool.setOptions({ shape: 'ellipse' });
    const ctx = makeCtx();

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(100, 100), ctx);
    tool.onPointerUp(pt(100, 100), ctx);

    const shapes = ctx.store.getElementsByType('shape');
    expect(shapes[0]?.shape).toBe('ellipse');
  });
});
