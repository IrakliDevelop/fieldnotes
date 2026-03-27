import { useCallback, useRef, useSyncExternalStore } from 'react';
import { useViewport } from './use-viewport';

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

export function useCamera(): CameraState {
  const viewport = useViewport();
  const cachedRef = useRef<CameraState>({ x: 0, y: 0, zoom: 1 });

  const subscribe = useCallback(
    (onStoreChange: () => void) => viewport.camera.onChange(onStoreChange),
    [viewport],
  );

  const getSnapshot = useCallback((): CameraState => {
    const { position, zoom } = viewport.camera;
    const cached = cachedRef.current;
    if (cached.x === position.x && cached.y === position.y && cached.zoom === zoom) {
      return cached;
    }
    const next = { x: position.x, y: position.y, zoom };
    cachedRef.current = next;
    return next;
  }, [viewport]);

  return useSyncExternalStore(subscribe, getSnapshot);
}
