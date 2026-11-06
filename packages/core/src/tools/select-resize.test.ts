// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { rotatePoint } from '../core/geometry';
import { createNote } from '../elements/element-factory';
import {
  anchorOffset,
  computeResize,
  computeRotatedResize,
  MIN_ELEMENT_SIZE,
} from './select-resize';

describe('anchorOffset', () => {
  it('returns the opposite corner for each handle', () => {
    const w = 100;
    const h = 60;
    expect(anchorOffset('se', w, h)).toEqual({ x: -w / 2, y: -h / 2 });
    expect(anchorOffset('sw', w, h)).toEqual({ x: w / 2, y: -h / 2 });
    expect(anchorOffset('ne', w, h)).toEqual({ x: -w / 2, y: h / 2 });
    expect(anchorOffset('nw', w, h)).toEqual({ x: w / 2, y: h / 2 });
  });
});

describe('computeResize', () => {
  it('grows w/h on an se drag', () => {
    const note = createNote({ position: { x: 100, y: 100 }, size: { w: 200, h: 100 } });
    const patch = computeResize(note, 'se', { x: 350, y: 250 }, { x: 300, y: 200 }, 0, false);
    expect(patch.position).toEqual({ x: 100, y: 100 });
    expect(patch.size).toEqual({ w: 250, h: 150 });
  });

  it('clamps at MIN_ELEMENT_SIZE on a shrinking se drag', () => {
    const note = createNote({ position: { x: 100, y: 100 }, size: { w: 200, h: 100 } });
    const patch = computeResize(note, 'se', { x: 0, y: 0 }, { x: 300, y: 200 }, 0, false);
    expect(patch.size).toEqual({ w: MIN_ELEMENT_SIZE, h: MIN_ELEMENT_SIZE });
  });

  it('clamps a narrowed nw resize to its rewrapped height without moving the bottom corner', () => {
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 60 } });
    const minHeight = (width: number) => (width === 60 ? 120 : MIN_ELEMENT_SIZE);

    const patch = computeResize(note, 'nw', { x: 40, y: 40 }, { x: 0, y: 0 }, 0, false, minHeight);

    expect(patch).toEqual({ position: { x: 40, y: -60 }, size: { w: 60, h: 120 } });
  });

  for (const [handle, world, lastWorld, expected, fixed] of [
    ['se', { x: 100, y: -100 }, { x: 100, y: 60 }, { x: 0, y: 0 }, { x: 0, y: 0 }],
    ['sw', { x: 0, y: -100 }, { x: 0, y: 60 }, { x: 0, y: 0 }, { x: 100, y: 0 }],
    ['ne', { x: 100, y: 160 }, { x: 100, y: 0 }, { x: 0, y: -60 }, { x: 0, y: 60 }],
    ['nw', { x: 0, y: 160 }, { x: 0, y: 0 }, { x: 0, y: -60 }, { x: 100, y: 60 }],
  ] as const) {
    it(`keeps the opposite corner fixed at the bound-text height (${handle})`, () => {
      const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 60 } });
      const patch = computeResize(note, handle, world, lastWorld, 0, false, () => 120);
      const afterFixed = {
        se: { x: patch.position.x, y: patch.position.y },
        sw: { x: patch.position.x + patch.size.w, y: patch.position.y },
        ne: { x: patch.position.x, y: patch.position.y + patch.size.h },
        nw: { x: patch.position.x + patch.size.w, y: patch.position.y + patch.size.h },
      }[handle];

      expect(patch).toEqual({ position: expected, size: { w: 100, h: 120 } });
      expect(afterFixed).toEqual(fixed);
    });
  }
});

