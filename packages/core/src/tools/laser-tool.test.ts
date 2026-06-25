// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LaserTool } from './laser-tool';
import { Camera } from '../canvas/camera';
import type { ToolContext, PointerState } from './types';

interface TrailLike {
  trail: { x: number; y: number; t: number }[];
  rafId: number | null;
  now(): number;
}

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    camera: new Camera(),
    store: {
      add: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    } as unknown as ToolContext['store'],
    requestRender: vi.fn(),
    ...overrides,
  };
}

function pt(x: number, y: number): PointerState {
  return { x, y, pressure: 0.5, pointerType: 'mouse', shiftKey: false };
}

let rafCallbacks: FrameRequestCallback[];

function setNow(tool: LaserTool, value: number): void {
  vi.spyOn(tool as unknown as TrailLike, 'now').mockReturnValue(value);
}

beforeEach(() => {
  rafCallbacks = [];
  let id = 0;
  globalThis.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
    rafCallbacks.push(cb);
    return ++id;
  }) as unknown as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = vi.fn() as unknown as typeof cancelAnimationFrame;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function flushFrame(): void {
  const cbs = rafCallbacks;
  rafCallbacks = [];
  for (const cb of cbs) cb(0);
}

describe('LaserTool', () => {
  it('has name "laser" by default and is configurable', () => {
    expect(new LaserTool().name).toBe('laser');
    expect(new LaserTool({ name: 'pointer' }).name).toBe('pointer');
  });

  it('exposes default options', () => {
    const tool = new LaserTool();
    expect(tool.getOptions()).toEqual({
      name: 'laser',
      color: '#ff3b30',
      width: 4,
      fadeMs: 1200,
    });
  });

  it('setOptions updates color/width/fadeMs and notifies listeners', () => {
    const tool = new LaserTool();
    const cb = vi.fn();
    tool.onOptionsChange(cb);
    tool.setOptions({ color: '#00ff00', width: 8, fadeMs: 600 });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(tool.getOptions()).toMatchObject({ color: '#00ff00', width: 8, fadeMs: 600 });
  });

  it('records world trail points on down + moves', () => {
    const tool = new LaserTool();
    setNow(tool, 100);
    const ctx = makeCtx();
    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(10, 10), ctx);
    tool.onPointerMove(pt(20, 20), ctx);
    const trail = (tool as unknown as TrailLike).trail;
    expect(trail.length).toBe(3);
    expect(trail[0]).toMatchObject({ x: 0, y: 0, t: 100 });
    expect(trail[2]).toMatchObject({ x: 20, y: 20 });
  });

  it('ignores moves when not drawing', () => {
    const tool = new LaserTool();
    const ctx = makeCtx();
    tool.onPointerMove(pt(5, 5), ctx);
    expect((tool as unknown as TrailLike).trail.length).toBe(0);
  });

  it('renderOverlay strokes segments with decreasing alpha as points age', () => {
    const tool = new LaserTool({ fadeMs: 1000 });
    setNow(tool, 0);
    const ctx = makeCtx();
    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(10, 0), ctx); // t=0
    setNow(tool, 500);
    tool.onPointerMove(pt(20, 0), ctx); // t=500

    const alphas: number[] = [];
    const mockCtx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      set globalAlpha(v: number) {
        alphas.push(v);
      },
      strokeStyle: '',
      lineWidth: 0,
      lineCap: '',
      lineJoin: '',
    } as unknown as CanvasRenderingContext2D;

    setNow(tool, 500);
    tool.renderOverlay(mockCtx);
    // segment 0 (newer point t=0) age 500 → alpha 0.5; segment 1 (t=500) age 0 → alpha 1
    expect(alphas).toEqual([0.5, 1]);

    // Advance time: alphas decrease overall, hitting ~0 at fadeMs.
    alphas.length = 0;
    setNow(tool, 1000);
    tool.renderOverlay(mockCtx);
    expect(alphas).toEqual([0, 0.5]);
  });

  it('self-driven tick prunes expired points and stops the loop', () => {
    const tool = new LaserTool({ fadeMs: 1000 });
    setNow(tool, 0);
    const ctx = makeCtx();
    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(10, 10), ctx);
    tool.onPointerUp(pt(10, 10), ctx);

    // Drive a frame while points are still fresh: loop continues.
    setNow(tool, 100);
    flushFrame();
    expect((tool as unknown as TrailLike).trail.length).toBe(2);
    expect((tool as unknown as TrailLike).rafId).not.toBeNull();

    // Advance past fadeMs: all points expire, tick clears trail and stops loop.
    setNow(tool, 2000);
    flushFrame();
    expect((tool as unknown as TrailLike).trail.length).toBe(0);
    expect((tool as unknown as TrailLike).rafId).toBeNull();
    // Final requestRender clears the last faded frame.
    expect(ctx.requestRender).toHaveBeenCalled();
  });

  it('ensureAnimating schedules only one rAF at a time', () => {
    const tool = new LaserTool();
    setNow(tool, 0);
    const ctx = makeCtx();
    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(1, 1), ctx);
    tool.onPointerMove(pt(2, 2), ctx);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
  });

  it('NEVER touches the store across down/move/up + ticks', () => {
    const tool = new LaserTool({ fadeMs: 500 });
    setNow(tool, 0);
    const ctx = makeCtx();
    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(10, 10), ctx);
    tool.onPointerMove(pt(20, 20), ctx);
    tool.onPointerUp(pt(20, 20), ctx);
    setNow(tool, 100);
    flushFrame();
    setNow(tool, 1000);
    flushFrame();

    expect(ctx.store.add).not.toHaveBeenCalled();
    expect(ctx.store.update).not.toHaveBeenCalled();
    expect(ctx.store.remove).not.toHaveBeenCalled();
  });

  it('onDeactivate cancels the live rAF and clears the trail', () => {
    const tool = new LaserTool();
    setNow(tool, 0);
    const ctx = makeCtx();
    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(5, 5), ctx);
    const liveId = (tool as unknown as TrailLike).rafId;
    expect(liveId).not.toBeNull();

    tool.onDeactivate?.(ctx);
    expect(cancelAnimationFrame).toHaveBeenCalledWith(liveId);
    expect((tool as unknown as TrailLike).rafId).toBeNull();
    expect((tool as unknown as TrailLike).trail.length).toBe(0);
    expect(ctx.requestRender).toHaveBeenCalled();
  });

  it('onPointerUp stops drawing but keeps the trail for fading', () => {
    const tool = new LaserTool();
    setNow(tool, 0);
    const ctx = makeCtx();
    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(5, 5), ctx);
    tool.onPointerUp(pt(5, 5), ctx);
    expect((tool as unknown as TrailLike).trail.length).toBe(2);
    // A subsequent move is ignored (drawing stopped).
    tool.onPointerMove(pt(9, 9), ctx);
    expect((tool as unknown as TrailLike).trail.length).toBe(2);
  });
});
