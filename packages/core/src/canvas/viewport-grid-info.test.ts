// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Viewport } from './viewport';
import type { GridInfo } from './viewport';

function expectGridInfo(info: GridInfo | null): GridInfo {
  expect(info).not.toBeNull();
  return info as GridInfo;
}

describe('Viewport grid info API', () => {
  let container: HTMLDivElement;
  let viewport: Viewport;

  beforeEach(() => {
    container = document.createElement('div');
    Object.defineProperty(container, 'getBoundingClientRect', {
      value: () => ({
        x: 0,
        y: 0,
        width: 800,
        height: 600,
        top: 0,
        left: 0,
        right: 800,
        bottom: 600,
      }),
    });
    document.body.appendChild(container);
    viewport = new Viewport(container);
  });

  afterEach(() => {
    viewport.destroy();
    container.remove();
  });

  describe('getGridInfo', () => {
    it('returns null when no grid exists', () => {
      expect(viewport.getGridInfo()).toBeNull();
    });

    it('returns grid info for a square grid', () => {
      viewport.addGrid({ gridType: 'square', cellSize: 50 });

      const info = expectGridInfo(viewport.getGridInfo());
      expect(info.gridType).toBe('square');
      expect(info.cellSize).toBe(50);
      expect(info.cellRadius).toBe(25);
    });

    it('returns grid info for a pointy hex grid', () => {
      viewport.addGrid({ gridType: 'hex', hexOrientation: 'pointy', cellSize: 40 });

      const info = expectGridInfo(viewport.getGridInfo());
      expect(info.gridType).toBe('hex');
      expect(info.hexOrientation).toBe('pointy');
      expect(info.cellSize).toBe(40);
      expect(info.cellRadius).toBe(40);
    });

    it('returns grid info for a flat hex grid', () => {
      viewport.addGrid({ gridType: 'hex', hexOrientation: 'flat', cellSize: 30 });

      const info = expectGridInfo(viewport.getGridInfo());
      expect(info.gridType).toBe('hex');
      expect(info.hexOrientation).toBe('flat');
      expect(info.cellSize).toBe(30);
      expect(info.cellRadius).toBe(30);
    });

    it('returns null after grid is removed', () => {
      viewport.addGrid({ cellSize: 40 });
      expect(viewport.getGridInfo()).not.toBeNull();

      viewport.removeGrid();
      expect(viewport.getGridInfo()).toBeNull();
    });

    it('reflects updated grid properties', () => {
      viewport.addGrid({ gridType: 'square', cellSize: 40 });
      viewport.updateGrid({ cellSize: 60 });

      const info = expectGridInfo(viewport.getGridInfo());
      expect(info.cellSize).toBe(60);
      expect(info.cellRadius).toBe(30);
    });

    it('cellRadius is half cellSize for square grids', () => {
      viewport.addGrid({ gridType: 'square', cellSize: 80 });
      expect(expectGridInfo(viewport.getGridInfo()).cellRadius).toBe(40);
    });

    it('cellRadius equals cellSize (circumradius) for hex grids', () => {
      viewport.addGrid({ gridType: 'hex', cellSize: 50 });
      expect(expectGridInfo(viewport.getGridInfo()).cellRadius).toBe(50);
    });
  });

  describe('onGridChange', () => {
    it('fires when a grid is added', () => {
      const cb = vi.fn();
      viewport.onGridChange(cb);

      viewport.addGrid({ gridType: 'square', cellSize: 40 });

      expect(cb).toHaveBeenCalledTimes(1);
      const info: GridInfo = cb.mock.calls[0][0];
      expect(info.gridType).toBe('square');
      expect(info.cellSize).toBe(40);
    });

    it('fires with null when grid is removed', () => {
      viewport.addGrid({ cellSize: 40 });
      const cb = vi.fn();
      viewport.onGridChange(cb);

      viewport.removeGrid();

      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb.mock.calls[0][0]).toBeNull();
    });

    it('fires when grid properties change', () => {
      viewport.addGrid({ gridType: 'square', cellSize: 40 });
      const cb = vi.fn();
      viewport.onGridChange(cb);

      viewport.updateGrid({ cellSize: 80 });

      expect(cb).toHaveBeenCalledTimes(1);
      const info: GridInfo = cb.mock.calls[0][0];
      expect(info.cellSize).toBe(80);
    });

    it('does not fire for non-grid element changes', () => {
      const cb = vi.fn();
      viewport.onGridChange(cb);

      viewport.addImage('data:image/png;base64,', { x: 0, y: 0 });

      expect(cb).not.toHaveBeenCalled();
    });

    it('returns an unsubscribe function', () => {
      const cb = vi.fn();
      const unsub = viewport.onGridChange(cb);

      viewport.addGrid({ cellSize: 40 });
      expect(cb).toHaveBeenCalledTimes(1);

      unsub();
      viewport.updateGrid({ cellSize: 80 });
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('fires with null on store clear', () => {
      viewport.addGrid({ cellSize: 40 });
      const cb = vi.fn();
      viewport.onGridChange(cb);

      viewport.store.clear();

      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb.mock.calls[0][0]).toBeNull();
    });

    it('fires when grid type changes from square to hex', () => {
      viewport.addGrid({ gridType: 'square', cellSize: 40 });
      const cb = vi.fn();
      viewport.onGridChange(cb);

      viewport.updateGrid({ gridType: 'hex', hexOrientation: 'pointy' });

      expect(cb).toHaveBeenCalledTimes(1);
      const info: GridInfo = cb.mock.calls[0][0];
      expect(info.gridType).toBe('hex');
      expect(info.cellRadius).toBe(40);
    });
  });
});
