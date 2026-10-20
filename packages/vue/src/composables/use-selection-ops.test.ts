import { describe, it, expect, afterEach, vi } from 'vitest';
import { enableAutoUnmount } from '@vue/test-utils';
import { SelectTool, createNote } from '@fieldnotes/core';
import { useSelectionOps } from './use-selection-ops';
import { mountComposable } from '../test-utils/mount-composable';
import { createTestViewport, destroyTestViewports } from '../test-utils/create-test-viewport';

enableAutoUnmount(afterEach);
afterEach(() => {
  destroyTestViewports();
  vi.restoreAllMocks();
});

function setup(xs: number[]) {
  const viewport = createTestViewport();
  const select = new SelectTool();
  viewport.toolManager.register(select);
  viewport.setTool('select');
  const ids = xs.map((x) => {
    const note = createNote({ position: { x, y: 0 } });
    viewport.store.add(note);
    return note.id;
  });
  const { result } = mountComposable(() => useSelectionOps(), viewport);
  return { result, viewport, select, ids };
}

describe('useSelectionOps', () => {
  it('reports empty defaults with no selection', () => {
    const { result } = setup([]);
    expect(result.selectedIds.value).toEqual([]);
    expect(result.selectedCount.value).toBe(0);
    expect(result.canGroup.value).toBe(false);
    expect(result.canUngroup.value).toBe(false);
    expect(result.canAlign.value).toBe(false);
    expect(result.canDistribute.value).toBe(false);
    expect(result.isLocked.value).toBeNull();
  });

  it('derives the predicates from the selection size', () => {
    const { result, select, ids } = setup([0, 100, 200]);
    select.setSelection(ids.slice(0, 2));
    expect(result.selectedCount.value).toBe(2);
    expect(result.canGroup.value).toBe(true);
    expect(result.canAlign.value).toBe(true);
    expect(result.canDistribute.value).toBe(false);
    select.setSelection(ids);
    expect(result.canDistribute.value).toBe(true);
  });

  it('group makes the selection ungroupable', () => {
    const { result, select, ids } = setup([0, 100]);
    select.setSelection(ids);
    expect(result.canUngroup.value).toBe(false);
    result.group();
    expect(result.canUngroup.value).toBe(true);
    result.ungroup();
    expect(result.canUngroup.value).toBe(false);
  });

  it('toggleLock flips isLocked', () => {
    const { result, select, ids } = setup([0]);
    select.setSelection(ids);
    expect(result.isLocked.value).toBe(false);
    result.toggleLock();
    expect(result.isLocked.value).toBe(true);
  });

  it('keeps the same selectedIds when an unrelated store change leaves the selection unchanged', () => {
    const { result, viewport, select, ids } = setup([0, 100]);
    select.setSelection(ids);
    const before = result.selectedIds.value;
    viewport.store.add(createNote({ position: { x: 999, y: 999 } }));
    expect(result.selectedIds.value).toBe(before);
  });

  it('align(left) snaps the selection to the min x', () => {
    const { result, viewport, select, ids } = setup([50, 300]);
    select.setSelection(ids);
    result.align('left');
    expect(ids.map((id) => viewport.store.getById(id)?.position.x)).toEqual([50, 50]);
  });

  it('distribute(horizontal) spaces three elements evenly', () => {
    const { result, viewport, select, ids } = setup([0, 50, 400]);
    select.setSelection(ids);
    result.distribute('horizontal');
    expect(ids.map((id) => viewport.store.getById(id)?.position.x)).toEqual([0, 200, 400]);
  });

  it('rotateCW and rotateCCW delegate to viewport.rotateSelection', () => {
    const { result, viewport } = setup([]);
    const spy = vi.spyOn(viewport, 'rotateSelection');
    result.rotateCW();
    result.rotateCCW();
    expect(spy.mock.calls).toEqual([['cw'], ['ccw']]);
  });
});
