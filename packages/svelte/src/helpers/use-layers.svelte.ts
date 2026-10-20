import type { Readable } from 'svelte/store';
import { createLayersSource } from '@fieldnotes/core';
import type { Layer, LayersState } from '@fieldnotes/core';
import { useViewport } from '../context.js';
import { fromSource } from './from-source.svelte.js';

/** Result of {@link useLayers}. */
export type UseLayersResult = Readable<LayersState> & {
  createLayer: (name?: string) => Layer;
  removeLayer: (id: string) => void;
  renameLayer: (id: string, name: string) => void;
  reorderLayer: (id: string, newOrder: number) => void;
  setVisible: (id: string, visible: boolean) => void;
  setLocked: (id: string, locked: boolean) => void;
  setOpacity: (id: string, opacity: number) => void;
  setActiveLayer: (id: string) => void;
  moveElement: (elementId: string, layerId: string) => void;
};

/**
 * Current layer list (`$layers.layers`, `$layers.activeLayerId`) and mutation helpers — updates
 * whenever a layer is added, removed, reordered, renamed, or its visibility/lock/opacity/active
 * state changes.
 */
export function useLayers(): UseLayersResult {
  const viewport = useViewport();
  const layerManager = viewport.layerManager;
  const { subscribe } = fromSource(createLayersSource(viewport));
  return {
    subscribe,
    createLayer: (name) => layerManager.createLayer(name),
    removeLayer: (id) => layerManager.removeLayer(id),
    renameLayer: (id, name) => layerManager.renameLayer(id, name),
    reorderLayer: (id, newOrder) => layerManager.reorderLayer(id, newOrder),
    setVisible: (id, visible) => layerManager.setLayerVisible(id, visible),
    setLocked: (id, locked) => layerManager.setLayerLocked(id, locked),
    setOpacity: (id, opacity) => layerManager.setLayerOpacity(id, opacity),
    setActiveLayer: (id) => layerManager.setActiveLayer(id),
    moveElement: (elementId, layerId) => layerManager.moveElementToLayer(elementId, layerId),
  };
}
