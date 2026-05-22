// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ViewportHarness } from '../test-helpers/viewport-harness';
import { createViewportHarness } from '../test-helpers/viewport-harness';
import { drag, tap } from '../test-helpers/pointer-helpers';
import type { SelectTool } from '../tools/select-tool';

describe('Integration: history (undo/redo)', () => {
  let h: ViewportHarness;

  beforeEach(() => {
    h = createViewportHarness();
  });

  afterEach(() => {
    h.cleanup();
  });

  it('undoes shape creation', () => {
    h.viewport.toolManager.setTool('shape', h.viewport.toolContext);
    drag(h.wrapper, [100, 100], [300, 200]);

    expect(h.viewport.store.getElementsByType('shape')).toHaveLength(1);

    h.viewport.undo();
    expect(h.viewport.store.getElementsByType('shape')).toHaveLength(0);
  });

  it('redoes after undo', () => {
    h.viewport.toolManager.setTool('shape', h.viewport.toolContext);
    drag(h.wrapper, [100, 100], [300, 200]);

    h.viewport.undo();
    expect(h.viewport.store.getElementsByType('shape')).toHaveLength(0);

    h.viewport.redo();
    expect(h.viewport.store.getElementsByType('shape')).toHaveLength(1);
  });

  it('undoes multiple operations in sequence', () => {
    h.viewport.toolManager.setTool('pencil', h.viewport.toolContext);
    drag(h.wrapper, [50, 50], [150, 50], 5);
    drag(h.wrapper, [50, 100], [150, 100], 5);
    drag(h.wrapper, [50, 150], [150, 150], 5);

    expect(h.viewport.store.getElementsByType('stroke')).toHaveLength(3);

    h.viewport.undo();
    expect(h.viewport.store.getElementsByType('stroke')).toHaveLength(2);

    h.viewport.undo();
    expect(h.viewport.store.getElementsByType('stroke')).toHaveLength(1);

    h.viewport.undo();
    expect(h.viewport.store.getElementsByType('stroke')).toHaveLength(0);
  });

  it('undo eraser restores deleted stroke', () => {
    h.viewport.toolManager.setTool('pencil', h.viewport.toolContext);
    drag(h.wrapper, [100, 100], [300, 100], 10);
    expect(h.viewport.store.getElementsByType('stroke')).toHaveLength(1);

    h.viewport.toolManager.setTool('eraser', h.viewport.toolContext);
    drag(h.wrapper, [120, 100], [280, 100], 10);
    expect(h.viewport.store.getElementsByType('stroke')).toHaveLength(0);

    h.viewport.undo();
    expect(h.viewport.store.getElementsByType('stroke')).toHaveLength(1);
  });

  it('undo note placement', () => {
    h.viewport.toolManager.setTool('note', h.viewport.toolContext);
    tap(h.wrapper, 400, 300);
    expect(h.viewport.store.getElementsByType('note')).toHaveLength(1);

    h.viewport.undo();
    expect(h.viewport.store.getElementsByType('note')).toHaveLength(0);
  });

  it('undo across tool switches preserves earlier work', () => {
    h.viewport.toolManager.setTool('pencil', h.viewport.toolContext);
    drag(h.wrapper, [50, 50], [150, 50], 5);
    expect(h.viewport.store.getElementsByType('stroke')).toHaveLength(1);

    h.viewport.toolManager.setTool('shape', h.viewport.toolContext);
    drag(h.wrapper, [200, 200], [400, 350]);
    expect(h.viewport.store.getElementsByType('shape')).toHaveLength(1);

    h.viewport.undo();
    expect(h.viewport.store.getElementsByType('shape')).toHaveLength(0);
    expect(h.viewport.store.getElementsByType('stroke')).toHaveLength(1);
  });

  it('redo then new action clears redo stack', () => {
    h.viewport.toolManager.setTool('shape', h.viewport.toolContext);
    drag(h.wrapper, [100, 100], [300, 200]);

    h.viewport.toolManager.setTool('shape', h.viewport.toolContext);
    drag(h.wrapper, [100, 300], [300, 400]);

    expect(h.viewport.store.getElementsByType('shape')).toHaveLength(2);

    h.viewport.undo();
    expect(h.viewport.store.getElementsByType('shape')).toHaveLength(1);

    h.viewport.toolManager.setTool('pencil', h.viewport.toolContext);
    drag(h.wrapper, [50, 50], [150, 50], 5);

    const redoResult = h.viewport.redo();
    expect(redoResult).toBe(false);
    expect(h.viewport.store.getElementsByType('shape')).toHaveLength(1);
    expect(h.viewport.store.getElementsByType('stroke')).toHaveLength(1);
  });

  it('undo move restores original position', () => {
    const id = h.viewport.addImage(
      'data:image/png;base64,abc',
      { x: 100, y: 100 },
      { w: 200, h: 150 },
    );

    const originalPos = { ...h.viewport.store.getById(id)?.position };

    h.viewport.toolManager.setTool('select', h.viewport.toolContext);
    tap(h.wrapper, 200, 175);

    const selectTool = h.viewport.toolManager.getTool<SelectTool>('select');
    expect(selectTool?.selectedIds).toContain(id);

    drag(h.wrapper, [200, 175], [400, 375], 10);

    const movedEl = h.viewport.store.getById(id);
    expect(movedEl?.position.x).not.toBe(originalPos.x);
    expect(movedEl?.position.y).not.toBe(originalPos.y);

    h.viewport.undo();

    const restored = h.viewport.store.getById(id);
    expect(restored?.position.x).toBe(originalPos.x);
    expect(restored?.position.y).toBe(originalPos.y);
  });
});
