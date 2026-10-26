import { describe, expect, it, vi } from 'vitest';
import {
  Camera,
  ConstraintServiceProxy,
  ElementRegistry,
  ElementStore,
  SelectTool,
} from '@fieldnotes/core';
import type { Point, PointerState, ToolContext } from '@fieldnotes/core';
import { GridConstraintService } from '../grid/grid-constraint-service';
import { registerVttElementTypes } from '../register';
import { TemplateTool } from './template-tool';

const pointer = (x: number, y: number): PointerState => ({
  x,
  y,
  pressure: 0.5,
  pointerType: 'mouse',
  shiftKey: false,
});

function recordingCtx(): { ctx: CanvasRenderingContext2D; paths: Point[][] } {
  const paths: Point[][] = [];
  const point = (x: number, y: number): void => {
    paths[paths.length - 1]?.push({ x, y });
  };
  const noop = vi.fn();
  const ctx = {
    beginPath: () => paths.push([]),
    moveTo: point,
    lineTo: point,
    arc: noop,
    closePath: noop,
    fill: noop,
    stroke: noop,
    save: noop,
    restore: noop,
    setLineDash: noop,
    roundRect: noop,
    fillText: noop,
    measureText: () => ({ width: 30 }),
  } as unknown as CanvasRenderingContext2D;
  return { ctx, paths };
}

function hexGridContext(active: boolean, cellSize = 48): { ctx: ToolContext; store: ElementStore } {
  const registry = new ElementRegistry();
  registerVttElementTypes(registry);
  const store = new ElementStore();
  const constraintService = new ConstraintServiceProxy();
  constraintService.setImplementation(
    new GridConstraintService(() => ({
      gridType: 'hex',
      hexOrientation: 'pointy',
      cellSize,
      cellRadius: cellSize,
    })),
  );
  constraintService.setActive(active);
  const ctx: ToolContext = {
    camera: new Camera(),
    store,
    requestRender: vi.fn(),
    requestOverlayRender: vi.fn(),
    elementRegistry: registry,
    constraintService,
  };
  return { ctx, store };
}

const hexW = Math.sqrt(3) * 48;
const snappedCenter = { x: 12 * hexW + hexW / 2, y: 5 * 72 };

