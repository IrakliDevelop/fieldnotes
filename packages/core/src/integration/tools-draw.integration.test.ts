// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ViewportHarness } from '../test-helpers/viewport-harness';
import { createViewportHarness } from '../test-helpers/viewport-harness';
import { drag, tap, pointerDown, pointerMove, pointerUp } from '../test-helpers/pointer-helpers';
import type { ShapeTool } from '../tools/shape-tool';
import type { PencilTool } from '../tools/pencil-tool';
import type { ArrowTool } from '../tools/arrow-tool';
import type { NoteTool } from '../tools/note-tool';

describe('Integration: drawing tools', () => {
  let h: ViewportHarness;

  beforeEach(() => {
    h = createViewportHarness();
  });

  afterEach(() => {
    h.cleanup();
  });

  describe('shape tool', () => {
    it('draws a rectangle via drag', () => {
      h.viewport.toolManager.setTool('shape', h.viewport.toolContext);

      drag(h.wrapper, [100, 100], [300, 200]);

      const shapes = h.viewport.store.getElementsByType('shape');
      expect(shapes).toHaveLength(1);
      expect(shapes[0]?.shape).toBe('rectangle');
      expect(shapes[0]?.size.w).toBeGreaterThan(0);
      expect(shapes[0]?.size.h).toBeGreaterThan(0);
    });

    it('draws an ellipse when shape option is set', () => {
      h.viewport.toolManager.setTool('shape', h.viewport.toolContext);
      const shapeTool = h.viewport.toolManager.getTool<ShapeTool>('shape');
      shapeTool?.setOptions({ shape: 'ellipse' });

      drag(h.wrapper, [100, 100], [300, 250]);

      const shapes = h.viewport.store.getElementsByType('shape');
      expect(shapes).toHaveLength(1);
      expect(shapes[0]?.shape).toBe('ellipse');
    });

    it('zero-drag does not create a shape', () => {
      h.viewport.toolManager.setTool('shape', h.viewport.toolContext);
      tap(h.wrapper, 200, 200);

      expect(h.viewport.store.getElementsByType('shape')).toHaveLength(0);
    });

    it('auto-switches to select tool after shape creation', () => {
      h.viewport.toolManager.setTool('shape', h.viewport.toolContext);
      drag(h.wrapper, [100, 100], [300, 200]);

      expect(h.viewport.toolManager.activeTool?.name).toBe('select');
    });

    it('shape snaps to grid when enabled', () => {
      h.viewport.addGrid({ gridType: 'square', cellSize: 50 });
      h.viewport.setSnapToGrid(true);
      h.viewport.toolManager.setTool('shape', h.viewport.toolContext);

      drag(h.wrapper, [12, 18], [163, 112]);

      const shapes = h.viewport.store.getElementsByType('shape');
      expect(shapes).toHaveLength(1);
      const pos = shapes[0]?.position;
      expect((pos?.x ?? NaN) % 50).toBe(0);
      expect((pos?.y ?? NaN) % 50).toBe(0);
    });

    it('preserves stroke and fill colors', () => {
      h.viewport.toolManager.setTool('shape', h.viewport.toolContext);
      const shapeTool = h.viewport.toolManager.getTool<ShapeTool>('shape');
      shapeTool?.setOptions({ strokeColor: '#ff0000', fillColor: '#00ff00' });

      drag(h.wrapper, [100, 100], [250, 200]);

      const shapes = h.viewport.store.getElementsByType('shape');
      expect(shapes).toHaveLength(1);
      expect(shapes[0]?.strokeColor).toBe('#ff0000');
      expect(shapes[0]?.fillColor).toBe('#00ff00');
    });
  });

  describe('pencil tool', () => {
    it('draws a freehand stroke via drag', () => {
      h.viewport.toolManager.setTool('pencil', h.viewport.toolContext);

      drag(h.wrapper, [50, 50], [250, 150], 10);

      const strokes = h.viewport.store.getElementsByType('stroke');
      expect(strokes).toHaveLength(1);
      expect(strokes[0]?.points.length).toBeGreaterThanOrEqual(2);
    });

    it('captures pressure data in stroke points', () => {
      h.viewport.toolManager.setTool('pencil', h.viewport.toolContext);

      pointerDown(h.wrapper, 100, 100, { pressure: 0.8 });
      pointerMove(h.wrapper, 120, 110, { pressure: 0.6 });
      pointerMove(h.wrapper, 140, 120, { pressure: 0.4 });
      pointerUp(h.wrapper, 160, 130);

      const strokes = h.viewport.store.getElementsByType('stroke');
      expect(strokes).toHaveLength(1);
      const pressures = strokes[0]?.points.map((p) => p.pressure) ?? [];
      expect(pressures.some((p) => p !== 0.5)).toBe(true);
    });

    it('single click without movement does not create stroke', () => {
      h.viewport.toolManager.setTool('pencil', h.viewport.toolContext);
      tap(h.wrapper, 200, 200);

      expect(h.viewport.store.getElementsByType('stroke')).toHaveLength(0);
    });

    it('uses configured color and width', () => {
      h.viewport.toolManager.setTool('pencil', h.viewport.toolContext);
      const pencilTool = h.viewport.toolManager.getTool<PencilTool>('pencil');
      pencilTool?.setOptions({ color: '#0000ff', width: 5 });

      drag(h.wrapper, [50, 50], [250, 150], 10);

      const strokes = h.viewport.store.getElementsByType('stroke');
      expect(strokes).toHaveLength(1);
      expect(strokes[0]?.color).toBe('#0000ff');
      expect(strokes[0]?.width).toBe(5);
    });

    it('draws multiple strokes independently', () => {
      h.viewport.toolManager.setTool('pencil', h.viewport.toolContext);

      drag(h.wrapper, [50, 50], [150, 50], 5);
      drag(h.wrapper, [50, 100], [150, 100], 5);

      const strokes = h.viewport.store.getElementsByType('stroke');
      expect(strokes).toHaveLength(2);
    });
  });

  describe('arrow tool', () => {
    it('draws an arrow via drag', () => {
      h.viewport.toolManager.setTool('arrow', h.viewport.toolContext);

      drag(h.wrapper, [100, 100], [300, 200]);

      const arrows = h.viewport.store.getElementsByType('arrow');
      expect(arrows).toHaveLength(1);
      expect(arrows[0]?.from).toBeDefined();
      expect(arrows[0]?.to).toBeDefined();
    });

    it('zero-drag does not create an arrow', () => {
      h.viewport.toolManager.setTool('arrow', h.viewport.toolContext);
      tap(h.wrapper, 200, 200);

      expect(h.viewport.store.getElementsByType('arrow')).toHaveLength(0);
    });

    it('arrow binds to existing element when dragged near its center', () => {
      const imageId = h.viewport.addImage(
        'data:image/png;base64,abc',
        { x: 50, y: 50 },
        { w: 100, h: 100 },
      );
      expect(h.viewport.store.getById(imageId)).toBeDefined();

      h.viewport.toolManager.setTool('arrow', h.viewport.toolContext);
      drag(h.wrapper, [100, 100], [400, 400]);

      const arrows = h.viewport.store.getElementsByType('arrow');
      expect(arrows).toHaveLength(1);
      expect(arrows[0]?.fromBinding).toBeDefined();
      expect(arrows[0]?.fromBinding?.elementId).toBe(imageId);
    });

    it('uses configured color and width', () => {
      h.viewport.toolManager.setTool('arrow', h.viewport.toolContext);
      const arrowTool = h.viewport.toolManager.getTool<ArrowTool>('arrow');
      arrowTool?.setOptions({ color: '#ff00ff', width: 4 });

      drag(h.wrapper, [100, 100], [300, 200]);

      const arrows = h.viewport.store.getElementsByType('arrow');
      expect(arrows).toHaveLength(1);
      expect(arrows[0]?.color).toBe('#ff00ff');
      expect(arrows[0]?.width).toBe(4);
    });

    it('binds both ends when dragged between two elements', () => {
      const id1 = h.viewport.addImage(
        'data:image/png;base64,abc',
        { x: 50, y: 50 },
        { w: 100, h: 100 },
      );
      const id2 = h.viewport.addImage(
        'data:image/png;base64,def',
        { x: 350, y: 50 },
        { w: 100, h: 100 },
      );

      h.viewport.toolManager.setTool('arrow', h.viewport.toolContext);
      drag(h.wrapper, [100, 100], [400, 100]);

      const arrows = h.viewport.store.getElementsByType('arrow');
      expect(arrows).toHaveLength(1);
      expect(arrows[0]?.fromBinding?.elementId).toBe(id1);
      expect(arrows[0]?.toBinding?.elementId).toBe(id2);
    });
  });

  describe('note tool', () => {
    it('places a sticky note on tap', () => {
      h.viewport.toolManager.setTool('note', h.viewport.toolContext);
      tap(h.wrapper, 400, 300);

      const notes = h.viewport.store.getElementsByType('note');
      expect(notes).toHaveLength(1);
      expect(notes[0]?.backgroundColor).toBeDefined();
    });

    it('auto-switches to select after note placement', () => {
      h.viewport.toolManager.setTool('note', h.viewport.toolContext);
      tap(h.wrapper, 400, 300);

      expect(h.viewport.toolManager.activeTool?.name).toBe('select');
    });

    it('places note at world coordinates (accounts for camera)', () => {
      h.viewport.camera.pan(100, 50);
      h.viewport.toolManager.setTool('note', h.viewport.toolContext);
      tap(h.wrapper, 200, 200);

      const notes = h.viewport.store.getElementsByType('note');
      expect(notes).toHaveLength(1);
      const notePos = notes[0]?.position;
      expect(notePos).toBeDefined();
      expect(notePos?.x).not.toBe(200);
    });

    it('note snaps to grid when enabled', () => {
      h.viewport.addGrid({ gridType: 'square', cellSize: 50 });
      h.viewport.setSnapToGrid(true);
      h.viewport.toolManager.setTool('note', h.viewport.toolContext);

      tap(h.wrapper, 73, 88);

      const notes = h.viewport.store.getElementsByType('note');
      expect(notes).toHaveLength(1);
      const pos = notes[0]?.position;
      expect((pos?.x ?? NaN) % 50).toBe(0);
      expect((pos?.y ?? NaN) % 50).toBe(0);
    });

    it('uses configured background and text colors', () => {
      h.viewport.toolManager.setTool('note', h.viewport.toolContext);
      const noteTool = h.viewport.toolManager.getTool<NoteTool>('note');
      noteTool?.setOptions({ backgroundColor: '#ff9800', textColor: '#ffffff' });

      tap(h.wrapper, 400, 300);

      const notes = h.viewport.store.getElementsByType('note');
      expect(notes).toHaveLength(1);
      expect(notes[0]?.backgroundColor).toBe('#ff9800');
      expect(notes[0]?.textColor).toBe('#ffffff');
    });
  });

  describe('text tool', () => {
    it('places a text element on tap', () => {
      h.viewport.toolManager.setTool('text', h.viewport.toolContext);
      tap(h.wrapper, 300, 250);

      const texts = h.viewport.store.getElementsByType('text');
      expect(texts).toHaveLength(1);
    });

    it('places text at world coordinates', () => {
      h.viewport.camera.pan(80, 60);
      h.viewport.toolManager.setTool('text', h.viewport.toolContext);
      tap(h.wrapper, 300, 250);

      const texts = h.viewport.store.getElementsByType('text');
      expect(texts).toHaveLength(1);
      const pos = texts[0]?.position;
      expect(pos).toBeDefined();
      expect(pos?.x).not.toBe(300);
    });
  });

  describe('image placement', () => {
    it('addImage adds an image element', () => {
      const id = h.viewport.addImage(
        'data:image/png;base64,abc',
        { x: 100, y: 100 },
        { w: 200, h: 150 },
      );

      const images = h.viewport.store.getElementsByType('image');
      expect(images).toHaveLength(1);
      expect(images[0]?.id).toBe(id);
      expect(images[0]?.src).toBe('data:image/png;base64,abc');
      expect(images[0]?.position).toEqual({ x: 100, y: 100 });
      expect(images[0]?.size).toEqual({ w: 200, h: 150 });
    });
  });
});
