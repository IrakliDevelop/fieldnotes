// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ViewportHarness } from '../test-helpers/viewport-harness';
import { createViewportHarness } from '../test-helpers/viewport-harness';
import { drag, tap } from '../test-helpers/pointer-helpers';
import type { SelectTool } from '../tools/select-tool';

describe('Integration: multi-tool workflows', () => {
  let h: ViewportHarness;

  beforeEach(() => {
    h = createViewportHarness();
  });

  afterEach(() => {
    h.cleanup();
  });

  it('draw stroke, place note, select note, delete it — stroke remains', () => {
    h.viewport.toolManager.setTool('pencil', h.viewport.toolContext);
    drag(h.wrapper, [50, 50], [200, 80], 5);
    expect(h.viewport.store.getElementsByType('stroke')).toHaveLength(1);

    h.viewport.toolManager.setTool('note', h.viewport.toolContext);
    tap(h.wrapper, 400, 300);
    expect(h.viewport.store.getElementsByType('note')).toHaveLength(1);

    h.viewport.toolManager.setTool('select', h.viewport.toolContext);
    tap(h.wrapper, 400, 300);

    const selectTool = h.viewport.toolManager.getTool<SelectTool>('select');
    expect(selectTool?.selectedIds.length).toBeGreaterThan(0);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));

    expect(h.viewport.store.getElementsByType('note')).toHaveLength(0);
    expect(h.viewport.store.getElementsByType('stroke')).toHaveLength(1);
  });

  it('draw shapes, draw arrow between them — arrow binds', () => {
    const id1 = h.viewport.addImage(
      'data:image/png;base64,abc',
      { x: 50, y: 50 },
      { w: 100, h: 100 },
    );
    const id2 = h.viewport.addImage(
      'data:image/png;base64,def',
      { x: 350, y: 50 },
      { w: 100, h: 100 },
    );

    h.viewport.toolManager.setTool('arrow', h.viewport.toolContext);
    drag(h.wrapper, [100, 100], [400, 100]);

    const arrows = h.viewport.store.getElementsByType('arrow');
    expect(arrows).toHaveLength(1);
    expect(arrows[0]?.fromBinding?.elementId).toBe(id1);
    expect(arrows[0]?.toBinding?.elementId).toBe(id2);
  });

  it('pencil, eraser, undo — stroke restored', () => {
    h.viewport.toolManager.setTool('pencil', h.viewport.toolContext);
    drag(h.wrapper, [100, 100], [300, 100], 10);
    expect(h.viewport.store.getElementsByType('stroke')).toHaveLength(1);

    h.viewport.toolManager.setTool('eraser', h.viewport.toolContext);
    drag(h.wrapper, [120, 100], [280, 100], 10);
    expect(h.viewport.store.getElementsByType('stroke')).toHaveLength(0);

    h.viewport.undo();
    expect(h.viewport.store.getElementsByType('stroke')).toHaveLength(1);
  });

  it('draw on layer1, switch to layer2, draw again — different layerIds', () => {
    const layer1Id = h.viewport.layerManager.activeLayerId;

    h.viewport.toolManager.setTool('pencil', h.viewport.toolContext);
    drag(h.wrapper, [50, 50], [200, 50], 5);

    const layer2 = h.viewport.layerManager.createLayer('Layer 2');
    h.viewport.layerManager.setActiveLayer(layer2.id);

    h.viewport.toolManager.setTool('pencil', h.viewport.toolContext);
    drag(h.wrapper, [50, 150], [200, 150], 5);

    const strokes = h.viewport.store.getElementsByType('stroke');
    expect(strokes).toHaveLength(2);

    const layerIds = strokes.map((s) => s.layerId);
    expect(layerIds).toContain(layer1Id);
    expect(layerIds).toContain(layer2.id);
    expect(layerIds[0]).not.toBe(layerIds[1]);
  });
});
