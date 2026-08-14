import { Viewport } from '@fieldnotes/core';

/**
 * A real `Viewport` mounted on a detached container, for hook tests that need
 * a working store/camera/layerManager without going through
 * `<FieldNotesCanvas>`.
 */
export function createTestViewport(): Viewport {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return new Viewport(container);
}
