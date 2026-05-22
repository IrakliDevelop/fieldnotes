// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ViewportHarness } from '../test-helpers/viewport-harness';
import { createViewportHarness } from '../test-helpers/viewport-harness';
import { drag, tap } from '../test-helpers/pointer-helpers';

describe('Integration: camera navigation', () => {
  let h: ViewportHarness;

  beforeEach(() => {
    h = createViewportHarness();
  });

  afterEach(() => {
    h.cleanup();
  });

  it('hand tool pans camera via drag', () => {
    const startX = h.viewport.camera.position.x;
    const startY = h.viewport.camera.position.y;

    h.viewport.toolManager.setTool('hand', h.viewport.toolContext);
    drag(h.wrapper, [200, 200], [350, 280], 10);

    expect(h.viewport.camera.position.x).not.toBe(startX);
    expect(h.viewport.camera.position.y).not.toBe(startY);
  });

  it('scroll wheel zooms', () => {
    const startZoom = h.viewport.camera.zoom;

    h.wrapper.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: -100,
        clientX: 400,
        clientY: 300,
        bubbles: true,
      }),
    );

    expect(h.viewport.camera.zoom).toBeGreaterThan(startZoom);
  });

  it('camera transforms affect element world coordinates', () => {
    h.viewport.camera.pan(200, 150);

    h.viewport.toolManager.setTool('note', h.viewport.toolContext);
    tap(h.wrapper, 400, 300);

    const notes = h.viewport.store.getElementsByType('note');
    expect(notes).toHaveLength(1);

    const notePos = notes[0]?.position;
    expect(notePos).toBeDefined();
    expect(notePos?.x).not.toBe(400);
    expect(notePos?.y).not.toBe(300);
  });
});
