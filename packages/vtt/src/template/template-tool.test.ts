import { describe, expect, it, vi } from 'vitest';
import { Camera, ElementRegistry, ElementStore, SelectTool } from '@fieldnotes/core';
import type { PointerState, ToolContext } from '@fieldnotes/core';
import { registerVttElementTypes } from '../register';
import { TemplateTool } from './template-tool';

const pointer = (x: number, y: number): PointerState => ({
  x,
  y,
  pressure: 0.5,
  pointerType: 'mouse',
  shiftKey: false,
});

describe('TemplateTool', () => {
  it('adds a registered extension envelope that the core renderer can dispatch', () => {
    const registry = new ElementRegistry();
    registerVttElementTypes(registry);
    const store = new ElementStore();
    const ctx: ToolContext = {
      camera: new Camera(),
      store,
      requestRender: vi.fn(),
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
