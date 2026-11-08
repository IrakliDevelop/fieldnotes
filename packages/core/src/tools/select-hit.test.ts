// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import {
  rectsOverlap,
  isInsideBounds,
  hitTestResizeHandle,
  hitTest,
  hitTestExtensionHandle,
  hitTestRotateHandle,
  hitTestLineHandles,
  findElementsInRect,
} from './select-hit';
import { ElementStore } from '../elements/element-store';
import { Camera } from '../canvas/camera';
import {
  createNote,
  createStroke,
  createArrow,
  createShape,
  createText,
} from '../elements/element-factory';
import { createBoundText } from '../elements/bound-text';
import { createFrame } from '../elements/frame-element';
import type { ToolContext } from './types';
import { ElementRegistry } from '../elements/element-registry';
import type { ExtensionElementEnvelope } from '../elements/types';
import { ConstraintServiceProxy } from '../core/constraint-service';
import { getOverlayLayout } from './select-overlay';

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    camera: new Camera(),
    store: new ElementStore(),
    requestRender: vi.fn(),
    requestOverlayRender: vi.fn(),
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
  it('selects a bound text child as its rectangle and excludes it from a marquee', () => {
    const ctx = makeCtx();
    const rectangle = createShape({
      shape: 'rectangle',
      position: { x: 20, y: 30 },
      size: { w: 160, h: 100 },
    });
    const text = { ...createBoundText(rectangle, { text: 'Bound text' }), size: { w: 80, h: 20 } };
    ctx.store.add(rectangle);
    ctx.store.add(text);

    expect(
      hitTest({ x: text.position.x + text.size.w / 2, y: text.position.y + text.size.h / 2 }, ctx)
        ?.id,
    ).toBe(rectangle.id);
    expect(findElementsInRect({ x: 0, y: 0, w: 240, h: 180 }, ctx)).toEqual([rectangle.id]);
  });

  it('maps actual bound text through locked layers but leaves advisory text independent', () => {
    const rectangle = createShape({
      shape: 'rectangle',
      position: { x: 0, y: 0 },
      size: { w: 100, h: 80 },
    });
    const bound = {
      ...createBoundText(rectangle, { text: 'bound', index: 'a' }),
      size: { w: 40, h: 20 },
    };
    const mismatched = createText({
      position: { x: 120, y: 0 },
      size: { w: 40, h: 20 },
      parentId: rectangle.id,
    });
    const extra = {
      ...createBoundText(rectangle, { text: 'extra', index: 'z' }),
      position: { x: 180, y: 0 },
      size: { w: 40, h: 20 },
    };
    const ctx = makeCtx({ isLayerLocked: (id) => id === 'locked' });
    rectangle.layerId = 'locked';
    bound.layerId = 'locked';
    mismatched.layerId = 'locked';
    extra.layerId = 'locked';
    ctx.store.add(rectangle);
    ctx.store.add(bound);
    ctx.store.add(mismatched);
    ctx.store.add(extra);
    const point = {
      x: bound.position.x + bound.size.w / 2,
      y: bound.position.y + bound.size.h / 2,
    };
    expect(hitTest(point, ctx)).toBeNull();
    ctx.isLayerLocked = () => false;
    expect(hitTest(point, ctx)?.id).toBe(rectangle.id);
    expect(hitTest({ x: 140, y: 10 }, ctx)?.id).toBe(mismatched.id);
    expect(hitTest({ x: 200, y: 10 }, ctx)?.id).toBe(extra.id);
    expect(findElementsInRect({ x: 0, y: 0, w: 240, h: 80 }, ctx)).toEqual([
      rectangle.id,
      mismatched.id,
      extra.id,
    ]);
  });

  it('skips a bound arrow inside its source and hits its visible curve', () => {
    const ctx = makeCtx();
    const from = createShape({
      shape: 'rectangle',
      position: { x: 0, y: 0 },
      size: { w: 100, h: 100 },
    });
    const to = createShape({
      shape: 'rectangle',
      position: { x: 300, y: 0 },
      size: { w: 100, h: 100 },
    });
    const arrow = createArrow({
      from: { x: 50, y: 50 },
      to: { x: 350, y: 50 },
      bend: 60,
      fromBinding: { elementId: from.id },
      toBinding: { elementId: to.id },
    });
    arrow.cachedControlPoint = { x: 200, y: -200 };
    ctx.store.add(from);
    ctx.store.add(to);
    ctx.store.add(arrow);

    expect(hitTest({ x: 80, y: 60.8 }, ctx)?.id).toBe(from.id);
    expect(hitTest({ x: 140, y: 75.2 }, ctx)?.id).toBe(arrow.id);
  });

  it('hits a detour and misses the obsolete chord', () => {
    const ctx = makeCtx();
    const arrow = createArrow({
      from: { x: 0, y: 0 },
      to: { x: 200, y: 100 },
      routing: 'elbow',
      fixedSegments: [{ axis: 'x', value: 80 }],
    });
    const blocker = createShape({
      shape: 'rectangle',
      position: { x: 90, y: 20 },
      size: { w: 40, h: 40 },
    });
    ctx.store.add(blocker);
    ctx.store.add(arrow);

    expect(hitTest({ x: 80, y: 75 }, ctx)?.id).toBe(arrow.id);
    expect(hitTest({ x: 130, y: 65 }, ctx)).toBeNull();
  });

  it('falls through a clipped top candidate to the lower visible element', () => {
    const ctx = makeCtx();
    const lower = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 100 }, index: 'a' });
    const upper = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 100 }, index: 'b' });
    ctx.store.add(lower);
    ctx.store.add(upper);
    vi.spyOn(ctx.store, 'getEffectiveClip').mockImplementation((id) =>
      id === upper.id ? { x: 50, y: 50, w: 10, h: 10 } : null,
    );
    expect(hitTest({ x: 10, y: 10 }, ctx)?.id).toBe(lower.id);
  });
  it('rejects a raw body hit outside its effective ancestor clip', () => {
    const element = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 100 } });
    const store = new ElementStore();
    store.add(element);
    const ctx = makeCtx({ store });
    vi.spyOn(store, 'getEffectiveClip').mockReturnValue({ x: 10, y: 10, w: 20, h: 20 });
    expect(isInsideBounds({ x: 5, y: 5 }, element)).toBe(true);
    expect(isInsideBounds({ x: 5, y: 5 }, element, ctx)).toBe(false);
    expect(isInsideBounds({ x: 15, y: 15 }, element, ctx)).toBe(true);
  });
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
      index: 'a0',
      version: 1,
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

  it('lets a candidate beneath a frame win inside its transparent content', () => {
    const ctx = makeCtx();
    const note = createNote({ position: { x: 40, y: 60 }, size: { w: 40, h: 40 }, index: 'a' });
    const frame = createFrame({ position: { x: 10, y: 20 }, size: { w: 120, h: 90 }, index: 'b' });
    ctx.store.add(note);
    ctx.store.add(frame);

    expect(hitTest({ x: 60, y: 80 }, ctx)?.id).toBe(note.id);
    expect(hitTest({ x: 60, y: 30 }, ctx)?.id).toBe(frame.id);
  });
});

