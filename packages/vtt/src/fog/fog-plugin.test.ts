import { describe, expect, it, vi } from 'vitest';
import type { PluginConfigureContext, PluginStartContext } from '@fieldnotes/core';
import { createFogPlugin, FogManagerKey } from './fog-plugin';
import { FogManager } from './fog-manager';

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
