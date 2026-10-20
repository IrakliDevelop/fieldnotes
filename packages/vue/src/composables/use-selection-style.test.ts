import { describe, it, expect, afterEach } from 'vitest';
import { enableAutoUnmount } from '@vue/test-utils';
import { SelectTool, createArrow, createStroke } from '@fieldnotes/core';
import { useSelectionStyle } from './use-selection-style';
import { mountComposable } from '../test-utils/mount-composable';
import { createTestViewport, destroyTestViewports } from '../test-utils/create-test-viewport';

enableAutoUnmount(afterEach);
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
  const { result } = mountComposable(() => useSelectionStyle(), viewport);
  return { result, viewport, select, strokeId: stroke.id };
}

describe('useSelectionStyle', () => {
  it('returns null when nothing is selected', () => {
    const {
      result: [style],
    } = setup();
    expect(style.value).toBeNull();
  });

  it('reflects the style of the selected element and store updates under it', () => {
    const {
      result: [style],
      viewport,
      select,
      strokeId,
    } = setup();
    select.setSelection([strokeId]);
    expect(style.value).toMatchObject({ color: '#123456', strokeWidth: 3 });
    viewport.store.update(strokeId, { color: '#ddeeff' });
    expect(style.value?.color).toBe('#ddeeff');
  });

  it('applies a style patch to the selection', () => {
    const {
      result: [, apply],
      viewport,
      select,
      strokeId,
    } = setup();
    select.setSelection([strokeId]);
    apply({ color: '#ff0000' });
    expect(viewport.store.getById(strokeId)).toMatchObject({ color: '#ff0000' });
  });

  it('updates when only strokeStyle changes', () => {
    const {
      result: [style],
      viewport,
      select,
    } = setup();
    const arrow = createArrow({
      from: { x: 0, y: 0 },
      to: { x: 10, y: 10 },
      color: '#000000',
      width: 2,
      layerId: viewport.layerManager.activeLayerId,
    });
    viewport.store.add(arrow);
    select.setSelection([arrow.id]);
    expect(style.value?.strokeStyle).toBeUndefined();
    viewport.applyStyleToSelection({ strokeStyle: 'dashed' });
    expect(style.value?.strokeStyle).toBe('dashed');
  });

  it('keeps the same style object when a store change leaves the style equal', () => {
    const {
      result: [style],
      viewport,
      select,
      strokeId,
    } = setup();
    select.setSelection([strokeId]);
    const before = style.value;
    viewport.store.add(createArrow({ from: { x: 0, y: 0 }, to: { x: 5, y: 5 } }));
    expect(style.value).toBe(before);
  });
});
