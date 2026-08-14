/**
 * @vitest-environment jsdom
 */
// Core Vitest defaults to the Node environment; every viewport test in this
// package carries this docblock (see viewport.test.ts). Without it,
// `document.createElement` throws before any assertion runs.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Viewport } from './viewport';
import { createGrid, createImage, createShape, createStroke } from '../elements/element-factory';
import type { CanvasElement } from '../elements/types';

function imageAt(id: string, x: number, y: number, layerId: string): CanvasElement {
  return {
    ...createImage({ position: { x, y }, size: { w: 40, h: 40 }, src: 'a.png', layerId }),
    id,
  };
}

/** A two-point stroke: a straight segment from (x0,y0) to (x1,y1) in world space. */
function strokeAt(
  id: string,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  layerId: string,
): CanvasElement {
  return {
    ...createStroke({
      position: { x: 0, y: 0 },
      points: [
        { x: x0, y: y0, pressure: 0.5 },
        { x: x1, y: y1, pressure: 0.5 },
      ],
      layerId,
    }),
    id,
  };
}

/** A 'line'-shape from (x,y) to (x+w,y+h), so its threshold branch in isInsideBounds fires. */
function lineShapeAt(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  strokeWidth: number,
  layerId: string,
): CanvasElement {
  return {
    ...createShape({ position: { x, y }, size: { w, h }, shape: 'line', strokeWidth, layerId }),
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

  it('accounts for rotation: hits inside the rotated footprint, misses inside the unrotated AABB', () => {
    // 40x40 image at (0,0), so its unrotated box is [0,40]x[0,40] and its
    // rotation centre is (20,20). Rotated 45°, its footprint is a diamond
    // whose corners poke outside that box and whose own corners of the box
    // fall outside the diamond.
    vp.store.add({ ...imageAt('a', 0, 0, targetLayerId), rotation: Math.PI / 4 });

    // (20, -5) is outside the unrotated [0,40]x[0,40] box (y < 0), but
    // rotating it -45° about (20,20) lands it at ~(2.3, 2.3) — inside. A
    // hit-test that ignored rotation (or tested the raw AABB) would miss here.
    expect(vp.getElementAt({ x: 20, y: -5 })?.id).toBe('a');

    // (2, 2) is inside the unrotated [0,40]x[0,40] box, but rotating it -45°
    // about (20,20) lands it at ~(20, -5.46) — outside. A hit-test that
    // ignored rotation would incorrectly hit here.
    expect(vp.getElementAt({ x: 2, y: 2 })).toBeNull();
  });

  it('never returns a grid element, even directly under the probe point', () => {
    // High zIndex: were grid participation ever restored, it would be the
    // topmost candidate at this point, so only the explicit exclusion (not
    // z-order) can be what keeps `under` the answer.
    vp.store.add({ ...createGrid({ layerId: targetLayerId }), id: 'g', zIndex: 999 });
    vp.store.add(imageAt('under', 0, 0, targetLayerId));

    expect(vp.getElementAt({ x: 20, y: 20 })?.id).toBe('under');

    // And with nothing beneath it, a probe over the grid alone finds nothing.
    vp.store.add({ ...createGrid({ layerId: targetLayerId }), id: 'g2', zIndex: 999 });
    expect(vp.getElementAt({ x: 500, y: 500 })).toBeNull();
  });

  it('hits a stroke within its 10px threshold, misses just beyond it', () => {
    vp.store.add(strokeAt('s', 0, 0, 40, 0, targetLayerId));
    // 9px from the horizontal polyline: inside the fixed 10px stroke threshold.
    expect(vp.getElementAt({ x: 20, y: 9 })?.id).toBe('s');
    // 11px away: just beyond it.
    expect(vp.getElementAt({ x: 20, y: 11 })).toBeNull();
  });

  it('pins the thin-geometry hit threshold at max(strokeWidth/2, 6)', () => {
    // strokeWidth 2 -> strokeWidth/2 = 1, so the 6px floor governs, not the
    // stroke width itself.
    vp.store.add(lineShapeAt('ln', 0, 0, 40, 0, 2, targetLayerId));
    expect(vp.getElementAt({ x: 20, y: 6 })?.id).toBe('ln');
    expect(vp.getElementAt({ x: 20, y: 7 })).toBeNull();
  });
});