describe('hitTestResizeHandle', () => {
  it('does not expose a rotate handle for a frame', () => {
    const ctx = makeCtx();
    const frame = createFrame({ position: { x: 10, y: 20 }, size: { w: 120, h: 90 } });
    ctx.store.add(frame);
    const rotateHandle = getOverlayLayout(frame, 1, ctx.elementRegistry)?.rotateHandle;
    if (!rotateHandle) throw new Error('Missing frame overlay');

    expect(hitTestRotateHandle(rotateHandle, ctx, [frame.id])).toBeNull();
  });

  it('rejects resize, rotate, line, extension and marquee geometry outside a clip', () => {
    const ctx = makeCtx();
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 100 } });
    const line = createShape({ position: { x: 0, y: 0 }, size: { w: 100, h: 0 }, shape: 'line' });
    ctx.store.add(note);
    ctx.store.add(line);
    vi.spyOn(ctx.store, 'getEffectiveClip').mockReturnValue({ x: 40, y: 40, w: 20, h: 20 });
    expect(hitTestResizeHandle({ x: 100, y: 100 }, ctx, [note.id])).toBeNull();
    expect(hitTestRotateHandle({ x: 50, y: -20 }, ctx, [note.id])).toBeNull();
    expect(hitTestLineHandles({ x: 0, y: 0 }, ctx, [line.id])).toBeNull();
    expect(findElementsInRect({ x: 0, y: 0, w: 20, h: 20 }, ctx)).toEqual([]);
    expect(findElementsInRect({ x: 45, y: 45, w: 10, h: 10 }, ctx)).toEqual([note.id]);
  });
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

describe('hitTestExtensionHandle', () => {
  it.each([
    [24, 24],
    [Number.NaN, undefined],
    [Number.POSITIVE_INFINITY, undefined],
    [0, undefined],
    [-24, undefined],
  ])('passes normalized snap size %s to extension handles', (snapStep, expectedSize) => {
    const registry = new ElementRegistry();
    const hitTestHandle = vi.fn(() => ({ id: 'resize', cursor: 'nwse-resize' }));
    registry.register<ExtensionElementEnvelope>({
      type: 'test:handles',
      legacyTypes: [],
      decodeLegacy: (raw) => raw as unknown as ExtensionElementEnvelope,
      validateData: () => true,
      unwrap: (element) => element,
      wrap: (element) => element,
      bounds: () => ({ x: 0, y: 0, w: 100, h: 100 }),
      interaction: { hitTestHandle },
      renderMode: 'canvas',
    });
    const constraintService = new ConstraintServiceProxy();
    constraintService.setImplementation({
      constrainPoint: (point) => point,
      getConstraintInfo: () => ({ type: 'test-mode', snapStep }),
      hasCapability: () => false,
    });
    constraintService.setActive(true);
    const element: ExtensionElementEnvelope = {
      id: 'ext',
      type: 'extension',
      extensionType: 'test:handles',
      position: { x: 0, y: 0 },
      index: 'a0',
      version: 1,
      locked: false,
      layerId: '',
      data: {},
    };
    const ctx = makeCtx({ elementRegistry: registry, constraintService });
    ctx.store.setElementRegistry(registry);
    ctx.store.add(element);

    expect(hitTestExtensionHandle({ x: 0, y: 0 }, ctx, [element.id], false)).toEqual({
      elementId: element.id,
      handleId: 'resize',
      cursor: 'nwse-resize',
    });
    expect(hitTestHandle).toHaveBeenCalledWith(
      element,
      { x: 0, y: 0 },
      expect.objectContaining({
        snap: { enabled: true, size: expectedSize, mode: 'test-mode' },
      }),
    );
  });
});
