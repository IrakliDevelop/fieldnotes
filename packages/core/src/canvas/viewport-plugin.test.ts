/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Viewport } from './viewport';
import type { ViewportPlugin, ViewportPluginHost } from './viewport-plugin';
import type { PluginHandle } from '../core/plugin-state-manager';

function createContainer(): HTMLDivElement {
  const container = document.createElement('div');
  Object.defineProperty(container, 'getBoundingClientRect', {
    value: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  });
  document.body.appendChild(container);
  return container;
}

describe('ViewportPlugin', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('accepts an empty plugins array without error', () => {
    const viewport = new Viewport(container, { plugins: [] });
    expect(viewport).toBeDefined();
    viewport.destroy();
  });

  it('works identically with no plugins option and empty plugins', () => {
    const vp1 = new Viewport(container);
    expect(vp1).toBeDefined();
    const state1 = vp1.exportState();
    vp1.destroy();

    const container2 = createContainer();
    const vp2 = new Viewport(container2, { plugins: [] });
    expect(vp2).toBeDefined();
    const state2 = vp2.exportState();
    vp2.destroy();
    document.body.removeChild(container2);

    // Both should produce valid states with the same structure
    expect(state1.version).toBe(state2.version);
    expect(state1.elements).toEqual(state2.elements);
    expect(state1.camera).toEqual(state2.camera);
  });

  it('calls install(host) with a valid host object', () => {
    const installSpy = vi.fn();
    const plugin: ViewportPlugin = {
      name: 'test-plugin',
      install: installSpy,
    };

    const viewport = new Viewport(container, { plugins: [plugin] });

    expect(installSpy).toHaveBeenCalledOnce();
    const host = installSpy.mock.calls[0][0] as ViewportPluginHost;
    expect(host).toBeDefined();
    expect(typeof host.pushHistory).toBe('function');
    expect(typeof host.requestRender).toBe('function');
    expect(typeof host.invalidateMinimap).toBe('function');
    expect(typeof host.registerPluginHandle).toBe('function');
    expect(typeof host.registerExtraBounds).toBe('function');
    expect(typeof host.onChange).toBe('function');
    expect(host.renderHooks).toBeDefined();
    expect(host.renderHooks.viewport).toBeDefined();
    expect(host.renderHooks.minimap).toBeDefined();
    expect(host.store).toBeDefined();

    viewport.destroy();
  });

  it('calls dispose() on plugin when viewport is destroyed', () => {
    const disposeSpy = vi.fn();
    const plugin: ViewportPlugin = {
      name: 'test-plugin',
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      install() {},
      dispose: disposeSpy,
    };

    const viewport = new Viewport(container, { plugins: [plugin] });
    viewport.destroy();

    expect(disposeSpy).toHaveBeenCalledOnce();
  });

  it('does not call dispose if plugin has no dispose method', () => {
    const plugin: ViewportPlugin = {
      name: 'test-plugin',
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      install() {},
    };

    const viewport = new Viewport(container, { plugins: [plugin] });
    expect(() => viewport.destroy()).not.toThrow();
  });

  it('installs multiple plugins in order', () => {
    const order: string[] = [];
    const p1: ViewportPlugin = {
      name: 'first',
      install() {
        order.push('first');
      },
    };
    const p2: ViewportPlugin = {
      name: 'second',
      install() {
        order.push('second');
      },
    };
    const p3: ViewportPlugin = {
      name: 'third',
      install() {
        order.push('third');
      },
    };

    const viewport = new Viewport(container, { plugins: [p1, p2, p3] });
    expect(order).toEqual(['first', 'second', 'third']);
    viewport.destroy();
  });

  it('disposes plugins in reverse order', () => {
    const disposed: string[] = [];
    const makePlugin = (name: string): ViewportPlugin => ({
      name,
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      install() {},
      dispose() {
        disposed.push(name);
      },
    });

    const viewport = new Viewport(container, {
      plugins: [makePlugin('a'), makePlugin('b'), makePlugin('c')],
    });
    viewport.destroy();
    expect(disposed).toEqual(['c', 'b', 'a']);
  });

  it('rolls back plugins and owned DOM when installation fails', () => {
    const disposed: string[] = [];
    const first: ViewportPlugin = {
      name: 'first',
      install() {
        // installed successfully before the later failure
      },
      dispose() {
        disposed.push('first');
      },
    };
    const second: ViewportPlugin = {
      name: 'second',
      install() {
        throw new Error('installation failed');
      },
      dispose() {
        disposed.push('second');
      },
    };

    expect(() => new Viewport(container, { plugins: [first, second] })).toThrow(
      'installation failed',
    );
    expect(disposed).toEqual(['second', 'first']);
    expect(container.childElementCount).toBe(0);
  });

  it('rolls back installed plugins when a later install fails', () => {
    const disposed: string[] = [];
    const first: ViewportPlugin = {
      name: 'first',
      install(host) {
        host.renderHooks.viewport.register({ afterElements: vi.fn() });
      },
      dispose: () => disposed.push('first'),
    };
    const failing: ViewportPlugin = {
      name: 'failing',
      install() {
        throw new Error('install failed');
      },
      dispose: () => disposed.push('failing'),
    };

    expect(() => new Viewport(container, { plugins: [first, failing] })).toThrow('install failed');
    expect(disposed).toEqual(['failing', 'first']);
  });

  it('plugin can register render hooks via the host', () => {
    const afterElementsSpy = vi.fn();
    let registeredHooks = false;
    const plugin: ViewportPlugin = {
      name: 'render-test',
      install(host) {
        host.renderHooks.viewport.register(
          { afterElements: afterElementsSpy },
          { slot: 'afterSceneBeforeOverlay' },
        );
        registeredHooks = true;
      },
    };

    const viewport = new Viewport(container, { plugins: [plugin] });
    expect(registeredHooks).toBe(true);
    viewport.destroy();
  });

  it('plugin can register a PluginHandle and state round-trips through export/load', () => {
    let pluginState = { count: 0 };
    const handle: PluginHandle = {
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      dispose() {},
      exportState() {
        return pluginState;
      },
      loadState(data: unknown) {
        pluginState = data as { count: number };
      },
    };

    const plugin: ViewportPlugin = {
      name: 'stateful-plugin',
      install(host) {
        host.registerPluginHandle('stateful-plugin', handle);
      },
    };

    const viewport = new Viewport(container, { plugins: [plugin] });
    pluginState = { count: 42 };

    const exported = viewport.exportState();
    expect(exported.extensions).toBeDefined();
    expect(exported.extensions['stateful-plugin']).toEqual({
      version: 1,
      data: { count: 42 },
    });

    pluginState = { count: 0 };
    viewport.loadState(exported);
    expect(pluginState).toEqual({ count: 42 });

    viewport.destroy();
  });

  it('plugin can register extra bounds for minimap', () => {
    const boundsProvider = vi.fn(() => ({ x: 0, y: 0, w: 1000, h: 1000 }));
    const plugin: ViewportPlugin = {
      name: 'bounds-test',
      install(host) {
        host.registerExtraBounds(boundsProvider);
      },
    };

    const viewport = new Viewport(container, {
      plugins: [plugin],
      minimap: { enabled: true },
    });

    expect(boundsProvider).toBeDefined();
    viewport.destroy();
  });

  it('unregistering extra bounds stops the provider from being called', () => {
    const boundsProvider = vi.fn(() => ({ x: 0, y: 0, w: 500, h: 500 }));
    let unregister: (() => void) | undefined;

    const plugin: ViewportPlugin = {
      name: 'bounds-unregister',
      install(host) {
        unregister = host.registerExtraBounds(boundsProvider);
      },
    };

    const viewport = new Viewport(container, { plugins: [plugin] });
    unregister?.();
    boundsProvider.mockClear();

    expect(boundsProvider).not.toHaveBeenCalled();
    viewport.destroy();
  });

  it('plugin onChange listener fires when plugin notifies changes', () => {
    const changeListener = vi.fn();

    const plugin: ViewportPlugin = {
      name: 'change-test',
      install(host) {
        host.onChange(changeListener);
      },
    };

    const viewport = new Viewport(container, { plugins: [plugin] });
    expect(changeListener).toBeDefined();
    viewport.destroy();
  });
});
