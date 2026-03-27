// @vitest-environment jsdom
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

  it('snaps start and end points to grid', () => {
    const tool = new ShapeTool();
    const ctx = makeCtx();
    ctx.snapToGrid = true;
    ctx.gridSize = 24;

    tool.onPointerDown(pt(10, 10), ctx);
    tool.onPointerMove(pt(110, 85), ctx);
    tool.onPointerUp(pt(110, 85), ctx);

    const shapes = ctx.store.getElementsByType('shape');
    expect(shapes).toHaveLength(1);
    // snapPoint(10,24)=0, snapPoint(110,24)=120, snapPoint(85,24)=96
    expect(shapes[0]?.position).toEqual({ x: 0, y: 0 });
    expect(shapes[0]?.size).toEqual({ w: 120, h: 96 });
  });

  it('constrains to square when Shift is held', () => {
    const tool = new ShapeTool();
    const ctx = makeCtx();

    tool.onActivate(ctx);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }));

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(200, 100), ctx);
    tool.onPointerUp(pt(200, 100), ctx);

    const shapes = ctx.store.getElementsByType('shape');
    expect(shapes).toHaveLength(1);
    expect(shapes[0]?.size.w).toBe(shapes[0]?.size.h);
    expect(shapes[0]?.size.w).toBe(200);

    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift' }));
    tool.onDeactivate(ctx);
  });

  describe('getOptions', () => {
    it('returns current options', () => {
      const tool = new ShapeTool({
        shape: 'ellipse',
        strokeColor: '#ff0000',
        strokeWidth: 3,
        fillColor: '#00ff00',
      });
      expect(tool.getOptions()).toEqual({
        shape: 'ellipse',
        strokeColor: '#ff0000',
        strokeWidth: 3,
        fillColor: '#00ff00',
      });
    });
  });

  describe('onOptionsChange', () => {
    it('fires listener when setOptions is called', () => {
      const tool = new ShapeTool();
      const listener = vi.fn();
      tool.onOptionsChange(listener);
      tool.setOptions({ fillColor: '#0000ff' });
      expect(listener).toHaveBeenCalledOnce();
    });

    it('returns unsubscribe function', () => {
      const tool = new ShapeTool();
      const listener = vi.fn();
      const unsub = tool.onOptionsChange(listener);
      unsub();
      tool.setOptions({ fillColor: '#0000ff' });
      expect(listener).not.toHaveBeenCalled();
    });
  });
});
