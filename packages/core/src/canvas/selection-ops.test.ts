// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { SelectionOps } from './selection-ops';
import { ElementStore } from '../elements/element-store';
import { HistoryStack } from '../history/history-stack';
import { HistoryRecorder } from '../history/history-recorder';
import { createShape, createArrow, createTemplate } from '../elements/element-factory';
import { rotatePoint } from '../core/geometry';
import { getElementBounds } from '../elements/element-bounds';

function setup(selectedIds: string[] = []) {
  const store = new ElementStore();
  const stack = new HistoryStack();
  const recorder = new HistoryRecorder(store, stack);
  const requestRender = vi.fn();
  const ops = new SelectionOps({
    store,
    recorder,
    getSelectedIds: () => selectedIds,
    requestRender,
  });
  return { store, stack, recorder, requestRender, ops };
}

describe('SelectionOps', () => {
  it('group() sets a shared groupId on selected elements in one undo step', () => {
    const a = createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } });
    const b = createShape({ position: { x: 50, y: 0 }, size: { w: 10, h: 10 } });
    const { store, stack, ops } = setup([a.id, b.id]);
    store.add(a);
    store.add(b);
    const baseline = stack.undoCount;

    ops.group();

    const groupA = store.getById(a.id)?.groupId;
    const groupB = store.getById(b.id)?.groupId;
    expect(groupA).toBeDefined();
    expect(groupA).toBe(groupB);
    expect(stack.undoCount).toBe(baseline + 1);
  });

  it('toggleLock() locks all when any unlocked', () => {
    const a = createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 }, locked: true });
    const b = createShape({ position: { x: 50, y: 0 }, size: { w: 10, h: 10 } });
    const { store, ops } = setup([a.id, b.id]);
    store.add(a);
    store.add(b);

    ops.toggleLock();

    expect(store.getById(a.id)?.locked).toBe(true);
    expect(store.getById(b.id)?.locked).toBe(true);
  });

  it('getStyle() returns null on empty selection', () => {
    const { ops } = setup([]);
    expect(ops.getStyle()).toBeNull();
  });

  it('getStyle() returns a shared color when both elements share it', () => {
    const a = createShape({
      position: { x: 0, y: 0 },
      size: { w: 10, h: 10 },
      strokeColor: '#ff0000',
    });
    const b = createShape({
      position: { x: 50, y: 0 },
      size: { w: 10, h: 10 },
      strokeColor: '#ff0000',
    });
    const { store, ops } = setup([a.id, b.id]);
    store.add(a);
    store.add(b);

    expect(ops.getStyle()?.color).toBe('#ff0000');
  });
});

