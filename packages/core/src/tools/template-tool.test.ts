// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { TemplateTool } from './template-tool';
import { ElementStore } from '../elements/element-store';
import { Camera } from '../canvas/camera';
import type { ToolContext, PointerState } from './types';
import type { TemplateShape, TemplateElement } from '../elements/types';

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    camera: new Camera(),
    store: new ElementStore(),
    requestRender: vi.fn(),
    switchTool: vi.fn(),
    activeLayerId: 'layer-1',
    ...overrides,
  };
}

function pt(x: number, y: number): PointerState {
  return { x, y, pressure: 0.5, pointerType: 'mouse', shiftKey: false };
}

describe('TemplateTool', () => {
  it('has name "template"', () => {
    expect(new TemplateTool().name).toBe('template');
  });

  it('creates circle template on pointer up', () => {
    const tool = new TemplateTool();
    const ctx = makeCtx();

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(100, 0), ctx);
    tool.onPointerUp(pt(100, 0), ctx);

    const elements = ctx.store.getAll();
    expect(elements).toHaveLength(1);
    const el = elements[0] as TemplateElement;
    expect(el.type).toBe('template');
    expect(el.templateShape).toBe('circle');
    expect(el.radius).toBe(100);
    expect(el.position).toEqual({ x: 0, y: 0 });
  });

  it('creates cone template with angle from drag direction', () => {
    const tool = new TemplateTool({ templateShape: 'cone' });
    const ctx = makeCtx();

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(100, 100), ctx);
    tool.onPointerUp(pt(100, 100), ctx);

    const elements = ctx.store.getAll();
    expect(elements).toHaveLength(1);
    const el = elements[0] as TemplateElement;
    expect(el.templateShape).toBe('cone');
    expect(el.angle).toBeCloseTo(Math.PI / 4);
  });

  it('does not create element for zero-radius drag', () => {
    const tool = new TemplateTool();
    const ctx = makeCtx();

    tool.onPointerDown(pt(50, 50), ctx);
    tool.onPointerUp(pt(50, 50), ctx);

    expect(ctx.store.getAll()).toHaveLength(0);
  });

  it('switches to select tool after placement', () => {
    const tool = new TemplateTool();
    const ctx = makeCtx();

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(100, 0), ctx);
    tool.onPointerUp(pt(100, 0), ctx);

    expect(ctx.switchTool).toHaveBeenCalledWith('select');
  });

  it('assigns active layer to created element', () => {
    const tool = new TemplateTool();
    const ctx = makeCtx({ activeLayerId: 'my-layer' });

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(50, 0), ctx);
    tool.onPointerUp(pt(50, 0), ctx);

    const el = ctx.store.getAll()[0] as TemplateElement;
    expect(el.layerId).toBe('my-layer');
  });

  it('snaps radius to grid when snap is enabled', () => {
    const tool = new TemplateTool();
    const ctx = makeCtx({ snapToGrid: true, gridSize: 50 });

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(80, 0), ctx);
    tool.onPointerUp(pt(80, 0), ctx);

    const el = ctx.store.getAll()[0] as TemplateElement;
    expect(el.radius).toBe(100);
  });

  it('does not snap radius when snap is disabled', () => {
    const tool = new TemplateTool();
    const ctx = makeCtx({ snapToGrid: false, gridSize: 50 });

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(80, 0), ctx);
    tool.onPointerUp(pt(80, 0), ctx);

    const el = ctx.store.getAll()[0] as TemplateElement;
    expect(el.radius).toBe(80);
  });

  it('requests render during drag', () => {
    const tool = new TemplateTool();
    const ctx = makeCtx();

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(50, 50), ctx);

    expect(ctx.requestRender).toHaveBeenCalled();
  });

  it('setOptions updates templateShape', () => {
    const tool = new TemplateTool();
    tool.setOptions({ templateShape: 'cone' });

    const ctx = makeCtx();
    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(100, 0), ctx);
    tool.onPointerUp(pt(100, 0), ctx);

    const el = ctx.store.getAll()[0] as TemplateElement;
    expect(el.templateShape).toBe('cone');
  });

  it('getOptions returns current options', () => {
    const tool = new TemplateTool({
      templateShape: 'square',
      fillColor: 'red',
    });
    const opts = tool.getOptions();
    expect(opts.templateShape).toBe('square');
    expect(opts.fillColor).toBe('red');
  });

  it('fires options change listener on setOptions', () => {
    const tool = new TemplateTool();
    const listener = vi.fn();
    tool.onOptionsChange(listener);
    tool.setOptions({ templateShape: 'line' });
    expect(listener).toHaveBeenCalledOnce();
  });

  it('returns unsubscribe from onOptionsChange', () => {
    const tool = new TemplateTool();
    const listener = vi.fn();
    const unsub = tool.onOptionsChange(listener);
    unsub();
    tool.setOptions({ templateShape: 'line' });
    expect(listener).not.toHaveBeenCalled();
  });

  it('onDeactivate clears drawing state', () => {
    const tool = new TemplateTool();
    const ctx = makeCtx();

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(100, 0), ctx);

    tool.onDeactivate(ctx);

    // After deactivation, pointer up should not create an element
    tool.onPointerUp(pt(100, 0), ctx);
    expect(ctx.store.getAll()).toHaveLength(0);
  });

  it('snaps origin via smartSnap', () => {
    const tool = new TemplateTool();
    const ctx = makeCtx({ snapToGrid: true, gridSize: 50 });

    tool.onPointerDown(pt(23, 27), ctx);
    tool.onPointerMove(pt(100, 0), ctx);
    tool.onPointerUp(pt(100, 0), ctx);

    const el = ctx.store.getAll()[0] as TemplateElement;
    expect(el.position).toEqual({ x: 0, y: 50 });
  });

  it('snaps radius to hex cell spacing on hex grid', () => {
    const tool = new TemplateTool();
    const cellSize = 40;
    const hexSpacing = Math.sqrt(3) * cellSize;
    const ctx = makeCtx({ snapToGrid: true, gridSize: cellSize, gridType: 'hex' });

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(Math.round(hexSpacing * 1.4), 0), ctx);
    tool.onPointerUp(pt(Math.round(hexSpacing * 1.4), 0), ctx);

    const el = ctx.store.getAll()[0] as TemplateElement;
    expect(el.radius).toBeCloseTo(hexSpacing);
  });

  it('does not snap current point during move (raw world coords)', () => {
    const tool = new TemplateTool();
    const ctx = makeCtx({ snapToGrid: true, gridSize: 50 });

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(73, 0), ctx);
    tool.onPointerUp(pt(73, 0), ctx);

    // Radius should snap to nearest gridSize multiple: round(73/50)*50 = round(1.46)*50 = 50
    const el = ctx.store.getAll()[0] as TemplateElement;
    expect(el.radius).toBe(50);
  });

  it('applies configured fillColor, strokeColor, strokeWidth, opacity', () => {
    const tool = new TemplateTool({
      fillColor: 'blue',
      strokeColor: 'green',
      strokeWidth: 4,
      opacity: 0.8,
    });
    const ctx = makeCtx();

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(100, 0), ctx);
    tool.onPointerUp(pt(100, 0), ctx);

    const el = ctx.store.getAll()[0] as TemplateElement;
    expect(el.fillColor).toBe('blue');
    expect(el.strokeColor).toBe('green');
    expect(el.strokeWidth).toBe(4);
    expect(el.opacity).toBe(0.8);
  });

  it('does not switch tool if radius is zero', () => {
    const tool = new TemplateTool();
    const ctx = makeCtx();

    tool.onPointerDown(pt(50, 50), ctx);
    tool.onPointerUp(pt(50, 50), ctx);

    expect(ctx.switchTool).not.toHaveBeenCalled();
  });

  it('ignores pointer move when not drawing', () => {
    const tool = new TemplateTool();
    const ctx = makeCtx();

    tool.onPointerMove(pt(50, 50), ctx);

    expect(ctx.requestRender).not.toHaveBeenCalled();
  });

  it('computes radiusFeet from grid size and feetPerCell', () => {
    const tool = new TemplateTool({ feetPerCell: 5 });
    const ctx = makeCtx({ gridSize: 40 });

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(80, 0), ctx);
    tool.onPointerUp(pt(80, 0), ctx);

    const el = ctx.store.getAll()[0] as TemplateElement;
    expect(el.radiusFeet).toBe(10);
    expect(el.feetPerCell).toBe(5);
  });

  it('creates a rectangle with a length and a non-zero default width', () => {
    const tool = new TemplateTool({ templateShape: 'rectangle', feetPerCell: 5 });
    const ctx = makeCtx({ gridSize: 40 });
    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(120, 0), ctx);
    tool.onPointerUp(pt(120, 0), ctx);
    const el = ctx.store.getAll()[0] as TemplateElement;
    expect(el.templateShape).toBe('rectangle');
    expect(el.radius).toBeGreaterThan(0);
    expect(el.width).toBeGreaterThan(0);
  });

  it('sets radiusFeet undefined when grid size is missing', () => {
    const tool = new TemplateTool({ feetPerCell: 5 });
    const ctx = makeCtx();

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(80, 0), ctx);
    tool.onPointerUp(pt(80, 0), ctx);

    const el = ctx.store.getAll()[0] as TemplateElement;
    expect(el.radiusFeet).toBeUndefined();
  });

  it('setOptions updates feetPerCell', () => {
    const tool = new TemplateTool({ feetPerCell: 5 });
    tool.setOptions({ feetPerCell: 10 });

    const ctx = makeCtx({ gridSize: 40 });
    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(80, 0), ctx);
    tool.onPointerUp(pt(80, 0), ctx);

    const el = ctx.store.getAll()[0] as TemplateElement;
    expect(el.radiusFeet).toBe(20);
  });

  it('getOptions includes feetPerCell', () => {
    const tool = new TemplateTool({ feetPerCell: 10 });
    expect(tool.getOptions().feetPerCell).toBe(10);
  });

  it('defaults renderStyle to "cells"', () => {
    expect(new TemplateTool().getOptions().renderStyle).toBe('cells');
  });

  it('does not set renderStyle on placed template when style is "cells"', () => {
    const tool = new TemplateTool();
    const ctx = makeCtx();
    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(100, 0), ctx);
    tool.onPointerUp(pt(100, 0), ctx);

    const el = ctx.store.getAll()[0] as TemplateElement;
    expect(el.renderStyle).toBe('cells');
  });

  it('setOptions threads renderStyle onto placed template', () => {
    const tool = new TemplateTool();
    tool.setOptions({ renderStyle: 'geometric' });
    expect(tool.getOptions().renderStyle).toBe('geometric');

    const ctx = makeCtx();
    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(100, 0), ctx);
    tool.onPointerUp(pt(100, 0), ctx);

    const el = ctx.store.getAll()[0] as TemplateElement;
    expect(el.renderStyle).toBe('geometric');
  });

  it('defaults activeLayerId to empty string when not provided', () => {
    const tool = new TemplateTool();
    const ctx = makeCtx({ activeLayerId: undefined });

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(100, 0), ctx);
    tool.onPointerUp(pt(100, 0), ctx);

    const el = ctx.store.getAll()[0] as TemplateElement;
    expect(el.layerId).toBe('');
  });

  describe('renderOverlay', () => {
    function mockCanvasCtx(): CanvasRenderingContext2D {
      return {
        save: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn(),
        closePath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        fillRect: vi.fn(),
        strokeRect: vi.fn(),
        fillText: vi.fn(),
        measureText: vi.fn(() => ({ width: 30 })),
        roundRect: vi.fn(),
        globalAlpha: 1,
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 0,
        font: '',
        textAlign: '',
        textBaseline: '',
        setLineDash: vi.fn(),
      } as unknown as CanvasRenderingContext2D;
    }

    it('does not render when not drawing', () => {
      const tool = new TemplateTool();
      const canvas = mockCanvasCtx();
      tool.renderOverlay(canvas);
      expect(canvas.save).not.toHaveBeenCalled();
    });

    it('does not render when radius is zero', () => {
      const tool = new TemplateTool();
      const ctx = makeCtx();
      tool.onPointerDown(pt(50, 50), ctx);
      const canvas = mockCanvasCtx();
      tool.renderOverlay(canvas);
      expect(canvas.save).not.toHaveBeenCalled();
    });

    it('renders geometric circle overlay', () => {
      const tool = new TemplateTool({ templateShape: 'circle' });
      const ctx = makeCtx();
      tool.onPointerDown(pt(0, 0), ctx);
      tool.onPointerMove(pt(100, 0), ctx);

      const canvas = mockCanvasCtx();
      tool.renderOverlay(canvas);

      expect(canvas.save).toHaveBeenCalled();
      expect(canvas.arc).toHaveBeenCalled();
      expect(canvas.fill).toHaveBeenCalled();
      expect(canvas.stroke).toHaveBeenCalled();
      expect(canvas.restore).toHaveBeenCalled();
    });

    it('renders geometric square overlay', () => {
      const tool = new TemplateTool({ templateShape: 'square' });
      const ctx = makeCtx();
      tool.onPointerDown(pt(0, 0), ctx);
      tool.onPointerMove(pt(100, 0), ctx);

      const canvas = mockCanvasCtx();
      tool.renderOverlay(canvas);

      expect(canvas.fillRect).toHaveBeenCalled();
      expect(canvas.strokeRect).toHaveBeenCalled();
    });

    it('renders geometric cone overlay', () => {
      const tool = new TemplateTool({ templateShape: 'cone' });
      const ctx = makeCtx();
      tool.onPointerDown(pt(0, 0), ctx);
      tool.onPointerMove(pt(100, 100), ctx);

      const canvas = mockCanvasCtx();
      tool.renderOverlay(canvas);

      expect(canvas.moveTo).toHaveBeenCalled();
      expect(canvas.arc).toHaveBeenCalled();
      expect(canvas.closePath).toHaveBeenCalled();
      expect(canvas.fill).toHaveBeenCalled();
      expect(canvas.stroke).toHaveBeenCalled();
    });

    it('renders geometric line overlay', () => {
      const tool = new TemplateTool({ templateShape: 'line' });
      const ctx = makeCtx();
      tool.onPointerDown(pt(0, 0), ctx);
      tool.onPointerMove(pt(100, 0), ctx);

      const canvas = mockCanvasCtx();
      tool.renderOverlay(canvas);

      expect(canvas.moveTo).toHaveBeenCalled();
      expect(canvas.lineTo).toHaveBeenCalledTimes(3);
      expect(canvas.closePath).toHaveBeenCalled();
      expect(canvas.fill).toHaveBeenCalled();
      expect(canvas.stroke).toHaveBeenCalled();
    });

    it('renders hex overlay for circle on hex grid', () => {
      const tool = new TemplateTool({ templateShape: 'circle' });
      const cellSize = 40;
      const hexSpacing = Math.sqrt(3) * cellSize;
      const ctx = makeCtx({
        gridSize: cellSize,
        gridType: 'hex',
        hexOrientation: 'pointy',
      });

      tool.onPointerDown(pt(0, 0), ctx);
      tool.onPointerMove(pt(Math.round(hexSpacing * 2), 0), ctx);

      const canvas = mockCanvasCtx();
      tool.renderOverlay(canvas);

      expect(canvas.save).toHaveBeenCalled();
      expect(canvas.fill).toHaveBeenCalled();
      expect(canvas.stroke).toHaveBeenCalled();
      expect(canvas.fillText).toHaveBeenCalled();
      expect(canvas.restore).toHaveBeenCalled();
    });

    it('renders hex overlay for cone on hex grid', () => {
      const tool = new TemplateTool({ templateShape: 'cone' });
      const cellSize = 40;
      const hexSpacing = Math.sqrt(3) * cellSize;
      const ctx = makeCtx({
        gridSize: cellSize,
        gridType: 'hex',
        hexOrientation: 'pointy',
      });

      tool.onPointerDown(pt(0, 0), ctx);
      tool.onPointerMove(pt(Math.round(hexSpacing * 2), Math.round(hexSpacing)), ctx);

      const canvas = mockCanvasCtx();
      tool.renderOverlay(canvas);

      expect(canvas.save).toHaveBeenCalled();
      expect(canvas.fill).toHaveBeenCalled();
      expect(canvas.restore).toHaveBeenCalled();
    });

    it('renders hex overlay for line on hex grid', () => {
      const tool = new TemplateTool({ templateShape: 'line' });
      const cellSize = 40;
      const hexSpacing = Math.sqrt(3) * cellSize;
      const ctx = makeCtx({
        gridSize: cellSize,
        gridType: 'hex',
        hexOrientation: 'pointy',
      });

      tool.onPointerDown(pt(0, 0), ctx);
      tool.onPointerMove(pt(Math.round(hexSpacing * 3), 0), ctx);

      const canvas = mockCanvasCtx();
      tool.renderOverlay(canvas);

      expect(canvas.save).toHaveBeenCalled();
      expect(canvas.fill).toHaveBeenCalled();
      expect(canvas.restore).toHaveBeenCalled();
    });

    it('renders hex overlay for square on hex grid', () => {
      const tool = new TemplateTool({ templateShape: 'square' });
      const cellSize = 40;
      const hexSpacing = Math.sqrt(3) * cellSize;
      const ctx = makeCtx({
        gridSize: cellSize,
        gridType: 'hex',
        hexOrientation: 'pointy',
      });

      tool.onPointerDown(pt(0, 0), ctx);
      tool.onPointerMove(pt(Math.round(hexSpacing * 2), 0), ctx);

      const canvas = mockCanvasCtx();
      tool.renderOverlay(canvas);

      expect(canvas.save).toHaveBeenCalled();
      expect(canvas.fill).toHaveBeenCalled();
      expect(canvas.restore).toHaveBeenCalled();
    });

    it('renders origin hex highlight for all template shapes on hex grid', () => {
      for (const shape of ['circle', 'cone', 'line', 'square'] as const) {
        const tool = new TemplateTool({ templateShape: shape });
        const cellSize = 40;
        const hexSpacing = Math.sqrt(3) * cellSize;
        const ctx = makeCtx({
          gridSize: cellSize,
          gridType: 'hex',
          hexOrientation: 'pointy',
        });

        tool.onPointerDown(pt(0, 0), ctx);
        tool.onPointerMove(pt(Math.round(hexSpacing * 2), 0), ctx);

        const canvas = mockCanvasCtx();
        tool.renderOverlay(canvas);

        const fillCalls = (canvas.fill as ReturnType<typeof vi.fn>).mock.calls.length;
        expect(fillCalls).toBeGreaterThanOrEqual(2);
      }
    });

    it('renders feet label for hex circle overlay', () => {
      const tool = new TemplateTool({ templateShape: 'circle', feetPerCell: 5 });
      const cellSize = 40;
      const hexSpacing = Math.sqrt(3) * cellSize;
      const ctx = makeCtx({
        gridSize: cellSize,
        gridType: 'hex',
        hexOrientation: 'pointy',
      });

      tool.onPointerDown(pt(0, 0), ctx);
      tool.onPointerMove(pt(Math.round(hexSpacing * 2), 0), ctx);

      const canvas = mockCanvasCtx();
      tool.renderOverlay(canvas);

      expect(canvas.fillText).toHaveBeenCalled();
      expect(canvas.measureText).toHaveBeenCalled();
      expect(canvas.roundRect).toHaveBeenCalled();
    });

    it('does not render hex overlay without hexOrientation', () => {
      const tool = new TemplateTool({ templateShape: 'circle' });
      const ctx = makeCtx({
        gridSize: 40,
        gridType: 'hex',
      });

      tool.onPointerDown(pt(0, 0), ctx);
      tool.onPointerMove(pt(100, 0), ctx);

      const canvas = mockCanvasCtx();
      tool.renderOverlay(canvas);

      expect(canvas.arc).toHaveBeenCalled();
    });

    it('sets globalAlpha and style properties for geometric overlay', () => {
      const tool = new TemplateTool({
        templateShape: 'circle',
        fillColor: 'red',
        strokeColor: 'blue',
        strokeWidth: 3,
      });
      const ctx = makeCtx();
      tool.onPointerDown(pt(0, 0), ctx);
      tool.onPointerMove(pt(100, 0), ctx);

      const canvas = mockCanvasCtx();
      tool.renderOverlay(canvas);

      expect(canvas.globalAlpha).toBe(0.4);
    });

    it('renders smooth geometric overlay on hex grid when renderStyle is geometric', () => {
      const tool = new TemplateTool({ templateShape: 'cone', renderStyle: 'geometric' });
      const cellSize = 40;
      const hexSpacing = Math.sqrt(3) * cellSize;
      const ctx = makeCtx({
        gridSize: cellSize,
        gridType: 'hex',
        hexOrientation: 'pointy',
      });

      tool.onPointerDown(pt(0, 0), ctx);
      tool.onPointerMove(pt(Math.round(hexSpacing * 2), Math.round(hexSpacing)), ctx);

      const canvas = mockCanvasCtx();
      tool.renderOverlay(canvas);

      // Geometric cone uses moveTo + arc; the hex-cell path never calls arc.
      expect(canvas.arc).toHaveBeenCalled();
    });

    it('does not use geometric arc for hex-cell cone preview on hex grid', () => {
      const tool = new TemplateTool({ templateShape: 'cone' });
      const cellSize = 40;
      const hexSpacing = Math.sqrt(3) * cellSize;
      const ctx = makeCtx({
        gridSize: cellSize,
        gridType: 'hex',
        hexOrientation: 'pointy',
      });

      tool.onPointerDown(pt(0, 0), ctx);
      tool.onPointerMove(pt(Math.round(hexSpacing * 2), Math.round(hexSpacing)), ctx);

      const canvas = mockCanvasCtx();
      tool.renderOverlay(canvas);

      expect(canvas.arc).not.toHaveBeenCalled();
    });

    it('renders hex overlay with flat-top orientation', () => {
      const tool = new TemplateTool({ templateShape: 'circle' });
      const cellSize = 40;
      const hexSpacing = Math.sqrt(3) * cellSize;
      const ctx = makeCtx({
        gridSize: cellSize,
        gridType: 'hex',
        hexOrientation: 'flat',
      });

      tool.onPointerDown(pt(0, 0), ctx);
      tool.onPointerMove(pt(Math.round(hexSpacing * 2), 0), ctx);

      const canvas = mockCanvasCtx();
      tool.renderOverlay(canvas);

      expect(canvas.save).toHaveBeenCalled();
      expect(canvas.fill).toHaveBeenCalled();
      expect(canvas.restore).toHaveBeenCalled();
    });
  });

  describe('snapToGrid', () => {
    it('snaps to hex center on hex grid', () => {
      const tool = new TemplateTool();
      const ctx = makeCtx({
        gridSize: 40,
        gridType: 'hex',
        hexOrientation: 'pointy',
      });

      tool.onPointerDown(pt(10, 10), ctx);
      tool.onPointerMove(pt(200, 0), ctx);
      tool.onPointerUp(pt(200, 0), ctx);

      const el = ctx.store.getAll()[0] as TemplateElement;
      expect(el.position.x).not.toBe(10);
      expect(el.position.y).not.toBe(10);
    });

    it('snaps to square grid on square grid type', () => {
      const tool = new TemplateTool();
      const ctx = makeCtx({
        gridSize: 50,
        gridType: 'square',
      });

      tool.onPointerDown(pt(23, 27), ctx);
      tool.onPointerMove(pt(200, 0), ctx);
      tool.onPointerUp(pt(200, 0), ctx);

      const el = ctx.store.getAll()[0] as TemplateElement;
      expect(el.position).toEqual({ x: 0, y: 50 });
    });
  });

  describe('hex grid element creation', () => {
    it('computes radiusFeet with hex spacing', () => {
      const tool = new TemplateTool({ feetPerCell: 5 });
      const cellSize = 40;
      const hexSpacing = Math.sqrt(3) * cellSize;
      const ctx = makeCtx({
        gridSize: cellSize,
        gridType: 'hex',
        hexOrientation: 'pointy',
      });

      tool.onPointerDown(pt(0, 0), ctx);
      tool.onPointerMove(pt(Math.round(hexSpacing * 2), 0), ctx);
      tool.onPointerUp(pt(Math.round(hexSpacing * 2), 0), ctx);

      const el = ctx.store.getAll()[0] as TemplateElement;
      expect(el.radiusFeet).toBeCloseTo(10);
    });
  });
});

