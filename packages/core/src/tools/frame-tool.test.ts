// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { Camera } from '../canvas/camera';
import { ElementStore } from '../elements/element-store';
import { FrameTool } from './frame-tool';
import type { PointerState, ToolContext } from './types';

function point(x: number, y: number, shiftKey = false): PointerState {
  return { x, y, pressure: 0.5, pointerType: 'mouse', shiftKey };
}

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    camera: new Camera(),
    store: new ElementStore(),
    requestRender: vi.fn(),
    requestOverlayRender: vi.fn(),
    activeLayerId: 'layer',
    isLayerLocked: () => false,
    switchTool: vi.fn(),
    setSelection: vi.fn(),
    ...overrides,
  };
}

describe('FrameTool', () => {
  it('creates and selects one valid frame after a drag', () => {
    const tool = new FrameTool();
    const ctx = makeContext();

    tool.onPointerDown(point(10, 20), ctx);
    tool.onPointerMove(point(110, 120), ctx);
    tool.onPointerUp(point(110, 120), ctx);

    const frames = ctx.store.getElementsByType('extension');
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ extensionType: 'core:frame' });
    expect(ctx.switchTool).toHaveBeenCalledWith('select');
    expect(ctx.setSelection).toHaveBeenCalledWith([frames[0]?.id]);
  });

  it.each([
    [point(200, 200), point(100, 150), { x: 100, y: 150 }, { w: 100, h: 50 }],
    [point(10, 20), point(30, 20), { x: 10, y: 20 }, { w: 80, h: 48 }],
    [point(100, 100), point(70, 90), { x: 20, y: 52 }, { w: 80, h: 48 }],
  ])('normalizes and clamps a nonzero drag', (start, end, position, size) => {
    const tool = new FrameTool();
    const ctx = makeContext();

    tool.onPointerDown(start, ctx);
    tool.onPointerUp(end, ctx);

    expect(ctx.store.getElementsByType('extension')[0]).toMatchObject({ position, size });
  });

  it('keeps using the captured layer when another layer becomes active', () => {
    const tool = new FrameTool();
    const ctx = makeContext();

    tool.onPointerDown(point(10, 10), ctx);
    ctx.activeLayerId = 'another-layer';
    tool.onPointerUp(point(110, 110), ctx);

    expect(ctx.store.getElementsByType('extension')[0]).toMatchObject({ layerId: 'layer' });
  });

  it('uses pointer-up coordinates and shift state for a square', () => {
    const tool = new FrameTool();
    const ctx = makeContext();

    tool.onPointerDown(point(100, 100), ctx);
    tool.onPointerUp(point(70, 80, true), ctx);

    expect(ctx.store.getElementsByType('extension')[0]).toMatchObject({
      position: { x: 20, y: 20 },
      size: { w: 80, h: 80 },
    });
  });

  it('does not create a frame from a click or a locked layer', () => {
    const tool = new FrameTool();
    const ctx = makeContext();

    tool.onPointerDown(point(10, 10), ctx);
    tool.onPointerUp(point(10, 10), ctx);
    tool.onPointerDown(point(10, 10), ctx);
    ctx.isLayerLocked = () => true;
    tool.onPointerUp(point(110, 110), ctx);

    expect(ctx.store.count).toBe(0);
  });

  it('clears a preview when pointer up returns to the drag start', () => {
    const tool = new FrameTool();
    const ctx = makeContext();

    tool.onPointerDown(point(10, 10), ctx);
    tool.onPointerMove(point(110, 110), ctx);
    tool.onPointerUp(point(10, 10), ctx);

    expect(ctx.store.count).toBe(0);
    expect(ctx.switchTool).not.toHaveBeenCalled();
    expect(ctx.setSelection).not.toHaveBeenCalled();
    expect(ctx.requestOverlayRender).toHaveBeenCalledTimes(2);
  });

  it('clears a preview when the captured layer locks before pointer up', () => {
    const tool = new FrameTool();
    const ctx = makeContext();

    tool.onPointerDown(point(10, 10), ctx);
    tool.onPointerMove(point(110, 110), ctx);
    ctx.isLayerLocked = () => true;
    tool.onPointerUp(point(110, 110), ctx);

    expect(ctx.store.count).toBe(0);
    expect(ctx.switchTool).not.toHaveBeenCalled();
    expect(ctx.setSelection).not.toHaveBeenCalled();
    expect(ctx.requestOverlayRender).toHaveBeenCalledTimes(2);
  });

  it('does not start without an active layer or finish after the layer locks', () => {
    const tool = new FrameTool();
    const ctx = makeContext({ activeLayerId: undefined });

    tool.onPointerDown(point(10, 10), ctx);
    tool.onPointerUp(point(110, 110), ctx);
    ctx.activeLayerId = 'layer';
    tool.onPointerDown(point(10, 10), ctx);
    ctx.isLayerLocked = () => true;
    tool.onPointerUp(point(110, 110), ctx);

    expect(ctx.store.count).toBe(0);
  });

  it('cancels an active drag on cancel, Escape, and deactivate', () => {
    const ctx = makeContext();
    const tool = new FrameTool();

    tool.onPointerDown(point(10, 10), ctx);
    tool.onPointerCancel(point(100, 100), ctx);
    tool.onPointerUp(point(100, 100), ctx);
    tool.onPointerDown(point(10, 10), ctx);
    expect(tool.onKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }), ctx)).toBe(true);
    tool.onPointerUp(point(100, 100), ctx);
    tool.onPointerDown(point(10, 10), ctx);
    tool.onDeactivate(ctx);
    tool.onPointerUp(point(100, 100), ctx);

    expect(ctx.store.count).toBe(0);
    expect(ctx.requestOverlayRender).toHaveBeenCalledTimes(3);
    expect(tool.onKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }), ctx)).toBe(false);
  });

  it('renders the same normalized rectangle it creates', () => {
    const tool = new FrameTool();
    const ctx = makeContext();
    const strokeRect = vi.fn();
    const canvas = {
      save: vi.fn(),
      restore: vi.fn(),
      setLineDash: vi.fn(),
      strokeRect,
      strokeStyle: '',
      lineWidth: 0,
    } as unknown as CanvasRenderingContext2D;

    tool.onPointerDown(point(200, 200), ctx);
    tool.onPointerMove(point(100, 150), ctx);
    tool.renderOverlay(canvas);

    expect(strokeRect).toHaveBeenCalledWith(100, 150, 100, 50);
  });
});
