// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { SelectionOps } from './selection-ops';
import { ElementStore } from '../elements/element-store';
import { HistoryStack } from '../history/history-stack';
import { HistoryRecorder } from '../history/history-recorder';
import { createShape } from '../elements/element-factory';

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
