import { describe, it, expect, vi } from 'vitest';
import { SelectTool } from './select-tool';
import { ElementStore } from '../elements/element-store';
import { Camera } from '../canvas/camera';
import { createArrow } from '../elements/element-factory';
import type { ToolContext, PointerState } from './types';
import type { ArrowElement } from '../elements/types';

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

describe('arrow control points', () => {
  it('dragging start handle repositions arrow start', () => {
    const tool = new SelectTool();
    const ctx = makeCtx();
    const arrow = createArrow({ from: { x: 50, y: 50 }, to: { x: 250, y: 150 } });
    ctx.store.add(arrow);

    // Select the arrow
    tool.onPointerDown(pt(120, 85), ctx);
    tool.onPointerUp(pt(120, 85), ctx);
    expect(tool.selectedIds).toEqual([arrow.id]);

    // Drag the start handle (at 50, 50)
    tool.onPointerDown(pt(50, 50), ctx);
    tool.onPointerMove(pt(30, 30), ctx);
    tool.onPointerUp(pt(30, 30), ctx);

    const updated = ctx.store.getById(arrow.id) as ArrowElement;
    expect(updated.from).toEqual({ x: 30, y: 30 });
    expect(updated.to).toEqual({ x: 250, y: 150 });
  });

  it('dragging end handle repositions arrow end', () => {
    const tool = new SelectTool();
    const ctx = makeCtx();
    const arrow = createArrow({ from: { x: 50, y: 50 }, to: { x: 250, y: 150 } });
    ctx.store.add(arrow);

    // Select
    tool.onPointerDown(pt(120, 85), ctx);
    tool.onPointerUp(pt(120, 85), ctx);

    // Drag end handle (at 250, 150)
    tool.onPointerDown(pt(250, 150), ctx);
    tool.onPointerMove(pt(300, 200), ctx);
    tool.onPointerUp(pt(300, 200), ctx);

    const updated = ctx.store.getById(arrow.id) as ArrowElement;
    expect(updated.from).toEqual({ x: 50, y: 50 });
    expect(updated.to).toEqual({ x: 300, y: 200 });
  });

  it('dragging mid handle changes bend', () => {
    const tool = new SelectTool();
    const ctx = makeCtx();
    const arrow = createArrow({ from: { x: 0, y: 0 }, to: { x: 200, y: 0 } });
    ctx.store.add(arrow);

    // Select
    tool.onPointerDown(pt(80, 0), ctx);
    tool.onPointerUp(pt(80, 0), ctx);

    // Drag mid handle (at 100, 0 — the midpoint) downward
    tool.onPointerDown(pt(100, 0), ctx);
    tool.onPointerMove(pt(100, 50), ctx);
    tool.onPointerUp(pt(100, 50), ctx);

    const updated = ctx.store.getById(arrow.id) as ArrowElement;
    expect(updated.bend).not.toBe(0);
    expect(updated.from).toEqual({ x: 0, y: 0 });
    expect(updated.to).toEqual({ x: 200, y: 0 });
  });

  it('whole-arrow drag preserves bend', () => {
    const tool = new SelectTool();
    const ctx = makeCtx();
    const arrow = createArrow({
      from: { x: 0, y: 0 },
      to: { x: 200, y: 0 },
      bend: 40,
    });
    ctx.store.add(arrow);

    // Select (click on the curve, not at endpoints)
    tool.onPointerDown(pt(80, 15), ctx);
    tool.onPointerUp(pt(80, 15), ctx);

    // Drag the body (away from handles)
    tool.onPointerDown(pt(80, 15), ctx);
    tool.onPointerMove(pt(90, 25), ctx);
    tool.onPointerUp(pt(90, 25), ctx);

    const updated = ctx.store.getById(arrow.id) as ArrowElement;
    expect(updated.bend).toBe(40);
  });

  it('shows crosshair cursor when hovering start handle', () => {
    const tool = new SelectTool();
    const setCursor = vi.fn();
    const ctx = makeCtx({ setCursor });
    const arrow = createArrow({ from: { x: 50, y: 50 }, to: { x: 250, y: 150 } });
    ctx.store.add(arrow);

    tool.onActivate(ctx);
    tool.onPointerDown(pt(120, 85), ctx);
    tool.onPointerUp(pt(120, 85), ctx);
    setCursor.mockClear();

    tool.onHover?.(pt(50, 50), ctx);
    expect(setCursor).toHaveBeenCalledWith('crosshair');
  });

  it('shows grab cursor when hovering mid handle', () => {
    const tool = new SelectTool();
    const setCursor = vi.fn();
    const ctx = makeCtx({ setCursor });
    const arrow = createArrow({ from: { x: 0, y: 0 }, to: { x: 200, y: 0 } });
    ctx.store.add(arrow);

    tool.onActivate(ctx);
    tool.onPointerDown(pt(80, 0), ctx);
    tool.onPointerUp(pt(80, 0), ctx);
    setCursor.mockClear();

    // Midpoint is at (100, 0)
    tool.onHover?.(pt(100, 0), ctx);
    expect(setCursor).toHaveBeenCalledWith('grab');
  });

  it('renders arrow handles as circles', () => {
    const tool = new SelectTool();
    const ctx = makeCtx();
    const arrow = createArrow({ from: { x: 50, y: 50 }, to: { x: 250, y: 150 } });
    ctx.store.add(arrow);

    tool.onPointerDown(pt(120, 85), ctx);
    tool.onPointerUp(pt(120, 85), ctx);

    const canvas = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      strokeRect: vi.fn(),
      fillRect: vi.fn(),
      setLineDash: vi.fn(),
      strokeStyle: '',
      fillStyle: '',
      lineWidth: 0,
    } as unknown as CanvasRenderingContext2D;

    tool.renderOverlay?.(canvas);

    // 3 circular handles (start, mid, end)
    expect(canvas.arc).toHaveBeenCalledTimes(3);
    // No rectangular handles for arrows
    expect(canvas.fillRect).not.toHaveBeenCalled();
  });

  it('created arrows have bend 0 by default', () => {
    const arrow = createArrow({ from: { x: 0, y: 0 }, to: { x: 100, y: 100 } });
    expect(arrow.bend).toBe(0);
  });
});
