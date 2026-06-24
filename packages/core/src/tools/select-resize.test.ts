// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { rotatePoint } from '../core/geometry';
import { createNote, createTemplate } from '../elements/element-factory';
import {
  anchorOffset,
  computeResize,
  computeRotatedResize,
  computeTemplateResize,
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
});

describe('computeRotatedResize', () => {
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
});

describe('computeTemplateResize', () => {
  it('sets radius from the pointer distance, clamped at MIN_ELEMENT_SIZE', () => {
    const tpl = createTemplate({
      position: { x: 0, y: 0 },
      templateShape: 'circle',
      radius: 100,
    });
    const patch = computeTemplateResize(tpl, { x: 30, y: 40 }, {});
    expect(patch).not.toBeNull();
    expect(patch?.radius).toBeCloseTo(50, 6);

    const small = computeTemplateResize(tpl, { x: 3, y: 4 }, {});
    expect(small?.radius).toBe(MIN_ELEMENT_SIZE);
  });
});
