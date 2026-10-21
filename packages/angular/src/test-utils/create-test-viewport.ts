import { Viewport } from '@fieldnotes/core';

interface TrackedViewport {
  viewport: Viewport;
  container: HTMLDivElement;
}

const tracked: TrackedViewport[] = [];

/** A real `Viewport` on a container in `document.body`; `destroyTestViewports()` stops its render loop. */
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
