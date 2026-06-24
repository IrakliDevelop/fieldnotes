// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { rectsOverlap, isInsideBounds, hitTestResizeHandle } from './select-hit';
import { ElementStore } from '../elements/element-store';
import { Camera } from '../canvas/camera';
import { createNote } from '../elements/element-factory';
import type { ToolContext } from './types';

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
});

describe('hitTestResizeHandle', () => {
  it('returns null for a locked selected element', () => {
    const ctx = makeCtx();
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 200, h: 100 }, locked: true });
    ctx.store.add(note);
    expect(hitTestResizeHandle({ x: 200, y: 100 }, ctx, [note.id])).toBeNull();
  });
});
