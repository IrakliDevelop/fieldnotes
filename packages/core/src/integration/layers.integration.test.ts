// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ViewportHarness } from '../test-helpers/viewport-harness';
import { createViewportHarness } from '../test-helpers/viewport-harness';
import { drag, tap } from '../test-helpers/pointer-helpers';
import type { SelectTool } from '../tools/select-tool';

describe('Integration: layers', () => {
  let h: ViewportHarness;

  beforeEach(() => {
    h = createViewportHarness();
  });

  afterEach(() => {
    h.cleanup();
  });

  it('elements are placed on the active layer', () => {
    const activeLayerId = h.viewport.layerManager.activeLayerId;

    const id = h.viewport.addImage(
      'data:image/png;base64,abc',
      { x: 100, y: 100 },
      { w: 200, h: 150 },
    );

    const el = h.viewport.store.getById(id);
    expect(el?.layerId).toBe(activeLayerId);
  });

  it('drawing on second layer puts element on that layer', () => {
    const layer2 = h.viewport.layerManager.createLayer('Layer 2');
    h.viewport.layerManager.setActiveLayer(layer2.id);

    h.viewport.toolManager.setTool('pencil', h.viewport.toolContext);
    drag(h.wrapper, [50, 50], [200, 100], 5);

    const strokes = h.viewport.store.getElementsByType('stroke');
    expect(strokes).toHaveLength(1);
    expect(strokes[0]?.layerId).toBe(layer2.id);
  });

  it('select tool skips elements on hidden layers', () => {
    const defaultLayerId = h.viewport.layerManager.activeLayerId;

    h.viewport.addImage('data:image/png;base64,abc', { x: 100, y: 100 }, { w: 200, h: 150 });

    const layer2 = h.viewport.layerManager.createLayer('Layer 2');
    h.viewport.layerManager.setActiveLayer(layer2.id);
    h.viewport.layerManager.setLayerVisible(defaultLayerId, false);

    h.viewport.toolManager.setTool('select', h.viewport.toolContext);
    tap(h.wrapper, 200, 175);

    const selectTool = h.viewport.toolManager.getTool<SelectTool>('select');
    expect(selectTool?.selectedIds).toHaveLength(0);
  });

  it('select tool skips elements on locked layers', () => {
    const defaultLayerId = h.viewport.layerManager.activeLayerId;

    h.viewport.addImage('data:image/png;base64,abc', { x: 100, y: 100 }, { w: 200, h: 150 });

    const layer2 = h.viewport.layerManager.createLayer('Layer 2');
    h.viewport.layerManager.setActiveLayer(layer2.id);
    h.viewport.layerManager.setLayerLocked(defaultLayerId, true);

    h.viewport.toolManager.setTool('select', h.viewport.toolContext);
    tap(h.wrapper, 200, 175);

    const selectTool = h.viewport.toolManager.getTool<SelectTool>('select');
    expect(selectTool?.selectedIds).toHaveLength(0);
  });

  it('switch layers mid-workflow assigns correct layerIds', () => {
    const layer1Id = h.viewport.layerManager.activeLayerId;

    h.viewport.toolManager.setTool('pencil', h.viewport.toolContext);
    drag(h.wrapper, [50, 50], [200, 50], 5);

    const layer2 = h.viewport.layerManager.createLayer('Layer 2');
    h.viewport.layerManager.setActiveLayer(layer2.id);

    drag(h.wrapper, [50, 150], [200, 150], 5);

    const strokes = h.viewport.store.getElementsByType('stroke');
    expect(strokes).toHaveLength(2);

    const layerIds = strokes.map((s) => s.layerId);
    expect(layerIds).toContain(layer1Id);
    expect(layerIds).toContain(layer2.id);
    expect(layerIds[0]).not.toBe(layerIds[1]);
  });

  it('layer state preserved across undo', () => {
    const layer2 = h.viewport.layerManager.createLayer('Layer 2');
    h.viewport.layerManager.setActiveLayer(layer2.id);

    h.viewport.toolManager.setTool('pencil', h.viewport.toolContext);
    drag(h.wrapper, [50, 50], [200, 50], 5);

    const strokes = h.viewport.store.getElementsByType('stroke');
    expect(strokes).toHaveLength(1);
    expect(strokes[0]?.layerId).toBe(layer2.id);

    h.viewport.undo();
    expect(h.viewport.store.getElementsByType('stroke')).toHaveLength(0);

    h.viewport.redo();
    const restored = h.viewport.store.getElementsByType('stroke');
    expect(restored).toHaveLength(1);
    expect(restored[0]?.layerId).toBe(layer2.id);
  });

  it('removing a layer reassigns its elements to the fallback layer and undo restores both', () => {
    const layer1Id = h.viewport.layerManager.activeLayerId;

    const layer2 = h.viewport.layerManager.createLayer('Layer 2');
    h.viewport.layerManager.setActiveLayer(layer2.id);

    const elementId = h.viewport.addImage(
      'data:image/png;base64,abc',
      { x: 100, y: 100 },
      { w: 200, h: 150 },
    );
    expect(h.viewport.store.getById(elementId)?.layerId).toBe(layer2.id);

    h.viewport.history.clear();

    h.viewport.removeLayer(layer2.id);

    expect(h.viewport.layerManager.getLayer(layer2.id)).toBeUndefined();
    expect(h.viewport.store.getById(elementId)?.layerId).toBe(layer1Id);

    h.viewport.undo();

    expect(h.viewport.layerManager.getLayer(layer2.id)).toBeDefined();
    expect(h.viewport.store.getById(elementId)?.layerId).toBe(layer2.id);
  });

  it('element reference survives a layer delete then undo as one history step', () => {
    const layer1Id = h.viewport.layerManager.activeLayerId;

    const layer2 = h.viewport.layerManager.createLayer('Layer 2');
    h.viewport.layerManager.setActiveLayer(layer2.id);

    const elementId = h.viewport.addImage(
      'data:image/png;base64,abc',
      { x: 10, y: 10 },
      { w: 50, h: 50 },
    );

    h.viewport.history.clear();

    h.viewport.removeLayer(layer2.id);
    expect(h.viewport.store.getById(elementId)).toBeDefined();
    expect(h.viewport.store.getById(elementId)?.layerId).toBe(layer1Id);

    expect(h.viewport.undo()).toBe(true);

    const el = h.viewport.store.getById(elementId);
    expect(el).toBeDefined();
    expect(el?.layerId).toBe(layer2.id);

    expect(h.viewport.undo()).toBe(false);
  });

  it('reordering a layer flips cross-layer render order in the store', () => {
    const layer1Id = h.viewport.layerManager.activeLayerId;

    const idA = h.viewport.addImage('data:image/png;base64,aaa', { x: 0, y: 0 }, { w: 50, h: 50 });

    const layer2 = h.viewport.layerManager.createLayer('Layer 2');
    h.viewport.layerManager.setActiveLayer(layer2.id);

    const idB = h.viewport.addImage('data:image/png;base64,bbb', { x: 0, y: 0 }, { w: 50, h: 50 });

    const indexOf = (id: string): number =>
      h.viewport.store.getAll().findIndex((el) => el.id === id);

    expect(indexOf(idA)).toBeLessThan(indexOf(idB));

    const layer1Order = h.viewport.layerManager.getLayer(layer1Id)?.order ?? 0;
    const layer2Order = h.viewport.layerManager.getLayer(layer2.id)?.order ?? 0;
    h.viewport.layerManager.reorderLayer(layer1Id, layer2Order + 1);
    expect(layer2Order).toBeGreaterThanOrEqual(layer1Order);

    expect(indexOf(idA)).toBeGreaterThan(indexOf(idB));
  });
});
