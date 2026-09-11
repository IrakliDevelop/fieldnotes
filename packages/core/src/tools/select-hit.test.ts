// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { rectsOverlap, isInsideBounds, hitTestResizeHandle, hitTest } from './select-hit';
import { ElementStore } from '../elements/element-store';
import { Camera } from '../canvas/camera';
import { createNote, createStroke, createArrow } from '../elements/element-factory';
import type { ToolContext } from './types';
import { ElementRegistry } from '../elements/element-registry';
import type { ExtensionElementEnvelope } from '../elements/types';

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    camera: new Camera(),
    store: new ElementStore(),
    requestRender: vi.fn(),
    ...overrides,
  };
}

describe('rectsOverlap', () => {
  it('returns true for overlapping rects', () => {
    expect(rectsOverlap({ x: 0, y: 0, w: 100, h: 100 }, { x: 50, y: 50, w: 100, h: 100 })).toBe(
      true,
    );
  });

  it('returns false for disjoint rects', () => {
    expect(rectsOverlap({ x: 0, y: 0, w: 100, h: 100 }, { x: 200, y: 200, w: 100, h: 100 })).toBe(
      false,
    );
  });
});

describe('isInsideBounds', () => {
  // A 200x100 note at (0,0) rotated 90° sweeps a footprint that is tall and narrow
  // around its center (100, 50): roughly x in [50,150], y in [-50,150].
  const note = createNote({ position: { x: 0, y: 0 }, size: { w: 200, h: 100 } });
  const rotated = { ...note, rotation: Math.PI / 2 };

  it('returns true for a point inside the rotated footprint', () => {
    expect(isInsideBounds({ x: 100, y: 0 }, rotated)).toBe(true);
  });

  it('returns false for a point in the unrotated AABB but outside the rotated footprint', () => {
    // (190, 50) sits inside the unrotated 200x100 box but outside the 90°-rotated footprint.
    expect(isInsideBounds({ x: 190, y: 50 }, note)).toBe(true);
    expect(isInsideBounds({ x: 190, y: 50 }, rotated)).toBe(false);
  });

  it('delegates extension hit testing to the context registry', () => {
    const registry = new ElementRegistry();
    registry.register<ExtensionElementEnvelope>({
      type: 'test:selectable',
      legacyTypes: [],
      decodeLegacy: (raw) => raw as unknown as ExtensionElementEnvelope,
      encodeLegacy: (el) => structuredClone(el) as unknown as Record<string, unknown>,
      validateData: () => true,
      unwrap: (el) => el,
      wrap: (el) => el,
      bounds: () => ({ x: 0, y: 0, w: 100, h: 100 }),
      hitTest: (_el, point) => point.x === 42 && point.y === 24,
    });
    const element: ExtensionElementEnvelope = {
      id: 'ext',
      type: 'extension',
      extensionType: 'test:selectable',
      position: { x: 0, y: 0 },
      zIndex: 0,
      locked: false,
      layerId: '',
      data: {},
    };
    const ctx = makeCtx({ elementRegistry: registry });
    ctx.store.setElementRegistry(registry);
    ctx.store.add(element);

    expect(isInsideBounds({ x: 42, y: 24 }, element, ctx)).toBe(true);
    expect(isInsideBounds({ x: 10, y: 10 }, element, ctx)).toBe(false);
    expect(hitTest({ x: 42, y: 24 }, ctx)?.id).toBe(element.id);
  });
});

describe('hitTestResizeHandle', () => {
  it('returns null for a locked selected element', () => {
    const ctx = makeCtx();
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 200, h: 100 }, locked: true });
    ctx.store.add(note);
    expect(hitTestResizeHandle({ x: 200, y: 100 }, ctx, [note.id])).toBeNull();
  });

  describe('hit tolerance scales with zoom', () => {
    function strokeCtx(zoom: number): ToolContext {
      const ctx = makeCtx();
      ctx.camera.setZoom(zoom);
      ctx.store.add(
        createStroke({
          points: [
            { x: 0, y: 0, pressure: 0.5 },
            { x: 100, y: 0, pressure: 0.5 },
          ],
        }),
      );
      return ctx;
    }

    it('a click 5 world units off a stroke hits at zoom 1', () => {
      expect(hitTest({ x: 50, y: 5 }, strokeCtx(1))).not.toBeNull();
    });

    it('when zoomed out, a click 50 world units (5 screen px) off a stroke still hits', () => {
      expect(hitTest({ x: 50, y: 50 }, strokeCtx(0.1))).not.toBeNull();
    });

    it('when zoomed in, a click 5 world units (50 screen px) off a stroke misses', () => {
      expect(hitTest({ x: 50, y: 5 }, strokeCtx(10))).toBeNull();
    });

    it('arrow tolerance follows zoom too', () => {
      const ctx = makeCtx();
      ctx.camera.setZoom(0.1);
      ctx.store.add(
        createArrow({ from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, position: { x: 0, y: 0 } }),
      );
      expect(hitTest({ x: 50, y: 50 }, ctx)).not.toBeNull();
    });
  });
});
