import { describe, it, expect, afterEach } from 'vitest';
import { createNote } from '@fieldnotes/core';
import { useLayers } from './use-layers.svelte.js';
import { mountHelper, record } from '../test-fixtures/mount-helper';
import { destroyTestViewports } from '../test-fixtures/create-test-viewport';

afterEach(destroyTestViewports);

function setup() {
  const mounted = mountHelper(() => useLayers());
  const values = record(mounted.result);
  const latest = () => {
    const state = values.at(-1);
    if (!state) throw new Error('no layers state');
    return state;
  };
  return { ...mounted, latest };
}

describe('useLayers', () => {
  it('returns the initial layer as active', () => {
    const { latest } = setup();
    expect(latest().layers.map((l) => l.name)).toEqual(['Layer 1']);
    expect(latest().activeLayerId).toBe(latest().layers[0]?.id);
  });

  it('createLayer and removeLayer update the list', () => {
    const { result, latest } = setup();
    const layer = result.createLayer('Test Layer');
    expect(latest().layers.map((l) => l.name)).toEqual(['Layer 1', 'Test Layer']);
    result.removeLayer(layer.id);
    expect(latest().layers.map((l) => l.name)).toEqual(['Layer 1']);
  });

  it('renameLayer, setVisible, setLocked and setOpacity edit a layer', () => {
    const { result, latest } = setup();
    result.createLayer('Layer 2');
    const id = latest().layers[0]?.id ?? '';
    result.renameLayer(id, 'Renamed');
    result.setVisible(id, false);
    result.setLocked(id, true);
    result.setOpacity(id, 0.5);
    const layer = latest().layers.find((l) => l.id === id);
    expect(layer).toMatchObject({ name: 'Renamed', visible: false, locked: true, opacity: 0.5 });
  });

  it('reorderLayer moves a layer to the end', () => {
    const { result, latest } = setup();
    result.createLayer('Layer 2');
    const firstId = latest().layers[0]?.id ?? '';
    result.reorderLayer(firstId, 10);
    expect(latest().layers[1]?.id).toBe(firstId);
  });

  it('setActiveLayer switches the active layer', () => {
    const { result, latest } = setup();
    const layer = result.createLayer('Layer 2');
    result.setActiveLayer(layer.id);
    expect(latest().activeLayerId).toBe(layer.id);
  });

  it('moveElement moves an element to another layer', () => {
    const { result, viewport } = setup();
    const layer = result.createLayer('Layer 2');
    const note = createNote({ position: { x: 0, y: 0 } });
    viewport.store.add(note);
    result.moveElement(note.id, layer.id);
    expect(viewport.store.getById(note.id)?.layerId).toBe(layer.id);
  });
});
