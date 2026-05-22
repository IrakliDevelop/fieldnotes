// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ViewportHarness } from '../test-helpers/viewport-harness';
import { createViewportHarness } from '../test-helpers/viewport-harness';
import { drag, tap } from '../test-helpers/pointer-helpers';
import { Viewport } from '../canvas/viewport';

function createSecondViewport(): { viewport: Viewport; container: HTMLDivElement } {
  const container = document.createElement('div');
  Object.defineProperty(container, 'getBoundingClientRect', {
    value: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }),
  });
  document.body.appendChild(container);
  const viewport = new Viewport(container);
  return { viewport, container };
}

describe('Integration: serialization', () => {
  let h: ViewportHarness;

  beforeEach(() => {
    h = createViewportHarness();
  });

  afterEach(() => {
    h.cleanup();
  });

  it('exports and reimports state preserving all elements', () => {
    h.viewport.toolManager.setTool('pencil', h.viewport.toolContext);
    drag(h.wrapper, [50, 50], [200, 100], 5);

    h.viewport.toolManager.setTool('shape', h.viewport.toolContext);
    drag(h.wrapper, [100, 200], [300, 350]);

    h.viewport.toolManager.setTool('note', h.viewport.toolContext);
    tap(h.wrapper, 400, 300);

    h.viewport.addGrid({ gridType: 'square', cellSize: 50 });

    expect(h.viewport.store.getElementsByType('stroke')).toHaveLength(1);
    expect(h.viewport.store.getElementsByType('shape')).toHaveLength(1);
    expect(h.viewport.store.getElementsByType('note')).toHaveLength(1);
    expect(h.viewport.store.getElementsByType('grid')).toHaveLength(1);

    const json = h.viewport.exportJSON();

    const { viewport: v2, container: c2 } = createSecondViewport();
    v2.loadJSON(json);

    expect(v2.store.getElementsByType('stroke')).toHaveLength(1);
    expect(v2.store.getElementsByType('shape')).toHaveLength(1);
    expect(v2.store.getElementsByType('note')).toHaveLength(1);
    expect(v2.store.getElementsByType('grid')).toHaveLength(1);

    v2.destroy();
    c2.remove();
  });

  it('camera position preserved across roundtrip', () => {
    h.viewport.camera.pan(150, -80);
    h.viewport.camera.setZoom(1.5);

    const json = h.viewport.exportJSON();

    const { viewport: v2, container: c2 } = createSecondViewport();
    v2.loadJSON(json);

    expect(v2.camera.position.x).toBeCloseTo(150, 1);
    expect(v2.camera.position.y).toBeCloseTo(-80, 1);
    expect(v2.camera.zoom).toBeCloseTo(1.5, 1);

    v2.destroy();
    c2.remove();
  });

  it('layer state preserved across roundtrip', () => {
    const layer2 = h.viewport.layerManager.createLayer('My Layer');
    h.viewport.layerManager.setActiveLayer(layer2.id);

    h.viewport.toolManager.setTool('pencil', h.viewport.toolContext);
    drag(h.wrapper, [50, 50], [200, 100], 5);

    const layersBefore = h.viewport.layerManager.getLayers();
    expect(layersBefore.length).toBe(2);

    const json = h.viewport.exportJSON();

    const { viewport: v2, container: c2 } = createSecondViewport();
    v2.loadJSON(json);

    const layersAfter = v2.layerManager.getLayers();
    expect(layersAfter.length).toBe(2);

    const namedLayer = layersAfter.find((l) => l.name === 'My Layer');
    expect(namedLayer).toBeDefined();

    v2.destroy();
    c2.remove();
  });

  it('export empty canvas produces valid JSON', () => {
    const json = h.viewport.exportJSON();
    const parsed: unknown = JSON.parse(json);
    expect(parsed).toBeDefined();
    expect(typeof parsed).toBe('object');

    const state = parsed as Record<string, unknown>;
    expect(state['version']).toBeDefined();
    expect(state['camera']).toBeDefined();
    expect(Array.isArray(state['elements'])).toBe(true);
    expect((state['elements'] as unknown[]).length).toBe(0);
  });

  it('loadJSON clears previous state', () => {
    h.viewport.toolManager.setTool('pencil', h.viewport.toolContext);
    drag(h.wrapper, [50, 50], [200, 100], 5);
    drag(h.wrapper, [50, 150], [200, 200], 5);
    expect(h.viewport.store.getElementsByType('stroke')).toHaveLength(2);

    const json1 = h.viewport.exportJSON();

    h.viewport.toolManager.setTool('shape', h.viewport.toolContext);
    drag(h.wrapper, [300, 300], [500, 450]);
    expect(h.viewport.store.count).toBe(3);

    h.viewport.loadJSON(json1);

    expect(h.viewport.store.getElementsByType('stroke')).toHaveLength(2);
    expect(h.viewport.store.getElementsByType('shape')).toHaveLength(0);
    expect(h.viewport.store.count).toBe(2);
  });
});
