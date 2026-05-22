// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ViewportHarness } from '../test-helpers/viewport-harness';
import { createViewportHarness } from '../test-helpers/viewport-harness';
import { drag } from '../test-helpers/pointer-helpers';
import type { TemplateTool } from '../tools/template-tool';

describe('Integration: grid & templates', () => {
  let h: ViewportHarness;

  beforeEach(() => {
    h = createViewportHarness();
  });

  afterEach(() => {
    h.cleanup();
  });

  describe('grid management', () => {
    it('adds a square grid', () => {
      h.viewport.addGrid({ gridType: 'square', cellSize: 50 });

      const grids = h.viewport.store.getElementsByType('grid');
      expect(grids).toHaveLength(1);
      expect(grids[0]?.gridType).toBe('square');
      expect(grids[0]?.cellSize).toBe(50);
    });

    it('adds a hex grid', () => {
      h.viewport.addGrid({ gridType: 'hex', hexOrientation: 'pointy', cellSize: 40 });

      const grids = h.viewport.store.getElementsByType('grid');
      expect(grids).toHaveLength(1);
      expect(grids[0]?.gridType).toBe('hex');
      expect(grids[0]?.hexOrientation).toBe('pointy');
    });

    it('replaces existing grid when adding a new one', () => {
      h.viewport.addGrid({ gridType: 'square', cellSize: 50 });
      h.viewport.addGrid({ gridType: 'hex', hexOrientation: 'flat', cellSize: 30 });

      const grids = h.viewport.store.getElementsByType('grid');
      expect(grids).toHaveLength(1);
      expect(grids[0]?.gridType).toBe('hex');
      expect(grids[0]?.cellSize).toBe(30);
    });

    it('updates grid properties', () => {
      h.viewport.addGrid({ gridType: 'square', cellSize: 50 });
      h.viewport.updateGrid({ cellSize: 80, strokeColor: '#ff0000' });

      const grids = h.viewport.store.getElementsByType('grid');
      expect(grids).toHaveLength(1);
      expect(grids[0]?.cellSize).toBe(80);
      expect(grids[0]?.strokeColor).toBe('#ff0000');
    });

    it('removes grid', () => {
      h.viewport.addGrid({ gridType: 'square', cellSize: 50 });
      expect(h.viewport.store.getElementsByType('grid')).toHaveLength(1);

      h.viewport.removeGrid();
      expect(h.viewport.store.getElementsByType('grid')).toHaveLength(0);
    });

    it('getGridInfo returns correct info', () => {
      expect(h.viewport.getGridInfo()).toBeNull();

      h.viewport.addGrid({ gridType: 'square', cellSize: 50 });
      const info = h.viewport.getGridInfo();
      expect(info).not.toBeNull();
      expect(info?.gridType).toBe('square');
      expect(info?.cellSize).toBe(50);
      expect(info?.cellRadius).toBe(25);
    });

    it('grid context syncs to tool context for snap-to-grid', () => {
      h.viewport.addGrid({ gridType: 'square', cellSize: 60 });

      expect(h.viewport.toolContext.gridType).toBe('square');
      expect(h.viewport.toolContext.gridSize).toBe(60);

      h.viewport.removeGrid();
      expect(h.viewport.toolContext.gridType).toBeUndefined();
    });
  });

  describe('template tool', () => {
    it('creates a circle template via drag', () => {
      h.viewport.addGrid({ gridType: 'square', cellSize: 50 });
      h.viewport.toolManager.setTool('template', h.viewport.toolContext);

      drag(h.wrapper, [200, 200], [400, 200]);

      const templates = h.viewport.store.getElementsByType('template');
      expect(templates).toHaveLength(1);
      expect(templates[0]?.templateShape).toBe('circle');
      expect(templates[0]?.radius).toBeGreaterThan(0);
    });

    it('creates a cone template', () => {
      h.viewport.addGrid({ gridType: 'square', cellSize: 50 });
      h.viewport.toolManager.setTool('template', h.viewport.toolContext);
      const templateTool = h.viewport.toolManager.getTool<TemplateTool>('template');
      templateTool?.setOptions({ templateShape: 'cone' });

      drag(h.wrapper, [200, 200], [400, 300]);

      const templates = h.viewport.store.getElementsByType('template');
      expect(templates).toHaveLength(1);
      expect(templates[0]?.templateShape).toBe('cone');
    });

    it('template radius snaps to grid units', () => {
      const cellSize = 50;
      h.viewport.addGrid({ gridType: 'square', cellSize });
      h.viewport.setSnapToGrid(true);
      h.viewport.toolManager.setTool('template', h.viewport.toolContext);

      drag(h.wrapper, [200, 200], [473, 200]);

      const templates = h.viewport.store.getElementsByType('template');
      expect(templates).toHaveLength(1);
      const radius = templates[0]?.radius ?? 0;
      expect(radius).toBeGreaterThan(0);
      expect(radius % cellSize).toBe(0);
    });

    it('template on hex grid works', () => {
      h.viewport.addGrid({ gridType: 'hex', hexOrientation: 'pointy', cellSize: 40 });
      h.viewport.toolManager.setTool('template', h.viewport.toolContext);

      drag(h.wrapper, [200, 200], [400, 200]);

      const templates = h.viewport.store.getElementsByType('template');
      expect(templates).toHaveLength(1);
      expect(templates[0]?.radius).toBeGreaterThan(0);
    });
  });
});
