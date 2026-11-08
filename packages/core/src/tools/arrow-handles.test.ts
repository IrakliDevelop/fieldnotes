import { describe, it, expect, vi } from 'vitest';
import {
  applyArrowHandleDrag,
  getArrowHandleCursor,
  getArrowHandlePositions,
  hitTestArrowHandles,
  renderArrowHandles,
  getArrowHandleDragTarget,
  captureArrowHandleDrag,
} from './arrow-handles';
import { getElbowRoute } from '../elements/elbow-cache';
import { ElementStore } from '../elements/element-store';
import { getArrowMidpoint } from '../elements/arrow-geometry';
import { createNote, createArrow } from '../elements/element-factory';
import type { ToolContext } from './types';
import { Camera } from '../canvas/camera';

function makeCtx(store: ElementStore): ToolContext {
  return {
    camera: new Camera(),
    store,
    requestRender: vi.fn(),
    requestOverlayRender: vi.fn(),
    switchTool: vi.fn(),
    editElement: vi.fn(),
    setCursor: vi.fn(),
  };
}

describe('applyArrowHandleDrag binding', () => {
  it('pins the captured middle vertical segment and replaces the same slot on later moves', () => {
    const store = new ElementStore();
    const arrow = createArrow({
      from: { x: 0, y: 0 },
      to: { x: 100, y: 100 },
      routing: 'elbow',
    });
    store.add(arrow);
    const ctx = makeCtx(store);
    const drag = captureArrowHandleDrag('segment:1', arrow.id, ctx);
    if (!drag) throw new Error('expected segment drag');

    applyArrowHandleDrag('segment:1', arrow.id, { x: 70, y: 50 }, ctx, drag);
    expect(store.getById(arrow.id)).toMatchObject({ fixedSegments: [{ axis: 'x', value: 70 }] });

    applyArrowHandleDrag('segment:1', arrow.id, { x: 75, y: 50 }, ctx, drag);
    expect(store.getById(arrow.id)).toMatchObject({ fixedSegments: [{ axis: 'x', value: 75 }] });
  });

  it('pins y for a captured middle horizontal segment', () => {
    const store = new ElementStore();
    const arrow = createArrow({
      from: { x: 0, y: 0 },
      to: { x: 100, y: 200 },
      routing: 'elbow',
    });
    store.add(arrow);
    const ctx = makeCtx(store);
    const drag = captureArrowHandleDrag('segment:1', arrow.id, ctx);
    if (!drag) throw new Error('expected segment drag');

    applyArrowHandleDrag('segment:1', arrow.id, { x: 50, y: 70 }, ctx, drag);

    expect(store.getById(arrow.id)).toMatchObject({ fixedSegments: [{ axis: 'y', value: 70 }] });
  });

  it('updates only a tagged captured slot after route changes', () => {
    const store = new ElementStore();
    const arrow = createArrow({
      from: { x: 0, y: 0 },
      to: { x: 100, y: 100 },
      routing: 'elbow',
      fixedSegments: [
        { axis: 'x', value: 20 },
        { axis: 'y', value: 40 },
        { axis: 'x', value: 80 },
      ],
    });
    store.add(arrow);
    const ctx = makeCtx(store);
    const route = getElbowRoute(store, store.getById(arrow.id) as typeof arrow);
    const index = route?.segments.findIndex((segment) => segment.fixedIndex === 1);
    if (index === undefined || index < 0) throw new Error('expected tagged segment');
    const handle = `segment:${index}` as const;
    const drag = captureArrowHandleDrag(handle, arrow.id, ctx);
    if (!drag) throw new Error('expected segment drag');
    store.add(createNote({ position: { x: 45, y: 0 }, size: { w: 10, h: 100 } }));

    applyArrowHandleDrag(handle, arrow.id, { x: 50, y: 65 }, ctx, drag);

    expect(store.getById(arrow.id)).toMatchObject({
      fixedSegments: [
        { axis: 'x', value: 20 },
        { axis: 'y', value: 65 },
        { axis: 'x', value: 80 },
      ],
    });
  });

  it('does not create a seventeenth pin or edit protected arrows', () => {
    const pins = Array.from({ length: 16 }, (_, index) => ({ axis: 'x' as const, value: index }));
    const store = new ElementStore();
    const arrow = createArrow({
      from: { x: 0, y: 0 },
      to: { x: 100, y: 100 },
      routing: 'elbow',
      fixedSegments: pins,
    });
    store.add(arrow);
    const ctx = makeCtx(store);

    expect(captureArrowHandleDrag('segment:1', arrow.id, ctx)).toBeNull();
    expect(store.getById(arrow.id)).toMatchObject({ fixedSegments: pins });

    const locked = { ...arrow, id: 'locked', locked: true };
    store.add(locked);
    expect(captureArrowHandleDrag('segment:1', locked.id, ctx)).toBeNull();
  });

  it('keeps fixed pins while endpoint binding and rebinding changes', () => {
    const store = new ElementStore();
    const first = createNote({ position: { x: 200, y: 0 }, size: { w: 100, h: 100 } });
    const second = createNote({ position: { x: 400, y: 0 }, size: { w: 100, h: 100 } });
    const arrow = createArrow({
      from: { x: 0, y: 0 },
      to: { x: 100, y: 100 },
      routing: 'elbow',
      fixedSegments: [{ axis: 'x', value: 70 }],
    });
    store.add(first);
    store.add(second);
    store.add(arrow);
    const ctx = makeCtx(store);

    applyArrowHandleDrag('end', arrow.id, { x: 205, y: 5 }, ctx);
    applyArrowHandleDrag('end', arrow.id, { x: 405, y: 5 }, ctx);

    expect(store.getById(arrow.id)).toMatchObject({
      fixedSegments: [{ axis: 'x', value: 70 }],
      toBinding: { elementId: second.id },
    });
  });
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

  it('mid handle drag lands the curve midpoint (the handle) at the drag point', () => {
    const store = new ElementStore();
    const arrow = createArrow({ from: { x: 0, y: 0 }, to: { x: 200, y: 0 } });
    store.add(arrow);
    const ctx = makeCtx(store);

    const dragPoint = { x: 100, y: 50 };
    applyArrowHandleDrag('mid', arrow.id, dragPoint, ctx);
    const updated = store.getById(arrow.id);
    expect(updated?.type).toBe('arrow');
    if (updated?.type !== 'arrow') return;

    // The handle is drawn at getArrowMidpoint; after the drag it must sit on the pointer 1:1.
    const handlePos = getArrowMidpoint(updated.from, updated.to, updated.bend);
    expect(handlePos.x).toBeCloseTo(dragPoint.x);
    expect(handlePos.y).toBeCloseTo(dragPoint.y);
  });

  it('re-grabbing the mid handle does not move the curve (idempotent drag)', () => {
    const store = new ElementStore();
    const arrow = createArrow({ from: { x: 0, y: 0 }, to: { x: 200, y: 0 } });
    store.add(arrow);
    const ctx = makeCtx(store);

    // First drag.
    applyArrowHandleDrag('mid', arrow.id, { x: 100, y: 50 }, ctx);
    const afterFirst = store.getById(arrow.id);
    if (afterFirst?.type !== 'arrow') throw new Error('expected arrow');
    const handle = getArrowMidpoint(afterFirst.from, afterFirst.to, afterFirst.bend);

    // Re-grab: drag the handle to where it currently is. Bend must not jump.
    applyArrowHandleDrag('mid', arrow.id, handle, ctx);
    const afterSecond = store.getById(arrow.id);
    if (afterSecond?.type !== 'arrow') throw new Error('expected arrow');
    expect(afterSecond.bend).toBeCloseTo(afterFirst.bend);
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

  it.each([
    ['element lock', { locked: true }, undefined],
    ['layer lock', { layerId: 'locked-layer' }, (id: string) => id === 'locked-layer'],
  ])('does not mutate an arrow protected by %s', (_name, input, isLayerLocked) => {
    const store = new ElementStore();
    const arrow = createArrow({
      from: { x: 0, y: 0 },
      to: { x: 200, y: 0 },
      index: 'a0',
      ...input,
    });
    store.add(arrow);
    const ctx = { ...makeCtx(store), isLayerLocked };

    applyArrowHandleDrag('mid', arrow.id, { x: 100, y: 50 }, ctx);

    expect(store.getById(arrow.id)).toEqual(arrow);
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
  it('uses only endpoint and interior route-segment handles for elbow arrows', () => {
    const arrow = createArrow({
      from: { x: 0, y: 0 },
      to: { x: 100, y: 100 },
      routing: 'elbow',
    });

    expect(getArrowHandlePositions(arrow)).toEqual([
      ['start', { x: 0, y: 0 }],
      ['segment:1', { x: 50, y: 50 }],
      ['end', { x: 100, y: 100 }],
    ]);
  });

  it('uses routed visible ports and omits bezier mid handles from elbow arrows', () => {
    const store = new ElementStore();
    const source = createNote({ position: { x: -20, y: -20 }, size: { w: 40, h: 40 } });
    const target = createNote({ position: { x: 80, y: 80 }, size: { w: 40, h: 40 } });
    const arrow = createArrow({
      from: { x: 0, y: 0 },
      to: { x: 100, y: 100 },
      routing: 'elbow',
      fromBinding: { elementId: source.id },
      toBinding: { elementId: target.id },
    });
    store.add(source);
    store.add(target);
    store.add(arrow);

    const route = getElbowRoute(store, store.getById(arrow.id) as typeof arrow);
    expect(getArrowHandlePositions(store.getById(arrow.id) as typeof arrow, store)).toEqual([
      ['start', route?.points[0]],
      ['segment:1', { x: 50, y: 50 }],
      ['end', route?.points.at(-1)],
    ]);
  });

  it('hides first and last elbow segments and keeps bezier midpoint behavior', () => {
    const elbow = createArrow({
      from: { x: 0, y: 0 },
      to: { x: 100, y: 100 },
      routing: 'elbow',
    });
    const bezier = createArrow({ from: { x: 0, y: 0 }, to: { x: 100, y: 100 } });

    expect(getArrowHandlePositions(elbow).map(([handle]) => handle)).toEqual([
      'start',
      'segment:1',
      'end',
    ]);
    expect(getArrowHandlePositions(bezier).map(([handle]) => handle)).toEqual([
      'start',
      'mid',
      'end',
    ]);
  });

  it('returns start, mid, and end positions', () => {
    const arrow = createArrow({ from: { x: 0, y: 0 }, to: { x: 200, y: 0 } });
    const handles = getArrowHandlePositions(arrow);

    expect(handles).toHaveLength(3);
    expect(handles[0]?.[0]).toBe('start');
    expect(handles[0]?.[1]).toEqual({ x: 0, y: 0 });
    expect(handles[2]?.[0]).toBe('end');
    expect(handles[2]?.[1]).toEqual({ x: 200, y: 0 });
    expect(handles[1]?.[0]).toBe('mid');
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

  it.each([
    ['element lock', { locked: true }, undefined],
    ['layer lock', { layerId: 'locked-layer' }, (id: string) => id === 'locked-layer'],
  ])('returns null for an arrow protected by %s', (_name, input, isLayerLocked) => {
    const store = new ElementStore();
    const arrow = createArrow({ from: { x: 0, y: 0 }, to: { x: 200, y: 0 }, ...input });
    store.add(arrow);
    const ctx = { ...makeCtx(store), isLayerLocked };

    expect(hitTestArrowHandles({ x: 0, y: 0 }, [arrow.id], ctx)).toBeNull();
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
    expect(arcCalls[0]?.[2]).toBe(5 / 2);
  });

  it('uses blue fill for mid handle and white for endpoints', () => {
    const arrow = createArrow({ from: { x: 0, y: 0 }, to: { x: 200, y: 0 } });
    const canvas = mockCanvasCtx();

    renderArrowHandles(canvas, arrow, 1);

    const beginPathCalls = (canvas.beginPath as ReturnType<typeof vi.fn>).mock.invocationCallOrder;
    const fillCalls = (canvas.fill as ReturnType<typeof vi.fn>).mock.invocationCallOrder;

    expect(beginPathCalls.length).toBe(3);
    expect(fillCalls.length).toBe(3);
  });
});
