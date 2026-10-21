import { afterEach, describe, expect, it } from 'vitest';
import { createNote } from '@fieldnotes/core';
import { createTestViewport, destroyTestViewports } from '../test-utils/create-test-viewport';
import { mountHelper } from '../test-utils/mount-helper';
import { injectLayers } from './inject-layers';

afterEach(destroyTestViewports);

describe('injectLayers', () => {
  it('holds [] and an empty active id, and throws from actions before a viewport exists', async () => {
    const { result } = await mountHelper(() => injectLayers(), null);
    expect([result.layers(), result.activeLayerId()]).toEqual([[], '']);
    expect(() => result.createLayer('x')).toThrow(
      '[fieldnotes] createLayer called before <fn-canvas> mounted',
    );
  });

  it('returns the initial layer as active', async () => {
    const { result } = await mountHelper(() => injectLayers());
    expect(result.layers().map((l) => l.name)).toEqual(['Layer 1']);
    expect(result.activeLayerId()).toBe(result.layers()[0]?.id);
  });

  it('createLayer and removeLayer update the list', async () => {
    const { result } = await mountHelper(() => injectLayers());
    const layer = result.createLayer('Test Layer');
    expect(result.layers().map((l) => l.name)).toEqual(['Layer 1', 'Test Layer']);
    result.removeLayer(layer.id);
    expect(result.layers().map((l) => l.name)).toEqual(['Layer 1']);
  });

  it('renameLayer, setVisible, setLocked and setOpacity edit a layer', async () => {
    const { result } = await mountHelper(() => injectLayers());
    result.createLayer('Layer 2');
    const id = result.layers()[0]?.id ?? '';
    result.renameLayer(id, 'Renamed');
    result.setVisible(id, false);
    result.setLocked(id, true);
    result.setOpacity(id, 0.5);
    const layer = result.layers().find((l) => l.id === id);
    expect(layer).toMatchObject({ name: 'Renamed', visible: false, locked: true, opacity: 0.5 });
  });

  it('reorderLayer moves a layer to the end', async () => {
    const { result } = await mountHelper(() => injectLayers());
    result.createLayer('Layer 2');
    const firstId = result.layers()[0]?.id ?? '';
    result.reorderLayer(firstId, 10);
    expect(result.layers()[1]?.id).toBe(firstId);
  });

  it('setActiveLayer switches the active layer', async () => {
    const { result } = await mountHelper(() => injectLayers());
    const layer = result.createLayer('Layer 2');
    result.setActiveLayer(layer.id);
    expect(result.activeLayerId()).toBe(layer.id);
  });

  it('moveElement moves an element to another layer', async () => {
    const viewport = createTestViewport();
    const { result } = await mountHelper(() => injectLayers(), viewport);
    const layer = result.createLayer('Layer 2');
    const note = createNote({ position: { x: 0, y: 0 } });
    viewport.store.add(note);
    result.moveElement(note.id, layer.id);
    expect(viewport.store.getById(note.id)?.layerId).toBe(layer.id);
  });
});
