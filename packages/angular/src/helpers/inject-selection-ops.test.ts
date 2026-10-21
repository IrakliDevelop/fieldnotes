import { afterEach, describe, expect, it, vi } from 'vitest';
import { SelectTool, createNote } from '@fieldnotes/core';
import { createTestViewport, destroyTestViewports } from '../test-utils/create-test-viewport';
import { mountHelper } from '../test-utils/mount-helper';
import { injectSelectionOps } from './inject-selection-ops';

afterEach(() => {
  destroyTestViewports();
  vi.restoreAllMocks();
});

async function setup(xs: number[]) {
  const viewport = createTestViewport();
  const select = new SelectTool();
  viewport.toolManager.register(select);
  viewport.setTool('select');
  const ids = xs.map((x) => {
    const note = createNote({ position: { x, y: 0 } });
    viewport.store.add(note);
    return note.id;
  });
  const { result } = await mountHelper(() => injectSelectionOps(), viewport);
  return { result, viewport, select, ids };
}

describe('injectSelectionOps', () => {
  it('holds the empty fallbacks and throws from actions before a viewport exists', async () => {
    const { result } = await mountHelper(() => injectSelectionOps(), null);
    expect(result.selectedIds()).toEqual([]);
    expect(result.selectedCount()).toBe(0);
    expect([
      result.canGroup(),
      result.canUngroup(),
      result.canAlign(),
      result.canDistribute(),
    ]).toEqual([false, false, false, false]);
    expect(result.isLocked()).toBeNull();
    expect(() => result.group()).toThrow('[fieldnotes] group called before <fn-canvas> mounted');
  });

  it('reports empty defaults with no selection', async () => {
    const { result } = await setup([]);
    expect(result.selectedIds()).toEqual([]);
    expect(result.selectedCount()).toBe(0);
    expect(result.canGroup()).toBe(false);
    expect(result.canUngroup()).toBe(false);
    expect(result.canAlign()).toBe(false);
    expect(result.canDistribute()).toBe(false);
    expect(result.isLocked()).toBeNull();
  });

  it('derives the predicates from the selection size', async () => {
    const { result, select, ids } = await setup([0, 100, 200]);
    select.setSelection(ids.slice(0, 2));
    expect(result.selectedCount()).toBe(2);
    expect(result.canGroup()).toBe(true);
    expect(result.canAlign()).toBe(true);
    expect(result.canDistribute()).toBe(false);
    select.setSelection(ids);
    expect(result.canDistribute()).toBe(true);
  });

  it('group makes the selection ungroupable', async () => {
    const { result, select, ids } = await setup([0, 100]);
    select.setSelection(ids);
    expect(result.canUngroup()).toBe(false);
    result.group();
    expect(result.canUngroup()).toBe(true);
    result.ungroup();
    expect(result.canUngroup()).toBe(false);
  });

  it('toggleLock flips isLocked', async () => {
    const { result, select, ids } = await setup([0]);
    select.setSelection(ids);
    expect(result.isLocked()).toBe(false);
    result.toggleLock();
    expect(result.isLocked()).toBe(true);
  });

  it('keeps the same selectedIds when an unrelated store change leaves the selection unchanged', async () => {
    const { result, viewport, select, ids } = await setup([0, 100]);
    select.setSelection(ids);
    const before = result.selectedIds();
    viewport.store.add(createNote({ position: { x: 999, y: 999 } }));
    expect(result.selectedIds()).toBe(before);
  });

  it('align(left) snaps the selection to the min x', async () => {
    const { result, viewport, select, ids } = await setup([50, 300]);
    select.setSelection(ids);
    result.align('left');
    expect(ids.map((id) => viewport.store.getById(id)?.position.x)).toEqual([50, 50]);
  });

  it('distribute(horizontal) spaces three elements evenly', async () => {
    const { result, viewport, select, ids } = await setup([0, 50, 400]);
    select.setSelection(ids);
    result.distribute('horizontal');
    expect(ids.map((id) => viewport.store.getById(id)?.position.x)).toEqual([0, 200, 400]);
  });

  it('rotateCW and rotateCCW delegate to viewport.rotateSelection', async () => {
    const { result, viewport } = await setup([]);
    const spy = vi.spyOn(viewport, 'rotateSelection');
    result.rotateCW();
    result.rotateCCW();
    expect(spy.mock.calls).toEqual([['cw'], ['ccw']]);
  });
});
