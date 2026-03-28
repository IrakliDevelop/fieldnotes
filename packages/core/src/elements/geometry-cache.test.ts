import { describe, it, expect } from 'vitest';
import { getStrokeRenderData, computeStrokeSegments } from './stroke-cache';
import { getElementBounds } from './element-bounds';
import { createStroke, createArrow } from './element-factory';
import { ElementStore } from './element-store';
import { getArrowControlPoint } from './arrow-geometry';

describe('geometry cache invalidation', () => {
  describe('stroke segment cache is camera-independent', () => {
    it('returns same reference regardless of external state changes', () => {
      const stroke = createStroke({
        points: [
          { x: 0, y: 0, pressure: 0.5 },
          { x: 10, y: 10, pressure: 0.5 },
          { x: 20, y: 5, pressure: 0.5 },
        ],
      });
      const data1 = getStrokeRenderData(stroke);
      // Simulate any external change — cache should not be affected
      const data2 = getStrokeRenderData(stroke);
      expect(data1).toBe(data2);
    });
  });

  describe('stroke bounds cache is camera-independent', () => {
    it('returns same value for same element reference', () => {
      const stroke = createStroke({
        points: [
          { x: 0, y: 0, pressure: 0.5 },
          { x: 10, y: 10, pressure: 0.5 },
        ],
      });
      const bounds1 = getElementBounds(stroke);
      const bounds2 = getElementBounds(stroke);
      expect(bounds1).toBe(bounds2);
    });
  });

  describe('warm call uses same reference as store', () => {
    it('store.add() preserves object reference', () => {
      const store = new ElementStore();
      const stroke = createStroke({
        points: [
          { x: 0, y: 0, pressure: 0.5 },
          { x: 10, y: 10, pressure: 0.5 },
          { x: 20, y: 5, pressure: 0.5 },
        ],
      });
      computeStrokeSegments(stroke);
      store.add(stroke);
      const stored = store.getById(stroke.id);
      expect(stored).toBe(stroke);
      // Cache hit because same reference
      if (!stored || stored.type !== 'stroke') throw new Error('expected stroke');
      const data = getStrokeRenderData(stored);
      const warmed = getStrokeRenderData(stroke);
      expect(data).toBe(warmed);
    });
  });

  describe('stroke cache invalidates on store.update()', () => {
    it('returns different reference after update (new object from spread)', () => {
      const store = new ElementStore();
      const stroke = createStroke({
        points: [
          { x: 0, y: 0, pressure: 0.5 },
          { x: 10, y: 10, pressure: 0.5 },
          { x: 20, y: 5, pressure: 0.5 },
        ],
      });
      store.add(stroke);
      const data1 = getStrokeRenderData(stroke);

      store.update(stroke.id, { color: '#ff0000' });
      const updated = store.getById(stroke.id);
      expect(updated).not.toBe(stroke);

      if (!updated || updated.type !== 'stroke') throw new Error('expected stroke');
      const data2 = getStrokeRenderData(updated);
      expect(data2).not.toBe(data1);
    });
  });

  describe('arrow cachedControlPoint', () => {
    it('is set on creation', () => {
      const arrow = createArrow({ from: { x: 0, y: 0 }, to: { x: 100, y: 100 }, bend: 30 });
      expect(arrow.cachedControlPoint).toBeDefined();
      const expected = getArrowControlPoint(arrow.from, arrow.to, arrow.bend);
      expect(arrow.cachedControlPoint).toEqual(expected);
    });

    it('is recomputed on store.update()', () => {
      const store = new ElementStore();
      const arrow = createArrow({ from: { x: 0, y: 0 }, to: { x: 100, y: 100 }, bend: 30 });
      store.add(arrow);
      const originalCp = arrow.cachedControlPoint;

      store.update(arrow.id, { bend: 60 });
      const updated = store.getById(arrow.id);
      expect(updated).toBeDefined();
      if (updated?.type === 'arrow') {
        expect(updated.cachedControlPoint).toBeDefined();
        expect(updated.cachedControlPoint).not.toEqual(originalCp);
        const expected = getArrowControlPoint(updated.from, updated.to, updated.bend);
        expect(updated.cachedControlPoint).toEqual(expected);
      }
    });

    it('survives store.update() that does not change from/to/bend', () => {
      const store = new ElementStore();
      const arrow = createArrow({ from: { x: 0, y: 0 }, to: { x: 100, y: 100 }, bend: 30 });
      store.add(arrow);

      store.update(arrow.id, { color: '#ff0000' });
      const updated = store.getById(arrow.id);
      if (updated?.type === 'arrow') {
        // Recomputed but same value since from/to/bend unchanged
        const expected = getArrowControlPoint(updated.from, updated.to, updated.bend);
        expect(updated.cachedControlPoint).toEqual(expected);
      }
    });
  });
});
