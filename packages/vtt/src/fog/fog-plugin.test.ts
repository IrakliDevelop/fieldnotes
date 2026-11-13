import { afterEach, describe, expect, it, vi } from 'vitest';
import { Viewport } from '@fieldnotes/core';
import type { PluginConfigureContext, PluginStartContext } from '@fieldnotes/core';
import { createFogPlugin, FogManagerKey } from './fog-plugin';
import type { FogPlugin } from './fog-plugin';
import { FogManager } from './fog-manager';
import { FogRenderer } from './fog-renderer';

function configureContext() {
  const registrations = {
    viewport: vi.fn(),
    minimap: vi.fn(),
    imageExport: vi.fn(),
    svgExport: vi.fn(),
  };
  const context = {
    elementRegistry: {},
    toolManager: {},
    registerElementType: vi.fn(),
    registerTool: vi.fn(),
    registerViewportHooks: registrations.viewport,
    registerMinimapHooks: registrations.minimap,
    registerImageExportHooks: registrations.imageExport,
    registerSvgExportHooks: registrations.svgExport,
  } as unknown as PluginConfigureContext;
  return { context, registrations };
}

function startContext() {
  const disposers: (() => void)[] = [];
  const context = {
    viewport: {},
    store: {},
    pushHistory: vi.fn(),
    requestRender: vi.fn(),
    invalidateMinimap: vi.fn(),
    registerService: vi.fn(),
    addDisposer: (dispose: () => void) => disposers.push(dispose),
    registerExtraBounds: vi.fn(() => vi.fn()),
    onChange: vi.fn(() => vi.fn()),
    notifyChange: vi.fn(),
  } as unknown as PluginStartContext;
  return { context, disposers };
}

describe('createFogPlugin', () => {
  it('declares privacy-first lifecycle metadata', () => {
    const plugin = createFogPlugin();
    expect(plugin).toMatchObject({ name: 'fog', priority: -100, required: true });
    expect(plugin.manager).toBeInstanceOf(FogManager);
  });

  it('registers required fog capabilities on every render surface during configure', () => {
    const plugin = createFogPlugin();
    const { context, registrations } = configureContext();
    plugin.configure?.(context);
    for (const register of Object.values(registrations)) {
      expect(register).toHaveBeenCalledOnce();
      expect(register.mock.calls[0]?.[1]).toMatchObject({
        required: true,
        satisfies: ['vtt:fog'],
      });
    }
  });

  it('registers the typed manager service and a per-instance state handle during start', () => {
    const manager = new FogManager();
    const plugin = createFogPlugin({ manager });
    const configured = configureContext();
    const started = startContext();
    plugin.configure?.(configured.context);
    const handle = plugin.start?.(started.context);
    expect(started.context.registerService).toHaveBeenCalledWith(FogManagerKey, manager);
    expect(handle?.exportState?.()).toBeNull();
    handle?.dispose();
    for (const dispose of started.disposers.reverse()) dispose();
  });

  it('manager changes invalidate both viewport and minimap and emit plugin change', () => {
    const plugin = createFogPlugin();
    const configured = configureContext();
    const started = startContext();
    plugin.configure?.(configured.context);
    const handle = plugin.start?.(started.context);
    plugin.manager.initialize({ bounds: { x: 0, y: 0, w: 128, h: 128 }, cellSize: 1 });
    expect(started.context.requestRender).toHaveBeenCalled();
    expect(started.context.invalidateMinimap).toHaveBeenCalled();
    expect(started.context.notifyChange).toHaveBeenCalled();
    handle?.dispose();
    for (const dispose of started.disposers.reverse()) dispose();
  });

  it('satisfies vtt:fog only while the instance is started, whether or not fog is visible', () => {
    const plugin = createFogPlugin();
    const configured = configureContext();
    const started = startContext();
    plugin.configure?.(configured.context);
    const options: { enabled?: () => boolean } | undefined =
      configured.registrations.viewport.mock.calls[0]?.[1];
    expect(options?.enabled?.()).toBe(false);
    const handle = plugin.start?.(started.context);
    expect(options?.enabled?.()).toBe(true);
    plugin.manager.initialize({ bounds: { x: 0, y: 0, w: 128, h: 128 }, cellSize: 1 });
    plugin.manager.setViewMode('off');
    expect(options?.enabled?.()).toBe(true);
    handle?.dispose();
    expect(options?.enabled?.()).toBe(false);
    for (const dispose of started.disposers.reverse()) dispose();
  });

  it('returns independent renderer handles when the definition is configured twice', () => {
    const plugin = createFogPlugin();
    const firstConfigure = configureContext();
    const secondConfigure = configureContext();
    plugin.configure?.(firstConfigure.context);
    plugin.configure?.(secondConfigure.context);
    const first = startContext();
    const second = startContext();
    const firstHandle = plugin.start?.(first.context);
    const secondHandle = plugin.start?.(second.context);
    expect(firstHandle).not.toBe(secondHandle);
    firstHandle?.dispose();
    secondHandle?.dispose();
    for (const dispose of [...first.disposers, ...second.disposers].reverse()) dispose();
  });
});