describe('computeRotatedResize', () => {
  it('clamps a narrowed nw resize and preserves its rotated opposite corner', () => {
    const angle = Math.PI / 4;
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 60 } });
    const oldCenter = { x: 50, y: 30 };
    const anchor = rotatePoint({ x: 100, y: 60 }, oldCenter, angle);
    const patch = computeRotatedResize(
      note,
      'nw',
      angle,
      { x: 40 / Math.SQRT2, y: 40 / Math.SQRT2 },
      { x: 0, y: 0 },
      0,
      false,
      (width) => (width === 60 ? 120 : MIN_ELEMENT_SIZE),
    );
    const center = {
      x: patch.position.x + patch.size.w / 2,
      y: patch.position.y + patch.size.h / 2,
    };
    const after = rotatePoint(
      { x: patch.position.x + patch.size.w, y: patch.position.y + patch.size.h },
      center,
      angle,
    );

    expect(patch.size).toEqual({ w: 60, h: 120 });
    expect(after.x).toBeCloseTo(anchor.x);
    expect(after.y).toBeCloseTo(anchor.y);
  });
  for (const handle of ['nw', 'ne', 'sw', 'se'] as const) {
    it(`keeps the opposite corner fixed in world space (${handle})`, () => {
      const angle = Math.PI / 6; // 30°
      const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 100 } });
      note.rotation = angle;

      const center0 = {
        x: note.position.x + note.size.w / 2,
        y: note.position.y + note.size.h / 2,
      };
      const { x, y } = note.position;
      const { w, h } = note.size;
      const fixedCornerLocal: Record<typeof handle, { x: number; y: number }> = {
        se: { x, y },
        sw: { x: x + w, y },
        nw: { x: x + w, y: y + h },
        ne: { x, y: y + h },
      };
      const anchorWorld = rotatePoint(fixedCornerLocal[handle], center0, angle);

      // the grabbed corner in world space
      const cornerLocal: Record<typeof handle, { x: number; y: number }> = {
        nw: { x, y },
        ne: { x: x + w, y },
        sw: { x, y: y + h },
        se: { x: x + w, y: y + h },
      };
      const grab = rotatePoint(cornerLocal[handle], center0, angle);
      const outward = {
        x: grab.x + (grab.x - center0.x) * 0.3,
        y: grab.y + (grab.y - center0.y) * 0.3,
      };

      const patch = computeRotatedResize(note, handle, angle, outward, grab, 0, false);

      const center1 = {
        x: patch.position.x + patch.size.w / 2,
        y: patch.position.y + patch.size.h / 2,
      };
      const fixedCornerLocalAfter: Record<typeof handle, { x: number; y: number }> = {
        se: { x: patch.position.x, y: patch.position.y },
        sw: { x: patch.position.x + patch.size.w, y: patch.position.y },
        nw: { x: patch.position.x + patch.size.w, y: patch.position.y + patch.size.h },
        ne: { x: patch.position.x, y: patch.position.y + patch.size.h },
      };
      const anchorAfter = rotatePoint(fixedCornerLocalAfter[handle], center1, angle);
      expect(anchorAfter.x).toBeCloseTo(anchorWorld.x, 4);
      expect(anchorAfter.y).toBeCloseTo(anchorWorld.y, 4);
      expect(patch.size.w).toBeGreaterThan(note.size.w);
      expect(patch.size.h).toBeGreaterThan(note.size.h);
    });
  }

  for (const handle of ['nw', 'ne', 'sw', 'se'] as const) {
    it(`keeps the rotated opposite corner fixed at the bound-text height (${handle})`, () => {
      const angle = Math.PI / 5;
      const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 60 } });
      const center = { x: 50, y: 30 };
      const oppositeCorner = {
        se: { x: 0, y: 0 },
        sw: { x: 100, y: 0 },
        ne: { x: 0, y: 60 },
        nw: { x: 100, y: 60 },
      }[handle];
      const fixed = rotatePoint(oppositeCorner, center, angle);
      const localDelta = handle === 'ne' || handle === 'nw' ? { x: 0, y: 100 } : { x: 0, y: -100 };
      const world = {
        x: 100 + localDelta.x * Math.cos(angle) - localDelta.y * Math.sin(angle),
        y: 60 + localDelta.x * Math.sin(angle) + localDelta.y * Math.cos(angle),
      };
      const patch = computeRotatedResize(
        note,
        handle,
        angle,
        world,
        { x: 100, y: 60 },
        0,
        false,
        () => 120,
      );
      const afterCenter = {
        x: patch.position.x + patch.size.w / 2,
        y: patch.position.y + patch.size.h / 2,
      };
      const afterOpposite = {
        se: { x: patch.position.x, y: patch.position.y },
        sw: { x: patch.position.x + patch.size.w, y: patch.position.y },
        ne: { x: patch.position.x, y: patch.position.y + patch.size.h },
        nw: { x: patch.position.x + patch.size.w, y: patch.position.y + patch.size.h },
      }[handle];
      const afterFixed = rotatePoint(afterOpposite, afterCenter, angle);

      expect(patch.size).toEqual({ w: 100, h: 120 });
      expect(afterFixed.x).toBeCloseTo(fixed.x, 6);
      expect(afterFixed.y).toBeCloseTo(fixed.y, 6);
    });
  }
});
