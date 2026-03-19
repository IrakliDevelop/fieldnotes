import { describe, it, expect, vi } from 'vitest';
import { ImageTool } from './image-tool';
import { ElementStore } from '../elements/element-store';
import { Camera } from '../canvas/camera';
import type { ToolContext, PointerState } from './types';
import type { ImageElement } from '../elements/types';

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

describe('ImageTool', () => {
  it('has name "image"', () => {
    expect(new ImageTool().name).toBe('image');
  });

  it('does nothing if no src is set', () => {
    const tool = new ImageTool();
    const ctx = makeCtx();

    tool.onPointerDown(pt(100, 100), ctx);
    tool.onPointerUp(pt(100, 100), ctx);

    expect(ctx.store.count).toBe(0);
  });

  it('creates an image at click position when src is set', () => {
    const tool = new ImageTool();
    tool.setSrc('data:image/png;base64,abc');
    const ctx = makeCtx();

    tool.onPointerDown(pt(100, 200), ctx);
    tool.onPointerUp(pt(100, 200), ctx);

    expect(ctx.store.count).toBe(1);
    const img = ctx.store.getAll()[0] as ImageElement;
    expect(img.type).toBe('image');
    expect(img.position).toEqual({ x: 100, y: 200 });
    expect(img.src).toBe('data:image/png;base64,abc');
  });

  it('uses configured default size', () => {
    const tool = new ImageTool({ size: { w: 400, h: 300 } });
    tool.setSrc('test.png');
    const ctx = makeCtx();

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerUp(pt(0, 0), ctx);

    const img = ctx.store.getAll()[0] as ImageElement;
    expect(img.size).toEqual({ w: 400, h: 300 });
  });

  it('converts screen to world coords', () => {
    const camera = new Camera();
    camera.pan(-100, -100);
    const ctx = makeCtx({ camera });
    const tool = new ImageTool();
    tool.setSrc('test.png');

    tool.onPointerDown(pt(50, 50), ctx);
    tool.onPointerUp(pt(50, 50), ctx);

    const img = ctx.store.getAll()[0] as ImageElement;
    expect(img.position.x).toBe(150);
    expect(img.position.y).toBe(150);
  });

  it('requests render after placing image', () => {
    const tool = new ImageTool();
    tool.setSrc('test.png');
    const ctx = makeCtx();

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerUp(pt(0, 0), ctx);

    expect(ctx.requestRender).toHaveBeenCalled();
  });

  it('switches to select tool after placing', () => {
    const tool = new ImageTool();
    tool.setSrc('test.png');
    const switchTool = vi.fn();
    const ctx = makeCtx({ switchTool });

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerUp(pt(0, 0), ctx);

    expect(switchTool).toHaveBeenCalledWith('select');
  });

  it('clears src after placing so next click requires new src', () => {
    const tool = new ImageTool();
    tool.setSrc('test.png');
    const ctx = makeCtx();

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerUp(pt(0, 0), ctx);
    expect(ctx.store.count).toBe(1);

    tool.onPointerDown(pt(50, 50), ctx);
    tool.onPointerUp(pt(50, 50), ctx);
    expect(ctx.store.count).toBe(1);
  });
});
