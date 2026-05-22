// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ViewportHarness } from '../test-helpers/viewport-harness';
import { createViewportHarness } from '../test-helpers/viewport-harness';
import { drag, tap } from '../test-helpers/pointer-helpers';
import type { SelectTool } from '../tools/select-tool';

describe('Integration: editing tools', () => {
  let h: ViewportHarness;

  beforeEach(() => {
    h = createViewportHarness();
  });

  afterEach(() => {
    h.cleanup();
  });

  describe('select tool', () => {
    it('selects an element on click', () => {
      const id = h.viewport.addImage(
        'data:image/png;base64,abc',
        { x: 100, y: 100 },
        { w: 200, h: 150 },
      );

      h.viewport.toolManager.setTool('select', h.viewport.toolContext);
      tap(h.wrapper, 200, 175);

      const selectTool = h.viewport.toolManager.getTool<SelectTool>('select');
      expect(selectTool?.selectedIds).toContain(id);
    });

    it('clicking empty space deselects', () => {
      h.viewport.addImage('data:image/png;base64,abc', { x: 100, y: 100 }, { w: 200, h: 150 });

      h.viewport.toolManager.setTool('select', h.viewport.toolContext);
      tap(h.wrapper, 200, 175);

      const selectTool = h.viewport.toolManager.getTool<SelectTool>('select');
      expect(selectTool?.selectedIds.length).toBeGreaterThan(0);

      tap(h.wrapper, 10, 10);

      expect(selectTool?.selectedIds).toHaveLength(0);
    });

    it('moves selected element by dragging', () => {
      h.viewport.addImage('data:image/png;base64,abc', { x: 100, y: 100 }, { w: 200, h: 150 });

      h.viewport.toolManager.setTool('select', h.viewport.toolContext);
      tap(h.wrapper, 200, 175);

      const images = h.viewport.store.getElementsByType('image');
      const originalX = images[0]?.position.x ?? 0;
      const originalY = images[0]?.position.y ?? 0;

      drag(h.wrapper, [200, 175], [300, 275], 10);

      const moved = h.viewport.store.getElementsByType('image');
      const newX = moved[0]?.position.x ?? 0;
      const newY = moved[0]?.position.y ?? 0;
      expect(newX).toBeGreaterThan(originalX);
      expect(newY).toBeGreaterThan(originalY);
    });

    it('marquee select captures multiple elements', () => {
      h.viewport.addImage('data:image/png;base64,abc', { x: 50, y: 50 }, { w: 80, h: 80 });
      h.viewport.addImage('data:image/png;base64,def', { x: 200, y: 50 }, { w: 80, h: 80 });

      h.viewport.toolManager.setTool('select', h.viewport.toolContext);
      drag(h.wrapper, [10, 10], [350, 200]);

      const selectTool = h.viewport.toolManager.getTool<SelectTool>('select');
      expect(selectTool?.selectedIds).toHaveLength(2);
    });

    it('delete key removes selected element', () => {
      const id = h.viewport.addImage(
        'data:image/png;base64,abc',
        { x: 100, y: 100 },
        { w: 200, h: 150 },
      );

      h.viewport.toolManager.setTool('select', h.viewport.toolContext);
      tap(h.wrapper, 200, 175);

      const selectTool = h.viewport.toolManager.getTool<SelectTool>('select');
      expect(selectTool?.selectedIds).toContain(id);

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));

      expect(h.viewport.store.getById(id)).toBeUndefined();
    });

    it('does not select elements on hidden layers', () => {
      const defaultLayerId = h.viewport.layerManager.activeLayerId;
      const id = h.viewport.addImage(
        'data:image/png;base64,abc',
        { x: 100, y: 100 },
        { w: 200, h: 150 },
      );

      const layer2 = h.viewport.layerManager.createLayer('Layer 2');
      h.viewport.layerManager.setActiveLayer(layer2.id);
      h.viewport.layerManager.setLayerVisible(defaultLayerId, false);

      h.viewport.toolManager.setTool('select', h.viewport.toolContext);
      tap(h.wrapper, 200, 175);

      const selectTool = h.viewport.toolManager.getTool<SelectTool>('select');
      expect(selectTool?.selectedIds).not.toContain(id);
      expect(selectTool?.selectedIds).toHaveLength(0);
    });

    it('does not select elements on locked layers', () => {
      const defaultLayerId = h.viewport.layerManager.activeLayerId;
      const id = h.viewport.addImage(
        'data:image/png;base64,abc',
        { x: 100, y: 100 },
        { w: 200, h: 150 },
      );

      const layer2 = h.viewport.layerManager.createLayer('Layer 2');
      h.viewport.layerManager.setActiveLayer(layer2.id);
      h.viewport.layerManager.setLayerLocked(defaultLayerId, true);

      h.viewport.toolManager.setTool('select', h.viewport.toolContext);
      tap(h.wrapper, 200, 175);

      const selectTool = h.viewport.toolManager.getTool<SelectTool>('select');
      expect(selectTool?.selectedIds).not.toContain(id);
      expect(selectTool?.selectedIds).toHaveLength(0);
    });
  });

  describe('eraser tool', () => {
    it('erases strokes that fall within eraser radius', () => {
      h.viewport.toolManager.setTool('pencil', h.viewport.toolContext);
      drag(h.wrapper, [100, 100], [300, 100], 10);

      const strokesBefore = h.viewport.store.getElementsByType('stroke');
      expect(strokesBefore).toHaveLength(1);

      h.viewport.toolManager.setTool('eraser', h.viewport.toolContext);
      drag(h.wrapper, [120, 100], [280, 100], 10);

      const strokesAfter = h.viewport.store.getElementsByType('stroke');
      expect(strokesAfter).toHaveLength(0);
    });

    it('does not erase non-stroke elements', () => {
      h.viewport.addImage('data:image/png;base64,abc', { x: 100, y: 100 }, { w: 200, h: 150 });

      h.viewport.toolManager.setTool('eraser', h.viewport.toolContext);
      drag(h.wrapper, [100, 100], [300, 250], 10);

      const images = h.viewport.store.getElementsByType('image');
      expect(images).toHaveLength(1);
    });

    it('erases multiple strokes in one pass', () => {
      h.viewport.toolManager.setTool('pencil', h.viewport.toolContext);
      drag(h.wrapper, [100, 100], [300, 100], 10);
      drag(h.wrapper, [100, 110], [300, 110], 10);

      const strokesBefore = h.viewport.store.getElementsByType('stroke');
      expect(strokesBefore).toHaveLength(2);

      h.viewport.toolManager.setTool('eraser', h.viewport.toolContext);
      drag(h.wrapper, [80, 105], [320, 105], 10);

      const strokesAfter = h.viewport.store.getElementsByType('stroke');
      expect(strokesAfter).toHaveLength(0);
    });
  });
});