describe('vtt:fog capability with a real viewport', () => {
  const viewports: Viewport[] = [];
  const containers: HTMLDivElement[] = [];
  const size = { width: 800, height: 600, dpr: 1 };
  const ctx = {} as CanvasRenderingContext2D;

  afterEach(() => {
    for (const viewport of viewports.splice(0)) viewport.destroy();
    for (const container of containers.splice(0)) container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function mount(): { viewport: Viewport; plugin: FogPlugin } {
    const container = document.createElement('div');
    document.body.appendChild(container);
    containers.push(container);
    const plugin = createFogPlugin();
    const viewport = new Viewport(container, {
      plugins: [plugin],
      requiredCapabilities: { viewport: ['vtt:fog'], minimap: ['vtt:fog'] },
    });
    viewports.push(viewport);
    return { viewport, plugin };
  }

  it('is satisfied on viewport and minimap when no fog state exists', () => {
    const { viewport } = mount();
    expect(viewport.renderHooks.viewport.isFailClosed()).toBe(false);
    expect(viewport.renderHooks.minimap.isFailClosed()).toBe(false);
  });

  it('is satisfied when fog is initialized but the view mode is off', () => {
    const { viewport, plugin } = mount();
    plugin.manager.initialize({ bounds: { x: 0, y: 0, w: 128, h: 128 }, cellSize: 1 });
    plugin.manager.setViewMode('off');
    expect(viewport.renderHooks.viewport.isFailClosed()).toBe(false);
  });

  it('is satisfied and draws fog in player view', () => {
    const render = vi.spyOn(FogRenderer.prototype, 'render').mockImplementation(() => undefined);
    const { viewport, plugin } = mount();
    plugin.manager.initialize({ bounds: { x: 0, y: 0, w: 128, h: 128 }, cellSize: 1 });
    plugin.manager.setViewMode('player');
    expect(viewport.renderHooks.viewport.isFailClosed()).toBe(false);
    viewport.renderHooks.viewport.call('afterElements', ctx, viewport.camera, size);
    expect(render).toHaveBeenCalledWith(ctx, viewport.camera, 800, 600, 1);
  });

  it('fails closed after the fog render throws, even with no fog state', () => {
    vi.stubGlobal('reportError', vi.fn());
    vi.spyOn(FogRenderer.prototype, 'render').mockImplementation(() => {
      throw new Error('fog failed');
    });
    const { viewport } = mount();
    expect(viewport.renderHooks.viewport.call('afterElements', ctx, viewport.camera, size)).toBe(
      true,
    );
    expect(viewport.renderHooks.viewport.isFailClosed()).toBe(true);
  });

  it('is not satisfied once the fog plugin is disposed', () => {
    const { viewport } = mount();
    viewport.destroy();
    expect(viewport.renderHooks.viewport.isFailClosed()).toBe(true);
    expect(viewport.renderHooks.minimap.isFailClosed()).toBe(true);
  });
});
