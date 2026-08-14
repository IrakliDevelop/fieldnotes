import { Viewport } from '@fieldnotes/core';

interface TrackedViewport {
  viewport: Viewport;
  container: HTMLDivElement;
}

const tracked: TrackedViewport[] = [];

/**
 * A real `Viewport` mounted on a detached container, for hook tests that need
 * a working store/camera/layerManager without going through
 * `<FieldNotesCanvas>`.
 *
 * Every `Viewport` starts its own self-rescheduling render loop (rAF-driven)
 * and appends its container to `document.body`. Call `destroyTestViewports()`
 * (e.g. from an `afterEach`) to stop and remove everything this helper has
 * created — mirroring `field-notes-canvas.tsx`'s destroy-in-cleanup
 * semantics — or those loops keep rescheduling for the lifetime of the test
 * process, which is especially costly in a rAF-timing-sensitive test file.
 */
export function createTestViewport(): Viewport {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const viewport = new Viewport(container);
  tracked.push({ viewport, container });
  return viewport;
}

/** Destroys and removes every `Viewport`/container this helper has created since the last call. */
export function destroyTestViewports(): void {
  for (const { viewport, container } of tracked.splice(0)) {
    viewport.destroy();
    container.remove();
  }
}
