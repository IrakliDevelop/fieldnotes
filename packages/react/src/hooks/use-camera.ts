import { useMemo, useSyncExternalStore } from 'react';
import { createCameraSource } from '@fieldnotes/core';
import type { CameraState } from '@fieldnotes/core';
import { useViewport } from './use-viewport';

/** Current camera position and zoom level — re-renders whenever the camera moves or zoom changes. */
export function useCamera(): CameraState {
  const viewport = useViewport();
  const source = useMemo(() => createCameraSource(viewport), [viewport]);
  return useSyncExternalStore(source.subscribe, source.getSnapshot);
}
