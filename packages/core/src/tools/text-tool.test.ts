import { describe, it, expect, vi } from 'vitest';
import { TextTool } from './text-tool';
import { ElementStore } from '../elements/element-store';
import { Camera } from '../canvas/camera';
import type { ToolContext, PointerState } from './types';
import type { TextElement } from '../elements/types';

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

describe('TextTool', () => {
  it('has name "text"', () => {
    expect(new TextTool().name).toBe('text');
  });

  it('creates a text element at click position', () => {
    const tool = new TextTool();
    const ctx = makeCtx();
    tool.onPointerDown(pt(100, 200), ctx);
    tool.onPointerUp(pt(100, 200), ctx);
    expect(ctx.store.count).toBe(1);
    const el = ctx.store.getAll()[0] as TextElement;
    expect(el.type).toBe('text');
    expect(el.position).toEqual({ x: 100, y: 200 });
  });

  it('uses configured defaults', () => {
    const tool = new TextTool({ fontSize: 24, color: '#ff0000', textAlign: 'center' });
    const ctx = makeCtx();
    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerUp(pt(0, 0), ctx);
    const el = ctx.store.getAll()[0] as TextElement;
    expect(el.fontSize).toBe(24);
    expect(el.color).toBe('#ff0000');
    expect(el.textAlign).toBe('center');
  });

  it('updates options via setOptions', () => {
    const tool = new TextTool();
    const ctx = makeCtx();
    tool.setOptions({ fontSize: 32, color: '#00ff00' });
    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerUp(pt(0, 0), ctx);
    const el = ctx.store.getAll()[0] as TextElement;
    expect(el.fontSize).toBe(32);
    expect(el.color).toBe('#00ff00');
  });

  it('converts screen to world coords', () => {
    const camera = new Camera();
    camera.pan(-100, -100);
    const ctx = makeCtx({ camera });
    const tool = new TextTool();
    tool.onPointerDown(pt(50, 50), ctx);
    tool.onPointerUp(pt(50, 50), ctx);
    const el = ctx.store.getAll()[0] as TextElement;
    expect(el.position.x).toBe(150);
    expect(el.position.y).toBe(150);
  });

  it('requests render after placing', () => {
    const tool = new TextTool();
    const ctx = makeCtx();
    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerUp(pt(0, 0), ctx);
    expect(ctx.requestRender).toHaveBeenCalled();
  });

  it('calls switchTool to select after placing', () => {
    const tool = new TextTool();
    const switchTool = vi.fn();
    const ctx = makeCtx({ switchTool });
    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerUp(pt(0, 0), ctx);
    expect(switchTool).toHaveBeenCalledWith('select');
  });

  it('calls editElement with the new text element id', () => {
    const tool = new TextTool();
    const editElement = vi.fn();
    const ctx = makeCtx({ editElement });
    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerUp(pt(0, 0), ctx);
    expect(editElement).toHaveBeenCalledTimes(1);
    const id = ctx.store.getAll()[0]?.id;
    expect(editElement).toHaveBeenCalledWith(id);
  });

  it('snaps placement position to grid', () => {
    const tool = new TextTool();
    const ctx = makeCtx();
    ctx.snapToGrid = true;
    ctx.gridSize = 24;

    tool.onPointerDown(pt(37, 55), ctx);
    tool.onPointerUp(pt(37, 55), ctx);

    const el = ctx.store.getAll()[0] as TextElement;
    // snapPoint(37,24)=48, snapPoint(55,24)=48
    expect(el.position).toEqual({ x: 48, y: 48 });
  });

  it('sets text cursor on activate', () => {
    const tool = new TextTool();
    const setCursor = vi.fn();
    const ctx = makeCtx({ setCursor });
    tool.onActivate?.(ctx);
    expect(setCursor).toHaveBeenCalledWith('text');
  });

  it('resets cursor on deactivate', () => {
    const tool = new TextTool();
    const setCursor = vi.fn();
    const ctx = makeCtx({ setCursor });
    tool.onDeactivate?.(ctx);
    expect(setCursor).toHaveBeenCalledWith('default');
  });

  describe('getOptions', () => {
    it('returns current options', () => {
      const tool = new TextTool({ fontSize: 24, color: '#ff0000', textAlign: 'center' });
      expect(tool.getOptions()).toEqual({ fontSize: 24, color: '#ff0000', textAlign: 'center' });
    });
  });

  describe('onOptionsChange', () => {
    it('fires listener when setOptions is called', () => {
      const tool = new TextTool();
      const listener = vi.fn();
      tool.onOptionsChange(listener);
      tool.setOptions({ fontSize: 32 });
      expect(listener).toHaveBeenCalledOnce();
    });

    it('returns unsubscribe function', () => {
      const tool = new TextTool();
      const listener = vi.fn();
      const unsub = tool.onOptionsChange(listener);
      unsub();
      tool.setOptions({ fontSize: 32 });
      expect(listener).not.toHaveBeenCalled();
    });
  });
});
