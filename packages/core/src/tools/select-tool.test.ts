import { describe, it, expect, vi } from 'vitest';
import { SelectTool } from './select-tool';
import { ElementStore } from '../elements/element-store';
import { Camera } from '../canvas/camera';
import { createNote, createArrow, createStroke, createImage } from '../elements/element-factory';
import type { ToolContext, PointerState } from './types';
import type { NoteElement, ImageElement } from '../elements/types';

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    camera: new Camera(),
    store: new ElementStore(),
    requestRender: vi.fn(),
    ...overrides,
  };
}

function pt(x: number, y: number): PointerState {
  return { x, y, pressure: 0.5 };
}

describe('SelectTool', () => {
  it('has name "select"', () => {
    expect(new SelectTool().name).toBe('select');
  });

  describe('click to select', () => {
    it('selects a note element when clicking inside its bounds', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const note = createNote({ position: { x: 100, y: 100 }, size: { w: 200, h: 100 } });
      ctx.store.add(note);

      tool.onPointerDown(pt(150, 130), ctx);
      tool.onPointerUp(pt(150, 130), ctx);

      expect(tool.selectedIds).toEqual([note.id]);
    });

    it('deselects when clicking empty area', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const note = createNote({ position: { x: 100, y: 100 } });
      ctx.store.add(note);

      tool.onPointerDown(pt(150, 130), ctx);
      tool.onPointerUp(pt(150, 130), ctx);
      expect(tool.selectedIds).toHaveLength(1);

      tool.onPointerDown(pt(0, 0), ctx);
      tool.onPointerUp(pt(0, 0), ctx);
      expect(tool.selectedIds).toHaveLength(0);
    });

    it('selects elements with higher zIndex first', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const back = createNote({
        position: { x: 100, y: 100 },
        size: { w: 200, h: 100 },
        zIndex: 0,
      });
      const front = createNote({
        position: { x: 100, y: 100 },
        size: { w: 200, h: 100 },
        zIndex: 1,
      });
      ctx.store.add(back);
      ctx.store.add(front);

      tool.onPointerDown(pt(150, 130), ctx);
      tool.onPointerUp(pt(150, 130), ctx);

      expect(tool.selectedIds).toEqual([front.id]);
    });

    it('clears selection on deactivate', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const note = createNote({ position: { x: 100, y: 100 }, size: { w: 200, h: 100 } });
      ctx.store.add(note);

      tool.onPointerDown(pt(150, 130), ctx);
      tool.onPointerUp(pt(150, 130), ctx);
      expect(tool.selectedIds).toHaveLength(1);

      tool.onDeactivate(ctx);
      expect(tool.selectedIds).toHaveLength(0);
    });
  });

  describe('drag to move', () => {
    it('moves a selected element by dragging', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const note = createNote({ position: { x: 100, y: 100 }, size: { w: 200, h: 100 } });
      ctx.store.add(note);

      tool.onPointerDown(pt(150, 130), ctx);
      tool.onPointerMove(pt(170, 150), ctx);
      tool.onPointerUp(pt(170, 150), ctx);

      const updated = ctx.store.getById(note.id);
      expect(updated?.position.x).toBe(120);
      expect(updated?.position.y).toBe(120);
    });

    it('does not move locked elements', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const note = createNote({ position: { x: 100, y: 100 }, size: { w: 200, h: 100 } });
      note.locked = true;
      ctx.store.add(note);

      tool.onPointerDown(pt(150, 130), ctx);
      tool.onPointerMove(pt(200, 200), ctx);
      tool.onPointerUp(pt(200, 200), ctx);

      const updated = ctx.store.getById(note.id);
      expect(updated?.position).toEqual({ x: 100, y: 100 });
    });

    it('requests render on drag', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const note = createNote({ position: { x: 100, y: 100 }, size: { w: 200, h: 100 } });
      ctx.store.add(note);

      tool.onPointerDown(pt(150, 130), ctx);
      tool.onPointerMove(pt(160, 140), ctx);

      expect(ctx.requestRender).toHaveBeenCalled();
    });

    it('moves an arrow by updating from and to (single gesture)', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const arrow = createArrow({ from: { x: 50, y: 50 }, to: { x: 150, y: 100 } });
      ctx.store.add(arrow);

      tool.onPointerDown(pt(100, 75), ctx);
      tool.onPointerMove(pt(120, 95), ctx);
      tool.onPointerUp(pt(120, 95), ctx);

      const updated = ctx.store.getById(arrow.id);
      expect(updated).toBeDefined();
      if (updated?.type === 'arrow') {
        expect(updated.from).toEqual({ x: 70, y: 70 });
        expect(updated.to).toEqual({ x: 170, y: 120 });
      }
    });

    it('moves an arrow after selecting it first (two gestures)', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const arrow = createArrow({ from: { x: 50, y: 50 }, to: { x: 250, y: 150 } });
      ctx.store.add(arrow);

      // Gesture 1: click to select (away from handles)
      tool.onPointerDown(pt(120, 85), ctx);
      tool.onPointerUp(pt(120, 85), ctx);
      expect(tool.selectedIds).toEqual([arrow.id]);

      // Gesture 2: click on the arrow body and drag to move
      tool.onPointerDown(pt(120, 85), ctx);
      tool.onPointerMove(pt(140, 105), ctx);
      tool.onPointerUp(pt(140, 105), ctx);

      const updated = ctx.store.getById(arrow.id);
      expect(updated).toBeDefined();
      if (updated?.type === 'arrow') {
        expect(updated.from).toEqual({ x: 70, y: 70 });
        expect(updated.to).toEqual({ x: 270, y: 170 });
      }
    });

    it('moves multiple selected elements together', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const n1 = createNote({ position: { x: 50, y: 50 }, size: { w: 80, h: 40 } });
      const n2 = createNote({ position: { x: 200, y: 200 }, size: { w: 80, h: 40 } });
      ctx.store.add(n1);
      ctx.store.add(n2);

      tool.onPointerDown(pt(0, 0), ctx);
      tool.onPointerMove(pt(300, 300), ctx);
      tool.onPointerUp(pt(300, 300), ctx);
      expect(tool.selectedIds).toHaveLength(2);

      tool.onPointerDown(pt(60, 60), ctx);
      tool.onPointerMove(pt(70, 70), ctx);
      tool.onPointerUp(pt(70, 70), ctx);

      expect(ctx.store.getById(n1.id)?.position).toEqual({ x: 60, y: 60 });
      expect(ctx.store.getById(n2.id)?.position).toEqual({ x: 210, y: 210 });
    });
  });

  describe('marquee selection', () => {
    it('selects elements within drag rectangle', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const note = createNote({ position: { x: 50, y: 50 }, size: { w: 100, h: 60 } });
      ctx.store.add(note);

      tool.onPointerDown(pt(0, 0), ctx);
      tool.onPointerMove(pt(200, 200), ctx);
      tool.onPointerUp(pt(200, 200), ctx);

      expect(tool.selectedIds).toEqual([note.id]);
    });

    it('selects multiple elements within marquee', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const n1 = createNote({ position: { x: 50, y: 50 }, size: { w: 80, h: 40 } });
      const n2 = createNote({ position: { x: 200, y: 200 }, size: { w: 80, h: 40 } });
      ctx.store.add(n1);
      ctx.store.add(n2);

      tool.onPointerDown(pt(0, 0), ctx);
      tool.onPointerMove(pt(300, 300), ctx);
      tool.onPointerUp(pt(300, 300), ctx);

      expect(tool.selectedIds).toHaveLength(2);
      expect(tool.selectedIds).toContain(n1.id);
      expect(tool.selectedIds).toContain(n2.id);
    });

    it('does not select elements outside marquee', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const inside = createNote({ position: { x: 50, y: 50 }, size: { w: 40, h: 40 } });
      const outside = createNote({ position: { x: 500, y: 500 }, size: { w: 40, h: 40 } });
      ctx.store.add(inside);
      ctx.store.add(outside);

      tool.onPointerDown(pt(0, 0), ctx);
      tool.onPointerMove(pt(100, 100), ctx);
      tool.onPointerUp(pt(100, 100), ctx);

      expect(tool.selectedIds).toEqual([inside.id]);
    });

    it('selects arrows by marquee', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const arrow = createArrow({ from: { x: 20, y: 20 }, to: { x: 80, y: 80 } });
      ctx.store.add(arrow);

      tool.onPointerDown(pt(0, 0), ctx);
      tool.onPointerMove(pt(100, 100), ctx);
      tool.onPointerUp(pt(100, 100), ctx);

      expect(tool.selectedIds).toEqual([arrow.id]);
    });

    it('selects strokes by marquee', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const stroke = createStroke({
        points: [
          { x: 10, y: 10, pressure: 0.5 },
          { x: 50, y: 50, pressure: 0.5 },
        ],
      });
      ctx.store.add(stroke);

      tool.onPointerDown(pt(0, 0), ctx);
      tool.onPointerMove(pt(60, 60), ctx);
      tool.onPointerUp(pt(60, 60), ctx);

      expect(tool.selectedIds).toEqual([stroke.id]);
    });

    it('works with reverse drag direction (bottom-right to top-left)', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const note = createNote({ position: { x: 50, y: 50 }, size: { w: 40, h: 40 } });
      ctx.store.add(note);

      tool.onPointerDown(pt(200, 200), ctx);
      tool.onPointerMove(pt(0, 0), ctx);
      tool.onPointerUp(pt(0, 0), ctx);

      expect(tool.selectedIds).toEqual([note.id]);
    });

    it('requests render during marquee drag', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();

      tool.onPointerDown(pt(0, 0), ctx);
      tool.onPointerMove(pt(100, 100), ctx);

      expect(ctx.requestRender).toHaveBeenCalled();
    });

    it('clears marquee state after pointer up', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();

      tool.onPointerDown(pt(0, 0), ctx);
      tool.onPointerMove(pt(100, 100), ctx);
      tool.onPointerUp(pt(100, 100), ctx);

      expect(tool.isMarqueeActive).toBe(false);
    });
  });

  describe('resize', () => {
    it('resizes a note from the SE handle', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const note = createNote({ position: { x: 100, y: 100 }, size: { w: 200, h: 100 } });
      ctx.store.add(note);

      // Select the note
      tool.onPointerDown(pt(150, 130), ctx);
      tool.onPointerUp(pt(150, 130), ctx);
      expect(tool.selectedIds).toEqual([note.id]);

      // Drag the SE corner (300, 200) by (+20, +30)
      tool.onPointerDown(pt(300, 200), ctx);
      tool.onPointerMove(pt(320, 230), ctx);
      tool.onPointerUp(pt(320, 230), ctx);

      const updated = ctx.store.getById(note.id) as NoteElement;
      expect(updated.size.w).toBe(220);
      expect(updated.size.h).toBe(130);
      expect(updated.position).toEqual({ x: 100, y: 100 });
    });

    it('resizes a note from the NW handle', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const note = createNote({ position: { x: 100, y: 100 }, size: { w: 200, h: 100 } });
      ctx.store.add(note);

      tool.onPointerDown(pt(150, 130), ctx);
      tool.onPointerUp(pt(150, 130), ctx);

      // Drag the NW corner (100, 100) by (-10, -20)
      tool.onPointerDown(pt(100, 100), ctx);
      tool.onPointerMove(pt(90, 80), ctx);
      tool.onPointerUp(pt(90, 80), ctx);

      const updated = ctx.store.getById(note.id) as NoteElement;
      expect(updated.size.w).toBe(210);
      expect(updated.size.h).toBe(120);
      expect(updated.position).toEqual({ x: 90, y: 80 });
    });

    it('enforces minimum size', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const note = createNote({ position: { x: 100, y: 100 }, size: { w: 50, h: 50 } });
      ctx.store.add(note);

      tool.onPointerDown(pt(120, 120), ctx);
      tool.onPointerUp(pt(120, 120), ctx);

      // Try to shrink SE corner by a huge amount
      tool.onPointerDown(pt(150, 150), ctx);
      tool.onPointerMove(pt(50, 50), ctx);
      tool.onPointerUp(pt(50, 50), ctx);

      const updated = ctx.store.getById(note.id) as NoteElement;
      expect(updated.size.w).toBeGreaterThanOrEqual(20);
      expect(updated.size.h).toBeGreaterThanOrEqual(20);
    });

    it('resizes a note from the NE handle', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const note = createNote({ position: { x: 100, y: 100 }, size: { w: 200, h: 100 } });
      ctx.store.add(note);

      tool.onPointerDown(pt(150, 130), ctx);
      tool.onPointerUp(pt(150, 130), ctx);

      // Drag the NE corner (300, 100) by (+15, -10)
      tool.onPointerDown(pt(300, 100), ctx);
      tool.onPointerMove(pt(315, 90), ctx);
      tool.onPointerUp(pt(315, 90), ctx);

      const updated = ctx.store.getById(note.id) as NoteElement;
      expect(updated.size.w).toBe(215);
      expect(updated.size.h).toBe(110);
      expect(updated.position.x).toBe(100);
      expect(updated.position.y).toBe(90);
    });

    it('resizes a note from the SW handle', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const note = createNote({ position: { x: 100, y: 100 }, size: { w: 200, h: 100 } });
      ctx.store.add(note);

      tool.onPointerDown(pt(150, 130), ctx);
      tool.onPointerUp(pt(150, 130), ctx);

      // Drag the SW corner (100, 200) by (-10, +20)
      tool.onPointerDown(pt(100, 200), ctx);
      tool.onPointerMove(pt(90, 220), ctx);
      tool.onPointerUp(pt(90, 220), ctx);

      const updated = ctx.store.getById(note.id) as NoteElement;
      expect(updated.size.w).toBe(210);
      expect(updated.size.h).toBe(120);
      expect(updated.position.x).toBe(90);
      expect(updated.position.y).toBe(100);
    });

    it('resizes an image element', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const img = createImage({
        position: { x: 50, y: 50 },
        size: { w: 100, h: 80 },
        src: 'data:image/png;base64,abc',
      });
      ctx.store.add(img);

      tool.onPointerDown(pt(80, 70), ctx);
      tool.onPointerUp(pt(80, 70), ctx);

      // Drag SE corner (150, 130) by (+30, +20)
      tool.onPointerDown(pt(150, 130), ctx);
      tool.onPointerMove(pt(180, 150), ctx);
      tool.onPointerUp(pt(180, 150), ctx);

      const updated = ctx.store.getById(img.id) as ImageElement;
      expect(updated.size.w).toBe(130);
      expect(updated.size.h).toBe(100);
    });

    it('does not resize locked elements', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const note = createNote({
        position: { x: 100, y: 100 },
        size: { w: 200, h: 100 },
        locked: true,
      });
      ctx.store.add(note);

      tool.onPointerDown(pt(150, 130), ctx);
      tool.onPointerUp(pt(150, 130), ctx);

      tool.onPointerDown(pt(300, 200), ctx);
      tool.onPointerMove(pt(320, 230), ctx);
      tool.onPointerUp(pt(320, 230), ctx);

      const updated = ctx.store.getById(note.id) as NoteElement;
      expect(updated.size.w).toBe(200);
      expect(updated.size.h).toBe(100);
    });

    it('does not show resize handles for strokes', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const stroke = createStroke({
        points: [
          { x: 10, y: 10, pressure: 0.5 },
          { x: 50, y: 50, pressure: 0.5 },
        ],
      });
      ctx.store.add(stroke);

      // Marquee select the stroke
      tool.onPointerDown(pt(0, 0), ctx);
      tool.onPointerMove(pt(60, 60), ctx);
      tool.onPointerUp(pt(60, 60), ctx);
      expect(tool.selectedIds).toEqual([stroke.id]);

      // Clicking near a corner should not trigger resize (no handles on strokes)
      tool.onPointerDown(pt(10, 10), ctx);
      // Should be hitTest → re-select, not resize
      tool.onPointerUp(pt(10, 10), ctx);
      expect(tool.selectedIds).toEqual([stroke.id]);
    });
  });

  describe('snap-to-grid dragging', () => {
    it('snaps element position when dragging with snap enabled', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      ctx.snapToGrid = true;
      ctx.gridSize = 24;

      const note = createNote({ position: { x: 10, y: 10 }, size: { w: 200, h: 100 } });
      ctx.store.add(note);

      // Select the note by clicking on it, then drag
      tool.onPointerDown(pt(10, 10), ctx);
      tool.onPointerMove(pt(60, 60), ctx);
      tool.onPointerUp(pt(60, 60), ctx);

      const moved = ctx.store.getById(note.id);
      // lastWorld snaps (10,10) → snapPoint(10,10,24) = (0,0) [Math.round(10/24)=0]
      // world snaps (60,60) → snapPoint(60,60,24) = (72,72) [Math.round(60/24)=Math.round(2.5)=3, 3*24=72]
      // delta = (72, 72), new position = (10+72, 10+72) = (82, 82)
      expect(moved?.position).toEqual({ x: 82, y: 82 });
    });

    it('does not snap when snap is disabled', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      ctx.snapToGrid = false;

      const note = createNote({ position: { x: 10, y: 10 }, size: { w: 200, h: 100 } });
      ctx.store.add(note);

      tool.onPointerDown(pt(10, 10), ctx);
      tool.onPointerMove(pt(55, 55), ctx);
      tool.onPointerUp(pt(55, 55), ctx);

      const moved = ctx.store.getById(note.id);
      expect(moved?.position).toEqual({ x: 55, y: 55 });
    });
  });

  describe('arrow binding', () => {
    it('updates bound arrow when dragging a note', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 100 } });
      const arrow = createArrow({
        from: { x: 50, y: 50 },
        to: { x: 300, y: 300 },
        fromBinding: { elementId: note.id },
      });
      ctx.store.add(arrow);
      ctx.store.add(note);

      // Select the note
      tool.onPointerDown(pt(50, 50), ctx);
      // Drag it 100px right
      tool.onPointerMove(pt(150, 50), ctx);
      tool.onPointerUp(pt(150, 50), ctx);

      const updatedArrow = ctx.store.getById(arrow.id);
      // Note moved from (0,0) to (100,0), center was (50,50) now (150,50)
      expect(updatedArrow?.type === 'arrow' && updatedArrow.from.x).toBe(150);
      expect(updatedArrow?.type === 'arrow' && updatedArrow.from.y).toBe(50);
    });

    it('does not move a bound arrow when dragged independently', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 100 } });
      const arrow = createArrow({
        from: { x: 50, y: 50 },
        to: { x: 300, y: 300 },
        fromBinding: { elementId: note.id },
      });
      ctx.store.add(arrow);
      ctx.store.add(note);

      // Select the arrow by clicking on its line
      tool.onPointerDown(pt(175, 175), ctx);
      // Try to drag it
      tool.onPointerMove(pt(200, 200), ctx);
      tool.onPointerUp(pt(200, 200), ctx);

      const updatedArrow = ctx.store.getById(arrow.id);
      // Arrow should stay in place and keep its binding
      expect(updatedArrow?.type === 'arrow' && updatedArrow.fromBinding?.elementId).toBe(note.id);
      expect(updatedArrow?.type === 'arrow' && updatedArrow.from.x).toBe(50);
    });

    it('updates bound arrows when resizing an element', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const note = createNote({ position: { x: 100, y: 100 }, size: { w: 200, h: 100 } });
      const arrow = createArrow({
        from: { x: 200, y: 150 },
        to: { x: 400, y: 400 },
        fromBinding: { elementId: note.id },
      });
      ctx.store.add(arrow);
      ctx.store.add(note);

      // Select the note
      tool.onPointerDown(pt(200, 150), ctx);
      tool.onPointerUp(pt(200, 150), ctx);

      // Resize from SE corner (300, 200) by (+50, 0) — width goes to 250
      tool.onPointerDown(pt(300, 200), ctx);
      tool.onPointerMove(pt(350, 200), ctx);
      tool.onPointerUp(pt(350, 200), ctx);

      // Center was (200, 150), after resize to width 250 -> center is (225, 150)
      const updatedArrow = ctx.store.getById(arrow.id);
      expect(updatedArrow?.type === 'arrow' && updatedArrow.from.x).toBe(225);
      expect(updatedArrow?.type === 'arrow' && updatedArrow.from.y).toBe(150);
    });
  });

  describe('layer-aware hit testing', () => {
    it('skips elements on hidden layers', () => {
      const tool = new SelectTool();
      const store = new ElementStore();
      const note = createNote({ position: { x: 50, y: 50 }, layerId: 'hidden-layer' });
      store.add(note);

      const ctx: ToolContext = {
        camera: new Camera(),
        store,
        requestRender: vi.fn(),
        isLayerVisible: (id: string) => id !== 'hidden-layer',
        isLayerLocked: () => false,
        activeLayerId: 'visible-layer',
      };

      tool.onPointerDown(pt(55, 55), ctx);
      tool.onPointerUp(pt(55, 55), ctx);
      expect(tool.selectedIds).toEqual([]);
    });

    it('skips elements on locked layers', () => {
      const tool = new SelectTool();
      const store = new ElementStore();
      const note = createNote({ position: { x: 50, y: 50 }, layerId: 'locked-layer' });
      store.add(note);

      const ctx: ToolContext = {
        camera: new Camera(),
        store,
        requestRender: vi.fn(),
        isLayerVisible: () => true,
        isLayerLocked: (id: string) => id === 'locked-layer',
        activeLayerId: 'other-layer',
      };

      tool.onPointerDown(pt(55, 55), ctx);
      tool.onPointerUp(pt(55, 55), ctx);
      expect(tool.selectedIds).toEqual([]);
    });
  });

  describe('layer-aware marquee selection', () => {
    it('skips elements on hidden layers during marquee', () => {
      const tool = new SelectTool();
      const store = new ElementStore();
      const note = createNote({ position: { x: 50, y: 50 }, layerId: 'hidden-layer' });
      store.add(note);

      const ctx = makeCtx({
        store,
        isLayerVisible: (id: string) => id !== 'hidden-layer',
        isLayerLocked: () => false,
        activeLayerId: 'visible-layer',
      });

      tool.onPointerDown(pt(0, 0), ctx);
      tool.onPointerMove(pt(500, 500), ctx);
      tool.onPointerUp(pt(500, 500), ctx);
      expect(tool.selectedIds).toEqual([]);
    });

    it('skips elements on locked layers during marquee', () => {
      const tool = new SelectTool();
      const store = new ElementStore();
      const note = createNote({ position: { x: 50, y: 50 }, layerId: 'locked-layer' });
      store.add(note);

      const ctx = makeCtx({
        store,
        isLayerVisible: () => true,
        isLayerLocked: (id: string) => id === 'locked-layer',
        activeLayerId: 'other-layer',
      });

      tool.onPointerDown(pt(0, 0), ctx);
      tool.onPointerMove(pt(500, 500), ctx);
      tool.onPointerUp(pt(500, 500), ctx);
      expect(tool.selectedIds).toEqual([]);
    });
  });

  describe('cursors', () => {
    it('shows resize cursor when hovering over a handle', () => {
      const tool = new SelectTool();
      const setCursor = vi.fn();
      const ctx = makeCtx({ setCursor });
      const note = createNote({ position: { x: 100, y: 100 }, size: { w: 200, h: 100 } });
      ctx.store.add(note);

      tool.onActivate(ctx);
      tool.onPointerDown(pt(150, 130), ctx);
      tool.onPointerUp(pt(150, 130), ctx);
      setCursor.mockClear();

      // Hover over SE handle (300, 200)
      tool.onHover?.(pt(300, 200), ctx);

      expect(setCursor).toHaveBeenCalledWith('nwse-resize');
    });

    it('shows move cursor when hovering over an element', () => {
      const tool = new SelectTool();
      const setCursor = vi.fn();
      const ctx = makeCtx({ setCursor });
      const note = createNote({ position: { x: 100, y: 100 }, size: { w: 200, h: 100 } });
      ctx.store.add(note);

      tool.onActivate(ctx);
      tool.onHover?.(pt(150, 130), ctx);

      expect(setCursor).toHaveBeenCalledWith('move');
    });

    it('shows default cursor when hovering over empty space', () => {
      const tool = new SelectTool();
      const setCursor = vi.fn();
      const ctx = makeCtx({ setCursor });

      tool.onActivate(ctx);
      tool.onHover?.(pt(500, 500), ctx);

      expect(setCursor).toHaveBeenCalledWith('default');
    });

    it('shows resize cursor during active resize', () => {
      const tool = new SelectTool();
      const setCursor = vi.fn();
      const ctx = makeCtx({ setCursor });
      const note = createNote({ position: { x: 100, y: 100 }, size: { w: 200, h: 100 } });
      ctx.store.add(note);

      tool.onPointerDown(pt(150, 130), ctx);
      tool.onPointerUp(pt(150, 130), ctx);
      setCursor.mockClear();

      // Start dragging SE handle
      tool.onPointerDown(pt(300, 200), ctx);
      tool.onPointerMove(pt(320, 220), ctx);

      expect(setCursor).toHaveBeenCalledWith('nwse-resize');
    });

    it('resets cursor on pointer up', () => {
      const tool = new SelectTool();
      const setCursor = vi.fn();
      const ctx = makeCtx({ setCursor });
      const note = createNote({ position: { x: 100, y: 100 }, size: { w: 200, h: 100 } });
      ctx.store.add(note);

      tool.onPointerDown(pt(150, 130), ctx);
      tool.onPointerUp(pt(150, 130), ctx);
      setCursor.mockClear();

      tool.onPointerDown(pt(300, 200), ctx);
      tool.onPointerMove(pt(320, 220), ctx);
      tool.onPointerUp(pt(320, 220), ctx);

      expect(setCursor).toHaveBeenLastCalledWith('default');
    });

    it('resets cursor on deactivate', () => {
      const tool = new SelectTool();
      const setCursor = vi.fn();
      const ctx = makeCtx({ setCursor });

      tool.onActivate(ctx);
      tool.onDeactivate(ctx);

      expect(setCursor).toHaveBeenCalledWith('default');
    });
  });

  describe('renderOverlay', () => {
    function mockCanvas(): CanvasRenderingContext2D {
      return {
        save: vi.fn(),
        restore: vi.fn(),
        strokeRect: vi.fn(),
        fillRect: vi.fn(),
        strokeStyle: '',
        fillStyle: '',
        lineWidth: 0,
        globalAlpha: 1,
        setLineDash: vi.fn(),
      } as unknown as CanvasRenderingContext2D;
    }

    it('draws selection box around selected element', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const note = createNote({ position: { x: 100, y: 100 }, size: { w: 200, h: 100 } });
      ctx.store.add(note);

      tool.onPointerDown(pt(150, 130), ctx);
      tool.onPointerUp(pt(150, 130), ctx);

      const canvas = mockCanvas();
      tool.renderOverlay?.(canvas);

      expect(canvas.setLineDash).toHaveBeenCalled();
      expect(canvas.strokeRect).toHaveBeenCalled();
    });

    it('draws resize handles for sized elements', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const note = createNote({ position: { x: 100, y: 100 }, size: { w: 200, h: 100 } });
      ctx.store.add(note);

      tool.onPointerDown(pt(150, 130), ctx);
      tool.onPointerUp(pt(150, 130), ctx);

      const canvas = mockCanvas();
      tool.renderOverlay?.(canvas);

      // 1 selection box stroke + 4 handle fills + 4 handle strokes = many calls
      expect(canvas.fillRect).toHaveBeenCalled();
      const fillCalls = (canvas.fillRect as ReturnType<typeof vi.fn>).mock.calls.length;
      expect(fillCalls).toBeGreaterThanOrEqual(4);
    });

    it('does not render overlay with no selection', () => {
      const tool = new SelectTool();
      const canvas = mockCanvas();

      tool.renderOverlay?.(canvas);

      expect(canvas.strokeRect).not.toHaveBeenCalled();
    });

    it('draws marquee rectangle while dragging on empty space', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const canvas = mockCanvas();

      tool.onPointerDown(pt(0, 0), ctx);
      tool.onPointerMove(pt(100, 100), ctx);
      tool.renderOverlay?.(canvas);

      expect(canvas.strokeRect).toHaveBeenCalled();
      expect(canvas.fillRect).toHaveBeenCalled();
    });
  });
});
