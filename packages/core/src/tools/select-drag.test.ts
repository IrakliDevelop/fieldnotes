import { describe, it, expect, vi } from 'vitest';
import { SelectTool } from './select-tool';
import { ToolManager } from './tool-manager';
import { HandTool } from './hand-tool';
import { ElementStore } from '../elements/element-store';
import { Camera } from '../canvas/camera';
import { createArrow, createNote, createShape } from '../elements/element-factory';
import { HistoryStack } from '../history/history-stack';
import { HistoryRecorder } from '../history/history-recorder';
import type { ToolContext, PointerState } from './types';
import type { SelectDragObserver } from './select-drag';

function setup() {
  const store = new ElementStore();
  const stack = new HistoryStack();
  const recorder = new HistoryRecorder(store, stack);
  const ctx: ToolContext = {
    camera: new Camera(),
    store,
    requestRender: vi.fn(),
    requestOverlayRender: vi.fn(),
  };
  const tool = new SelectTool();
  const shape = createShape({ position: { x: 100, y: 100 }, size: { w: 50, h: 50 } });
  store.add(shape);
  return { store, stack, recorder, ctx, tool, shape };
}

function pt(
  x: number,
  y: number,
  pointerType: PointerState['pointerType'] = 'mouse',
): PointerState {
  return { x, y, pressure: 0.5, pointerType, shiftKey: false };
}

function key(k: string): KeyboardEvent {
  return new KeyboardEvent('keydown', { key: k });
}

function spyObserver() {
  return {
    onDragStart: vi.fn(),
    onDragMove: vi.fn(),
    onDragEnd: vi.fn(),
    onDragCancel: vi.fn(),
  } satisfies SelectDragObserver;
}