describe('rotateSelection', () => {
  it('single rotatable element: +π/2 rotation, position unchanged, one undo step', () => {
    const a = createShape({ position: { x: 10, y: 20 }, size: { w: 40, h: 20 } });
    const { store, stack, ops, requestRender } = setup([a.id]);
    store.add(a);
    const baseline = stack.undoCount;

    ops.rotateSelection('cw');

    const el = store.getById(a.id);
    expect(el?.rotation).toBeCloseTo(Math.PI / 2);
    expect(el?.position.x).toBeCloseTo(10);
    expect(el?.position.y).toBeCloseTo(20);
    expect(stack.undoCount).toBe(baseline + 1);
    expect(requestRender).toHaveBeenCalled();
  });

  it('ccw rotates negative', () => {
    const a = createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } });
    const { store, ops } = setup([a.id]);
    store.add(a);

    ops.rotateSelection('ccw');

    expect(store.getById(a.id)?.rotation).toBeCloseTo(-Math.PI / 2);
  });

  it('multi-select: rigid group turn about union center, one undo step', () => {
    // a: 10x10 at (0,0); b: 10x10 at (90,0). Union x:[0,100] y:[0,10], pivot (50,5).
    // CW about (50,5): a-center (5,5) → (50,-40) → position (45,-45); b-center (95,5) → (50,50).
    const a = createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } });
    const b = createShape({ position: { x: 90, y: 0 }, size: { w: 10, h: 10 } });
    const { store, stack, ops } = setup([a.id, b.id]);
    store.add(a);
    store.add(b);
    const baseline = stack.undoCount;

    ops.rotateSelection('cw');

    const ra = store.getById(a.id);
    const rb = store.getById(b.id);
    expect(ra?.position.x).toBeCloseTo(45);
    expect(ra?.position.y).toBeCloseTo(-45);
    expect(rb?.position.x).toBeCloseTo(45);
    expect(rb?.position.y).toBeCloseTo(45);
    expect(ra?.rotation).toBeCloseTo(Math.PI / 2);
    expect(rb?.rotation).toBeCloseTo(Math.PI / 2);
    expect(stack.undoCount).toBe(baseline + 1);
  });

  it('undo restores positions and rotations exactly', () => {
    const a = createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 } });
    const b = createShape({ position: { x: 90, y: 0 }, size: { w: 10, h: 10 } });
    const { store, stack, ops } = setup([a.id, b.id]);
    store.add(a);
    store.add(b);

    ops.rotateSelection('cw');
    stack.undo(store);

    const ra = store.getById(a.id);
    expect(ra?.position).toEqual({ x: 0, y: 0 });
    expect(ra?.rotation ?? 0).toBe(0);
    expect(store.getById(b.id)?.position).toEqual({ x: 90, y: 0 });
  });

  it('locked elements are skipped; pivot from eligible only', () => {
    const locked = createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 }, locked: true });
    const free = createShape({ position: { x: 50, y: 50 }, size: { w: 10, h: 10 } });
    const { store, ops } = setup([locked.id, free.id]);
    store.add(locked);
    store.add(free);

    ops.rotateSelection('cw');

    expect(store.getById(locked.id)?.rotation ?? 0).toBe(0);
    expect(store.getById(locked.id)?.position).toEqual({ x: 0, y: 0 });
    // free is the only eligible → spins in place about own center
    expect(store.getById(free.id)?.rotation).toBeCloseTo(Math.PI / 2);
    expect(store.getById(free.id)?.position.x).toBeCloseTo(50);
  });

  it('no-op when nothing eligible: no history entry', () => {
    const locked = createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 }, locked: true });
    const { store, stack, ops, requestRender } = setup([locked.id]);
    store.add(locked);
    const baseline = stack.undoCount;

    ops.rotateSelection('cw');

    expect(stack.undoCount).toBe(baseline);
    expect(requestRender).not.toHaveBeenCalled();
  });

  it('unbound arrow in selection rotates endpoints; bound arrow skipped but re-anchored', () => {
    const target = createShape({ position: { x: 100, y: 100 }, size: { w: 20, h: 20 } });
    const bound = createArrow({
      from: { x: 0, y: 110 },
      to: { x: 100, y: 110 },
      toBinding: { elementId: target.id },
    });
    const loose = createArrow({ from: { x: 0, y: 0 }, to: { x: 10, y: 0 } });
    const { store, ops } = setup([target.id, bound.id, loose.id]);
    store.add(target);
    store.add(bound);
    store.add(loose);
    const boundToBefore = store.getById(bound.id);
    const looseBefore = store.getById(loose.id);
    if (boundToBefore?.type !== 'arrow' || looseBefore?.type !== 'arrow') throw new Error('setup');
    const boundToOld = { ...boundToBefore.to };

    ops.rotateSelection('cw');

    const looseAfter = store.getById(loose.id);
    if (looseAfter?.type !== 'arrow') throw new Error('arrow expected');
    expect(looseAfter.to).not.toEqual(looseBefore.to);
    const boundAfter = store.getById(bound.id);
    if (boundAfter?.type !== 'arrow') throw new Error('arrow expected');
    // re-anchored to the rotated target, not left where it was
    expect(boundAfter.to).not.toEqual(boundToOld);
  });

  it('template rotates aim and orbits pivot as part of a group', () => {
    const t = createTemplate({
      position: { x: 0, y: 0 },
      templateShape: 'cone',
      radius: 30,
      angle: 0,
    });
    const s = createShape({ position: { x: 50, y: 0 }, size: { w: 10, h: 10 } });
    const { store, ops } = setup([t.id, s.id]);
    store.add(t);
    store.add(s);

    ops.rotateSelection('cw');

    const rt = store.getById(t.id);
    if (rt?.type !== 'template') throw new Error('template expected');
    expect(rt.angle).toBeCloseTo(Math.PI / 2);
  });

  it('lone selected arrow orbits its own bbox center', () => {
    // bbox of (0,0)-(10,0) is x:[0,10] y:[0,0], center (5,0).
    // y-down CW: (x,y)-pivot -> (-dy,dx)+pivot. from (0,0): d=(-5,0) -> (0,-5) -> (5,-5).
    // to (10,0): d=(5,0) -> (0,5) -> (5,5).
    const arrow = createArrow({ from: { x: 0, y: 0 }, to: { x: 10, y: 0 } });
    const { store, ops } = setup([arrow.id]);
    store.add(arrow);

    ops.rotateSelection('cw');

    const el = store.getById(arrow.id);
    if (el?.type !== 'arrow') throw new Error('arrow expected');
    expect(el.from.x).toBeCloseTo(5);
    expect(el.from.y).toBeCloseTo(-5);
    expect(el.to.x).toBeCloseTo(5);
    expect(el.to.y).toBeCloseTo(5);
  });

  it('lone selected template orbits its own bounds center', () => {
    const template = createTemplate({
      position: { x: 10, y: 0 },
      templateShape: 'cone',
      radius: 30,
      angle: 0,
    });
    const { store, ops } = setup([template.id]);
    store.add(template);
    const bounds = getElementBounds(template);
    if (!bounds) throw new Error('bounds expected');
    const pivot = { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
    const expectedPosition = rotatePoint(template.position, pivot, Math.PI / 2);

    ops.rotateSelection('cw');

    const el = store.getById(template.id);
    if (el?.type !== 'template') throw new Error('template expected');
    expect(el.angle).toBeCloseTo(Math.PI / 2);
    expect(el.position.x).toBeCloseTo(expectedPosition.x);
    expect(el.position.y).toBeCloseTo(expectedPosition.y);
  });

  it('empty selection is a no-op', () => {
    const { stack, ops } = setup([]);
    const baseline = stack.undoCount;
    ops.rotateSelection('cw');
    expect(stack.undoCount).toBe(baseline);
  });
});
