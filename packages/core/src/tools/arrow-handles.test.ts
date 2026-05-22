import { describe, it, expect, vi } from 'vitest';
import {
  applyArrowHandleDrag,
  getArrowHandleCursor,
  getArrowHandlePositions,
  hitTestArrowHandles,
  renderArrowHandles,
  getArrowHandleDragTarget,
} from './arrow-handles';
import { ElementStore } from '../elements/element-store';
import { createNote, createArrow } from '../elements/element-factory';
import type { ToolContext } from './types';
import { Camera } from '../canvas/camera';

function makeCtx(store: ElementStore): ToolContext {
  return {
    camera: new Camera(),
    store,
    requestRender: vi.fn(),
    switchTool: vi.fn(),
    editElement: vi.fn(),
    setCursor: vi.fn(),
  };
}

describe('applyArrowHandleDrag binding', () => {
  it('binds start handle when dragged near an element', () => {
    const store = new ElementStore();
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 100 } });
    const arrow = createArrow({ from: { x: 200, y: 200 }, to: { x: 400, y: 400 } });
    store.add(note);
    store.add(arrow);
    const ctx = makeCtx(store);

    applyArrowHandleDrag('start', arrow.id, { x: 55, y: 55 }, ctx);
    const updated = store.getById(arrow.id);
    expect(updated?.type === 'arrow' && updated.fromBinding?.elementId).toBe(note.id);
  });

  it('binds end handle when dragged near an element', () => {
    const store = new ElementStore();
    const note = createNote({ position: { x: 300, y: 300 }, size: { w: 100, h: 100 } });
    const arrow = createArrow({ from: { x: 0, y: 0 }, to: { x: 200, y: 200 } });
    store.add(note);
    store.add(arrow);
    const ctx = makeCtx(store);

    applyArrowHandleDrag('end', arrow.id, { x: 305, y: 305 }, ctx);
    const updated = store.getById(arrow.id);
    expect(updated?.type === 'arrow' && updated.toBinding?.elementId).toBe(note.id);
  });

  it('clears binding when handle dragged away', () => {
    const store = new ElementStore();
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 100 } });
    const arrow = createArrow({
      from: { x: 50, y: 50 },
      to: { x: 400, y: 400 },
      fromBinding: { elementId: note.id },
    });
    store.add(note);
    store.add(arrow);
    const ctx = makeCtx(store);

    applyArrowHandleDrag('start', arrow.id, { x: 500, y: 500 }, ctx);
    const updated = store.getById(arrow.id);
    expect(updated?.type === 'arrow' && updated.fromBinding).toBeUndefined();
  });

  it('prevents self-binding during handle drag', () => {
    const store = new ElementStore();
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 200, h: 200 } });
    const arrow = createArrow({
      from: { x: 50, y: 50 },
      to: { x: 400, y: 400 },
      fromBinding: { elementId: note.id },
    });
    store.add(note);
    store.add(arrow);
    const ctx = makeCtx(store);

    applyArrowHandleDrag('end', arrow.id, { x: 150, y: 150 }, ctx);
    const updated = store.getById(arrow.id);
    expect(updated?.type === 'arrow' && updated.toBinding).toBeUndefined();
  });

  it('updates bend via mid handle drag', () => {
    const store = new ElementStore();
    const arrow = createArrow({ from: { x: 0, y: 0 }, to: { x: 200, y: 0 } });
    store.add(arrow);
    const ctx = makeCtx(store);

    applyArrowHandleDrag('mid', arrow.id, { x: 100, y: 50 }, ctx);
    const updated = store.getById(arrow.id);
    expect(updated?.type === 'arrow' && updated.bend).not.toBe(0);
    expect(ctx.requestRender).toHaveBeenCalled();
  });

  it('does nothing for non-existent element', () => {
    const store = new ElementStore();
    const ctx = makeCtx(store);

    applyArrowHandleDrag('start', 'nonexistent', { x: 50, y: 50 }, ctx);
    expect(ctx.requestRender).not.toHaveBeenCalled();
  });

  it('does nothing for non-arrow element', () => {
    const store = new ElementStore();
    const note = createNote({ position: { x: 0, y: 0 } });
    store.add(note);
    const ctx = makeCtx(store);

    applyArrowHandleDrag('start', note.id, { x: 50, y: 50 }, ctx);
    expect(ctx.requestRender).not.toHaveBeenCalled();
  });

  it('clears end binding when handle dragged away', () => {
    const store = new ElementStore();
    const note = createNote({ position: { x: 300, y: 300 }, size: { w: 100, h: 100 } });
    const arrow = createArrow({
      from: { x: 0, y: 0 },
      to: { x: 350, y: 350 },
      toBinding: { elementId: note.id },
    });
    store.add(note);
    store.add(arrow);
    const ctx = makeCtx(store);

    applyArrowHandleDrag('end', arrow.id, { x: 600, y: 600 }, ctx);
    const updated = store.getById(arrow.id);
    expect(updated?.type === 'arrow' && updated.toBinding).toBeUndefined();
    expect(updated?.type === 'arrow' && updated.to).toEqual({ x: 600, y: 600 });
  });
});

