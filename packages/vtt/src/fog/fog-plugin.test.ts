import { describe, it, expect, vi } from 'vitest';
import { createFogPlugin } from './fog-plugin';
import { FogManager } from './fog-manager';
import type { ViewportPluginHost } from '@fieldnotes/core';

function makeHost(): ViewportPluginHost & {
  changeListeners: Set<() => void>;
  extraBoundsProviders: Set<() => unknown>;
  pluginHandles: Map<string, unknown>;
} {
  const changeListeners = new Set<() => void>();
  const extraBoundsProviders = new Set<() => unknown>();
  const pluginHandles = new Map<string, unknown>();

  return {
    renderHooks: {
      viewport: { register: vi.fn(() => vi.fn()) },
      minimap: { register: vi.fn(() => vi.fn()) },
      imageExport: { register: vi.fn(() => vi.fn()) },
      svgExport: { register: vi.fn(() => vi.fn()) },
    } as unknown as ViewportPluginHost['renderHooks'],
    store: {} as ViewportPluginHost['store'],
    pushHistory: vi.fn(),
    requestRender: vi.fn(),
    invalidateMinimap: vi.fn(),
    registerPluginHandle: vi.fn((name: string, handle: unknown) => {
      pluginHandles.set(name, handle);
    }),
    registerExtraBounds: vi.fn((provider: () => unknown) => {
      extraBoundsProviders.add(provider);
      return () => {
        extraBoundsProviders.delete(provider);
      };
    }),
    onChange: vi.fn((listener: () => void) => {
      changeListeners.add(listener);
      return () => {
        changeListeners.delete(listener);
      };
    }),
    notifyChange: vi.fn(() => {
      for (const fn of changeListeners) fn();
    }),
    changeListeners,
    extraBoundsProviders,
    pluginHandles,
  };
}

describe('createFogPlugin', () => {
  it('creates a plugin with name "fog"', () => {
    const plugin = createFogPlugin();
    expect(plugin.name).toBe('fog');
    plugin.dispose?.();
  });

  it('exposes a FogManager', () => {
    const plugin = createFogPlugin();
    expect(plugin.manager).toBeDefined();
    expect(typeof plugin.manager.initialize).toBe('function');
    plugin.dispose?.();
  });

  it('registers export hooks, plugin handle, and extra bounds on install', () => {
    const plugin = createFogPlugin();
    const host = makeHost();
    plugin.install(host);

    expect(host.renderHooks.viewport.register).not.toHaveBeenCalled();
    expect(host.renderHooks.minimap.register).toHaveBeenCalledOnce();
    expect(host.renderHooks.imageExport.register).toHaveBeenCalledOnce();
    expect(host.renderHooks.svgExport.register).toHaveBeenCalledOnce();
    expect(host.registerPluginHandle).toHaveBeenCalledWith('fog', expect.any(Object));
    expect(host.registerExtraBounds).toHaveBeenCalledOnce();

    plugin.dispose?.();
  });

  it('registers its viewport layer only while fog is visible', () => {
    const unregisterViewport = vi.fn();
    const plugin = createFogPlugin();
    const host = makeHost();
    vi.mocked(host.renderHooks.viewport.register).mockReturnValue(unregisterViewport);
    plugin.install(host);

    plugin.manager.initialize({
      bounds: { x: 0, y: 0, w: 256, h: 256 },
      base: 'covered',
      cellSize: 64,
    });
    expect(host.renderHooks.viewport.register).not.toHaveBeenCalled();

    plugin.manager.setViewMode('editor');
    expect(host.renderHooks.viewport.register).toHaveBeenCalledOnce();

    plugin.manager.setViewMode('off');
    expect(unregisterViewport).toHaveBeenCalledOnce();

    plugin.dispose?.();
  });

  it('setOptions updates the renderer and triggers render', () => {
    const plugin = createFogPlugin();
    const host = makeHost();
    plugin.install(host);

    plugin.setOptions({ editorColor: '#ff0000' });
    expect(host.requestRender).toHaveBeenCalled();
    expect(host.invalidateMinimap).toHaveBeenCalled();

    plugin.dispose?.();
  });

  it('fog manager change triggers render, minimap invalidation, and notifyChange', () => {
    const plugin = createFogPlugin();
    const host = makeHost();
    plugin.install(host);

    plugin.manager.initialize({
      bounds: { x: 0, y: 0, w: 256, h: 256 },
      base: 'covered',
      cellSize: 64,
    });
    plugin.manager.setViewMode('editor');
    plugin.manager.applyRegion(
      { kind: 'rectangle', from: { x: 100, y: 100 }, to: { x: 150, y: 150 } },
      'reveal',
    );

    expect(host.requestRender).toHaveBeenCalled();
    expect(host.invalidateMinimap).toHaveBeenCalled();
    expect(host.notifyChange).toHaveBeenCalled();

    plugin.dispose?.();
  });

  it('dispose cleans up subscriptions', () => {
    const plugin = createFogPlugin();
    const host = makeHost();
    plugin.install(host);

    plugin.manager.initialize({
      bounds: { x: 0, y: 0, w: 256, h: 256 },
      base: 'covered',
      cellSize: 64,
    });
    plugin.manager.setViewMode('editor');

    plugin.dispose?.();

    const renderBefore = (host.requestRender as ReturnType<typeof vi.fn>).mock.calls.length;
    const notifyBefore = (host.notifyChange as ReturnType<typeof vi.fn>).mock.calls.length;

    plugin.manager.applyRegion(
      { kind: 'rectangle', from: { x: 100, y: 100 }, to: { x: 150, y: 150 } },
      'reveal',
    );

    expect((host.requestRender as ReturnType<typeof vi.fn>).mock.calls.length).toBe(renderBefore);
    expect((host.notifyChange as ReturnType<typeof vi.fn>).mock.calls.length).toBe(notifyBefore);
  });

  it('accepts a pre-created FogManager', () => {
    const manager = new FogManager();
    const plugin = createFogPlugin({ manager });
    expect(plugin.manager).toBe(manager);
    plugin.dispose?.();
  });
});
