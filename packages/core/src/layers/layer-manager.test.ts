import { describe, it, expect, vi } from 'vitest';
import { LayerManager } from './layer-manager';
import { ElementStore } from '../elements/element-store';
import type { NoteElement } from '../elements/types';

function makeNote(overrides: Partial<NoteElement> = {}): NoteElement {
  return {
    id: 'el-1',
    type: 'note',
    position: { x: 0, y: 0 },
    size: { w: 100, h: 100 },
    text: '',
    backgroundColor: '#fff',
    textColor: '#000',
    zIndex: 0,
    locked: false,
    layerId: '',
    ...overrides,
  };
}

function setup() {
  const store = new ElementStore();
  const manager = new LayerManager(store);
  return { store, manager };
}

describe('LayerManager', () => {
  describe('construction', () => {
    it('creates a default layer', () => {
      const { manager } = setup();
      const layers = manager.getLayers();
      expect(layers).toHaveLength(1);
      expect(layers[0]?.name).toBe('Layer 1');
      expect(layers[0]?.visible).toBe(true);
      expect(layers[0]?.locked).toBe(false);
      expect(layers[0]?.order).toBe(0);
      expect(layers[0]?.opacity).toBe(1.0);
    });

    it('sets the default layer as active', () => {
      const { manager } = setup();
      expect(manager.activeLayer.name).toBe('Layer 1');
    });
  });

  describe('createLayer', () => {
    it('creates a named layer at the top', () => {
      const { manager } = setup();
      const layer = manager.createLayer('Foreground');
      expect(layer.name).toBe('Foreground');
      expect(layer.order).toBeGreaterThan(manager.getLayers()[0]?.order ?? -1);
    });

    it('auto-names layers when no name given', () => {
      const { manager } = setup();
      const layer = manager.createLayer();
      expect(layer.name).toBe('Layer 2');
    });

    it('emits change event', () => {
      const { manager } = setup();
      const spy = vi.fn();
      manager.on('change', spy);
      manager.createLayer();
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('removeLayer', () => {
    it('throws when removing the last layer', () => {
      const { manager } = setup();
      const id = manager.activeLayerId;
      expect(() => manager.removeLayer(id)).toThrow();
    });

    it('removes a layer and moves its elements to the active layer', () => {
      const { store, manager } = setup();
      const layer2 = manager.createLayer('Layer 2');
      store.add(makeNote({ layerId: layer2.id }));
      manager.removeLayer(layer2.id);
      const el = store.getById('el-1');
      expect(el?.layerId).toBe(manager.activeLayerId);
      expect(manager.getLayers()).toHaveLength(1);
    });

    it('switches active if the active layer is removed', () => {
      const { manager } = setup();
      const oldActive = manager.activeLayerId;
      const layer2 = manager.createLayer();
      manager.setActiveLayer(layer2.id);
      manager.removeLayer(layer2.id);
      expect(manager.activeLayerId).toBe(oldActive);
    });
  });

  describe('renameLayer', () => {
    it('renames a layer', () => {
      const { manager } = setup();
      const id = manager.activeLayerId;
      manager.renameLayer(id, 'Background');
      expect(manager.getLayer(id)?.name).toBe('Background');
    });
  });

  describe('reorderLayer', () => {
    it('reorders layers', () => {
      const { manager } = setup();
      const layer2 = manager.createLayer('Top');
      const firstId = manager.getLayers()[0]?.id;
      if (firstId) manager.reorderLayer(firstId, 10);
      const layers = manager.getLayers();
      expect(layers[0]?.id).toBe(layer2.id);
    });

    it('reorder to same position does not crash', () => {
      const { manager } = setup();
      const id = manager.activeLayerId;
      const orderBefore = manager.getLayer(id)?.order;
      manager.reorderLayer(id, orderBefore ?? 0);
      expect(manager.getLayer(id)?.order).toBe(orderBefore);
    });
  });

  describe('visibility', () => {
    it('toggles layer visibility', () => {
      const { manager } = setup();
      manager.createLayer();
      const id = manager.getLayers()[0]?.id;
      const secondId = manager.getLayers()[1]?.id;
      if (!id || !secondId) throw new Error('Expected two layers');
      manager.setActiveLayer(secondId);
      const result = manager.setLayerVisible(id, false);
      expect(result).toBe(true);
      expect(manager.isLayerVisible(id)).toBe(false);
    });

    it('prevents hiding the active layer if no fallback exists', () => {
      const { manager } = setup();
      const result = manager.setLayerVisible(manager.activeLayerId, false);
      expect(result).toBe(false);
      expect(manager.isLayerVisible(manager.activeLayerId)).toBe(true);
    });

    it('switches active layer when hiding the current active', () => {
      const { manager } = setup();
      const layer2 = manager.createLayer();
      const firstId = manager.getLayers()[0]?.id;
      if (!firstId) throw new Error('Expected a layer');
      manager.setActiveLayer(firstId);
      const result = manager.setLayerVisible(firstId, false);
      expect(result).toBe(true);
      expect(manager.activeLayerId).toBe(layer2.id);
    });
  });

  describe('locking', () => {
    it('toggles layer lock', () => {
      const { manager } = setup();
      manager.createLayer();
      const id = manager.getLayers()[0]?.id;
      const secondId = manager.getLayers()[1]?.id;
      if (!id || !secondId) throw new Error('Expected two layers');
      manager.setActiveLayer(secondId);
      const result = manager.setLayerLocked(id, true);
      expect(result).toBe(true);
      expect(manager.isLayerLocked(id)).toBe(true);
    });

    it('prevents locking the active layer if no fallback exists', () => {
      const { manager } = setup();
      const result = manager.setLayerLocked(manager.activeLayerId, true);
      expect(result).toBe(false);
      expect(manager.isLayerLocked(manager.activeLayerId)).toBe(false);
    });
  });

  describe('moveElementToLayer', () => {
    it('updates element layerId via store', () => {
      const { store, manager } = setup();
      store.add(makeNote({ layerId: manager.activeLayerId }));
      const layer2 = manager.createLayer();
      manager.moveElementToLayer('el-1', layer2.id);
      expect(store.getById('el-1')?.layerId).toBe(layer2.id);
    });
  });

  describe('setLayerOpacity', () => {
    it('sets opacity on a layer', () => {
      const store = new ElementStore();
      const mgr = new LayerManager(store);
      const layer = mgr.getLayers()[0];
      if (!layer) throw new Error('Expected a layer');
      mgr.setLayerOpacity(layer.id, 0.5);
      expect(mgr.getLayer(layer.id)?.opacity).toBe(0.5);
    });

    it('clamps opacity to 0-1 range', () => {
      const store = new ElementStore();
      const mgr = new LayerManager(store);
      const layer = mgr.getLayers()[0];
      if (!layer) throw new Error('Expected a layer');
      mgr.setLayerOpacity(layer.id, 1.5);
      expect(mgr.getLayer(layer.id)?.opacity).toBe(1);
      mgr.setLayerOpacity(layer.id, -0.5);
      expect(mgr.getLayer(layer.id)?.opacity).toBe(0);
    });

    it('emits change event', () => {
      const store = new ElementStore();
      const mgr = new LayerManager(store);
      const layer = mgr.getLayers()[0];
      if (!layer) throw new Error('Expected a layer');
      const listener = vi.fn();
      mgr.on('change', listener);
      mgr.setLayerOpacity(layer.id, 0.7);
      expect(listener).toHaveBeenCalledOnce();
    });

    it('ignores non-existent layer', () => {
      const store = new ElementStore();
      const mgr = new LayerManager(store);
      const listener = vi.fn();
      mgr.on('change', listener);
      mgr.setLayerOpacity('nonexistent', 0.5);
      expect(listener).not.toHaveBeenCalled();
    });

    it('clamps negative values to 0', () => {
      const { manager } = setup();
      const id = manager.activeLayerId;
      manager.setLayerOpacity(id, -5);
      expect(manager.getLayer(id)?.opacity).toBe(0);
    });

    it('clamps values greater than 1 to 1', () => {
      const { manager } = setup();
      const id = manager.activeLayerId;
      manager.setLayerOpacity(id, 0.5);
      manager.setLayerOpacity(id, 99);
      expect(manager.getLayer(id)?.opacity).toBe(1);
    });
  });

  describe('serialization', () => {
    it('round-trips via snapshot/loadSnapshot', () => {
      const { manager } = setup();
      manager.createLayer('Top');
      const snap = manager.snapshot();

      const store2 = new ElementStore();
      const manager2 = new LayerManager(store2);
      manager2.loadSnapshot(snap);

      expect(manager2.getLayers()).toHaveLength(2);
      expect(manager2.getLayers().map((l) => l.name)).toEqual(['Layer 1', 'Top']);
    });
  });

  describe('setActiveLayer', () => {
    it('ignores non-existent layer id', () => {
      const { manager } = setup();
      const before = manager.activeLayerId;
      manager.setActiveLayer('nonexistent');
      expect(manager.activeLayerId).toBe(before);
    });
  });

  describe('moveElementToLayer', () => {
    it('ignores non-existent layer', () => {
      const { store, manager } = setup();
      store.add(makeNote({ layerId: manager.activeLayerId }));
      const changeSpy = vi.fn();
      manager.on('change', changeSpy);
      manager.moveElementToLayer('el-1', 'nonexistent');
      expect(changeSpy).not.toHaveBeenCalled();
    });
  });

  describe('reorderLayer', () => {
    it('ignores non-existent layer id', () => {
      const { manager } = setup();
      const changeSpy = vi.fn();
      manager.on('change', changeSpy);
      manager.reorderLayer('nonexistent', 5);
      expect(changeSpy).not.toHaveBeenCalled();
    });
  });

  describe('isLayerVisible/isLayerLocked for unknown id', () => {
    it('returns true for unknown layer visibility', () => {
      const { manager } = setup();
      expect(manager.isLayerVisible('unknown-id')).toBe(true);
    });

    it('returns false for unknown layer lock state', () => {
      const { manager } = setup();
      expect(manager.isLayerLocked('unknown-id')).toBe(false);
    });
  });

  describe('getLayer', () => {
    it('returns undefined for non-existent layer', () => {
      const { manager } = setup();
      expect(manager.getLayer('nonexistent')).toBeUndefined();
    });
  });

  describe('removeLayer — fallback layer selection', () => {
    it('uses fallback when active layer is removed', () => {
      const { manager } = setup();
      const layer2 = manager.createLayer('Layer 2');
      manager.setActiveLayer(layer2.id);
      manager.removeLayer(layer2.id);
      expect(manager.getLayers()).toHaveLength(1);
    });
  });

  describe('setLayerLocked — switches active on lock', () => {
    it('switches active layer when locking the current active', () => {
      const { manager } = setup();
      const layer2 = manager.createLayer();
      const firstId = manager.getLayers()[0]?.id;
      if (!firstId) throw new Error('Expected a layer');
      manager.setActiveLayer(firstId);
      const result = manager.setLayerLocked(firstId, true);
      expect(result).toBe(true);
      expect(manager.activeLayerId).toBe(layer2.id);
    });
  });

  describe('updateLayerDirect — non-existent layer', () => {
    it('ignores updates to non-existent layers', () => {
      const { manager } = setup();
      expect(() => manager.updateLayerDirect('nonexistent', { name: 'test' })).not.toThrow();
    });
  });
});
