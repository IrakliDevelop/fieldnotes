/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionRegistry } from '../actions/action-registry';
import { createServiceKey } from '../core/service-key';
import { PluginHost } from './plugin-host';
import { Viewport } from './viewport';
import type { ViewportPlugin } from './viewport-plugin';
import type { Tool } from '../tools/types';

function createHost(viewport: Viewport): PluginHost {
  return new PluginHost({
    viewport,
    elementRegistry: viewport.elementRegistry,
    toolManager: viewport.toolManager,
    renderHooks: viewport.renderHooks,
    actionRegistry: new ActionRegistry(() => ({
      viewport,
      store: viewport.store,
      selectedIds: [],
    })),
    store: viewport.store,
    history: viewport.history,
    requestRender: () => viewport.requestRender(),
    pluginStateManager: viewport.plugins,
    getMinimap: () => null,
  });
}

function stubTool(name: string): Tool {
  return { name, onPointerDown: vi.fn(), onPointerMove: vi.fn(), onPointerUp: vi.fn() };
}

describe('PluginHost', () => {
  let container: HTMLDivElement;
  let viewport: Viewport;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    viewport = new Viewport(container);
  });

  afterEach(() => {
    viewport.destroy();
    container.remove();
  });

  it('configures by priority, starts in that order, and disposes in reverse', () => {
    const order: string[] = [];
    const plugin = (name: string, priority: number): ViewportPlugin => ({
      name,
      priority,
      configure: (ctx) => {
        order.push(`configure:${name}`);
        ctx.registerTool(stubTool(`tool-${name}`));
      },
      start: (ctx) => {
        order.push(`start:${name}`);
        ctx.addDisposer(() => order.push(`stop:${name}`));
        return { dispose: () => order.push(`handle:${name}`) };
      },
    });
    const host = createHost(viewport);

    host.configurePlugins([plugin('late', 10), plugin('early', -1)]);
    host.startPlugins();
    host.disposePlugins();

    expect(order).toEqual([
      'configure:early',
      'configure:late',
      'start:early',
      'start:late',
      'handle:late',
      'stop:late',
      'handle:early',
      'stop:early',
    ]);
    expect(viewport.toolManager.getTool('tool-early')).toBeUndefined();
    expect(viewport.toolManager.getTool('tool-late')).toBeUndefined();
  });

  it('rolls back an optional plugin that fails to start and keeps the others running', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const key = createServiceKey<string>('svc');
    const host = createHost(viewport);
    const stopped: string[] = [];

    host.configurePlugins([
      {
        name: 'good',
        start: (ctx) => {
          ctx.registerService(key, 'good');
          ctx.addDisposer(() => stopped.push('good'));
          return undefined;
        },
      },
      {
        name: 'bad',
        configure: (ctx) => ctx.registerTool(stubTool('bad-tool')),
        start: (ctx) => {
          ctx.registerService(key, 'bad');
          ctx.addDisposer(() => stopped.push('bad'));
          throw new Error('boom');
        },
      },
    ]);
    host.startPlugins();

    expect(host.getService(key)).toBe('good');
    expect(viewport.toolManager.getTool('bad-tool')).toBeUndefined();
    expect(stopped).toEqual(['bad']);
    expect(warn).toHaveBeenCalledWith('[fieldnotes] optional plugin "bad" failed to start: boom');
    warn.mockRestore();
  });
});
