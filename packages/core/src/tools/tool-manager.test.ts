import { describe, it, expect, vi } from 'vitest';
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
  };
}

const point: PointerState = { x: 10, y: 20, pressure: 0.5 };

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

  it('lists registered tool names', () => {
    const manager = new ToolManager();
    manager.register(stubTool('pencil'));
    manager.register(stubTool('eraser'));

    expect(manager.toolNames).toEqual(['pencil', 'eraser']);
  });
});
