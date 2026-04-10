// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { TemplateTool } from './template-tool';
import { ElementStore } from '../elements/element-store';
import { Camera } from '../canvas/camera';
import type { ToolContext, PointerState } from './types';
import type { TemplateElement } from '../elements/types';

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
  return { x, y, pressure: 0.5 };
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

  it('defaults activeLayerId to empty string when not provided', () => {
    const tool = new TemplateTool();
    const ctx = makeCtx({ activeLayerId: undefined });

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(100, 0), ctx);
    tool.onPointerUp(pt(100, 0), ctx);

    const el = ctx.store.getAll()[0] as TemplateElement;
    expect(el.layerId).toBe('');
  });
});
