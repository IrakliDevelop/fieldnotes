import { describe, it, expect, vi } from 'vitest';
import { EraserTool } from './eraser-tool';
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

function pt(x: number, y: number): PointerState {
  return { x, y, pressure: 0.5 };
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
});
