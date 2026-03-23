import { describe, it, expect } from 'vitest';
import { ElementStore } from '../elements/element-store';
import { LayerManager } from '../layers/layer-manager';
import { CreateLayerCommand, RemoveLayerCommand, UpdateLayerCommand } from './layer-commands';
import type { Layer } from '../layers/types';

function setup() {
  const store = new ElementStore();
  const manager = new LayerManager(store);
  return { store, manager };
}

describe('CreateLayerCommand', () => {
  it('undo removes the created layer', () => {
    const { store, manager } = setup();
    const layer: Layer = {
      id: 'test-layer',
      name: 'Test',
      visible: true,
      locked: false,
      order: 1,
      opacity: 1.0,
    };
    const cmd = new CreateLayerCommand(manager, layer);
    cmd.execute(store);
    expect(manager.getLayers()).toHaveLength(2);
    cmd.undo(store);
    expect(manager.getLayers()).toHaveLength(1);
  });
});

describe('RemoveLayerCommand', () => {
  it('undo restores the removed layer', () => {
    const { store, manager } = setup();
    const layer: Layer = {
      id: 'test-layer',
      name: 'Test',
      visible: true,
      locked: false,
      order: 1,
      opacity: 1.0,
    };
    manager.addLayerDirect(layer);
    const cmd = new RemoveLayerCommand(manager, layer);
    cmd.execute(store);
    expect(manager.getLayers()).toHaveLength(1);
    cmd.undo(store);
    expect(manager.getLayers()).toHaveLength(2);
  });
});

describe('UpdateLayerCommand', () => {
  it('undo restores previous layer state', () => {
    const { store, manager } = setup();
    const id = manager.activeLayerId;
    const before = { ...manager.activeLayer };
    const after = { ...before, name: 'Renamed' };
    const cmd = new UpdateLayerCommand(manager, id, before, after);
    cmd.execute(store);
    expect(manager.getLayer(id)?.name).toBe('Renamed');
    cmd.undo(store);
    expect(manager.getLayer(id)?.name).toBe('Layer 1');
  });
});
