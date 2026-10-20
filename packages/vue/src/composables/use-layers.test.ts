import { describe, it, expect, afterEach } from 'vitest';
import { enableAutoUnmount } from '@vue/test-utils';
import { createNote } from '@fieldnotes/core';
import { useLayers } from './use-layers';
import { mountComposable } from '../test-utils/mount-composable';
import { destroyTestViewports } from '../test-utils/create-test-viewport';

enableAutoUnmount(afterEach);
afterEach(destroyTestViewports);

describe('useLayers', () => {
  it('returns the initial layer as active', () => {
    const { result } = mountComposable(() => useLayers());
    expect(result.layers.value.map((l) => l.name)).toEqual(['Layer 1']);
    expect(result.activeLayerId.value).toBe(result.layers.value[0]?.id);
  });

  it('createLayer and removeLayer update the list', () => {
    const { result } = mountComposable(() => useLayers());
    const layer = result.createLayer('Test Layer');
    expect(result.layers.value.map((l) => l.name)).toEqual(['Layer 1', 'Test Layer']);
    result.removeLayer(layer.id);
    expect(result.layers.value.map((l) => l.name)).toEqual(['Layer 1']);
  });

  it('renameLayer, setVisible, setLocked and setOpacity edit a layer', () => {
    const { result } = mountComposable(() => useLayers());
    result.createLayer('Layer 2');
    const id = result.layers.value[0]?.id ?? '';
    result.renameLayer(id, 'Renamed');
    result.setVisible(id, false);
    result.setLocked(id, true);
    result.setOpacity(id, 0.5);
    const layer = result.layers.value.find((l) => l.id === id);
    expect(layer).toMatchObject({ name: 'Renamed', visible: false, locked: true, opacity: 0.5 });
  });

  it('reorderLayer moves a layer to the end', () => {
    const { result } = mountComposable(() => useLayers());
    result.createLayer('Layer 2');
    const firstId = result.layers.value[0]?.id ?? '';
    result.reorderLayer(firstId, 10);
    expect(result.layers.value[1]?.id).toBe(firstId);
  });

  it('setActiveLayer switches the active layer', () => {
    const { result } = mountComposable(() => useLayers());
    const layer = result.createLayer('Layer 2');
    result.setActiveLayer(layer.id);
    expect(result.activeLayerId.value).toBe(layer.id);
  });

  it('moveElement moves an element to another layer', () => {
    const { result, viewport } = mountComposable(() => useLayers());
    const layer = result.createLayer('Layer 2');
    const note = createNote({ position: { x: 0, y: 0 } });
    viewport.store.add(note);
    result.moveElement(note.id, layer.id);
    expect(viewport.store.getById(note.id)?.layerId).toBe(layer.id);
  });
});