function overlayCanvas(): CanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    closePath: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    roundRect: vi.fn(),
    setLineDash: vi.fn(),
    measureText: vi.fn(() => ({ width: 30 })),
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: '',
    textBaseline: '',
  } as unknown as CanvasRenderingContext2D;
}

describe('live feet readout while placing', () => {
  it.each(['circle', 'cone', 'line', 'square'] as TemplateShape[])(
    'shows a feet label mid-drag for %s when a grid scale exists',
    (shape) => {
      const tool = new TemplateTool({ templateShape: shape, feetPerCell: 5 });
      const ctx = makeCtx({ gridSize: 40 });
      tool.onPointerDown(pt(0, 0), ctx);
      tool.onPointerMove(pt(120, 0), ctx);
      const canvas = overlayCanvas();
      tool.renderOverlay?.(canvas);
      expect(canvas.fillText).toHaveBeenCalledWith(
        expect.stringContaining('ft'),
        expect.any(Number),
        expect.any(Number),
      );
    },
  );

  it('shows no feet label when there is no grid scale', () => {
    const tool = new TemplateTool({ templateShape: 'cone', feetPerCell: 5 });
    const ctx = makeCtx(); // no gridSize
    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(120, 0), ctx);
    const canvas = overlayCanvas();
    tool.renderOverlay?.(canvas);
    expect(canvas.fillText).not.toHaveBeenCalled();
  });
});
