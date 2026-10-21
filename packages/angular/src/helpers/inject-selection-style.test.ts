import { afterEach, describe, expect, it } from 'vitest';
import { SelectTool, createArrow, createStroke } from '@fieldnotes/core';
import { createTestViewport, destroyTestViewports } from '../test-utils/create-test-viewport';
import { mountHelper } from '../test-utils/mount-helper';
import { injectSelectionStyle } from './inject-selection-style';

afterEach(destroyTestViewports);

async function setup() {
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
  const { result } = await mountHelper(() => injectSelectionStyle(), viewport);
  return { result, viewport, select, strokeId: stroke.id };
}

describe('injectSelectionStyle', () => {
  it('holds null and throws from the setter before a viewport exists', async () => {
    const {
      result: [style, apply],
    } = await mountHelper(() => injectSelectionStyle(), null);
    expect(style()).toBeNull();
    expect(() => apply({ color: '#ff0000' })).toThrow(
      '[fieldnotes] applySelectionStyle called before <fn-canvas> mounted',
    );
  });

  it('returns null when nothing is selected', async () => {
    const {
      result: [style],
    } = await setup();
    expect(style()).toBeNull();
  });

  it('reflects the style of the selected element and store updates under it', async () => {
    const {
      result: [style],
      viewport,
      select,
      strokeId,
    } = await setup();
    select.setSelection([strokeId]);
    expect(style()).toMatchObject({ color: '#123456', strokeWidth: 3 });
    viewport.store.update(strokeId, { color: '#ddeeff' });
    expect(style()?.color).toBe('#ddeeff');
  });

  it('applies a style patch to the selection', async () => {
    const {
      result: [, apply],
      viewport,
      select,
      strokeId,
    } = await setup();
    select.setSelection([strokeId]);
    apply({ color: '#ff0000' });
    expect(viewport.store.getById(strokeId)).toMatchObject({ color: '#ff0000' });
  });

  it('updates when only strokeStyle changes', async () => {
    const {
      result: [style],
      viewport,
      select,
    } = await setup();
    const arrow = createArrow({
      from: { x: 0, y: 0 },
      to: { x: 10, y: 10 },
      color: '#000000',
      width: 2,
      layerId: viewport.layerManager.activeLayerId,
    });
    viewport.store.add(arrow);
    select.setSelection([arrow.id]);
    expect(style()?.strokeStyle).toBeUndefined();
    viewport.applyStyleToSelection({ strokeStyle: 'dashed' });
    expect(style()?.strokeStyle).toBe('dashed');
  });

  it('keeps the same style object when a store change leaves the style equal', async () => {
    const {
      result: [style],
      viewport,
      select,
      strokeId,
    } = await setup();
    select.setSelection([strokeId]);
    const before = style();
    viewport.store.add(createArrow({ from: { x: 0, y: 0 }, to: { x: 5, y: 5 } }));
    expect(style()).toBe(before);
  });
});
