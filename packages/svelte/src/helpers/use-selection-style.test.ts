import { describe, it, expect, afterEach } from 'vitest';
import { SelectTool, createArrow, createStroke } from '@fieldnotes/core';
import { useSelectionStyle } from './use-selection-style.svelte.js';
import { mountHelper, record } from '../test-fixtures/mount-helper';
import { createTestViewport, destroyTestViewports } from '../test-fixtures/create-test-viewport';

afterEach(destroyTestViewports);

function setup() {
  const viewport = createTestViewport();
  const select = new SelectTool();
  viewport.toolManager.register(select);
  viewport.setTool('select');
  const stroke = createStroke({
    points: [
      { x: 0, y: 0, pressure: 0.5 },
      { x: 10, y: 10, pressure: 0.5 },
    ],
    color: '#123456',
    width: 3,
    layerId: viewport.layerManager.activeLayerId,
  });
  viewport.store.add(stroke);
  const {
    result: [style, apply],
  } = mountHelper(() => useSelectionStyle(), viewport);
  return { values: record(style), apply, viewport, select, strokeId: stroke.id };
}

describe('useSelectionStyle', () => {
  it('returns null when nothing is selected', () => {
    const { values } = setup();
    expect(values).toEqual([null]);
  });

  it('reflects the style of the selected element and store updates under it', () => {
    const { values, viewport, select, strokeId } = setup();
    select.setSelection([strokeId]);
    expect(values.at(-1)).toMatchObject({ color: '#123456', strokeWidth: 3 });
    viewport.store.update(strokeId, { color: '#ddeeff' });
    expect(values.at(-1)?.color).toBe('#ddeeff');
  });

  it('applies a style patch to the selection', () => {
    const { apply, viewport, select, strokeId } = setup();
    select.setSelection([strokeId]);
    apply({ color: '#ff0000' });
    expect(viewport.store.getById(strokeId)).toMatchObject({ color: '#ff0000' });
  });

  it('updates when only strokeStyle changes', () => {
    const { values, viewport, select } = setup();
    const arrow = createArrow({
      from: { x: 0, y: 0 },
      to: { x: 10, y: 10 },
      color: '#000000',
      width: 2,
      layerId: viewport.layerManager.activeLayerId,
    });
    viewport.store.add(arrow);
    select.setSelection([arrow.id]);
    expect(values.at(-1)?.strokeStyle).toBeUndefined();
    viewport.applyStyleToSelection({ strokeStyle: 'dashed' });
    expect(values.at(-1)?.strokeStyle).toBe('dashed');
  });

  it('does not notify when a store change leaves the style equal', () => {
    const { values, viewport, select, strokeId } = setup();
    select.setSelection([strokeId]);
    const count = values.length;
    viewport.store.add(createArrow({ from: { x: 0, y: 0 }, to: { x: 5, y: 5 } }));
    expect(values).toHaveLength(count);
  });
});
