import { describe, it, expect, afterEach, vi } from 'vitest';
import { SelectTool, createNote } from '@fieldnotes/core';
import { useSelectionOps } from './use-selection-ops.svelte.js';
import { mountHelper, record } from '../test-fixtures/mount-helper';
import { createTestViewport, destroyTestViewports } from '../test-fixtures/create-test-viewport';

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
  const { result } = mountHelper(() => useSelectionOps(), viewport);
  const values = record(result);
  const latest = () => {
    const state = values.at(-1);
    if (!state) throw new Error('no selection ops state');
    return state;
  };
  return { result, values, latest, viewport, select, ids };
}

describe('useSelectionOps', () => {
  it('reports empty defaults with no selection', () => {
    const { latest } = setup([]);
    expect(latest()).toEqual({
      selectedIds: [],
      selectedCount: 0,
      canGroup: false,
      canUngroup: false,
      canAlign: false,
      canDistribute: false,
      isLocked: null,
    });
  });

  it('derives the predicates from the selection size', () => {
    const { latest, select, ids } = setup([0, 100, 200]);
    select.setSelection(ids.slice(0, 2));
    expect(latest()).toMatchObject({
      selectedCount: 2,
      canGroup: true,
      canAlign: true,
      canDistribute: false,
    });
    select.setSelection(ids);
    expect(latest().canDistribute).toBe(true);
  });

  it('group makes the selection ungroupable', () => {
    const { result, latest, select, ids } = setup([0, 100]);
    select.setSelection(ids);
    expect(latest().canUngroup).toBe(false);
    result.group();
    expect(latest().canUngroup).toBe(true);
    result.ungroup();
    expect(latest().canUngroup).toBe(false);
  });

  it('toggleLock flips isLocked', () => {
    const { result, latest, select, ids } = setup([0]);
    select.setSelection(ids);
    expect(latest().isLocked).toBe(false);
    result.toggleLock();
    expect(latest().isLocked).toBe(true);
  });

  it('does not notify when an unrelated store change leaves the state unchanged', () => {
    const { values, viewport, select, ids } = setup([0, 100]);
    select.setSelection(ids);
    const count = values.length;
    viewport.store.add(createNote({ position: { x: 999, y: 999 } }));
    expect(values).toHaveLength(count);
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
