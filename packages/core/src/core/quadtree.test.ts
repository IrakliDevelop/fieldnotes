import { describe, it, expect } from 'vitest';
import { Quadtree } from './quadtree';

describe('Quadtree', () => {
  const worldBounds = { x: -1000, y: -1000, w: 2000, h: 2000 };

  describe('insert and query', () => {
    it('inserts and queries a single item', () => {
      const qt = new Quadtree(worldBounds);
      qt.insert('a', { x: 10, y: 10, w: 20, h: 20 });
      expect(qt.query({ x: 0, y: 0, w: 50, h: 50 })).toEqual(['a']);
    });

    it('returns empty array when no items match', () => {
      const qt = new Quadtree(worldBounds);
      qt.insert('a', { x: 10, y: 10, w: 20, h: 20 });
      expect(qt.query({ x: 500, y: 500, w: 10, h: 10 })).toEqual([]);
    });

    it('returns multiple matching items', () => {
      const qt = new Quadtree(worldBounds);
      qt.insert('a', { x: 0, y: 0, w: 10, h: 10 });
      qt.insert('b', { x: 5, y: 5, w: 10, h: 10 });
      qt.insert('c', { x: 500, y: 500, w: 10, h: 10 });
      const result = qt.query({ x: 0, y: 0, w: 20, h: 20 });
      expect(result.sort()).toEqual(['a', 'b']);
    });

    it('handles items that span multiple quadrants', () => {
      const qt = new Quadtree(worldBounds);
      qt.insert('big', { x: -50, y: -50, w: 100, h: 100 });
      expect(qt.query({ x: -10, y: -10, w: 20, h: 20 })).toEqual(['big']);
      expect(qt.query({ x: 30, y: 30, w: 10, h: 10 })).toEqual(['big']);
    });

    it('handles touching edges', () => {
      const qt = new Quadtree(worldBounds);
      qt.insert('a', { x: 0, y: 0, w: 10, h: 10 });
      expect(qt.query({ x: 10, y: 0, w: 10, h: 10 })).toEqual(['a']);
    });
  });

  describe('queryPoint', () => {
    it('returns items containing the point', () => {
      const qt = new Quadtree(worldBounds);
      qt.insert('a', { x: 0, y: 0, w: 50, h: 50 });
      qt.insert('b', { x: 100, y: 100, w: 50, h: 50 });
      expect(qt.queryPoint({ x: 25, y: 25 })).toEqual(['a']);
    });

    it('returns empty array for miss', () => {
      const qt = new Quadtree(worldBounds);
      qt.insert('a', { x: 0, y: 0, w: 50, h: 50 });
      expect(qt.queryPoint({ x: 200, y: 200 })).toEqual([]);
    });
  });

  describe('remove', () => {
    it('removes an item so it no longer appears in queries', () => {
      const qt = new Quadtree(worldBounds);
      qt.insert('a', { x: 0, y: 0, w: 10, h: 10 });
      qt.remove('a');
      expect(qt.query({ x: 0, y: 0, w: 50, h: 50 })).toEqual([]);
      expect(qt.size).toBe(0);
    });

    it('does not affect other items', () => {
      const qt = new Quadtree(worldBounds);
      qt.insert('a', { x: 0, y: 0, w: 10, h: 10 });
      qt.insert('b', { x: 5, y: 5, w: 10, h: 10 });
      qt.remove('a');
      expect(qt.query({ x: 0, y: 0, w: 50, h: 50 })).toEqual(['b']);
    });

    it('is a no-op for non-existent id', () => {
      const qt = new Quadtree(worldBounds);
      qt.insert('a', { x: 0, y: 0, w: 10, h: 10 });
      qt.remove('nonexistent');
      expect(qt.size).toBe(1);
    });
  });

  describe('update', () => {
    it('moves an item to new bounds', () => {
      const qt = new Quadtree(worldBounds);
      qt.insert('a', { x: 0, y: 0, w: 10, h: 10 });
      qt.update('a', { x: 500, y: 500, w: 10, h: 10 });
      expect(qt.query({ x: 0, y: 0, w: 50, h: 50 })).toEqual([]);
      expect(qt.query({ x: 490, y: 490, w: 30, h: 30 })).toEqual(['a']);
    });
  });

  describe('clear', () => {
    it('removes all items', () => {
      const qt = new Quadtree(worldBounds);
      qt.insert('a', { x: 0, y: 0, w: 10, h: 10 });
      qt.insert('b', { x: 50, y: 50, w: 10, h: 10 });
      qt.clear();
      expect(qt.size).toBe(0);
      expect(qt.query({ x: -1000, y: -1000, w: 2000, h: 2000 })).toEqual([]);
    });
  });

  describe('size', () => {
    it('tracks insert/remove correctly', () => {
      const qt = new Quadtree(worldBounds);
      expect(qt.size).toBe(0);
      qt.insert('a', { x: 0, y: 0, w: 10, h: 10 });
      expect(qt.size).toBe(1);
      qt.insert('b', { x: 50, y: 50, w: 10, h: 10 });
      expect(qt.size).toBe(2);
      qt.remove('a');
      expect(qt.size).toBe(1);
    });
  });

  describe('degenerate cases', () => {
    it('handles many items at the same position', () => {
      const qt = new Quadtree(worldBounds);
      for (let i = 0; i < 20; i++) {
        qt.insert(`el-${i}`, { x: 0, y: 0, w: 10, h: 10 });
      }
      expect(qt.size).toBe(20);
      const results = qt.query({ x: -1, y: -1, w: 12, h: 12 });
      expect(results.length).toBe(20);
    });

    it('handles items spanning the entire tree bounds', () => {
      const qt = new Quadtree(worldBounds);
      qt.insert('huge', { x: -999, y: -999, w: 1998, h: 1998 });
      expect(qt.query({ x: 0, y: 0, w: 1, h: 1 })).toEqual(['huge']);
    });

    it('handles zero-size bounds', () => {
      const qt = new Quadtree(worldBounds);
      qt.insert('point', { x: 50, y: 50, w: 0, h: 0 });
      expect(qt.queryPoint({ x: 50, y: 50 })).toEqual(['point']);
    });
  });

  describe('node splitting', () => {
    it('handles more items than MAX_ITEMS without error', () => {
      const qt = new Quadtree(worldBounds);
      for (let i = 0; i < 50; i++) {
        qt.insert(`el-${i}`, { x: i * 20 - 500, y: i * 20 - 500, w: 10, h: 10 });
      }
      expect(qt.size).toBe(50);
      const results = qt.query({ x: -510, y: -510, w: 30, h: 30 });
      expect(results.length).toBeLessThan(50);
      expect(results.length).toBeGreaterThan(0);
    });
  });
});
