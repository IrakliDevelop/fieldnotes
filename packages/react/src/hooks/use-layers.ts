import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { createLayersSource } from '@fieldnotes/core';
import type { Layer } from '@fieldnotes/core';
import { useViewport } from './use-viewport';

export interface UseLayersResult {
  layers: Layer[];
  activeLayerId: string;
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
 * Current layer list and mutation helpers — re-renders whenever a layer is added, removed,
 * reordered, renamed, or its visibility/lock/opacity/active state changes.
 */
export function useLayers(): UseLayersResult {
  const viewport = useViewport();
  const source = useMemo(() => createLayersSource(viewport), [viewport]);

  const snapshot = useSyncExternalStore(source.subscribe, source.getSnapshot);

  const createLayer = useCallback(
    (name?: string) => viewport.layerManager.createLayer(name),
    [viewport],
  );

  const removeLayer = useCallback(
    (id: string) => viewport.layerManager.removeLayer(id),
    [viewport],
  );

  const renameLayer = useCallback(
    (id: string, name: string) => viewport.layerManager.renameLayer(id, name),
    [viewport],
  );

  const reorderLayer = useCallback(
    (id: string, newOrder: number) => viewport.layerManager.reorderLayer(id, newOrder),
    [viewport],
  );

  const setVisible = useCallback(
    (id: string, visible: boolean) => viewport.layerManager.setLayerVisible(id, visible),
    [viewport],
  );

  const setLocked = useCallback(
    (id: string, locked: boolean) => viewport.layerManager.setLayerLocked(id, locked),
    [viewport],
  );

  const setOpacity = useCallback(
    (id: string, opacity: number) => viewport.layerManager.setLayerOpacity(id, opacity),
    [viewport],
  );

  const setActiveLayer = useCallback(
    (id: string) => viewport.layerManager.setActiveLayer(id),
    [viewport],
  );

  const moveElement = useCallback(
    (elementId: string, layerId: string) =>
      viewport.layerManager.moveElementToLayer(elementId, layerId),
    [viewport],
  );

  return {
    layers: snapshot.layers,
    activeLayerId: snapshot.activeLayerId,
    createLayer,
    removeLayer,
    renameLayer,
    reorderLayer,
    setVisible,
    setLocked,
    setOpacity,
    setActiveLayer,
    moveElement,
  };
}
