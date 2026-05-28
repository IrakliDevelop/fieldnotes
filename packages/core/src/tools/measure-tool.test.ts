// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { MeasureTool } from './measure-tool';
import { ElementStore } from '../elements/element-store';
import { Camera } from '../canvas/camera';
import type { ToolContext, PointerState } from './types';

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    camera: new Camera(),
    store: new ElementStore(),
    requestRender: vi.fn(),
    ...overrides,
  };
}

function pt(x: number, y: number): PointerState {
  return { x, y, pressure: 0.5, pointerType: 'mouse' };
}

describe('MeasureTool', () => {
  it('has name "measure"', () => {
    expect(new MeasureTool().name).toBe('measure');
  });

  it('computes distance in feet correctly', () => {
    const tool = new MeasureTool();
    const ctx = makeCtx({ gridSize: 50 });

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(150, 0), ctx);

    const m = tool.getMeasurement();
    expect(m).not.toBeNull();
    expect(m?.worldDistance).toBe(150);
    expect(m?.cells).toBe(3);
    expect(m?.feet).toBe(15);
  });

  it('uses custom feetPerCell', () => {
    const tool = new MeasureTool({ feetPerCell: 10 });
    const ctx = makeCtx({ gridSize: 50 });

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(100, 0), ctx);

    const m = tool.getMeasurement();
    expect(m?.cells).toBe(2);
    expect(m?.feet).toBe(20);
  });

  it('clears measurement on pointer up', () => {
    const tool = new MeasureTool();
    const ctx = makeCtx({ gridSize: 50 });

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(100, 0), ctx);
    expect(tool.getMeasurement()).not.toBeNull();

    tool.onPointerUp(pt(100, 0), ctx);
    expect(tool.getMeasurement()).toBeNull();
  });

  it('requests render on pointer move', () => {
    const tool = new MeasureTool();
    const ctx = makeCtx({ gridSize: 50 });

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(50, 50), ctx);

    expect(ctx.requestRender).toHaveBeenCalled();
  });

  it('snaps when snapToGrid is true', () => {
    const tool = new MeasureTool();
    const ctx = makeCtx({ snapToGrid: true, gridSize: 50 });

    tool.onPointerDown(pt(10, 10), ctx);
    tool.onPointerMove(pt(110, 10), ctx);

    const m = tool.getMeasurement();
    expect(m?.start).toEqual({ x: 0, y: 0 });
    expect(m?.end).toEqual({ x: 100, y: 0 });
    expect(m?.worldDistance).toBe(100);
    expect(m?.cells).toBe(2);
    expect(m?.feet).toBe(10);
  });

  it('does not snap when snapToGrid is false', () => {
    const tool = new MeasureTool();
    const ctx = makeCtx({ snapToGrid: false, gridSize: 50 });

    tool.onPointerDown(pt(10, 10), ctx);
    tool.onPointerMove(pt(110, 10), ctx);

    const m = tool.getMeasurement();
    expect(m?.start).toEqual({ x: 10, y: 10 });
    expect(m?.end).toEqual({ x: 110, y: 10 });
  });

  it('setOptions updates feetPerCell', () => {
    const tool = new MeasureTool();
    const ctx = makeCtx({ gridSize: 50 });

    tool.setOptions({ feetPerCell: 10 });

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(100, 0), ctx);

    const m = tool.getMeasurement();
    expect(m?.feet).toBe(20);
  });

  it('getOptions returns current feetPerCell', () => {
    const tool = new MeasureTool({ feetPerCell: 10 });
    expect(tool.getOptions()).toEqual({ feetPerCell: 10 });
  });

  it('fires options change listener on setOptions', () => {
    const tool = new MeasureTool();
    const listener = vi.fn();
    tool.onOptionsChange(listener);
    tool.setOptions({ feetPerCell: 10 });
    expect(listener).toHaveBeenCalledOnce();
  });

  it('returns unsubscribe from onOptionsChange', () => {
    const tool = new MeasureTool();
    const listener = vi.fn();
    const unsub = tool.onOptionsChange(listener);
    unsub();
    tool.setOptions({ feetPerCell: 10 });
    expect(listener).not.toHaveBeenCalled();
  });

  it('returns null from getMeasurement before any interaction', () => {
    const tool = new MeasureTool();
    expect(tool.getMeasurement()).toBeNull();
  });

  it('computes diagonal distance correctly', () => {
    const tool = new MeasureTool();
    const ctx = makeCtx({ gridSize: 50 });

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(300, 400), ctx);

    const m = tool.getMeasurement();
    expect(m?.worldDistance).toBe(500);
    expect(m?.cells).toBe(10);
    expect(m?.feet).toBe(50);
  });

  it('does not create any elements', () => {
    const tool = new MeasureTool();
    const ctx = makeCtx({ gridSize: 50 });

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(100, 100), ctx);
    tool.onPointerUp(pt(100, 100), ctx);

    expect(ctx.store.getAll()).toHaveLength(0);
  });

  it('defaults gridSize to 1 when not provided', () => {
    const tool = new MeasureTool();
    const ctx = makeCtx();

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(100, 0), ctx);

    const m = tool.getMeasurement();
    expect(m?.worldDistance).toBe(100);
    expect(m?.cells).toBe(100);
    expect(m?.feet).toBe(500);
  });

  it('clears measurement on deactivate (mid-drag tool switch)', () => {
    const tool = new MeasureTool();
    const ctx = makeCtx({ gridSize: 40 });

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(80, 0), ctx);
    expect(tool.getMeasurement()).not.toBeNull();

    tool.onDeactivate(ctx);
    expect(tool.getMeasurement()).toBeNull();
  });

  it('requests render on pointer up to clear overlay', () => {
    const tool = new MeasureTool();
    const ctx = makeCtx({ gridSize: 50 });

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(100, 0), ctx);
    (ctx.requestRender as ReturnType<typeof vi.fn>).mockClear();

    tool.onPointerUp(pt(100, 0), ctx);
    expect(ctx.requestRender).toHaveBeenCalled();
  });

  it('uses hex center-to-center spacing for cell count on hex grids', () => {
    const tool = new MeasureTool();
    const cellSize = 40;
    const hexSpacing = Math.sqrt(3) * cellSize;
    const ctx = makeCtx({ gridSize: cellSize, gridType: 'hex', hexOrientation: 'pointy' });

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(Math.round(hexSpacing), 0), ctx);

    const m = tool.getMeasurement();
    expect(m?.cells).toBe(1);
    expect(m?.feet).toBe(5);
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
        moveTo: vi.fn(),
        lineTo: vi.fn(),
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

    it('does not render when no measurement is active', () => {
      const tool = new MeasureTool();
      const canvas = mockCanvasCtx();
      tool.renderOverlay(canvas);
      expect(canvas.save).not.toHaveBeenCalled();
    });

    it('renders measurement line and dots during drag', () => {
      const tool = new MeasureTool();
      const ctx = makeCtx({ gridSize: 50 });

      tool.onPointerDown(pt(0, 0), ctx);
      tool.onPointerMove(pt(100, 0), ctx);

      const canvas = mockCanvasCtx();
      tool.renderOverlay(canvas);

      expect(canvas.save).toHaveBeenCalled();
      expect(canvas.setLineDash).toHaveBeenCalledWith([8, 4]);
      expect(canvas.moveTo).toHaveBeenCalled();
      expect(canvas.lineTo).toHaveBeenCalled();
      expect(canvas.stroke).toHaveBeenCalled();
    });

    it('renders start and end dots', () => {
      const tool = new MeasureTool();
      const ctx = makeCtx({ gridSize: 50 });

      tool.onPointerDown(pt(0, 0), ctx);
      tool.onPointerMove(pt(100, 0), ctx);

      const canvas = mockCanvasCtx();
      tool.renderOverlay(canvas);

      const arcCalls = (canvas.arc as ReturnType<typeof vi.fn>).mock.calls;
      expect(arcCalls.length).toBe(2);
    });

    it('renders distance label with background pill', () => {
      const tool = new MeasureTool();
      const ctx = makeCtx({ gridSize: 50 });

      tool.onPointerDown(pt(0, 0), ctx);
      tool.onPointerMove(pt(100, 0), ctx);

      const canvas = mockCanvasCtx();
      tool.renderOverlay(canvas);

      expect(canvas.measureText).toHaveBeenCalled();
      expect(canvas.roundRect).toHaveBeenCalled();
      expect(canvas.fillText).toHaveBeenCalled();
      expect(canvas.restore).toHaveBeenCalled();
    });

    it('renders correct feet label text', () => {
      const tool = new MeasureTool({ feetPerCell: 5 });
      const ctx = makeCtx({ gridSize: 50 });

      tool.onPointerDown(pt(0, 0), ctx);
      tool.onPointerMove(pt(100, 0), ctx);

      const canvas = mockCanvasCtx();
      tool.renderOverlay(canvas);

      const fillTextCalls = (canvas.fillText as ReturnType<typeof vi.fn>).mock.calls;
      expect(fillTextCalls.length).toBe(1);
      expect(fillTextCalls[0][0]).toBe('10 ft');
    });

    it('clears line dash after drawing the line', () => {
      const tool = new MeasureTool();
      const ctx = makeCtx({ gridSize: 50 });

      tool.onPointerDown(pt(0, 0), ctx);
      tool.onPointerMove(pt(100, 0), ctx);

      const canvas = mockCanvasCtx();
      tool.renderOverlay(canvas);

      const setLineDashCalls = (canvas.setLineDash as ReturnType<typeof vi.fn>).mock.calls;
      expect(setLineDashCalls).toContainEqual([[8, 4]]);
      expect(setLineDashCalls).toContainEqual([[]]);
    });
  });

  describe('snapToGrid', () => {
    it('snaps to square grid centers on square grid type', () => {
      const tool = new MeasureTool();
      const ctx = makeCtx({
        gridSize: 50,
        gridType: 'square',
      });

      tool.onPointerDown(pt(23, 27), ctx);
      tool.onPointerMove(pt(110, 10), ctx);

      const m = tool.getMeasurement();
      expect(m?.start).toEqual({ x: 0, y: 50 });
      expect(m?.end).toEqual({ x: 100, y: 0 });
    });

    it('snaps to hex centers on hex grid type', () => {
      const tool = new MeasureTool();
      const ctx = makeCtx({
        gridSize: 40,
        gridType: 'hex',
        hexOrientation: 'pointy',
      });

      tool.onPointerDown(pt(10, 10), ctx);

      const m = tool.getMeasurement();
      expect(m?.start.x).not.toBe(10);
      expect(m?.start.y).not.toBe(10);
    });

    it('does not snap when gridSize is zero', () => {
      const tool = new MeasureTool();
      const ctx = makeCtx({ gridSize: 0 });

      tool.onPointerDown(pt(13, 17), ctx);
      tool.onPointerMove(pt(113, 117), ctx);

      const m = tool.getMeasurement();
      expect(m?.start).toEqual({ x: 13, y: 17 });
    });
  });
});
