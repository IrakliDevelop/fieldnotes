import { describe, it, expect, vi } from 'vitest';
import { ArrowTool } from './arrow-tool';
import { ElementStore } from '../elements/element-store';
import { Camera } from '../canvas/camera';
import { createNote } from '../elements/element-factory';
import type { ToolContext, PointerState } from './types';
import type { ArrowElement } from '../elements/types';

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

describe('ArrowTool', () => {
  it('has name "arrow"', () => {
    expect(new ArrowTool().name).toBe('arrow');
  });

  it('creates an arrow from drag start to end', () => {
    const tool = new ArrowTool();
    const ctx = makeCtx();

    tool.onPointerDown(pt(10, 20), ctx);
    tool.onPointerMove(pt(100, 200), ctx);
    tool.onPointerUp(pt(100, 200), ctx);

    expect(ctx.store.count).toBe(1);
    const arrow = ctx.store.getAll()[0] as ArrowElement;
    expect(arrow.type).toBe('arrow');
    expect(arrow.from).toEqual({ x: 10, y: 20 });
    expect(arrow.to).toEqual({ x: 100, y: 200 });
  });

  it('does not create arrow if start equals end', () => {
    const tool = new ArrowTool();
    const ctx = makeCtx();

    tool.onPointerDown(pt(50, 50), ctx);
    tool.onPointerUp(pt(50, 50), ctx);

    expect(ctx.store.count).toBe(0);
  });

  it('uses configured color and width', () => {
    const tool = new ArrowTool({ color: '#00ff00', width: 4 });
    const ctx = makeCtx();

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(100, 100), ctx);
    tool.onPointerUp(pt(100, 100), ctx);

    const arrow = ctx.store.getAll()[0] as ArrowElement;
    expect(arrow.color).toBe('#00ff00');
    expect(arrow.width).toBe(4);
  });

  it('updates color and width via setOptions', () => {
    const tool = new ArrowTool({ color: '#000000', width: 2 });
    const ctx = makeCtx();

    tool.setOptions({ color: '#ff0000', width: 5 });

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(100, 100), ctx);
    tool.onPointerUp(pt(100, 100), ctx);

    const arrow = ctx.store.getAll()[0] as ArrowElement;
    expect(arrow.color).toBe('#ff0000');
    expect(arrow.width).toBe(5);
  });

  it('snaps start and end to grid when not binding', () => {
    const tool = new ArrowTool();
    const ctx = makeCtx();
    ctx.snapToGrid = true;
    ctx.gridSize = 24;

    tool.onPointerDown(pt(10, 10), ctx);
    tool.onPointerMove(pt(110, 85), ctx);
    tool.onPointerUp(pt(110, 85), ctx);

    const arrows = ctx.store.getElementsByType('arrow');
    expect(arrows).toHaveLength(1);
    // snapPoint(10,24)=0, snapPoint(110,24)=120, snapPoint(85,24)=96
    expect(arrows[0]?.from).toEqual({ x: 0, y: 0 });
    expect(arrows[0]?.to).toEqual({ x: 120, y: 96 });
  });

  it('requests render during drag', () => {
    const tool = new ArrowTool();
    const ctx = makeCtx();

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(50, 50), ctx);

    expect(ctx.requestRender).toHaveBeenCalled();
  });

  describe('renderOverlay', () => {
    function mockCanvas(): CanvasRenderingContext2D {
      return {
        save: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: vi.fn(),
        fill: vi.fn(),
        closePath: vi.fn(),
        strokeStyle: '',
        lineWidth: 0,
        lineCap: '',
        globalAlpha: 1,
        fillStyle: '',
      } as unknown as CanvasRenderingContext2D;
    }

    it('renders preview line while dragging', () => {
      const tool = new ArrowTool();
      const ctx = makeCtx();
      const canvas = mockCanvas();

      tool.onPointerDown(pt(0, 0), ctx);
      tool.onPointerMove(pt(100, 100), ctx);
      tool.renderOverlay?.(canvas);

      expect(canvas.beginPath).toHaveBeenCalled();
      expect(canvas.moveTo).toHaveBeenCalled();
      expect(canvas.lineTo).toHaveBeenCalled();
      expect(canvas.stroke).toHaveBeenCalled();
    });

    it('does not render overlay when not drawing', () => {
      const tool = new ArrowTool();
      const canvas = mockCanvas();

      tool.renderOverlay?.(canvas);

      expect(canvas.beginPath).not.toHaveBeenCalled();
    });
  });
});

describe('ArrowTool binding', () => {
  function makeBindCtx(store: ElementStore): ToolContext {
    return {
      camera: new Camera(),
      store,
      requestRender: vi.fn(),
      switchTool: vi.fn(),
      editElement: vi.fn(),
      setCursor: vi.fn(),
    };
  }

  it('creates arrow with fromBinding when starting near an element', () => {
    const store = new ElementStore();
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 100 } });
    store.add(note);

    const tool = new ArrowTool();
    const ctx = makeBindCtx(store);

    tool.onPointerDown({ x: 55, y: 55, pressure: 0.5 }, ctx);
    tool.onPointerMove({ x: 300, y: 300, pressure: 0.5 }, ctx);
    tool.onPointerUp({ x: 300, y: 300, pressure: 0.5 }, ctx);

    const arrows = store.getElementsByType('arrow');
    expect(arrows).toHaveLength(1);
    expect(arrows[0]?.fromBinding?.elementId).toBe(note.id);
    expect(arrows[0]?.toBinding).toBeUndefined();
  });

  it('creates arrow with toBinding when ending near an element', () => {
    const store = new ElementStore();
    const note = createNote({ position: { x: 200, y: 200 }, size: { w: 100, h: 100 } });
    store.add(note);

    const tool = new ArrowTool();
    const ctx = makeBindCtx(store);

    tool.onPointerDown({ x: 0, y: 0, pressure: 0.5 }, ctx);
    tool.onPointerMove({ x: 255, y: 255, pressure: 0.5 }, ctx);
    tool.onPointerUp({ x: 255, y: 255, pressure: 0.5 }, ctx);

    const arrows = store.getElementsByType('arrow');
    expect(arrows).toHaveLength(1);
    expect(arrows[0]?.toBinding?.elementId).toBe(note.id);
    expect(arrows[0]?.from).toEqual({ x: 0, y: 0 });
  });

  it('prevents self-binding (same element at both ends)', () => {
    const store = new ElementStore();
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 200, h: 200 } });
    store.add(note);

    const tool = new ArrowTool();
    const ctx = makeBindCtx(store);

    tool.onPointerDown({ x: 50, y: 50, pressure: 0.5 }, ctx);
    tool.onPointerMove({ x: 150, y: 150, pressure: 0.5 }, ctx);
    tool.onPointerUp({ x: 150, y: 150, pressure: 0.5 }, ctx);

    const arrows = store.getElementsByType('arrow');
    expect(arrows).toHaveLength(1);
    expect(arrows[0]?.fromBinding?.elementId).toBe(note.id);
    expect(arrows[0]?.toBinding).toBeUndefined();
  });
});