describe('TemplateTool', () => {
  it('previews hex cells around the snapped center cell when grid snapping is inactive', () => {
    const { ctx, store } = hexGridContext(false);
    const tool = new TemplateTool({ templateShape: 'circle' });
    tool.onPointerDown(pointer(1000, 390), ctx);
    tool.onPointerMove(pointer(1200, 390), ctx);

    const { ctx: canvas, paths } = recordingCtx();
    tool.renderOverlay(canvas);

    expect(paths.some((p) => p.length === 19 * 6)).toBe(true);
    const marker = paths.find((p) => p.length === 6);
    if (!marker) throw new Error('no single-hex marker path');
    const mx = marker.reduce((sum, p) => sum + p.x, 0) / 6;
    const my = marker.reduce((sum, p) => sum + p.y, 0) / 6;
    expect(mx).toBeCloseTo(snappedCenter.x, 2);
    expect(my).toBeCloseTo(snappedCenter.y, 2);
    const labelStart = paths.find((p) => p.length === 2)?.[0];
    expect(labelStart?.x).toBeCloseTo(snappedCenter.x, 2);
    expect(labelStart?.y).toBeCloseTo(snappedCenter.y, 2);

    tool.onPointerUp(pointer(1200, 390), ctx);
    expect(store.getAll()[0]).toMatchObject({
      position: { x: 1000, y: 390 },
      data: { radius: 200 },
    });
  });

  it('draws the geometric preview when a hex grid reports a zero cell size', () => {
    const { ctx } = hexGridContext(false, 0);
    const tool = new TemplateTool({ templateShape: 'circle' });
    tool.onPointerDown(pointer(1000, 390), ctx);
    tool.onPointerMove(pointer(1200, 390), ctx);

    const { ctx: canvas } = recordingCtx();
    const arc = vi.spyOn(canvas, 'arc');
    tool.renderOverlay(canvas);

    expect(arc).toHaveBeenCalledWith(1000, 390, 200, 0, Math.PI * 2);
  });

  it('snaps the origin and radius to the hex grid when grid snapping is active', () => {
    const { ctx, store } = hexGridContext(true);
    const tool = new TemplateTool({ templateShape: 'circle' });
    tool.onPointerDown(pointer(1000, 390), ctx);
    tool.onPointerMove(pointer(1200, 390), ctx);
    tool.onPointerUp(pointer(1200, 390), ctx);

    const created = store.getAll()[0];
    if (!created || created.type !== 'extension') throw new Error('template was not created');
    expect(created.position.x).toBeCloseTo(snappedCenter.x, 2);
    expect(created.position.y).toBeCloseTo(snappedCenter.y, 2);
    expect(created.data['radius']).toBeCloseTo(2 * hexW, 2);
  });

  it('uses a type-only custom constraint service for its origin without grid radius rounding', () => {
    const registry = new ElementRegistry();
    registerVttElementTypes(registry);
    const store = new ElementStore();
    const constraintService = new ConstraintServiceProxy();
    constraintService.setImplementation({
      constrainPoint: () => ({ x: 314, y: 159 }),
      getConstraintInfo: () => ({ type: 'custom' }),
      hasCapability: () => false,
    });
    constraintService.setActive(true);
    const ctx: ToolContext = {
      camera: new Camera(),
      store,
      requestRender: vi.fn(),
      requestOverlayRender: vi.fn(),
      elementRegistry: registry,
      constraintService,
    };
    const tool = new TemplateTool({ templateShape: 'circle' });

    tool.onPointerDown(pointer(10, 10), ctx);
    tool.onPointerMove(pointer(324, 159), ctx);
    tool.onPointerUp(pointer(324, 159), ctx);

    const created = store.getAll()[0];
    expect(created).toMatchObject({
      position: { x: 314, y: 159 },
      data: { radius: 10 },
    });
  });

  it('adds a registered extension envelope that the core renderer can dispatch', () => {
    const registry = new ElementRegistry();
    registerVttElementTypes(registry);
    const store = new ElementStore();
    const ctx: ToolContext = {
      camera: new Camera(),
      store,
      requestRender: vi.fn(),
      requestOverlayRender: vi.fn(),
      elementRegistry: registry,
      activeLayerId: 'default',
    };
    const tool = new TemplateTool({ templateShape: 'circle' });

    tool.onPointerDown(pointer(0, 0), ctx);
    tool.onPointerMove(pointer(30, 0), ctx);
    tool.onPointerUp(pointer(30, 0), ctx);

    expect(store.getAll()).toHaveLength(1);
    expect(store.getAll()[0]).toMatchObject({
      type: 'extension',
      extensionType: 'vtt:template',
      layerId: 'default',
      data: { templateShape: 'circle', radius: 30 },
    });
  });

  it('fails clearly when the VTT type was not registered', () => {
    const ctx: ToolContext = {
      camera: new Camera(),
      store: new ElementStore(),
      requestRender: vi.fn(),
      requestOverlayRender: vi.fn(),
      elementRegistry: new ElementRegistry(),
    };
    const tool = new TemplateTool();

    tool.onPointerDown(pointer(0, 0), ctx);
    tool.onPointerMove(pointer(10, 0), ctx);

    expect(() => tool.onPointerUp(pointer(10, 0), ctx)).toThrow(
      'TemplateTool requires registerVttElementTypes()',
    );
  });

  it('creates a template that core selection can select and move', () => {
    const registry = new ElementRegistry();
    registerVttElementTypes(registry);
    const store = new ElementStore(registry);
    const ctx: ToolContext = {
      camera: new Camera(),
      store,
      requestRender: vi.fn(),
      requestOverlayRender: vi.fn(),
      elementRegistry: registry,
    };
    const template = new TemplateTool();
    template.onPointerDown(pointer(0, 0), ctx);
    template.onPointerMove(pointer(30, 0), ctx);
    template.onPointerUp(pointer(30, 0), ctx);
    const created = store.getAll()[0];
    if (!created) throw new Error('template was not created');

    const select = new SelectTool();
    select.onPointerDown(pointer(0, 0), ctx);
    select.onPointerUp(pointer(0, 0), ctx);
    expect(select.selectedIds).toEqual([created.id]);

    select.onPointerDown(pointer(0, 0), ctx);
    select.onPointerMove(pointer(10, 5), ctx);
    select.onPointerUp(pointer(10, 5), ctx);
    expect(store.getById(created.id)?.position).toEqual({ x: 10, y: 5 });
  });

  it('keeps core aim controls working for an extracted template envelope', () => {
    const registry = new ElementRegistry();
    registerVttElementTypes(registry);
    const store = new ElementStore(registry);
    const ctx: ToolContext = {
      camera: new Camera(),
      store,
      requestRender: vi.fn(),
      requestOverlayRender: vi.fn(),
      elementRegistry: registry,
    };
    const template = new TemplateTool({ templateShape: 'cone' });
    template.onPointerDown(pointer(100, 100), ctx);
    template.onPointerMove(pointer(180, 100), ctx);
    template.onPointerUp(pointer(180, 100), ctx);
    const created = store.getAll()[0];
    if (!created || created.type !== 'extension') throw new Error('template was not created');
    store.update(created.id, { data: { ...created.data, futureField: 'preserved' } });

    const select = new SelectTool();
    select.onPointerDown(pointer(100, 100), ctx);
    select.onPointerUp(pointer(100, 100), ctx);
    select.onPointerDown(pointer(204, 100), ctx);
    select.onPointerMove(pointer(100, 20), ctx);
    select.onPointerUp(pointer(100, 20), ctx);

    const updated = store.getById(created.id);
    expect(updated?.type).toBe('extension');
    if (!updated || updated.type !== 'extension') return;
    expect(updated.data['angle']).toBeCloseTo(-Math.PI / 2, 3);
    expect(updated.data['futureField']).toBe('preserved');
  });

  it('keeps core resize controls working for an extracted template envelope', () => {
    const registry = new ElementRegistry();
    registerVttElementTypes(registry);
    const store = new ElementStore(registry);
    const ctx: ToolContext = {
      camera: new Camera(),
      store,
      requestRender: vi.fn(),
      requestOverlayRender: vi.fn(),
      elementRegistry: registry,
    };
    const template = new TemplateTool({ templateShape: 'circle' });
    template.onPointerDown(pointer(100, 100), ctx);
    template.onPointerMove(pointer(140, 100), ctx);
    template.onPointerUp(pointer(140, 100), ctx);
    const created = store.getAll()[0];
    if (!created || created.type !== 'extension') throw new Error('template was not created');

    const select = new SelectTool();
    select.onPointerDown(pointer(100, 100), ctx);
    select.onPointerUp(pointer(100, 100), ctx);
    select.onPointerDown(pointer(140, 140), ctx);
    select.onPointerMove(pointer(170, 170), ctx);
    select.onPointerUp(pointer(170, 170), ctx);

    const updated = store.getById(created.id);
    expect(updated?.type).toBe('extension');
    if (!updated || updated.type !== 'extension') return;
    expect(updated.data['radius']).toBeGreaterThan(40);
  });
});
