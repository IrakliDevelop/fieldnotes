import { describe, it, expect, vi } from 'vitest';
import { EraserTool } from './eraser-tool';
import type { EraserToolOptions } from './eraser-tool';
import { ElementStore } from '../elements/element-store';
import { Camera } from '../canvas/camera';
import { createStroke, createNote } from '../elements/element-factory';
import type { ToolContext, PointerState } from './types';

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    camera: new Camera(),
    store: new ElementStore(),
    requestRender: vi.fn(),
    ...overrides,
  };
}

function makeEraser(options: EraserToolOptions): {
  tool: EraserTool;
  ctx: ToolContext;
  store: ElementStore;
} {
  const store = new ElementStore();
  const ctx: ToolContext = {
    camera: new Camera(),
    store,
    requestRender: vi.fn(),
    isLayerVisible: () => true,
    isLayerLocked: () => false,
  };
  const tool = new EraserTool(options);
  return { tool, ctx, store };
}

function pt(x: number, y: number): PointerState {
  return { x, y, pressure: 0.5, pointerType: 'mouse', shiftKey: false };
}

describe('EraserTool', () => {
  it('has name "eraser"', () => {
    expect(new EraserTool().name).toBe('eraser');
  });

  it('removes a stroke whose points are near the eraser path', () => {
    const ctx = makeCtx();
    const stroke = createStroke({
      points: [
        { x: 10, y: 10, pressure: 0.5 },
        { x: 20, y: 20, pressure: 0.5 },
      ],
    });
    ctx.store.add(stroke);

    const tool = new EraserTool();
    tool.onPointerDown(pt(10, 10), ctx);
    tool.onPointerMove(pt(15, 15), ctx);
    tool.onPointerUp(pt(15, 15), ctx);

    expect(ctx.store.count).toBe(0);
  });

  it('does not remove strokes far from eraser path', () => {
    const ctx = makeCtx();
    const stroke = createStroke({
      points: [
        { x: 500, y: 500, pressure: 0.5 },
        { x: 510, y: 510, pressure: 0.5 },
      ],
    });
    ctx.store.add(stroke);

    const tool = new EraserTool();
    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(10, 10), ctx);
    tool.onPointerUp(pt(10, 10), ctx);

    expect(ctx.store.count).toBe(1);
  });

  it('only erases stroke elements, not notes', () => {
    const ctx = makeCtx();
    const note = createNote({ position: { x: 0, y: 0 } });
    ctx.store.add(note);

    const tool = new EraserTool();
    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(5, 5), ctx);
    tool.onPointerUp(pt(5, 5), ctx);

    expect(ctx.store.count).toBe(1);
  });

  it('requests render when erasing', () => {
    const ctx = makeCtx();
    ctx.store.add(
      createStroke({
        points: [
          { x: 10, y: 10, pressure: 0.5 },
          { x: 20, y: 20, pressure: 0.5 },
        ],
      }),
    );

    const tool = new EraserTool();
    tool.onPointerDown(pt(10, 10), ctx);
    tool.onPointerMove(pt(15, 15), ctx);

    expect(ctx.requestRender).toHaveBeenCalled();
  });

  it('does not erase strokes on hidden layers', () => {
    const store = new ElementStore();
    const stroke = createStroke({
      points: [{ x: 50, y: 50, pressure: 0.5 }],
      layerId: 'hidden-layer',
    });
    store.add(stroke);

    const ctx: ToolContext = {
      camera: new Camera(),
      store,
      requestRender: vi.fn(),
      isLayerVisible: (id: string) => id !== 'hidden-layer',
      isLayerLocked: () => false,
    };

    const tool = new EraserTool();
    tool.onPointerDown(pt(50, 50), ctx);
    expect(store.count).toBe(1);
  });

  it('does not erase strokes on locked layers', () => {
    const store = new ElementStore();
    const stroke = createStroke({
      points: [{ x: 50, y: 50, pressure: 0.5 }],
      layerId: 'locked-layer',
    });
    store.add(stroke);

    const ctx: ToolContext = {
      camera: new Camera(),
      store,
      requestRender: vi.fn(),
      isLayerVisible: () => true,
      isLayerLocked: (id: string) => id === 'locked-layer',
    };

    const tool = new EraserTool();
    tool.onPointerDown(pt(50, 50), ctx);
    expect(store.count).toBe(1);
  });

  it('erasing with no strokes in store is a no-op', () => {
    const ctx = makeCtx();
    expect(ctx.store.count).toBe(0);

    const tool = new EraserTool();
    tool.onPointerDown(pt(10, 10), ctx);
    tool.onPointerMove(pt(20, 20), ctx);
    tool.onPointerUp(pt(20, 20), ctx);

    expect(ctx.store.count).toBe(0);
  });

  it('accepts custom eraser radius', () => {
    const ctx = makeCtx();
    ctx.store.add(
      createStroke({
        points: [
          { x: 50, y: 50, pressure: 0.5 },
          { x: 60, y: 60, pressure: 0.5 },
        ],
      }),
    );

    const tool = new EraserTool({ radius: 5 });
    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(5, 5), ctx);
    tool.onPointerUp(pt(5, 5), ctx);

    expect(ctx.store.count).toBe(1);
  });

  it('erases a sparse stroke at the midpoint between its sample points', () => {
    const ctx = makeCtx();
    const sparse = createStroke({
      points: [
        { x: 0, y: 0, pressure: 0.5 },
        { x: 100, y: 0, pressure: 0.5 },
      ],
    });
    ctx.store.add(sparse);

    const tool = new EraserTool({ mode: 'stroke' });
    tool.onPointerDown(pt(50, 2), ctx);
    tool.onPointerUp(pt(50, 2), ctx);

    expect(ctx.store.count).toBe(0);
  });

  describe('getOptions', () => {
    it('returns current options', () => {
      const tool = new EraserTool({ radius: 30, mode: 'stroke' });
      expect(tool.getOptions()).toEqual({ radius: 30, mode: 'stroke' });
    });

    it('returns default options', () => {
      const tool = new EraserTool();
      expect(tool.getOptions()).toEqual({ radius: 20, mode: 'partial' });
    });

    it('setOptions updates radius (and round-trips)', () => {
      const tool = new EraserTool();
      tool.setOptions({ radius: 8 });
      expect(tool.getOptions()).toEqual({ radius: 8, mode: 'partial' });
    });
  });

  describe('partial mode', () => {
    it('partial mode splits a stroke into surviving fragments (one drag)', () => {
      const { tool, ctx, store } = makeEraser({ mode: 'partial', radius: 3 });
      const stroke = createStroke({
        points: [
          { x: 0, y: 0, pressure: 1 },
          { x: 10, y: 0, pressure: 1 },
          { x: 20, y: 0, pressure: 1 },
          { x: 30, y: 0, pressure: 1 },
        ],
        color: '#abc',
        width: 4,
        opacity: 0.5,
        layerId: 'L1',
        zIndex: 7,
      });
      store.add(stroke);
      tool.onPointerDown({ x: 15, y: 0, pressure: 1, pointerType: 'mouse', shiftKey: false }, ctx);
      tool.onPointerUp({ x: 15, y: 0, pressure: 1, pointerType: 'mouse', shiftKey: false }, ctx);
      const strokes = store.getAll().filter((e) => e.type === 'stroke');
      expect(store.getById(stroke.id)).toBeUndefined();
      expect(strokes).toHaveLength(2);
      for (const s of strokes) {
        expect(s).toMatchObject({
          color: '#abc',
          width: 4,
          opacity: 0.5,
          layerId: 'L1',
          zIndex: 7,
        });
        expect(s.id).not.toBe(stroke.id);
      }
    });

    it('stroke mode removes the whole stroke', () => {
      const { tool, ctx, store } = makeEraser({ mode: 'stroke', radius: 3 });
      const stroke = createStroke({
        points: [
          { x: 0, y: 0, pressure: 1 },
          { x: 30, y: 0, pressure: 1 },
        ],
      });
      store.add(stroke);
      tool.onPointerDown({ x: 15, y: 0, pressure: 1, pointerType: 'mouse', shiftKey: false }, ctx);
      expect(store.getById(stroke.id)).toBeUndefined();
      expect(store.getAll().filter((e) => e.type === 'stroke')).toHaveLength(0);
    });

    it('leaves non-stroke elements untouched in partial mode', () => {
      const { tool, ctx, store } = makeEraser({ mode: 'partial', radius: 50 });
      const note = createNote({ position: { x: 0, y: 0 } });
      store.add(note);
      tool.onPointerDown({ x: 0, y: 0, pressure: 1, pointerType: 'mouse', shiftKey: false }, ctx);
      expect(store.getById(note.id)).toBeDefined();
    });

    it('round-trips the mode option', () => {
      const { tool } = makeEraser({ mode: 'stroke' });
      expect(tool.getOptions().mode).toBe('stroke');
      tool.setOptions({ mode: 'partial' });
      expect(tool.getOptions().mode).toBe('partial');
    });

    it('defaults to partial mode', () => {
      const { tool } = makeEraser({});
      expect(tool.getOptions().mode).toBe('partial');
    });
  });
});