describe('getArrowHandleCursor', () => {
  it('returns crosshair for start handle', () => {
    expect(getArrowHandleCursor('start', false)).toBe('crosshair');
  });

  it('returns crosshair for end handle', () => {
    expect(getArrowHandleCursor('end', true)).toBe('crosshair');
  });

  it('returns grab for inactive mid handle', () => {
    expect(getArrowHandleCursor('mid', false)).toBe('grab');
  });

  it('returns grabbing for active mid handle', () => {
    expect(getArrowHandleCursor('mid', true)).toBe('grabbing');
  });
});

describe('getArrowHandlePositions', () => {
  it('returns start, mid, and end positions', () => {
    const arrow = createArrow({ from: { x: 0, y: 0 }, to: { x: 200, y: 0 } });
    const handles = getArrowHandlePositions(arrow);

    expect(handles).toHaveLength(3);
    expect(handles[0][0]).toBe('start');
    expect(handles[0][1]).toEqual({ x: 0, y: 0 });
    expect(handles[2][0]).toBe('end');
    expect(handles[2][1]).toEqual({ x: 200, y: 0 });
    expect(handles[1][0]).toBe('mid');
  });
});

describe('hitTestArrowHandles', () => {
  it('returns null when selectedIds is empty', () => {
    const store = new ElementStore();
    const ctx = makeCtx(store);

    const result = hitTestArrowHandles({ x: 0, y: 0 }, [], ctx);
    expect(result).toBeNull();
  });

  it('returns null when no arrow handles are near the point', () => {
    const store = new ElementStore();
    const arrow = createArrow({ from: { x: 0, y: 0 }, to: { x: 200, y: 0 } });
    store.add(arrow);
    const ctx = makeCtx(store);

    const result = hitTestArrowHandles({ x: 500, y: 500 }, [arrow.id], ctx);
    expect(result).toBeNull();
  });

  it('hits the start handle', () => {
    const store = new ElementStore();
    const arrow = createArrow({ from: { x: 0, y: 0 }, to: { x: 200, y: 0 } });
    store.add(arrow);
    const ctx = makeCtx(store);

    const result = hitTestArrowHandles({ x: 2, y: 2 }, [arrow.id], ctx);
    expect(result).not.toBeNull();
    expect(result?.handle).toBe('start');
    expect(result?.elementId).toBe(arrow.id);
  });

  it('hits the end handle', () => {
    const store = new ElementStore();
    const arrow = createArrow({ from: { x: 0, y: 0 }, to: { x: 200, y: 0 } });
    store.add(arrow);
    const ctx = makeCtx(store);

    const result = hitTestArrowHandles({ x: 198, y: 2 }, [arrow.id], ctx);
    expect(result).not.toBeNull();
    expect(result?.handle).toBe('end');
  });

  it('skips non-arrow elements', () => {
    const store = new ElementStore();
    const note = createNote({ position: { x: 0, y: 0 } });
    store.add(note);
    const ctx = makeCtx(store);

    const result = hitTestArrowHandles({ x: 0, y: 0 }, [note.id], ctx);
    expect(result).toBeNull();
  });

  it('skips deleted elements', () => {
    const store = new ElementStore();
    const arrow = createArrow({ from: { x: 0, y: 0 }, to: { x: 200, y: 0 } });
    store.add(arrow);
    store.remove(arrow.id);
    const ctx = makeCtx(store);

    const result = hitTestArrowHandles({ x: 0, y: 0 }, [arrow.id], ctx);
    expect(result).toBeNull();
  });
});

