import type { Readable } from 'svelte/store';
import { createCameraSource } from '@fieldnotes/core';
import type { CameraState } from '@fieldnotes/core';
import { useViewport } from '../context.js';
import { fromSource } from './from-source.svelte.js';

/** Current camera position and zoom level — updates whenever the camera moves or zoom changes. */
export function useCamera(): Readable<CameraState> {
  return fromSource(createCameraSource(useViewport()));
}
