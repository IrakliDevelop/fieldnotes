import type { ShallowRef } from 'vue';
import { createCameraSource } from '@fieldnotes/core';
import type { CameraState } from '@fieldnotes/core';
import { useViewport } from './use-viewport';
import { useSource } from './use-source';

/** Current camera position and zoom level — updates whenever the camera moves or zoom changes. */
export function useCamera(): Readonly<ShallowRef<CameraState>> {
  return useSource(createCameraSource(useViewport()));
}