describe('SelectTool drag observers', () => {
  it('drag start fires on the first move, not on pointerdown', () => {
    const { ctx, tool, shape } = setup();
    const observer = spyObserver();
    tool.addDragObserver(observer);

    tool.onPointerDown(pt(120, 120, 'pen'), ctx);
    expect(observer.onDragStart).not.toHaveBeenCalled();

    tool.onPointerMove(pt(130, 120, 'pen'), ctx);
    expect(observer.onDragStart).toHaveBeenCalledTimes(1);
    const info = observer.onDragStart.mock.calls[0]?.[0];
    expect(info.ids).toEqual([shape.id]);
    expect(info.origins.get(shape.id)).toEqual({ x: 100, y: 100 });
    expect(info.pointer).toEqual({ x: 130, y: 120 });
    expect(info.pointerType).toBe('pen');
    expect(ctx.store.getById(shape.id)?.position).toEqual({ x: 110, y: 100 });
  });

  it('click without movement fires no drag events', () => {
    const { ctx, tool } = setup();
    const observer = spyObserver();
    tool.addDragObserver(observer);

    tool.onPointerDown(pt(120, 120), ctx);
    tool.onPointerUp(pt(120, 120), ctx);

    expect(observer.onDragStart).not.toHaveBeenCalled();
    expect(observer.onDragMove).not.toHaveBeenCalled();
    expect(observer.onDragEnd).not.toHaveBeenCalled();
    expect(observer.onDragCancel).not.toHaveBeenCalled();
  });

  it('a removed observer receives no further events', () => {
    const { ctx, tool } = setup();
    const observer = spyObserver();
    const remove = tool.addDragObserver(observer);
    remove();

    tool.onPointerDown(pt(120, 120), ctx);
    tool.onPointerMove(pt(130, 120), ctx);
    tool.onPointerUp(pt(130, 120), ctx);

    expect(observer.onDragStart).not.toHaveBeenCalled();
    expect(observer.onDragEnd).not.toHaveBeenCalled();
  });

  it('onDragEnd runs inside the open transaction', () => {
    const { store, stack, recorder, ctx, tool, shape } = setup();
    const other = createShape({ position: { x: 400, y: 400 }, size: { w: 50, h: 50 } });
    store.add(other);
    tool.addDragObserver({
      onDragEnd: (_info, c) => c.store.update(other.id, { position: { x: 0, y: 0 } }),
    });
    const before = stack.undoCount;

    recorder.begin();
    tool.onPointerDown(pt(120, 120), ctx);
    tool.onPointerMove(pt(130, 120), ctx);
    tool.onPointerUp(pt(130, 120), ctx);
    recorder.commit();

    expect(stack.undoCount).toBe(before + 1);
    stack.undo(store);
    expect(store.getById(shape.id)?.position).toEqual({ x: 100, y: 100 });
    expect(store.getById(other.id)?.position).toEqual({ x: 400, y: 400 });
  });

  it('pointer cancel ends the drag like pointerup', () => {
    const { ctx, tool, shape } = setup();
    const manager = new ToolManager();
    manager.register(tool);
    manager.setTool('select', ctx);
    const observer = spyObserver();
    tool.addDragObserver(observer);

    manager.handlePointerDown(pt(120, 120, 'touch'), ctx);
    manager.handlePointerMove(pt(130, 120, 'touch'), ctx);
    manager.handlePointerCancel(pt(130, 120, 'touch'), ctx);

    expect(observer.onDragEnd).toHaveBeenCalledTimes(1);
    expect(observer.onDragCancel).not.toHaveBeenCalled();
    expect(ctx.store.getById(shape.id)?.position).toEqual({ x: 110, y: 100 });
  });

  it('a tool switch mid-drag ends the drag', () => {
    const { ctx, tool, shape } = setup();
    const manager = new ToolManager();
    manager.register(tool);
    manager.register(new HandTool());
    manager.setTool('select', ctx);
    const observer = spyObserver();
    tool.addDragObserver(observer);

    manager.handlePointerDown(pt(120, 120), ctx);
    manager.handlePointerMove(pt(130, 120), ctx);
    manager.setTool('hand', ctx);

    expect(observer.onDragEnd).toHaveBeenCalledTimes(1);
    expect(observer.onDragEnd.mock.calls[0]?.[0].ids).toEqual([shape.id]);
    expect(observer.onDragCancel).not.toHaveBeenCalled();
  });

  it('Escape restores positions and records nothing', () => {
    const { store, stack, recorder, ctx, tool, shape } = setup();
    const loose = createArrow({
      position: { x: 300, y: 300 },
      from: { x: 300, y: 300 },
      to: { x: 350, y: 300 },
    });
    const bound = createArrow({
      position: { x: 125, y: 125 },
      from: { x: 125, y: 125 },
      to: { x: 125, y: 500 },
      fromBinding: { elementId: shape.id },
    });
    store.add(loose);
    store.add(bound);
    const observer = spyObserver();
    tool.addDragObserver(observer);
    tool.setSelection([shape.id, loose.id]);
    const before = stack.undoCount;

    recorder.begin();
    tool.onPointerDown(pt(105, 105), ctx);
    tool.onPointerMove(pt(115, 105), ctx);
    tool.onPointerMove(pt(125, 110), ctx);
    tool.onPointerMove(pt(135, 115), ctx);
    expect(store.getById(shape.id)?.position).toEqual({ x: 130, y: 110 });

    expect(tool.onKeyDown(key('Escape'), ctx)).toBe(true);

    expect(store.getById(shape.id)?.position).toEqual({ x: 100, y: 100 });
    const looseAfter = store.getById(loose.id);
    expect(looseAfter?.type === 'arrow' && looseAfter.from).toEqual({ x: 300, y: 300 });
    expect(looseAfter?.type === 'arrow' && looseAfter.to).toEqual({ x: 350, y: 300 });
    const boundAfter = store.getById(bound.id);
    expect(boundAfter?.type === 'arrow' && boundAfter.from).toEqual({ x: 125, y: 125 });
    expect(observer.onDragCancel).toHaveBeenCalledTimes(1);

    tool.onPointerMove(pt(200, 200), ctx);
    expect(store.getById(shape.id)?.position).toEqual({ x: 100, y: 100 });
    tool.onPointerUp(pt(200, 200), ctx);
    recorder.commit();

    expect(observer.onDragEnd).not.toHaveBeenCalled();
    expect(stack.undoCount).toBe(before);
  });

  it('keeps observer roots literal and restores an inherited arrow on Escape', () => {
    const { store, stack, recorder, ctx, tool } = setup();
    const parent = createNote({ position: { x: 300, y: 300 }, size: { w: 80, h: 60 } });
    const child = createNote({
      position: { x: 320, y: 320 },
      size: { w: 40, h: 20 },
      parentId: parent.id,
    });
    const locked = createNote({
      position: { x: 340, y: 340 },
      size: { w: 20, h: 10 },
      parentId: child.id,
      locked: true,
    });
    const inherited = createArrow({
      position: { x: 500, y: 500 },
      from: { x: 500, y: 500 },
      to: { x: 520, y: 520 },
      parentId: parent.id,
      fromBinding: { elementId: parent.id, anchor: { x: 0.5, y: 0.5 } },
    });
    const external = createArrow({
      position: { x: 340, y: 330 },
      from: { x: 340, y: 330 },
      to: { x: 600, y: 600 },
      fromBinding: { elementId: parent.id, anchor: { x: 0.5, y: 0.5 } },
    });
    store.add(parent);
    store.add(child);
    store.add(locked);
    store.add(inherited);
    store.add(external);
    const observer = spyObserver();
    tool.addDragObserver(observer);
    tool.setSelection([child.id, parent.id]);
    const before = stack.undoCount;
    recorder.begin();

    tool.onPointerDown(pt(305, 305), ctx);
    tool.onPointerMove(pt(325, 320), ctx);
    tool.onPointerMove(pt(335, 330), ctx);
    const info = observer.onDragStart.mock.calls[0]?.[0];
    expect(info?.ids).toEqual([child.id, parent.id]);
    expect([...(info?.origins.keys() ?? [])]).toEqual([child.id, parent.id]);
    expect(tool.selectedIds).toEqual([child.id, parent.id]);
    expect(store.getById(child.id)?.position).toEqual({ x: 350, y: 345 });
    expect(store.getVersion(child.id)).toBe(2);
    expect(store.getById(locked.id)?.position).toEqual({ x: 370, y: 365 });
    expect(store.getById(inherited.id)).toMatchObject({
      position: { x: 530, y: 525 },
      from: { x: 530, y: 525 },
      to: { x: 550, y: 545 },
    });

    expect(tool.onKeyDown(key('Escape'), ctx)).toBe(true);
    tool.onPointerUp(pt(335, 330), ctx);
    recorder.commit();
    expect(store.getById(parent.id)?.position).toEqual({ x: 300, y: 300 });
    expect(store.getById(child.id)?.position).toEqual({ x: 320, y: 320 });
    expect(store.getById(locked.id)?.position).toEqual({ x: 340, y: 340 });
    expect(store.getById(inherited.id)).toMatchObject({
      position: { x: 500, y: 500 },
      from: { x: 500, y: 500 },
      to: { x: 520, y: 520 },
    });
    expect(store.getVersion(inherited.id)).toBe(3);
    expect(store.getById(external.id)).toMatchObject({
      position: { x: 340, y: 330 },
      from: { x: 340, y: 330 },
      to: { x: 600, y: 600 },
    });
    expect(store.getVersion(external.id)).toBe(3);
    expect(observer.onDragCancel).toHaveBeenCalledOnce();
    expect(observer.onDragEnd).not.toHaveBeenCalled();
    expect(stack.undoCount).toBe(before);
  });

  it('records a completed subtree drag as one undoable command', () => {
    const { store, stack, recorder, ctx, tool } = setup();
    const parent = createNote({ position: { x: 300, y: 300 }, size: { w: 80, h: 60 } });
    const child = createNote({
      position: { x: 320, y: 320 },
      size: { w: 40, h: 20 },
      parentId: parent.id,
    });
    const locked = createNote({
      position: { x: 340, y: 340 },
      size: { w: 20, h: 10 },
      parentId: child.id,
      locked: true,
    });
    const arrow = createArrow({
      position: { x: 500, y: 500 },
      from: { x: 500, y: 500 },
      to: { x: 540, y: 540 },
      parentId: parent.id,
    });
    store.add(parent);
    store.add(child);
    store.add(locked);
    store.add(arrow);
    stack.clear();
    tool.setSelection([child.id, parent.id]);
    recorder.begin();
    const firstUpdate: { parent: unknown; child: unknown; locked: unknown; arrow: unknown }[] = [];
    store.on('update', () => {
      if (firstUpdate.length === 0) {
        firstUpdate.push({
          parent: store.getById(parent.id)?.position,
          child: store.getById(child.id)?.position,
          locked: store.getById(locked.id)?.position,
          arrow: store.getById(arrow.id),
        });
      }
    });

    tool.onPointerDown(pt(305, 305), ctx);
    tool.onPointerMove(pt(325, 320), ctx);
    tool.onPointerUp(pt(325, 320), ctx);
    recorder.commit();

    expect(stack.undoCount).toBe(1);
    expect(firstUpdate).toEqual([
      {
        parent: { x: 320, y: 315 },
        child: { x: 340, y: 335 },
        locked: { x: 360, y: 355 },
        arrow: expect.objectContaining({
          position: { x: 520, y: 515 },
          from: { x: 520, y: 515 },
          to: { x: 560, y: 555 },
        }),
      },
    ]);
    expect(store.getVersion(child.id)).toBe(1);
    expect(store.getVersion(arrow.id)).toBe(1);
    expect(store.getById(locked.id)?.position).toEqual({ x: 360, y: 355 });
    expect(stack.undo(store)).toBe(true);
    expect(store.getById(parent.id)?.position).toEqual({ x: 300, y: 300 });
    expect(store.getById(child.id)?.position).toEqual({ x: 320, y: 320 });
    expect(store.getById(locked.id)?.position).toEqual({ x: 340, y: 340 });
    expect(store.getById(arrow.id)).toMatchObject({
      position: { x: 500, y: 500 },
      from: { x: 500, y: 500 },
      to: { x: 540, y: 540 },
    });
    expect(stack.redo(store)).toBe(true);
    expect(store.getById(parent.id)?.position).toEqual({ x: 320, y: 315 });
    expect(store.getById(child.id)?.position).toEqual({ x: 340, y: 335 });
    expect(store.getById(locked.id)?.position).toEqual({ x: 360, y: 355 });
    expect(store.getById(arrow.id)).toMatchObject({
      position: { x: 520, y: 515 },
      from: { x: 520, y: 515 },
      to: { x: 560, y: 555 },
    });
  });

  it('observer keys win', () => {
    const { ctx, tool, shape } = setup();
    const onDragCancel = vi.fn();
    tool.addDragObserver({ onDragKeyDown: (e) => e.key === 'f', onDragCancel });

    tool.onPointerDown(pt(120, 120), ctx);
    tool.onPointerMove(pt(130, 120), ctx);
    expect(tool.onKeyDown(key('f'), ctx)).toBe(true);
    tool.onPointerMove(pt(140, 120), ctx);
    expect(ctx.store.getById(shape.id)?.position).toEqual({ x: 120, y: 100 });
    expect(onDragCancel).not.toHaveBeenCalled();

    expect(tool.onKeyDown(key('Escape'), ctx)).toBe(true);
    expect(ctx.store.getById(shape.id)?.position).toEqual({ x: 100, y: 100 });
    expect(onDragCancel).toHaveBeenCalledTimes(1);
  });

  it('an observer that consumes Escape keeps the drag live', () => {
    const { ctx, tool, shape } = setup();
    tool.addDragObserver({ onDragKeyDown: (e) => e.key === 'Escape' });

    tool.onPointerDown(pt(120, 120), ctx);
    tool.onPointerMove(pt(130, 120), ctx);
    expect(tool.onKeyDown(key('Escape'), ctx)).toBe(true);

    expect(ctx.store.getById(shape.id)?.position).toEqual({ x: 110, y: 100 });
  });

  it('onKeyDown returns false when no drag is live', () => {
    const { ctx, tool } = setup();
    expect(tool.onKeyDown(key('Escape'), ctx)).toBe(false);

    tool.onPointerDown(pt(120, 120), ctx);
    tool.onPointerMove(pt(130, 120), ctx);
    tool.onPointerUp(pt(130, 120), ctx);
    expect(tool.onKeyDown(key('Escape'), ctx)).toBe(false);
  });
});
