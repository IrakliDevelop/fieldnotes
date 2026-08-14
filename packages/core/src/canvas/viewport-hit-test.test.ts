/**
 * @vitest-environment jsdom
 */
// Core Vitest defaults to the Node environment; every viewport test in this
// package carries this docblock (see viewport.test.ts). Without it,
// `document.createElement` throws before any assertion runs.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Viewport } from './viewport';
import { createImage } from '../elements/element-factory';
import type { CanvasElement } from '../elements/types';

function imageAt(id: string, x: number, y: number, layerId: string): CanvasElement {
  return {
    ...createImage({ position: { x, y }, size: { w: 40, h: 40 }, src: 'a.png', layerId }),
    id,
  };
}

describe('Viewport.getElementAt', () => {
  let container: HTMLDivElement;
  let vp: Viewport;
  /** The layer test elements live on. NEVER the active layer — see below. */
  let targetLayerId: string;

  beforeEach(() => {
    container = document.createElement('div');
    Object.defineProperty(container, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    });
    document.body.appendChild(container);
    vp = new Viewport(container);

    // LayerManager REFUSES to hide or lock the active layer when no fallback
    // exists (`layer-manager.ts:101-119` returns false and no-ops). A default
    // viewport has exactly one layer, so a fixture that locks/hides it would
    // silently change nothing and every assertion below would pass against a
    // fully visible, unlocked element. Create a second layer and keep the
    // default one active so the target layer always has a fallback.
    targetLayerId = vp.layerManager.createLayer('target').id;
  });

  afterEach(() => {
    vp.destroy();
    container.remove();
  });

  it('returns the element under a world point', () => {
    vp.store.add(imageAt('a', 0, 0, targetLayerId));
    expect(vp.getElementAt({ x: 20, y: 20 })?.id).toBe('a');
  });

  it('returns null where nothing is', () => {
    vp.store.add(imageAt('a', 0, 0, targetLayerId));
    expect(vp.getElementAt({ x: 500, y: 500 })).toBeNull();
  });

  it('skips locked layers by default and returns them with respectLayerLock: false', () => {
    vp.store.add(imageAt('a', 0, 0, targetLayerId));
    // Assert the setter actually applied: a false return means it no-opped and
    // the rest of this test would be meaningless.
    expect(vp.layerManager.setLayerLocked(targetLayerId, true)).toBe(true);
    expect(vp.layerManager.isLayerLocked(targetLayerId)).toBe(true);

    expect(vp.getElementAt({ x: 20, y: 20 })).toBeNull();
    expect(vp.getElementAt({ x: 20, y: 20 }, { respectLayerLock: false })?.id).toBe('a');
  });

  it('never returns an element on an invisible layer, in either mode', () => {
    vp.store.add(imageAt('a', 0, 0, targetLayerId));
    expect(vp.layerManager.setLayerVisible(targetLayerId, false)).toBe(true);
    expect(vp.layerManager.isLayerVisible(targetLayerId)).toBe(false);

    expect(vp.getElementAt({ x: 20, y: 20 })).toBeNull();
    expect(vp.getElementAt({ x: 20, y: 20 }, { respectLayerLock: false })).toBeNull();
  });

  it('returns the topmost element that PASSES match, not null, when a non-matching element covers it', () => {
    vp.store.add({ ...imageAt('wanted', 0, 0, targetLayerId), zIndex: 1 });
    vp.store.add({ ...imageAt('cover', 0, 0, targetLayerId), zIndex: 999 });

    // Positive control: without a filter the cover wins, so the assertion below
    // cannot pass by construction.
    expect(vp.getElementAt({ x: 20, y: 20 })?.id).toBe('cover');
    expect(vp.getElementAt({ x: 20, y: 20 }, { match: (el) => el.id === 'wanted' })?.id).toBe(
      'wanted',
    );
  });

  it('keeps the built-in thin-geometry thresholds unchanged (no radius option exists)', () => {
    vp.store.add(imageAt('a', 0, 0, targetLayerId));
    // 4px outside the rect: images use exact bounds, no inflation.
    expect(vp.getElementAt({ x: 44, y: 20 })).toBeNull();
  });
});
