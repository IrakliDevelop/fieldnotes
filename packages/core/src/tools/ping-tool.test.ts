// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PingTool } from './ping-tool';
import { Camera } from '../canvas/camera';
import type { ToolContext, PointerState } from './types';

interface PingsLike {
  pings: { x: number; y: number; t: number }[];
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

function pt(
  x: number,
  y: number,
  pointerType: PointerState['pointerType'] = 'mouse',
): PointerState {
  return { x, y, pressure: 0.5, pointerType, shiftKey: false };
}

let rafCallbacks: FrameRequestCallback[];

function setNow(tool: PingTool, value: number): void {
  vi.spyOn(tool as unknown as PingsLike, 'now').mockReturnValue(value);
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

describe('PingTool', () => {
  it('has name "ping" by default and is configurable', () => {
    expect(new PingTool().name).toBe('ping');
    expect(new PingTool({ name: 'marker' }).name).toBe('marker');
  });

  it('exposes default options', () => {
    const tool = new PingTool();
    expect(tool.getOptions()).toEqual({
      name: 'ping',
      color: '#ff3b30',
      durationMs: 1800,
      radius: 48,
      minIntervalMs: 300,
    });
  });

  it('setOptions updates style and rate limit and notifies listeners', () => {
    const tool = new PingTool();
    const cb = vi.fn();
    tool.onOptionsChange(cb);
    tool.setOptions({ color: '#00ff00', durationMs: 900, radius: 24, minIntervalMs: 100 });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(tool.getOptions()).toMatchObject({
      color: '#00ff00',
      durationMs: 900,
      radius: 24,
      minIntervalMs: 100,
    });
  });

  it('emits one world-space ping per accepted pointer down, with the current style', () => {
    const tool = new PingTool({ color: '#f4c430', durationMs: 1500, radius: 32 });
    setNow(tool, 1000);
    const camera = new Camera();
    camera.moveTo(100, 0); // world x = screen x - 100 at zoom 1
    const ctx = makeCtx({ camera });
    const emissions: unknown[] = [];
    tool.onPing((e) => emissions.push(e));

    tool.onPointerDown(pt(110, 20), ctx);
    expect(emissions).toEqual([{ x: 10, y: 20, color: '#f4c430', durationMs: 1500, radius: 32 }]);
    expect((tool as unknown as PingsLike).pings).toEqual([{ x: 10, y: 20, t: 1000 }]);
  });

  it('touch pointer down emits the same ping as mouse', () => {
    const tool = new PingTool();
    setNow(tool, 0);
    const ctx = makeCtx();
    const emissions: { x: number; y: number }[] = [];
    tool.onPing((e) => emissions.push(e));
    tool.onPointerDown(pt(30, 40, 'touch'), ctx);
    expect(emissions).toEqual([expect.objectContaining({ x: 30, y: 40 })]);
  });

  it('rate-limits taps: faster than minIntervalMs is dropped entirely', () => {
    const tool = new PingTool({ minIntervalMs: 300 });
    const ctx = makeCtx();
    const emissions: unknown[] = [];
    tool.onPing((e) => emissions.push(e));

    setNow(tool, 0);
    tool.onPointerDown(pt(0, 0), ctx);
    setNow(tool, 100);
    tool.onPointerDown(pt(10, 10), ctx); // dropped: 100ms < 300ms
    expect(emissions.length).toBe(1);
    expect((tool as unknown as PingsLike).pings.length).toBe(1);

    setNow(tool, 300);
    tool.onPointerDown(pt(20, 20), ctx); // accepted at exactly the interval
    expect(emissions.length).toBe(2);
  });

  it('pointer move and up do nothing', () => {
    const tool = new PingTool();
    setNow(tool, 0);
    const ctx = makeCtx();
    const emissions: unknown[] = [];
    tool.onPing((e) => emissions.push(e));
    tool.onPointerMove(pt(5, 5), ctx);
    tool.onPointerUp(pt(5, 5), ctx);
    expect(emissions.length).toBe(0);
    expect((tool as unknown as PingsLike).pings.length).toBe(0);
  });

  it('a throwing listener does not break tap handling or other listeners', () => {
    const tool = new PingTool();
    setNow(tool, 0);
    const ctx = makeCtx();
    const emissions: unknown[] = [];
    tool.onPing(() => {
      throw new Error('boom');
    });
    tool.onPing((e) => emissions.push(e));
    tool.onPointerDown(pt(0, 0), ctx);
    expect(emissions.length).toBe(1);
    expect((tool as unknown as PingsLike).pings.length).toBe(1);
  });

  it('unsubscribe stops delivery', () => {
    const tool = new PingTool();
    setNow(tool, 0);
    const ctx = makeCtx();
    const emissions: unknown[] = [];
    const unsubscribe = tool.onPing((e) => emissions.push(e));
    unsubscribe();
    tool.onPointerDown(pt(0, 0), ctx);
    expect(emissions.length).toBe(0);
  });

  it('renderOverlay draws an expanding ripple that fades with age', () => {
    const tool = new PingTool({ durationMs: 1000, radius: 40 });
    setNow(tool, 0);
    const ctx = makeCtx();
    tool.onPointerDown(pt(0, 0), ctx);

    const arcs: number[] = [];
    const alphas: number[] = [];
    const mockCtx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn((_x: number, _y: number, r: number) => arcs.push(r)),
      stroke: vi.fn(),
      fill: vi.fn(),
      set globalAlpha(v: number) {
        alphas.push(v);
      },
      strokeStyle: '',
      fillStyle: '',
      lineWidth: 0,
    } as unknown as CanvasRenderingContext2D;

    setNow(tool, 200);
    tool.renderOverlay(mockCtx);
    const earlyMaxRadius = Math.max(...arcs);
    const earlyRippleAlpha = alphas[0] ?? NaN;
    expect(earlyMaxRadius).toBeGreaterThan(0);
    expect(earlyMaxRadius).toBeLessThan(40);
    expect(earlyRippleAlpha).toBeGreaterThan(0.5);

    arcs.length = 0;
    alphas.length = 0;
    setNow(tool, 800);
    tool.renderOverlay(mockCtx);
    expect(Math.max(...arcs)).toBeGreaterThan(earlyMaxRadius);
    expect(alphas[0] ?? NaN).toBeLessThan(earlyRippleAlpha);

    // Past the duration nothing draws.
    arcs.length = 0;
    setNow(tool, 1000);
    tool.renderOverlay(mockCtx);
    expect(arcs.length).toBe(0);
  });

  it('self-driven tick prunes expired pings and stops the loop', () => {
    const tool = new PingTool({ durationMs: 1000 });
    setNow(tool, 0);
    const ctx = makeCtx();
    tool.onPointerDown(pt(0, 0), ctx);
    expect((tool as unknown as PingsLike).rafId).not.toBeNull();

    setNow(tool, 500);
    flushFrame();
    expect((tool as unknown as PingsLike).pings.length).toBe(1);
    expect((tool as unknown as PingsLike).rafId).not.toBeNull();

    setNow(tool, 2000);
    flushFrame();
    expect((tool as unknown as PingsLike).pings.length).toBe(0);
    expect((tool as unknown as PingsLike).rafId).toBeNull();
    expect(ctx.requestRender).toHaveBeenCalled();
  });

  it('ensureAnimating schedules only one rAF at a time', () => {
    const tool = new PingTool({ minIntervalMs: 0 });
    setNow(tool, 0);
    const ctx = makeCtx();
    tool.onPointerDown(pt(0, 0), ctx);
    setNow(tool, 1);
    tool.onPointerDown(pt(5, 5), ctx);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
  });

  it('NEVER touches the store across taps and ticks', () => {
    const tool = new PingTool({ durationMs: 500, minIntervalMs: 0 });
    setNow(tool, 0);
    const ctx = makeCtx();
    tool.onPointerDown(pt(0, 0), ctx);
    setNow(tool, 100);
    tool.onPointerDown(pt(10, 10), ctx);
    flushFrame();
    setNow(tool, 1000);
    flushFrame();

    expect(ctx.store.add).not.toHaveBeenCalled();
    expect(ctx.store.update).not.toHaveBeenCalled();
    expect(ctx.store.remove).not.toHaveBeenCalled();
  });

  it('onDeactivate cancels the live rAF and clears pending pulses', () => {
    const tool = new PingTool();
    setNow(tool, 0);
    const ctx = makeCtx();
    tool.onPointerDown(pt(0, 0), ctx);
    const liveId = (tool as unknown as PingsLike).rafId;
    expect(liveId).not.toBeNull();

    tool.onDeactivate?.(ctx);
    expect(cancelAnimationFrame).toHaveBeenCalledWith(liveId);
    expect((tool as unknown as PingsLike).rafId).toBeNull();
    expect((tool as unknown as PingsLike).pings.length).toBe(0);
    expect(ctx.requestRender).toHaveBeenCalled();
  });
});
