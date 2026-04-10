// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { MeasureTool } from './measure-tool';
import { ElementStore } from '../elements/element-store';
import { Camera } from '../canvas/camera';
import type { ToolContext, PointerState } from './types';

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

describe('MeasureTool', () => {
  it('has name "measure"', () => {
    expect(new MeasureTool().name).toBe('measure');
  });

  it('computes distance in feet correctly', () => {
    const tool = new MeasureTool();
    const ctx = makeCtx({ gridSize: 50 });

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(150, 0), ctx);

    const m = tool.getMeasurement();
    expect(m).not.toBeNull();
    expect(m?.worldDistance).toBe(150);
    expect(m?.cells).toBe(3);
    expect(m?.feet).toBe(15);
  });

  it('uses custom feetPerCell', () => {
    const tool = new MeasureTool({ feetPerCell: 10 });
    const ctx = makeCtx({ gridSize: 50 });

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(100, 0), ctx);

    const m = tool.getMeasurement();
    expect(m?.cells).toBe(2);
    expect(m?.feet).toBe(20);
  });

  it('clears measurement on pointer up', () => {
    const tool = new MeasureTool();
    const ctx = makeCtx({ gridSize: 50 });

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(100, 0), ctx);
    expect(tool.getMeasurement()).not.toBeNull();

    tool.onPointerUp(pt(100, 0), ctx);
    expect(tool.getMeasurement()).toBeNull();
  });

  it('requests render on pointer move', () => {
    const tool = new MeasureTool();
    const ctx = makeCtx({ gridSize: 50 });

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(50, 50), ctx);

    expect(ctx.requestRender).toHaveBeenCalled();
  });

  it('snaps when snapToGrid is true', () => {
    const tool = new MeasureTool();
    const ctx = makeCtx({ snapToGrid: true, gridSize: 50 });

    tool.onPointerDown(pt(10, 10), ctx);
    tool.onPointerMove(pt(110, 10), ctx);

    const m = tool.getMeasurement();
    expect(m?.start).toEqual({ x: 0, y: 0 });
    expect(m?.end).toEqual({ x: 100, y: 0 });
    expect(m?.worldDistance).toBe(100);
    expect(m?.cells).toBe(2);
    expect(m?.feet).toBe(10);
  });

  it('does not snap when snapToGrid is false', () => {
    const tool = new MeasureTool();
    const ctx = makeCtx({ snapToGrid: false, gridSize: 50 });

    tool.onPointerDown(pt(10, 10), ctx);
    tool.onPointerMove(pt(110, 10), ctx);

    const m = tool.getMeasurement();
    expect(m?.start).toEqual({ x: 10, y: 10 });
    expect(m?.end).toEqual({ x: 110, y: 10 });
  });

  it('setOptions updates feetPerCell', () => {
    const tool = new MeasureTool();
    const ctx = makeCtx({ gridSize: 50 });

    tool.setOptions({ feetPerCell: 10 });

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(100, 0), ctx);

    const m = tool.getMeasurement();
    expect(m?.feet).toBe(20);
  });

  it('getOptions returns current feetPerCell', () => {
    const tool = new MeasureTool({ feetPerCell: 10 });
    expect(tool.getOptions()).toEqual({ feetPerCell: 10 });
  });

  it('fires options change listener on setOptions', () => {
    const tool = new MeasureTool();
    const listener = vi.fn();
    tool.onOptionsChange(listener);
    tool.setOptions({ feetPerCell: 10 });
    expect(listener).toHaveBeenCalledOnce();
  });

  it('returns unsubscribe from onOptionsChange', () => {
    const tool = new MeasureTool();
    const listener = vi.fn();
    const unsub = tool.onOptionsChange(listener);
    unsub();
    tool.setOptions({ feetPerCell: 10 });
    expect(listener).not.toHaveBeenCalled();
  });

  it('returns null from getMeasurement before any interaction', () => {
    const tool = new MeasureTool();
    expect(tool.getMeasurement()).toBeNull();
  });

  it('computes diagonal distance correctly', () => {
    const tool = new MeasureTool();
    const ctx = makeCtx({ gridSize: 50 });

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(300, 400), ctx);

    const m = tool.getMeasurement();
    expect(m?.worldDistance).toBe(500);
    expect(m?.cells).toBe(10);
    expect(m?.feet).toBe(50);
  });

  it('does not create any elements', () => {
    const tool = new MeasureTool();
    const ctx = makeCtx({ gridSize: 50 });

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(100, 100), ctx);
    tool.onPointerUp(pt(100, 100), ctx);

    expect(ctx.store.getAll()).toHaveLength(0);
  });

  it('defaults gridSize to 1 when not provided', () => {
    const tool = new MeasureTool();
    const ctx = makeCtx();

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(100, 0), ctx);

    const m = tool.getMeasurement();
    expect(m?.worldDistance).toBe(100);
    expect(m?.cells).toBe(100);
    expect(m?.feet).toBe(500);
  });

  it('clears measurement on deactivate (mid-drag tool switch)', () => {
    const tool = new MeasureTool();
    const ctx = makeCtx({ gridSize: 40 });

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(80, 0), ctx);
    expect(tool.getMeasurement()).not.toBeNull();

    tool.onDeactivate(ctx);
    expect(tool.getMeasurement()).toBeNull();
  });

  it('requests render on pointer up to clear overlay', () => {
    const tool = new MeasureTool();
    const ctx = makeCtx({ gridSize: 50 });

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(100, 0), ctx);
    (ctx.requestRender as ReturnType<typeof vi.fn>).mockClear();

    tool.onPointerUp(pt(100, 0), ctx);
    expect(ctx.requestRender).toHaveBeenCalled();
  });
});
