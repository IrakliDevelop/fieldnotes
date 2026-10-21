import { computed } from '@angular/core';
import type { Signal } from '@angular/core';
import { createLayersSource } from '@fieldnotes/core';
import type { Layer, LayerManager } from '@fieldnotes/core';
import { injectViewport } from '../inject-viewport';
import { injectSource, requireViewport } from './inject-source';

/** Result of {@link injectLayers}. */
export interface InjectLayersResult {
  layers: Signal<Layer[]>;
  activeLayerId: Signal<string>;
  createLayer: (name?: string) => Layer;
  removeLayer: (id: string) => void;
  renameLayer: (id: string, name: string) => void;
  reorderLayer: (id: string, newOrder: number) => void;
  setVisible: (id: string, visible: boolean) => void;
  setLocked: (id: string, locked: boolean) => void;
  setOpacity: (id: string, opacity: number) => void;
  setActiveLayer: (id: string) => void;
  moveElement: (elementId: string, layerId: string) => void;
}

/**
 * Current layer list and mutation helpers — updates whenever a layer is added, removed,
 * reordered, renamed, or its visibility/lock/opacity/active state changes.
 */
export function injectLayers(): InjectLayersResult {
  const viewport = injectViewport();
  const state = injectSource(createLayersSource, { layers: [], activeLayerId: '' });
  const layers = (name: string): LayerManager => requireViewport(viewport, name).layerManager;
  return {
    layers: computed(() => state().layers),
    activeLayerId: computed(() => state().activeLayerId),
    createLayer: (name) => layers('createLayer').createLayer(name),
    removeLayer: (id) => layers('removeLayer').removeLayer(id),
    renameLayer: (id, name) => layers('renameLayer').renameLayer(id, name),
    reorderLayer: (id, newOrder) => layers('reorderLayer').reorderLayer(id, newOrder),
    setVisible: (id, visible) => layers('setVisible').setLayerVisible(id, visible),
    setLocked: (id, locked) => layers('setLocked').setLayerLocked(id, locked),
    setOpacity: (id, opacity) => layers('setOpacity').setLayerOpacity(id, opacity),
    setActiveLayer: (id) => layers('setActiveLayer').setActiveLayer(id),
    moveElement: (elementId, layerId) =>
      layers('moveElement').moveElementToLayer(elementId, layerId),
  };
}
