import type { Signal } from '@angular/core';
import { createCameraSource } from '@fieldnotes/core';
import type { CameraState } from '@fieldnotes/core';
import { injectSource } from './inject-source';

/** Current camera position and zoom level — updates whenever the camera moves or zoom changes. */
export function injectCamera(): Signal<CameraState> {
  return injectSource(createCameraSource, { x: 0, y: 0, zoom: 1 });
}
