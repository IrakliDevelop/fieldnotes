import { afterEach, describe, it, expect, vi } from 'vitest';
import { ToolManager } from './tool-manager';
import type { Tool, ToolContext, PointerState } from './types';

function stubTool(name: string): Tool {
  return {
    name,
    onPointerDown: vi.fn(),
    onPointerMove: vi.fn(),
    onPointerUp: vi.fn(),
    onActivate: vi.fn(),
    onDeactivate: vi.fn(),
  };
}

function stubContext(): ToolContext {
  return {
    camera: {} as ToolContext['camera'],
    store: {} as ToolContext['store'],
    requestRender: vi.fn(),
    requestOverlayRender: vi.fn(),
  };
}

const point: PointerState = { x: 10, y: 20, pressure: 0.5, pointerType: 'mouse', shiftKey: false };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function makeTool(name: string): Tool {
  return { name, onPointerDown: vi.fn(), onPointerMove: vi.fn(), onPointerUp: vi.fn() };
}

describe('ToolManager', () => {
  it('starts with no active tool', () => {
    const manager = new ToolManager();
    expect(manager.activeTool).toBeNull();
  });

  it('registers and activates a tool by name', () => {
    const manager = new ToolManager();
    const pencil = stubTool('pencil');
    const ctx = stubContext();

    manager.register(pencil);
    manager.setTool('pencil', ctx);

    expect(manager.activeTool).toBe(pencil);
  });

  it('calls onActivate when tool is set', () => {
    const manager = new ToolManager();
    const pencil = stubTool('pencil');
    const ctx = stubContext();

    manager.register(pencil);
    manager.setTool('pencil', ctx);

    expect(pencil.onActivate).toHaveBeenCalledWith(ctx);
  });

  it('calls onDeactivate on previous tool when switching', () => {
    const manager = new ToolManager();
    const pencil = stubTool('pencil');
    const eraser = stubTool('eraser');
    const ctx = stubContext();

    manager.register(pencil);
    manager.register(eraser);
    manager.setTool('pencil', ctx);
    manager.setTool('eraser', ctx);

    expect(pencil.onDeactivate).toHaveBeenCalledWith(ctx);
    expect(eraser.onActivate).toHaveBeenCalledWith(ctx);
  });

  it('delegates pointer events to active tool', () => {
    const manager = new ToolManager();
    const pencil = stubTool('pencil');
    const ctx = stubContext();

    manager.register(pencil);
    manager.setTool('pencil', ctx);

    manager.handlePointerDown(point, ctx);
    manager.handlePointerMove(point, ctx);
    manager.handlePointerUp(point, ctx);

    expect(pencil.onPointerDown).toHaveBeenCalledWith(point, ctx);
    expect(pencil.onPointerMove).toHaveBeenCalledWith(point, ctx);
    expect(pencil.onPointerUp).toHaveBeenCalledWith(point, ctx);
  });

  it('does nothing when no tool is active', () => {
    const manager = new ToolManager();
    const ctx = stubContext();

    expect(() => {
      manager.handlePointerDown(point, ctx);
      manager.handlePointerMove(point, ctx);
      manager.handlePointerUp(point, ctx);
    }).not.toThrow();
  });

  it('emits change event when tool changes', () => {
    const manager = new ToolManager();
    const pencil = stubTool('pencil');
    const ctx = stubContext();
    const listener = vi.fn();

    manager.register(pencil);
    manager.onChange(listener);
    manager.setTool('pencil', ctx);

    expect(listener).toHaveBeenCalledWith('pencil');
  });

  it('reports a throwing change listener and continues to later listeners', () => {
    const manager = new ToolManager();
    const error = new Error('host bug');
    const reportError = vi.fn<(error: unknown) => void>();
    const laterListener = vi.fn();
    vi.stubGlobal('reportError', reportError);

    manager.register(stubTool('pencil'));
    manager.onChange(() => {
      throw error;
    });
    manager.onChange(laterListener);

    expect(() => manager.setTool('pencil', stubContext())).not.toThrow();
    expect(reportError).toHaveBeenCalledWith(error);
    expect(laterListener).toHaveBeenCalledWith('pencil');
  });

  it('does not call a listener removed by an earlier listener during dispatch', () => {
    const manager = new ToolManager();
    const laterListener = vi.fn();
    let removeLater: () => void = () => undefined;

    manager.register(stubTool('pencil'));
    manager.onChange(() => removeLater());
    removeLater = manager.onChange(laterListener);

    manager.setTool('pencil', stubContext());

    expect(laterListener).not.toHaveBeenCalled();
  });

  it('retrieves a registered tool by name', () => {
    const manager = new ToolManager();
    const pencil = stubTool('pencil');
    manager.register(pencil);

    expect(manager.getTool('pencil')).toBe(pencil);
  });

  it('returns undefined for unregistered tool name', () => {
    const manager = new ToolManager();
    expect(manager.getTool('nonexistent')).toBeUndefined();
  });

  it('lists registered tool names', () => {
    const manager = new ToolManager();
    manager.register(stubTool('pencil'));
    manager.register(stubTool('eraser'));

    expect(manager.toolNames).toEqual(['pencil', 'eraser']);
  });

  it('handlePointerCancel prefers onPointerCancel when the tool implements it', () => {
    const manager = new ToolManager();
    const tool = { ...makeTool('path'), onPointerCancel: vi.fn() };
    manager.register(tool);
    manager.setTool('path', stubContext());
    manager.handlePointerCancel(point, stubContext());
    expect(tool.onPointerCancel).toHaveBeenCalledOnce();
    expect(tool.onPointerUp).not.toHaveBeenCalled();
  });

  it('handlePointerCancel falls back to onPointerUp for tools without it', () => {
    const manager = new ToolManager();
    const tool = makeTool('pencil');
    manager.register(tool);
    manager.setTool('pencil', stubContext());
    manager.handlePointerCancel(point, stubContext());
    expect(tool.onPointerUp).toHaveBeenCalledOnce();
  });
});

describe('onRegister', () => {
  it('notifies listeners with the registered tool', () => {
    const tm = new ToolManager();
    const seen: string[] = [];
    tm.onRegister((tool) => seen.push(tool.name));
    tm.register(makeTool('select'));
    tm.register(makeTool('pencil'));
    expect(seen).toEqual(['select', 'pencil']);
  });

  it('unsubscribe stops notifications and is idempotent', () => {
    const tm = new ToolManager();
    const seen: string[] = [];
    const off = tm.onRegister((tool) => seen.push(tool.name));
    off();
    off();
    tm.register(makeTool('select'));
    expect(seen).toEqual([]);
  });

  it('tool is retrievable via getTool when listener runs', () => {
    const tm = new ToolManager();
    let retrieved: unknown;
    tm.onRegister((tool) => {
      retrieved = tm.getTool(tool.name);
    });
    const t = makeTool('select');
    tm.register(t);
    expect(retrieved).toBe(t);
  });
});