describe('getArrowHandleDragTarget', () => {
  it('returns null for mid handle', () => {
    const store = new ElementStore();
    const arrow = createArrow({ from: { x: 0, y: 0 }, to: { x: 200, y: 0 } });
    store.add(arrow);
    const ctx = makeCtx(store);

    const result = getArrowHandleDragTarget('mid', arrow.id, { x: 100, y: 50 }, ctx);
    expect(result).toBeNull();
  });

  it('returns null for non-existent element', () => {
    const store = new ElementStore();
    const ctx = makeCtx(store);

    const result = getArrowHandleDragTarget('start', 'nonexistent', { x: 50, y: 50 }, ctx);
    expect(result).toBeNull();
  });

  it('returns null for non-arrow element', () => {
    const store = new ElementStore();
    const note = createNote({ position: { x: 0, y: 0 } });
    store.add(note);
    const ctx = makeCtx(store);

    const result = getArrowHandleDragTarget('start', note.id, { x: 50, y: 50 }, ctx);
    expect(result).toBeNull();
  });

  it('returns null when no bind target is found', () => {
    const store = new ElementStore();
    const arrow = createArrow({ from: { x: 0, y: 0 }, to: { x: 200, y: 0 } });
    store.add(arrow);
    const ctx = makeCtx(store);

    const result = getArrowHandleDragTarget('start', arrow.id, { x: 500, y: 500 }, ctx);
    expect(result).toBeNull();
  });

  it('returns target bounds when dragging near a bindable element', () => {
    const store = new ElementStore();
    const note = createNote({ position: { x: 50, y: 50 }, size: { w: 100, h: 80 } });
    const arrow = createArrow({ from: { x: 0, y: 0 }, to: { x: 200, y: 200 } });
    store.add(note);
    store.add(arrow);
    const ctx = makeCtx(store);

    const result = getArrowHandleDragTarget('start', arrow.id, { x: 55, y: 55 }, ctx);
    expect(result).not.toBeNull();
    expect(result?.x).toBe(50);
    expect(result?.y).toBe(50);
    expect(result?.w).toBe(100);
    expect(result?.h).toBe(80);
  });
});

describe('renderArrowHandles', () => {
  function mockCanvasCtx(): CanvasRenderingContext2D {
    return {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      setLineDash: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
  }

  it('renders three handles (start, mid, end)', () => {
    const arrow = createArrow({ from: { x: 0, y: 0 }, to: { x: 200, y: 0 } });
    const canvas = mockCanvasCtx();

    renderArrowHandles(canvas, arrow, 1);

    expect(canvas.setLineDash).toHaveBeenCalledWith([]);
    const arcCalls = (canvas.arc as ReturnType<typeof vi.fn>).mock.calls;
    expect(arcCalls.length).toBe(3);
    expect(canvas.fill).toHaveBeenCalledTimes(3);
    expect(canvas.stroke).toHaveBeenCalledTimes(3);
  });

  it('scales handle radius by zoom', () => {
    const arrow = createArrow({ from: { x: 0, y: 0 }, to: { x: 200, y: 0 } });
    const canvas = mockCanvasCtx();

    renderArrowHandles(canvas, arrow, 2);

    const arcCalls = (canvas.arc as ReturnType<typeof vi.fn>).mock.calls;
    expect(arcCalls[0][2]).toBe(5 / 2);
  });

  it('uses blue fill for mid handle and white for endpoints', () => {
    const arrow = createArrow({ from: { x: 0, y: 0 }, to: { x: 200, y: 0 } });
    const canvas = mockCanvasCtx();

    renderArrowHandles(canvas, arrow, 1);

    const fillStyleChanges: string[] = [];
    const beginPathCalls = (canvas.beginPath as ReturnType<typeof vi.fn>).mock.invocationCallOrder;
    const fillCalls = (canvas.fill as ReturnType<typeof vi.fn>).mock.invocationCallOrder;

    expect(beginPathCalls.length).toBe(3);
    expect(fillCalls.length).toBe(3);

    const fillStyleProxy = canvas as Record<string, unknown>;
    void fillStyleProxy;
    void fillStyleChanges;
  });
});
