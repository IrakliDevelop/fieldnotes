import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { Layer } from '@fieldnotes/core';
import { useViewport } from './use-viewport';

interface LayersSnapshot {
  layers: Layer[];
  activeLayerId: string;
}

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

export function useLayers(): UseLayersResult {
  const viewport = useViewport();
  const cachedRef = useRef<LayersSnapshot>({ layers: [], activeLayerId: '' });

  const subscribe = useCallback(
    (onStoreChange: () => void) => viewport.layerManager.on('change', onStoreChange),
    [viewport],
  );

  const getSnapshot = useCallback((): LayersSnapshot => {
    const layers = viewport.layerManager.getLayers();
    const activeLayerId = viewport.layerManager.activeLayerId;
    const cached = cachedRef.current;
    if (
      cached.activeLayerId === activeLayerId &&
      cached.layers.length === layers.length &&
      cached.layers.every((l, i) => {
        const next = layers[i];
        return (
          next !== undefined &&
          l.id === next.id &&
          l.name === next.name &&
          l.visible === next.visible &&
          l.locked === next.locked &&
          l.order === next.order &&
          l.opacity === next.opacity
        );
      })
    ) {
      return cached;
    }
    const next = { layers, activeLayerId };
    cachedRef.current = next;
    return next;
  }, [viewport]);

  const snapshot = useSyncExternalStore(subscribe, getSnapshot);

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
