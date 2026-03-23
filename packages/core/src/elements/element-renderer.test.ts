import { describe, it, expect, vi } from 'vitest';
import { ElementRenderer } from './element-renderer';
import type { StrokeElement, ArrowElement, NoteElement } from './types';

function mockCtx(): CanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    closePath: vi.fn(),
    arc: vi.fn(),
    quadraticCurveTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 0,
    lineCap: '',
    lineJoin: '',
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D;
}

function makeStroke(overrides: Partial<StrokeElement> = {}): StrokeElement {
  return {
    id: 'stroke-1',
    type: 'stroke',
    position: { x: 0, y: 0 },
    points: [
      { x: 0, y: 0, pressure: 0.5 },
      { x: 10, y: 10, pressure: 0.5 },
      { x: 20, y: 5, pressure: 0.5 },
    ],
    color: '#000',
    width: 2,
    opacity: 1,
    zIndex: 0,
    locked: false,
    layerId: '',
    ...overrides,
  };
}

function makeArrow(overrides: Partial<ArrowElement> = {}): ArrowElement {
  return {
    id: 'arrow-1',
    type: 'arrow',
    position: { x: 0, y: 0 },
    from: { x: 0, y: 0 },
    to: { x: 100, y: 100 },
    bend: 0,
    color: '#000',
    width: 2,
    zIndex: 0,
    locked: false,
    layerId: '',
    ...overrides,
  };
}

describe('ElementRenderer', () => {
  describe('renderStroke', () => {
    it('draws curved segments through points', () => {
      const renderer = new ElementRenderer();
      const ctx = mockCtx();
      renderer.renderCanvasElement(ctx, makeStroke());

      expect(ctx.beginPath).toHaveBeenCalled();
      expect(ctx.moveTo).toHaveBeenCalled();
      expect(ctx.bezierCurveTo).toHaveBeenCalled();
      expect(ctx.stroke).toHaveBeenCalled();
    });

    it('applies stroke style', () => {
      const renderer = new ElementRenderer();
      const ctx = mockCtx();
      renderer.renderCanvasElement(ctx, makeStroke({ color: '#ff0000', width: 5, opacity: 0.5 }));

      expect(ctx.strokeStyle).toBe('#ff0000');
      expect(ctx.globalAlpha).toBe(0.5);
      expect(ctx.lineWidth).toBeGreaterThan(0);
    });

    it('skips strokes with fewer than 2 points', () => {
      const renderer = new ElementRenderer();
      const ctx = mockCtx();
      renderer.renderCanvasElement(ctx, makeStroke({ points: [{ x: 0, y: 0, pressure: 0.5 }] }));

      expect(ctx.beginPath).not.toHaveBeenCalled();
    });

    it('saves and restores context', () => {
      const renderer = new ElementRenderer();
      const ctx = mockCtx();
      renderer.renderCanvasElement(ctx, makeStroke());

      expect(ctx.save).toHaveBeenCalled();
      expect(ctx.restore).toHaveBeenCalled();
    });
  });

  describe('renderArrow', () => {
    it('draws a line from start to end', () => {
      const renderer = new ElementRenderer();
      const ctx = mockCtx();
      renderer.renderCanvasElement(ctx, makeArrow());

      expect(ctx.moveTo).toHaveBeenCalledWith(0, 0);
      expect(ctx.lineTo).toHaveBeenCalledWith(100, 100);
      expect(ctx.stroke).toHaveBeenCalled();
    });

    it('draws an arrowhead', () => {
      const renderer = new ElementRenderer();
      const ctx = mockCtx();
      renderer.renderCanvasElement(ctx, makeArrow());

      expect(ctx.fill).toHaveBeenCalled();
    });
  });

  describe('isDomElement', () => {
    it('identifies note as a DOM element', () => {
      const renderer = new ElementRenderer();
      const note: NoteElement = {
        id: 'note-1',
        type: 'note',
        position: { x: 0, y: 0 },
        size: { w: 200, h: 100 },
        text: 'Hi',
        backgroundColor: '#ffeb3b',
        zIndex: 0,
        locked: false,
        layerId: '',
      };
      expect(renderer.isDomElement(note)).toBe(true);
    });

    it('identifies stroke as a canvas element', () => {
      const renderer = new ElementRenderer();
      expect(renderer.isDomElement(makeStroke())).toBe(false);
    });
  });
});
