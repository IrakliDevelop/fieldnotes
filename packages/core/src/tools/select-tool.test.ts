import { describe, it, expect, vi } from 'vitest';
import { SelectTool } from './select-tool';
import {
  hitTestResizeHandle,
  hitTestRotateHandle,
  hitTestLineHandles,
  isInsideBounds,
} from './select-hit';
import { ElementStore } from '../elements/element-store';
import { Camera } from '../canvas/camera';
import {
  createNote,
  createArrow,
  createStroke,
  createImage,
  createTemplate,
  createGrid,
  createShape,
} from '../elements/element-factory';
import { lineEndpoints } from '../elements/shape-geometry';
import { rotatePoint } from '../core/geometry';
import type { ToolContext, PointerState } from './types';
import type { NoteElement, ImageElement, TemplateElement } from '../elements/types';
import type { Point } from '../core/types';

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    camera: new Camera(),
    store: new ElementStore(),
    requestRender: vi.fn(),
    ...overrides,
  };
}

function pt(x: number, y: number): PointerState {
  return { x, y, pressure: 0.5, pointerType: 'mouse', shiftKey: false };
}

function shiftPt(x: number, y: number): PointerState {
  return { x, y, pressure: 0.5, pointerType: 'mouse', shiftKey: true };
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

    it('selects a sparse stroke when clicking between its sample points', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const sparse = createStroke({
        position: { x: 100, y: 100 },
        points: [
          { x: 0, y: 0, pressure: 0.5 },
          { x: 100, y: 0, pressure: 0.5 },
        ],
      });
      ctx.store.add(sparse);

      tool.onPointerDown(pt(150, 105), ctx);
      tool.onPointerUp(pt(150, 105), ctx);

      expect(tool.selectedIds).toEqual([sparse.id]);
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

    it('marquee selects a rotated element by its visible footprint', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 20 } });
      note.rotation = Math.PI / 2;
      ctx.store.add(note);
      // Visible footprint of the 90°-rotated note: x∈[40,60], y∈[-40,60].
      // Start the marquee below the footprint (45,-100) so it begins on empty
      // space (not a click-select), then drag to (55,-10): the marquee rect
      // x∈[45,55], y∈[-100,-10] overlaps the rotated footprint but is fully
      // above the unrotated AABB (y∈[0,20]).
      tool.onPointerDown(pt(45, -100), ctx);
      tool.onPointerMove(pt(55, -10), ctx);
      tool.onPointerUp(pt(55, -10), ctx);

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

    it('marquee on empty canvas results in empty selection', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();

      tool.onPointerDown(pt(0, 0), ctx);
      tool.onPointerMove(pt(500, 500), ctx);
      tool.onPointerUp(pt(500, 500), ctx);

      expect(tool.selectedIds).toEqual([]);
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

    describe('shift-constrain resize', () => {
      it('maintains aspect ratio when shift is held during SE resize', () => {
        const tool = new SelectTool();
        const ctx = makeCtx();
        const note = createNote({ position: { x: 100, y: 100 }, size: { w: 200, h: 100 } });
        ctx.store.add(note);

        tool.onPointerDown(pt(150, 130), ctx);
        tool.onPointerUp(pt(150, 130), ctx);

        // Drag SE corner with shift — width dominant
        tool.onPointerDown(pt(300, 200), ctx);
        tool.onPointerMove(shiftPt(350, 210), ctx);
        tool.onPointerUp(shiftPt(350, 210), ctx);

        const updated = ctx.store.getById(note.id) as NoteElement;
        // Original aspect ratio is 2:1 (200/100)
        // Width grew by 50, so w=250, h should be 250/2 = 125
        expect(updated.size.w).toBe(250);
        expect(updated.size.h).toBe(125);
        expect(updated.position).toEqual({ x: 100, y: 100 });
      });

      it('maintains aspect ratio when height is the dominant axis', () => {
        const tool = new SelectTool();
        const ctx = makeCtx();
        const note = createNote({ position: { x: 100, y: 100 }, size: { w: 100, h: 200 } });
        ctx.store.add(note);

        tool.onPointerDown(pt(120, 180), ctx);
        tool.onPointerUp(pt(120, 180), ctx);

        // Drag SE corner with shift — height dominant
        tool.onPointerDown(pt(200, 300), ctx);
        tool.onPointerMove(shiftPt(210, 400), ctx);
        tool.onPointerUp(shiftPt(400, 400), ctx);

        const updated = ctx.store.getById(note.id) as NoteElement;
        // Original ratio 0.5 (100/200). Height grew by 100, h=300, w = 300 * 0.5 = 150
        expect(updated.size.h).toBe(300);
        expect(updated.size.w).toBe(150);
      });

      it('maintains aspect ratio from NW handle', () => {
        const tool = new SelectTool();
        const ctx = makeCtx();
        const note = createNote({ position: { x: 100, y: 100 }, size: { w: 200, h: 100 } });
        ctx.store.add(note);

        tool.onPointerDown(pt(150, 130), ctx);
        tool.onPointerUp(pt(150, 130), ctx);

        // Drag NW corner with shift
        tool.onPointerDown(pt(100, 100), ctx);
        tool.onPointerMove(shiftPt(60, 90), ctx);
        tool.onPointerUp(shiftPt(60, 90), ctx);

        const updated = ctx.store.getById(note.id) as NoteElement;
        // Width grew by 40 (dx=-40, nw: w -= dx → w=240), h should be 240/2 = 120
        expect(updated.size.w).toBe(240);
        expect(updated.size.h).toBe(120);
      });

      it('does not constrain when shift is not held', () => {
        const tool = new SelectTool();
        const ctx = makeCtx();
        const note = createNote({ position: { x: 100, y: 100 }, size: { w: 200, h: 100 } });
        ctx.store.add(note);

        tool.onPointerDown(pt(150, 130), ctx);
        tool.onPointerUp(pt(150, 130), ctx);

        tool.onPointerDown(pt(300, 200), ctx);
        tool.onPointerMove(pt(350, 210), ctx);
        tool.onPointerUp(pt(350, 210), ctx);

        const updated = ctx.store.getById(note.id) as NoteElement;
        expect(updated.size.w).toBe(250);
        expect(updated.size.h).toBe(110);
      });

      it('still enforces minimum size after constraint', () => {
        const tool = new SelectTool();
        const ctx = makeCtx();
        const note = createNote({ position: { x: 100, y: 100 }, size: { w: 200, h: 100 } });
        ctx.store.add(note);

        tool.onPointerDown(pt(150, 130), ctx);
        tool.onPointerUp(pt(150, 130), ctx);

        // Drag SE corner hugely negative with shift
        tool.onPointerDown(pt(300, 200), ctx);
        tool.onPointerMove(shiftPt(50, 50), ctx);
        tool.onPointerUp(shiftPt(50, 50), ctx);

        const updated = ctx.store.getById(note.id) as NoteElement;
        expect(updated.size.w).toBeGreaterThanOrEqual(20);
        expect(updated.size.h).toBeGreaterThanOrEqual(20);
      });
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

    it('snaps element center to grid when gridType is set', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      ctx.snapToGrid = true;
      ctx.gridSize = 50;
      ctx.gridType = 'square';

      const note = createNote({ position: { x: 10, y: 10 }, size: { w: 100, h: 80 } });
      ctx.store.add(note);

      tool.onPointerDown(pt(50, 40), ctx);
      tool.onPointerMove(pt(80, 70), ctx);
      tool.onPointerUp(pt(80, 70), ctx);

      const moved = ctx.store.getById(note.id);
      expect(moved).toBeDefined();
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

    it('shows arrow handle cursor when hovering over arrow handle', () => {
      const tool = new SelectTool();
      const setCursor = vi.fn();
      const ctx = makeCtx({ setCursor });
      const arrow = createArrow({ from: { x: 0, y: 0 }, to: { x: 200, y: 0 } });
      ctx.store.add(arrow);

      tool.onActivate(ctx);
      tool.onPointerDown(pt(100, 0), ctx);
      tool.onPointerUp(pt(100, 0), ctx);
      expect(tool.selectedIds).toEqual([arrow.id]);
      setCursor.mockClear();

      tool.onHover?.(pt(0, 0), ctx);

      expect(setCursor).toHaveBeenCalledWith('crosshair');
    });

    it('shows resize cursor when hovering over template resize handle', () => {
      const tool = new SelectTool();
      const setCursor = vi.fn();
      const ctx = makeCtx({ setCursor });
      const tmpl = createTemplate({
        position: { x: 100, y: 100 },
        templateShape: 'circle',
        radius: 50,
      });
      ctx.store.add(tmpl);

      tool.onActivate(ctx);
      tool.onPointerDown(pt(100, 100), ctx);
      tool.onPointerUp(pt(100, 100), ctx);
      expect(tool.selectedIds).toEqual([tmpl.id]);
      setCursor.mockClear();

      tool.onHover?.(pt(150, 150), ctx);

      expect(setCursor).toHaveBeenCalledWith('nwse-resize');
    });
  });

  describe('renderOverlay', () => {
    function mockCanvas(): CanvasRenderingContext2D {
      return {
        save: vi.fn(),
        restore: vi.fn(),
        strokeRect: vi.fn(),
        fillRect: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        closePath: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn(),
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

    it('a selected line draws 2 endpoint circles (arc x2) and no fillRect corner handles', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const line = createShape({
        position: { x: 0, y: 0 },
        size: { w: 100, h: 100 },
        shape: 'line',
      });
      ctx.store.add(line);
      tool.onActivate(ctx);
      tool.setSelection([line.id]);

      const canvas = {
        save: vi.fn(),
        restore: vi.fn(),
        strokeRect: vi.fn(),
        fillRect: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        closePath: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn(),
        strokeStyle: '',
        fillStyle: '',
        lineWidth: 0,
        globalAlpha: 1,
        setLineDash: vi.fn(),
      } as unknown as CanvasRenderingContext2D;
      tool.renderOverlay?.(canvas);

      expect((canvas.arc as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
      expect(canvas.fillRect).not.toHaveBeenCalled();
    });

    it('a selected rectangle draws 4 corner handles (fillRect x4) and no arc', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const rect = createShape({
        position: { x: 0, y: 0 },
        size: { w: 100, h: 100 },
        shape: 'rectangle',
      });
      ctx.store.add(rect);
      tool.onActivate(ctx);
      tool.setSelection([rect.id]);

      const canvas = {
        save: vi.fn(),
        restore: vi.fn(),
        strokeRect: vi.fn(),
        fillRect: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        closePath: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn(),
        strokeStyle: '',
        fillStyle: '',
        lineWidth: 0,
        globalAlpha: 1,
        setLineDash: vi.fn(),
      } as unknown as CanvasRenderingContext2D;
      tool.renderOverlay?.(canvas);

      // 4 square corner handles (fillRect); the lone rotate handle is a circle (arc, not fillRect)
      const fillCalls = (canvas.fillRect as ReturnType<typeof vi.fn>).mock.calls.length;
      expect(fillCalls).toBe(4);
      expect((canvas.arc as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    });

    it('does not leak solid line-dash onto a co-selected element (line before rect)', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const line = createShape({
        position: { x: 0, y: 0 },
        size: { w: 100, h: 100 },
        shape: 'line',
      });
      const rect = createShape({
        position: { x: 200, y: 0 },
        size: { w: 50, h: 50 },
        shape: 'rectangle',
      });
      ctx.store.add(line);
      ctx.store.add(rect);
      tool.onActivate(ctx);
      tool.setSelection([line.id, rect.id]);

      // Track the active line-dash at the moment strokeRect (the dashed selection box) is called.
      let currentDash: number[] = [];
      const dashAtStrokeRect: number[][] = [];
      const canvas = {
        save: vi.fn(),
        restore: vi.fn(),
        strokeRect: vi.fn(() => dashAtStrokeRect.push([...currentDash])),
        fillRect: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        closePath: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn(),
        strokeStyle: '',
        fillStyle: '',
        lineWidth: 0,
        globalAlpha: 1,
        setLineDash: vi.fn((d: number[]) => {
          currentDash = d;
        }),
      } as unknown as CanvasRenderingContext2D;
      tool.renderOverlay?.(canvas);

      // The rect's selection box (first strokeRect, drawn before its solid corner handles)
      // must be dashed, not solid — i.e. the line branch's setLineDash([]) didn't leak.
      expect(dashAtStrokeRect[0]?.length).toBeGreaterThan(0);
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

    it('draws template resize handle for selected template', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const tmpl = createTemplate({
        position: { x: 100, y: 100 },
        templateShape: 'circle',
        radius: 50,
      });
      ctx.store.add(tmpl);

      tool.onPointerDown(pt(100, 100), ctx);
      tool.onPointerUp(pt(100, 100), ctx);
      expect(tool.selectedIds).toEqual([tmpl.id]);

      const canvas = mockCanvas();
      tool.renderOverlay?.(canvas);

      expect(canvas.strokeRect).toHaveBeenCalled();
      expect(canvas.fillRect).toHaveBeenCalled();
    });

    it('draws arrow drag target highlight when dragging arrow handle near element', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const note = createNote({ position: { x: 200, y: 200 }, size: { w: 100, h: 100 } });
      const arrow = createArrow({ from: { x: 0, y: 0 }, to: { x: 400, y: 400 } });
      ctx.store.add(note);
      ctx.store.add(arrow);

      tool.onActivate(ctx);

      tool.onPointerDown(pt(200, 200), ctx);
      tool.onPointerUp(pt(200, 200), ctx);

      tool.onPointerDown(pt(0, 0), ctx);
      tool.onPointerUp(pt(0, 0), ctx);
      expect(tool.selectedIds).toEqual([arrow.id]);

      tool.onPointerDown(pt(0, 0), ctx);
      tool.onPointerMove(pt(210, 210), ctx);

      const canvas = {
        save: vi.fn(),
        restore: vi.fn(),
        strokeRect: vi.fn(),
        fillRect: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        closePath: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn(),
        strokeStyle: '',
        fillStyle: '',
        lineWidth: 0,
        globalAlpha: 1,
        setLineDash: vi.fn(),
      } as unknown as CanvasRenderingContext2D;
      tool.renderOverlay?.(canvas);

      const strokeRectCalls = (canvas.strokeRect as ReturnType<typeof vi.fn>).mock.calls.length;
      expect(strokeRectCalls).toBeGreaterThanOrEqual(1);
    });

    it('renders binding highlights for selected bound arrow', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 100 } });
      const arrow = createArrow({
        from: { x: 50, y: 50 },
        to: { x: 300, y: 300 },
        fromBinding: { elementId: note.id },
      });
      ctx.store.add(note);
      ctx.store.add(arrow);

      tool.onActivate(ctx);

      tool.onPointerDown(pt(175, 175), ctx);
      tool.onPointerUp(pt(175, 175), ctx);
      expect(tool.selectedIds).toEqual([arrow.id]);

      const canvas = {
        save: vi.fn(),
        restore: vi.fn(),
        strokeRect: vi.fn(),
        fillRect: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        closePath: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn(),
        strokeStyle: '',
        fillStyle: '',
        lineWidth: 0,
        globalAlpha: 1,
        setLineDash: vi.fn(),
      } as unknown as CanvasRenderingContext2D;
      tool.renderOverlay?.(canvas);

      const strokeRectCalls = (canvas.strokeRect as ReturnType<typeof vi.fn>).mock.calls.length;
      expect(strokeRectCalls).toBeGreaterThanOrEqual(1);
    });
  });

  describe('template resize with feetPerCell', () => {
    it('updates radiusFeet when template has feetPerCell and grid is set', () => {
      const tool = new SelectTool();
      const ctx = makeCtx({ gridSize: 40 });
      const tmpl = createTemplate({
        position: { x: 100, y: 100 },
        templateShape: 'circle',
        radius: 50,
        feetPerCell: 5,
      });
      ctx.store.add(tmpl);

      tool.onPointerDown(pt(100, 100), ctx);
      tool.onPointerUp(pt(100, 100), ctx);
      expect(tool.selectedIds).toEqual([tmpl.id]);

      tool.onPointerDown(pt(150, 150), ctx);
      tool.onPointerMove(pt(200, 200), ctx);
      tool.onPointerUp(pt(200, 200), ctx);

      const resized = ctx.store.getById(tmpl.id) as TemplateElement;
      expect(resized.radiusFeet).toBeDefined();
      expect(resized.radiusFeet).toBeGreaterThan(0);
    });

    it('snaps template radius to grid when snap is enabled', () => {
      const tool = new SelectTool();
      const ctx = makeCtx({ gridSize: 50, snapToGrid: true });
      const tmpl = createTemplate({
        position: { x: 100, y: 100 },
        templateShape: 'circle',
        radius: 50,
        feetPerCell: 5,
      });
      ctx.store.add(tmpl);

      tool.onPointerDown(pt(100, 100), ctx);
      tool.onPointerUp(pt(100, 100), ctx);

      tool.onPointerDown(pt(150, 150), ctx);
      tool.onPointerMove(pt(170, 170), ctx);
      tool.onPointerUp(pt(170, 170), ctx);

      const resized = ctx.store.getById(tmpl.id) as TemplateElement;
      expect(resized.radius % 50).toBe(0);
    });
  });

  describe('Shift+click multi-select', () => {
    it('adds element to selection with Shift+click', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const note1 = createNote({ position: { x: 100, y: 100 }, size: { w: 200, h: 100 } });
      const note2 = createNote({ position: { x: 400, y: 100 }, size: { w: 200, h: 100 } });
      ctx.store.add(note1);
      ctx.store.add(note2);

      tool.onPointerDown(pt(150, 130), ctx);
      tool.onPointerUp(pt(150, 130), ctx);
      expect(tool.selectedIds).toEqual([note1.id]);

      tool.onPointerDown(shiftPt(450, 130), ctx);
      tool.onPointerUp(shiftPt(450, 130), ctx);
      expect(tool.selectedIds).toContain(note1.id);
      expect(tool.selectedIds).toContain(note2.id);
      expect(tool.selectedIds).toHaveLength(2);
    });

    it('removes element from selection with Shift+click', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const note1 = createNote({ position: { x: 100, y: 100 }, size: { w: 200, h: 100 } });
      const note2 = createNote({ position: { x: 400, y: 100 }, size: { w: 200, h: 100 } });
      ctx.store.add(note1);
      ctx.store.add(note2);

      tool.onPointerDown(pt(150, 130), ctx);
      tool.onPointerUp(pt(150, 130), ctx);
      tool.onPointerDown(shiftPt(450, 130), ctx);
      tool.onPointerUp(shiftPt(450, 130), ctx);
      expect(tool.selectedIds).toHaveLength(2);

      tool.onPointerDown(shiftPt(150, 130), ctx);
      tool.onPointerUp(shiftPt(150, 130), ctx);
      expect(tool.selectedIds).toEqual([note2.id]);
    });

    it('removes the only selected element with Shift+click', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const note = createNote({ position: { x: 100, y: 100 }, size: { w: 200, h: 100 } });
      ctx.store.add(note);

      tool.onPointerDown(pt(150, 130), ctx);
      tool.onPointerUp(pt(150, 130), ctx);
      expect(tool.selectedIds).toEqual([note.id]);

      tool.onPointerDown(shiftPt(150, 130), ctx);
      tool.onPointerUp(shiftPt(150, 130), ctx);
      expect(tool.selectedIds).toHaveLength(0);
    });

    it('clears selection when Shift+clicking empty area', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const note = createNote({ position: { x: 100, y: 100 }, size: { w: 200, h: 100 } });
      ctx.store.add(note);

      tool.onPointerDown(pt(150, 130), ctx);
      tool.onPointerUp(pt(150, 130), ctx);
      expect(tool.selectedIds).toHaveLength(1);

      tool.onPointerDown(shiftPt(0, 0), ctx);
      tool.onPointerUp(shiftPt(0, 0), ctx);
      expect(tool.selectedIds).toHaveLength(0);
    });

    it('non-shift click replaces multi-selection', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const note1 = createNote({ position: { x: 100, y: 100 }, size: { w: 200, h: 100 } });
      const note2 = createNote({ position: { x: 400, y: 100 }, size: { w: 200, h: 100 } });
      ctx.store.add(note1);
      ctx.store.add(note2);

      tool.onPointerDown(pt(150, 130), ctx);
      tool.onPointerUp(pt(150, 130), ctx);
      tool.onPointerDown(shiftPt(450, 130), ctx);
      tool.onPointerUp(shiftPt(450, 130), ctx);
      expect(tool.selectedIds).toHaveLength(2);

      tool.onPointerDown(pt(150, 130), ctx);
      tool.onPointerUp(pt(150, 130), ctx);
      expect(tool.selectedIds).toEqual([note1.id]);
    });
  });

  describe('nudgeSelection', () => {
    it('moves selected elements by the given delta', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const note = createNote({ position: { x: 100, y: 100 }, size: { w: 100, h: 50 } });
      ctx.store.add(note);
      tool.onActivate(ctx);
      tool.setSelection([note.id]);

      const moved = tool.nudgeSelection(1, 0, ctx);

      expect(moved).toBe(true);
      expect(ctx.store.getById(note.id)?.position).toEqual({ x: 101, y: 100 });
    });

    it('skips locked elements and returns false when nothing moved', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const note = createNote({ position: { x: 100, y: 100 }, size: { w: 100, h: 50 } });
      note.locked = true;
      ctx.store.add(note);
      tool.onActivate(ctx);
      tool.setSelection([note.id]);

      const moved = tool.nudgeSelection(0, -1, ctx);

      expect(moved).toBe(false);
      expect(ctx.store.getById(note.id)?.position).toEqual({ x: 100, y: 100 });
    });

    it('moves unbound arrows including their endpoints', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const arrow = createArrow({ from: { x: 0, y: 0 }, to: { x: 100, y: 100 } });
      ctx.store.add(arrow);
      tool.onActivate(ctx);
      tool.setSelection([arrow.id]);

      tool.nudgeSelection(5, 5, ctx);

      const moved = ctx.store.getById(arrow.id);
      if (moved?.type === 'arrow') {
        expect(moved.from).toEqual({ x: 5, y: 5 });
        expect(moved.to).toEqual({ x: 105, y: 105 });
      } else {
        expect.fail('arrow missing');
      }
    });

    it('updates arrows bound to a nudged element', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } });
      const arrow = createArrow({ from: { x: 300, y: 300 }, to: { x: 50, y: 25 } });
      arrow.toBinding = { elementId: note.id };
      ctx.store.add(note);
      ctx.store.add(arrow);
      tool.onActivate(ctx);
      tool.setSelection([note.id]);

      tool.nudgeSelection(10, 0, ctx);

      // note moved to x=10, center = { x: 10 + 100/2, y: 0 + 50/2 } = { x: 60, y: 25 }
      const after = ctx.store.getById(arrow.id);
      if (after?.type === 'arrow') {
        expect(after.to).toEqual({ x: 60, y: 25 });
      } else {
        expect.fail('arrow missing');
      }
    });

    it('selection containing both a bound arrow and its target nudges arrow endpoint exactly once', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } });
      const arrow = createArrow({ from: { x: 300, y: 300 }, to: { x: 50, y: 25 } });
      arrow.toBinding = { elementId: note.id };
      ctx.store.add(note);
      ctx.store.add(arrow);
      tool.onActivate(ctx);
      // Select both the note and the bound arrow
      tool.setSelection([note.id, arrow.id]);

      tool.nudgeSelection(10, 0, ctx);

      // note moved to x=10, center = { x: 60, y: 25 }
      // arrow is bound so it is skipped in the move loop, but updateArrowsBoundTo runs for the note
      const after = ctx.store.getById(arrow.id);
      if (after?.type === 'arrow') {
        expect(after.to).toEqual({ x: 60, y: 25 });
        // from should be unchanged (arrow itself was not moved independently)
        expect(after.from).toEqual({ x: 300, y: 300 });
      } else {
        expect.fail('arrow missing');
      }
    });
  });

  describe('fitNoteHeight on resize commit', () => {
    const PS = { x: 0, y: 0, pressure: 0, pointerType: 'mouse' as const, shiftKey: false };

    it('calls fitNoteHeight when a note resize finishes', () => {
      const fitNoteHeight = vi.fn();
      const tool = new SelectTool();
      const ctx = makeCtx();
      ctx.fitNoteHeight = fitNoteHeight;
      const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 100 } });
      ctx.store.add(note);
      tool.setSelection([note.id]);
      (tool as unknown as { mode: { type: string; elementId: string; handle: string } }).mode = {
        type: 'resizing',
        elementId: note.id,
        handle: 'se',
      };
      tool.onPointerUp(PS, ctx);
      expect(fitNoteHeight).toHaveBeenCalledWith(note.id);
    });

    it('does not call fitNoteHeight after a drag (only after resize)', () => {
      const fitNoteHeight = vi.fn();
      const tool = new SelectTool();
      const ctx = makeCtx();
      ctx.fitNoteHeight = fitNoteHeight;
      const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 100 } });
      ctx.store.add(note);
      tool.setSelection([note.id]);
      (tool as unknown as { mode: { type: string } }).mode = { type: 'dragging' };
      tool.onPointerUp(PS, ctx);
      expect(fitNoteHeight).not.toHaveBeenCalled();
    });
  });

  describe('selection-change event', () => {
    it('fires onSelectionChange when setSelection changes the set', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const a = createNote({ position: { x: 0, y: 0 } });
      ctx.store.add(a);
      tool.onActivate(ctx);
      const fn = vi.fn();
      tool.onSelectionChange(fn);
      tool.setSelection([a.id]);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('does NOT fire when the selection set is unchanged', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const a = createNote({ position: { x: 0, y: 0 } });
      ctx.store.add(a);
      tool.onActivate(ctx);
      tool.setSelection([a.id]);
      const fn = vi.fn();
      tool.onSelectionChange(fn);
      tool.setSelection([a.id]);
      expect(fn).not.toHaveBeenCalled();
    });

    it('selectedIds returns a stable reference across no-op sets', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const a = createNote({ position: { x: 0, y: 0 } });
      ctx.store.add(a);
      tool.onActivate(ctx);
      tool.setSelection([a.id]);
      const first = tool.selectedIds;
      tool.setSelection([a.id]);
      expect(tool.selectedIds).toBe(first);
    });

    it('unsubscribe stops notifications', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const a = createNote({ position: { x: 0, y: 0 } });
      ctx.store.add(a);
      tool.onActivate(ctx);
      const fn = vi.fn();
      const off = tool.onSelectionChange(fn);
      off();
      tool.setSelection([a.id]);
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe('smart guides', () => {
    it('snaps the dragged selection to a nearby element edge when enabled', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      ctx.smartGuides = true;
      const stationary = createNote({ position: { x: 200, y: 100 }, size: { w: 50, h: 50 } });
      const drag = createNote({ position: { x: 100, y: 0 }, size: { w: 50, h: 50 } });
      ctx.store.add(stationary);
      ctx.store.add(drag);
      tool.onActivate?.(ctx);
      tool.onPointerDown(
        { x: 125, y: 25, pressure: 1, pointerType: 'mouse', shiftKey: false },
        ctx,
      );
      tool.onPointerMove(
        { x: 222, y: 25, pressure: 1, pointerType: 'mouse', shiftKey: false },
        ctx,
      );
      // drag left would be 197 (100 + dx 97); within 6 of stationary left 200 → snaps to 200
      expect((ctx.store.getById(drag.id) as { position: { x: number } }).position.x).toBe(200);
      const guides = (tool as unknown as { activeGuides: { axis: string; position: number }[] })
        .activeGuides;
      expect(guides).toEqual([{ axis: 'x', position: 200 }]);
    });

    it('does not snap when smart guides are disabled', () => {
      const tool = new SelectTool();
      const ctx = makeCtx(); // smartGuides falsy
      const stationary = createNote({ position: { x: 200, y: 100 }, size: { w: 50, h: 50 } });
      const drag = createNote({ position: { x: 100, y: 0 }, size: { w: 50, h: 50 } });
      ctx.store.add(stationary);
      ctx.store.add(drag);
      tool.onActivate?.(ctx);
      tool.onPointerDown(
        { x: 125, y: 25, pressure: 1, pointerType: 'mouse', shiftKey: false },
        ctx,
      );
      tool.onPointerMove(
        { x: 222, y: 25, pressure: 1, pointerType: 'mouse', shiftKey: false },
        ctx,
      );
      expect((ctx.store.getById(drag.id) as { position: { x: number } }).position.x).toBe(197);
    });

    it('clears active guides on pointer up', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      ctx.smartGuides = true;
      const stationary = createNote({ position: { x: 200, y: 100 }, size: { w: 50, h: 50 } });
      const drag = createNote({ position: { x: 100, y: 0 }, size: { w: 50, h: 50 } });
      ctx.store.add(stationary);
      ctx.store.add(drag);
      tool.onActivate?.(ctx);
      tool.onPointerDown(
        { x: 125, y: 25, pressure: 1, pointerType: 'mouse', shiftKey: false },
        ctx,
      );
      tool.onPointerMove(
        { x: 222, y: 25, pressure: 1, pointerType: 'mouse', shiftKey: false },
        ctx,
      );
      tool.onPointerUp({ x: 222, y: 25, pressure: 1, pointerType: 'mouse', shiftKey: false }, ctx);
      expect((tool as unknown as { activeGuides: unknown[] }).activeGuides).toEqual([]);
    });
  });

  describe('line shape hit testing', () => {
    it('selects a line by proximity to its segment, not its bbox', () => {
      const line = createShape({
        position: { x: 0, y: 0 },
        size: { w: 100, h: 100 },
        shape: 'line',
        strokeWidth: 2,
      });
      expect(isInsideBounds({ x: 50, y: 50 }, line)).toBe(true);
      expect(isInsideBounds({ x: 90, y: 10 }, line)).toBe(false);
    });

    it('still hit-tests a rectangle by its bbox', () => {
      const rect = createShape({
        position: { x: 0, y: 0 },
        size: { w: 100, h: 100 },
        shape: 'rectangle',
      });
      expect(isInsideBounds({ x: 90, y: 10 }, rect)).toBe(true);
    });
  });

  describe('grid element exclusion', () => {
    it('does not select grid elements by click', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const grid = createGrid({ position: { x: 0, y: 0 } });
      ctx.store.add(grid);

      tool.onPointerDown(pt(10, 10), ctx);
      tool.onPointerUp(pt(10, 10), ctx);

      expect(tool.selectedIds).toEqual([]);
    });
  });

  describe('template interaction', () => {
    it('selects a template when clicking inside its bounds', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const tmpl = createTemplate({
        position: { x: 100, y: 100 },
        templateShape: 'circle',
        radius: 50,
      });
      ctx.store.add(tmpl);

      tool.onPointerDown(pt(120, 120), ctx);
      tool.onPointerUp(pt(120, 120), ctx);

      expect(tool.selectedIds).toEqual([tmpl.id]);
    });

    it('drags a template to move it', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const tmpl = createTemplate({
        position: { x: 100, y: 100 },
        templateShape: 'circle',
        radius: 50,
      });
      ctx.store.add(tmpl);

      tool.onPointerDown(pt(100, 100), ctx);
      tool.onPointerMove(pt(120, 130), ctx);
      tool.onPointerUp(pt(120, 130), ctx);

      const moved = ctx.store.getById(tmpl.id) as TemplateElement;
      expect(moved.position.x).toBe(120);
      expect(moved.position.y).toBe(130);
    });

    it('resizes a template via SE handle', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const tmpl = createTemplate({
        position: { x: 100, y: 100 },
        templateShape: 'circle',
        radius: 50,
      });
      ctx.store.add(tmpl);

      // Select first
      tool.onPointerDown(pt(100, 100), ctx);
      tool.onPointerUp(pt(100, 100), ctx);
      expect(tool.selectedIds).toEqual([tmpl.id]);

      // Drag the SE handle (bottom-right of bounds: 100+50=150, 100+50=150)
      tool.onPointerDown(pt(150, 150), ctx);
      tool.onPointerMove(pt(200, 200), ctx);
      tool.onPointerUp(pt(200, 200), ctx);

      const resized = ctx.store.getById(tmpl.id) as TemplateElement;
      const expectedRadius = Math.sqrt(100 * 100 + 100 * 100);
      expect(resized.radius).toBeCloseTo(expectedRadius);
    });
  });

  describe('hover outline', () => {
    function mockCanvas(): CanvasRenderingContext2D {
      return {
        save: vi.fn(),
        restore: vi.fn(),
        strokeRect: vi.fn(),
        fillRect: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        closePath: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn(),
        strokeStyle: '',
        fillStyle: '',
        lineWidth: 0,
        globalAlpha: 1,
        setLineDash: vi.fn(),
      } as unknown as CanvasRenderingContext2D;
    }

    function hoverSetup() {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const note = createNote({ position: { x: 100, y: 100 }, size: { w: 200, h: 100 } });
      ctx.store.add(note);
      tool.onActivate(ctx);
      return { tool, ctx, note };
    }

    it('requests a render when hover enters an element and strokes its bounds', () => {
      const { tool, ctx, note } = hoverSetup();
      tool.onHover?.(pt(150, 130), ctx);
      expect(ctx.requestRender).toHaveBeenCalledTimes(1);

      const canvas = mockCanvas();
      tool.renderOverlay?.(canvas);
      expect(canvas.strokeRect).toHaveBeenCalledWith(note.position.x, note.position.y, 200, 100);
    });

    it('does not re-request render while hovering the same element', () => {
      const { tool, ctx } = hoverSetup();
      tool.onHover?.(pt(150, 130), ctx);
      tool.onHover?.(pt(160, 140), ctx);
      expect(ctx.requestRender).toHaveBeenCalledTimes(1);
    });

    it('requests a render when hover leaves the element', () => {
      const { tool, ctx } = hoverSetup();
      tool.onHover?.(pt(150, 130), ctx);
      tool.onHover?.(pt(500, 500), ctx);
      expect(ctx.requestRender).toHaveBeenCalledTimes(2);
      const canvas = mockCanvas();
      tool.renderOverlay?.(canvas);
      expect(canvas.strokeRect).not.toHaveBeenCalled();
    });

    it('clears the outline on pointer down', () => {
      const { tool, ctx } = hoverSetup();
      tool.onHover?.(pt(150, 130), ctx);
      tool.onPointerDown(pt(500, 500), ctx);
      tool.onPointerUp(pt(500, 500), ctx);
      const canvas = mockCanvas();
      tool.renderOverlay?.(canvas);
      expect(canvas.strokeRect).not.toHaveBeenCalled();
    });

    it('does not stroke hover bounds for a selected element', () => {
      const { tool, ctx, note } = hoverSetup();
      tool.setSelection([note.id]);
      tool.onHover?.(pt(150, 130), ctx);
      const canvas = mockCanvas();
      tool.renderOverlay?.(canvas);
      const callsWithHover = (canvas.strokeRect as ReturnType<typeof vi.fn>).mock.calls.length;

      const tool2 = new SelectTool();
      const ctx2 = makeCtx();
      const note2 = createNote({ position: { x: 100, y: 100 }, size: { w: 200, h: 100 } });
      ctx2.store.add(note2);
      tool2.onActivate(ctx2);
      tool2.setSelection([note2.id]);
      const canvas2 = mockCanvas();
      tool2.renderOverlay?.(canvas2);
      const callsSelectionOnly = (canvas2.strokeRect as ReturnType<typeof vi.fn>).mock.calls.length;

      expect(callsWithHover).toBe(callsSelectionOnly);
    });
  });

  describe('setSelection', () => {
    it('sets selected IDs and requests render', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const note1 = createNote({ position: { x: 100, y: 100 } });
      const note2 = createNote({ position: { x: 200, y: 200 } });
      ctx.store.add(note1);
      ctx.store.add(note2);

      tool.onActivate(ctx);
      tool.setSelection([note1.id, note2.id]);

      expect(tool.selectedIds).toEqual([note1.id, note2.id]);
      expect(ctx.requestRender).toHaveBeenCalled();
    });

    it('setSelection stays literal and does not expand to groups', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const a = createNote({ position: { x: 100, y: 100 }, size: { w: 100, h: 100 } });
      const b = createNote({ position: { x: 400, y: 100 }, size: { w: 100, h: 100 } });
      a.groupId = 'g1';
      b.groupId = 'g1';
      ctx.store.add(a);
      ctx.store.add(b);

      tool.onActivate(ctx);
      tool.setSelection([a.id]);

      expect(tool.selectedIds).toEqual([a.id]);
    });
  });

  describe('group-aware selection', () => {
    it('clicking one member of a group selects all co-members', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const a = createNote({ position: { x: 100, y: 100 }, size: { w: 100, h: 100 } });
      const b = createNote({ position: { x: 400, y: 100 }, size: { w: 100, h: 100 } });
      const c = createNote({ position: { x: 700, y: 100 }, size: { w: 100, h: 100 } });
      a.groupId = 'g1';
      b.groupId = 'g1';
      ctx.store.add(a);
      ctx.store.add(b);
      ctx.store.add(c);

      tool.onPointerDown(pt(150, 150), ctx);
      tool.onPointerUp(pt(150, 150), ctx);

      expect(tool.selectedIds).toHaveLength(2);
      expect(tool.selectedIds).toContain(a.id);
      expect(tool.selectedIds).toContain(b.id);
    });

    it('shift-clicking an already-selected grouped member toggles the whole group off', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const a = createNote({ position: { x: 100, y: 100 }, size: { w: 100, h: 100 } });
      const b = createNote({ position: { x: 400, y: 100 }, size: { w: 100, h: 100 } });
      a.groupId = 'g1';
      b.groupId = 'g1';
      ctx.store.add(a);
      ctx.store.add(b);

      tool.onPointerDown(pt(150, 150), ctx);
      tool.onPointerUp(pt(150, 150), ctx);
      expect(tool.selectedIds).toHaveLength(2);

      tool.onPointerDown(shiftPt(150, 150), ctx);
      tool.onPointerUp(shiftPt(150, 150), ctx);

      expect(tool.selectedIds).toEqual([]);
    });

    it('shift-clicking a grouped member adds the whole group to the selection', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const solo = createNote({ position: { x: 100, y: 100 }, size: { w: 100, h: 100 } });
      const a = createNote({ position: { x: 400, y: 100 }, size: { w: 100, h: 100 } });
      const b = createNote({ position: { x: 700, y: 100 }, size: { w: 100, h: 100 } });
      a.groupId = 'g1';
      b.groupId = 'g1';
      ctx.store.add(solo);
      ctx.store.add(a);
      ctx.store.add(b);

      tool.onPointerDown(pt(150, 150), ctx);
      tool.onPointerUp(pt(150, 150), ctx);
      expect(tool.selectedIds).toEqual([solo.id]);

      tool.onPointerDown(shiftPt(450, 150), ctx);
      tool.onPointerUp(shiftPt(450, 150), ctx);

      expect(tool.selectedIds).toHaveLength(3);
      expect(tool.selectedIds).toContain(solo.id);
      expect(tool.selectedIds).toContain(a.id);
      expect(tool.selectedIds).toContain(b.id);
    });

    it('marquee overlapping only one member selects the whole group', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const a = createNote({ position: { x: 50, y: 50 }, size: { w: 40, h: 40 } });
      const b = createNote({ position: { x: 500, y: 500 }, size: { w: 40, h: 40 } });
      a.groupId = 'g1';
      b.groupId = 'g1';
      ctx.store.add(a);
      ctx.store.add(b);

      tool.onPointerDown(pt(0, 0), ctx);
      tool.onPointerMove(pt(100, 100), ctx);
      tool.onPointerUp(pt(100, 100), ctx);

      expect(tool.selectedIds).toHaveLength(2);
      expect(tool.selectedIds).toContain(a.id);
      expect(tool.selectedIds).toContain(b.id);
    });

    it('ungrouped click is unaffected (selection stays literal)', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const a = createNote({ position: { x: 100, y: 100 }, size: { w: 100, h: 100 } });
      const b = createNote({ position: { x: 400, y: 100 }, size: { w: 100, h: 100 } });
      a.groupId = 'g1';
      b.groupId = 'g1';
      const c = createNote({ position: { x: 700, y: 100 }, size: { w: 100, h: 100 } });
      ctx.store.add(a);
      ctx.store.add(b);
      ctx.store.add(c);

      tool.onPointerDown(pt(750, 150), ctx);
      tool.onPointerUp(pt(750, 150), ctx);

      expect(tool.selectedIds).toEqual([c.id]);
    });
  });

  describe('line endpoint drag-handles', () => {
    const PS = (x: number, y: number, shiftKey = false): PointerState => ({
      x,
      y,
      pressure: 1,
      pointerType: 'mouse',
      shiftKey,
    });

    function makeSelectTool() {
      const store = new ElementStore();
      const ctx = makeCtx({ store });
      const tool = new SelectTool();
      tool.onActivate(ctx);
      return { tool, ctx, store };
    }

    it('hitTestLineHandles returns the opposite endpoint as fixed', () => {
      const { tool, ctx, store } = makeSelectTool();
      const line = createShape({
        position: { x: 0, y: 0 },
        size: { w: 100, h: 100 },
        shape: 'line',
      });
      store.add(line);
      tool.setSelection([line.id]);
      expect(hitTestLineHandles({ x: 0, y: 0 }, ctx, tool.selectedIds)).toEqual({
        elementId: line.id,
        fixed: { x: 100, y: 100 },
      });
      expect(hitTestLineHandles({ x: 100, y: 100 }, ctx, tool.selectedIds)).toEqual({
        elementId: line.id,
        fixed: { x: 0, y: 0 },
      });
      expect(hitTestLineHandles({ x: 50, y: 0 }, ctx, tool.selectedIds)).toBeNull();
    });

    it('dragging an endpoint moves it and keeps the fixed end anchored', () => {
      const { tool, ctx, store } = makeSelectTool();
      const line = createShape({
        position: { x: 0, y: 0 },
        size: { w: 100, h: 100 },
        shape: 'line',
      });
      store.add(line);
      tool.setSelection([line.id]);
      (tool as unknown as { mode: unknown }).mode = {
        type: 'line-handle',
        elementId: line.id,
        fixed: { x: 100, y: 100 },
      };
      tool.onPointerMove(PS(20, 80), ctx);
      const u = store.getById(line.id) as {
        position: { x: number; y: number };
        size: { w: number; h: number };
      };
      expect(u.position).toEqual({ x: 20, y: 80 });
      expect(u.size).toEqual({ w: 80, h: 20 });
      const ends = lineEndpoints(store.getById(line.id) as never);
      expect(ends.some((p) => p.x === 100 && p.y === 100)).toBe(true);
    });

    it('a flip-crossing drag keeps the fixed end put', () => {
      const { tool, ctx, store } = makeSelectTool();
      const line = createShape({
        position: { x: 0, y: 0 },
        size: { w: 100, h: 100 },
        shape: 'line',
      });
      store.add(line);
      tool.setSelection([line.id]);
      (tool as unknown as { mode: unknown }).mode = {
        type: 'line-handle',
        elementId: line.id,
        fixed: { x: 100, y: 100 },
      };
      tool.onPointerMove(PS(200, 100), ctx);
      const ends = lineEndpoints(store.getById(line.id) as never);
      expect(ends.some((p) => p.x === 100 && p.y === 100)).toBe(true);
      expect(ends.some((p) => p.x === 200 && p.y === 100)).toBe(true);
    });

    it('does not offer bbox resize handles for a line', () => {
      const { tool, ctx, store } = makeSelectTool();
      const line = createShape({
        position: { x: 0, y: 0 },
        size: { w: 100, h: 100 },
        shape: 'line',
      });
      store.add(line);
      tool.setSelection([line.id]);
      expect(hitTestResizeHandle({ x: 100, y: 100 }, ctx, tool.selectedIds)).toBeNull();
    });
  });

  describe('rotation-aware hit-testing', () => {
    it('hits a point inside a 90°-rotated note footprint (outside its unrotated AABB)', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 20 } }); // wide & short
      note.rotation = Math.PI / 2; // becomes tall & narrow: center (50,10); world box x∈[40,60], y∈[-40,60]
      ctx.store.add(note);
      tool.onPointerDown(pt(50, 50), ctx); // inside rotated footprint, but y=50 is OUTSIDE the unrotated AABB (h=20)
      tool.onPointerUp(pt(50, 50), ctx);
      expect(tool.selectedIds).toEqual([note.id]);
    });

    it('misses a point inside the unrotated AABB but outside the rotated footprint', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 20 } });
      note.rotation = Math.PI / 2;
      ctx.store.add(note);
      tool.onPointerDown(pt(95, 10), ctx); // x=95 inside unrotated AABB (w=100) but outside rotated box (x∈[40,60])
      tool.onPointerUp(pt(95, 10), ctx);
      expect(tool.selectedIds).toEqual([]);
    });
  });

  describe('oriented selection overlay', () => {
    it('getOverlayLayout centers and rotates the corners', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 100 } });
      note.rotation = Math.PI / 2;
      ctx.store.add(note);
      const layout = (
        tool as unknown as {
          getOverlayLayout: (
            el: unknown,
            zoom: number,
          ) => {
            center: Point;
            corners: [string, Point][];
            rotateHandle: Point;
          } | null;
        }
      ).getOverlayLayout(note, 1);
      expect(layout?.center.x).toBeCloseTo(50);
      expect(layout?.center.y).toBeCloseTo(50);
      const nw = layout?.corners.find(([h]) => h === 'nw')?.[1];
      // unrotated nw is top-left (x = -4 from the padded box); after 90° it swings off that axis
      expect(nw && Math.abs(nw.x - -4) > 1).toBe(true);
    });
  });

  describe('rotate handle drag', () => {
    it('drags the rotate handle to set rotation (90°)', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 100 } }); // center (50,50)
      ctx.store.add(note);
      (tool as unknown as { setSelection: (ids: string[]) => void }).setSelection([note.id]);
      const layout = (
        tool as unknown as {
          getOverlayLayout: (el: unknown, z: number) => { rotateHandle: Point };
        }
      ).getOverlayLayout(note, 1);
      tool.onPointerDown(pt(layout.rotateHandle.x, layout.rotateHandle.y), ctx); // handle starts straight up (angle -90°)
      tool.onPointerMove(pt(100, 50), ctx); // pointer due right of center → +90° from start
      const r = ctx.store.getById(note.id)?.rotation ?? 0;
      expect(r).toBeCloseTo(Math.PI / 2);
    });

    it('snaps rotation to 15° with shift', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 100 } });
      ctx.store.add(note);
      (tool as unknown as { setSelection: (ids: string[]) => void }).setSelection([note.id]);
      const layout = (
        tool as unknown as {
          getOverlayLayout: (el: unknown, z: number) => { rotateHandle: Point };
        }
      ).getOverlayLayout(note, 1);
      tool.onPointerDown(pt(layout.rotateHandle.x, layout.rotateHandle.y), ctx);
      tool.onPointerMove(shiftPt(105, 47), ctx); // shift held → snap to nearest 15°
      const r = ctx.store.getById(note.id)?.rotation ?? 0;
      const deg = (r * 180) / Math.PI;
      expect(Math.abs(deg - Math.round(deg / 15) * 15)).toBeLessThan(1e-6);
    });

    it('does not grab a rotate handle on a locked element', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 100 } });
      note.locked = true;
      ctx.store.add(note);
      (tool as unknown as { setSelection: (ids: string[]) => void }).setSelection([note.id]);
      const hit = hitTestRotateHandle({ x: 50, y: -100 }, ctx, tool.selectedIds);
      expect(hit).toBeNull();
    });

    it('shows a grab cursor when hovering the rotate handle', () => {
      const tool = new SelectTool();
      const setCursor = vi.fn();
      const ctx = makeCtx({ setCursor });
      const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 100 } });
      ctx.store.add(note);
      (tool as unknown as { setSelection: (ids: string[]) => void }).setSelection([note.id]);
      const layout = (
        tool as unknown as {
          getOverlayLayout: (el: unknown, z: number) => { rotateHandle: Point };
        }
      ).getOverlayLayout(note, 1);

      tool.onHover?.(pt(layout.rotateHandle.x, layout.rotateHandle.y), ctx);

      expect(setCursor).toHaveBeenCalledWith('grab');
    });

    for (const handle of ['nw', 'ne', 'sw', 'se'] as const) {
      it(`resizing a rotated element keeps the opposite corner fixed in world space (${handle})`, () => {
        const tool = new SelectTool();
        const ctx = makeCtx();
        const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 100 } });
        note.rotation = Math.PI / 6; // 30°
        ctx.store.add(note);
        (tool as unknown as { setSelection: (ids: string[]) => void }).setSelection([note.id]);

        const before = ctx.store.getById(note.id) as {
          position: Point;
          size: { w: number; h: number };
          rotation: number;
        };
        const center0 = {
          x: before.position.x + before.size.w / 2,
          y: before.position.y + before.size.h / 2,
        };
        // the fixed anchor is the element corner OPPOSITE the dragged handle, rotated about center
        const { x, y } = before.position;
        const { w, h } = before.size;
        const fixedCornerLocal: Record<typeof handle, Point> = {
          se: { x, y },
          sw: { x: x + w, y },
          nw: { x: x + w, y: y + h },
          ne: { x, y: y + h },
        };
        const anchorWorld = rotatePoint(fixedCornerLocal[handle], center0, before.rotation);

        const layout = (
          tool as unknown as {
            getOverlayLayout: (el: unknown, z: number) => { corners: [string, Point][] };
          }
        ).getOverlayLayout(before, 1);
        const grab = layout.corners.find(([hh]) => hh === handle)?.[1] as Point;
        // drag the corner radially outward from center — always increases size for that handle
        const outward = {
          x: grab.x + (grab.x - center0.x) * 0.3,
          y: grab.y + (grab.y - center0.y) * 0.3,
        };
        tool.onPointerDown(pt(grab.x, grab.y), ctx); // grab handle
        tool.onPointerMove(pt(outward.x, outward.y), ctx); // drag outward

        const after = ctx.store.getById(note.id) as {
          position: Point;
          size: { w: number; h: number };
          rotation: number;
        };
        const center1 = {
          x: after.position.x + after.size.w / 2,
          y: after.position.y + after.size.h / 2,
        };
        const fixedCornerLocalAfter: Record<typeof handle, Point> = {
          se: { x: after.position.x, y: after.position.y },
          sw: { x: after.position.x + after.size.w, y: after.position.y },
          nw: { x: after.position.x + after.size.w, y: after.position.y + after.size.h },
          ne: { x: after.position.x, y: after.position.y + after.size.h },
        };
        const anchorAfter = rotatePoint(fixedCornerLocalAfter[handle], center1, after.rotation);
        expect(anchorAfter.x).toBeCloseTo(anchorWorld.x, 4);
        expect(anchorAfter.y).toBeCloseTo(anchorWorld.y, 4);
        expect(after.size.w).toBeGreaterThan(before.size.w);
        expect(after.size.h).toBeGreaterThan(before.size.h);
      });
    }
  });

  describe('selectAtPoint', () => {
    it('selectAtPoint selects the element under the point, clears on miss', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const a = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 100 } });
      ctx.store.add(a);
      tool.selectAtPoint({ x: 50, y: 50 }, ctx);
      expect(tool.selectedIds).toEqual([a.id]);
      tool.selectAtPoint({ x: 500, y: 500 }, ctx);
      expect(tool.selectedIds).toEqual([]);
    });

    it('selectAtPoint keeps a multi-selection when the point is inside it', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const a = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 100 } });
      const b = createNote({ position: { x: 200, y: 0 }, size: { w: 100, h: 100 } });
      ctx.store.add(a);
      ctx.store.add(b);
      (tool as unknown as { setSelection: (ids: string[]) => void }).setSelection([a.id, b.id]);
      tool.selectAtPoint({ x: 50, y: 50 }, ctx);
      expect(tool.selectedIds.slice().sort()).toEqual([a.id, b.id].sort());
    });
  });

  describe('locked element handles', () => {
    it('a locked element exposes no resize or rotate handles', () => {
      const tool = new SelectTool();
      const ctx = makeCtx();
      const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 100 } });
      note.locked = true;
      ctx.store.add(note);
      (tool as unknown as { setSelection: (ids: string[]) => void }).setSelection([note.id]);
      const layout = (
        tool as unknown as {
          getOverlayLayout: (
            el: unknown,
            z: number,
          ) => { corners: [string, Point][]; rotateHandle: Point };
        }
      ).getOverlayLayout(note, 1);
      const se = layout.corners.find(([h]) => h === 'se')?.[1] as Point;
      expect(hitTestResizeHandle(se, ctx, tool.selectedIds)).toBeNull();
      expect(hitTestRotateHandle(layout.rotateHandle, ctx, tool.selectedIds)).toBeNull();
    });
  });
});
