/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServiceKey } from '../core/service-key';
import type { PluginHandle } from '../core/plugin-state-manager';
import { Viewport } from './viewport';
import type { ViewportPlugin } from './viewport-plugin';

function createContainer(): HTMLDivElement {
  const container = document.createElement('div');
  Object.defineProperty(container, 'getBoundingClientRect', {
    value: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  });
  document.body.appendChild(container);
  return container;
}

describe('Viewport plugin lifecycle', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it('keeps plugin-free construction backward compatible', () => {
    const viewport = new Viewport(container, { plugins: [] });
    expect(viewport.exportState().version).toBe(4);
    viewport.destroy();
  });

  it('configures by stable priority before starting any plugin', () => {
    const order: string[] = [];
    const plugin = (name: string, priority: number): ViewportPlugin => ({
      name,
      priority,
      configure: () => order.push(`configure:${name}`),
      start: () => {
        order.push(`start:${name}`);
        return undefined;
      },
    });
    const viewport = new Viewport(container, {
      plugins: [plugin('late', 10), plugin('first', -1), plugin('same', 10)],
    });
    expect(order).toEqual([
      'configure:first',
      'configure:late',
      'configure:same',
      'start:first',
      'start:late',
      'start:same',
    ]);
    viewport.destroy();
  });

  it('installs a duplicate plugin name only once', () => {
    const configured = vi.fn();
    const started = vi.fn();
    const definition: ViewportPlugin = {
      name: 'same',
      configure: configured,
      start: started,
    };
    const viewport = new Viewport(container, { plugins: [definition, definition] });
    expect(configured).toHaveBeenCalledOnce();
    expect(started).toHaveBeenCalledOnce();
    viewport.destroy();
  });

  it('registers typed services during start', () => {
    const key = createServiceKey<{ value: number }>('answer');
    const viewport = new Viewport(container, {
      plugins: [
        {
          name: 'service',
          start(context) {
            context.registerService(key, { value: 42 });
            return undefined;
          },
        },
      ],
    });
    expect(viewport.getService(key)).toEqual({ value: 42 });
    viewport.destroy();
  });

  it('rolls back an optional configure failure and continues', () => {
    const started = vi.fn();
    const viewport = new Viewport(container, {
      plugins: [
        {
          name: 'broken',
          configure(context) {
            context.registerViewportHooks({}, { satisfies: ['broken-capability'] });
            throw new Error('configure failed');
          },
        },
        { name: 'healthy', start: started },
      ],
    });
    expect(started).toHaveBeenCalledOnce();
    expect(viewport.renderHooks.viewport.getSatisfiedCapabilities()).not.toContain(
      'broken-capability',
    );
    viewport.destroy();
  });

  it('rolls back start disposers, services, and configure registrations', () => {
    const key = createServiceKey<{ ok: true }>('temporary');
    const disposed = vi.fn();
    const viewport = new Viewport(container, {
      plugins: [
        {
          name: 'broken',
          configure(context) {
            context.registerViewportHooks({}, { satisfies: ['temporary'] });
          },
          start(context) {
            context.addDisposer(disposed);
            context.registerService(key, { ok: true });
            throw new Error('start failed');
          },
        },
      ],
    });
    expect(disposed).toHaveBeenCalledOnce();
    expect(viewport.getService(key)).toBeUndefined();
    expect(viewport.renderHooks.viewport.getSatisfiedCapabilities()).not.toContain('temporary');
    viewport.destroy();
  });

  it('aborts construction and removes owned DOM when a required plugin fails', () => {
    const disposed = vi.fn();
    expect(
      () =>
        new Viewport(container, {
          plugins: [
            { name: 'installed', start: () => ({ dispose: disposed }) },
            {
              name: 'required',
              required: true,
              start() {
                throw new Error('required start failed');
              },
            },
          ],
        }),
    ).toThrow('required start failed');
    expect(disposed).toHaveBeenCalledOnce();
    expect(container.childElementCount).toBe(0);
  });

  it('validates required capabilities after optional rollback', () => {
    expect(
      () =>
        new Viewport(container, {
          requiredCapabilities: { viewport: ['vtt:fog'] },
          plugins: [
            {
              name: 'optional-fog',
              configure(context) {
                context.registerViewportHooks({}, { satisfies: ['vtt:fog'] });
              },
              start() {
                throw new Error('optional start failed');
              },
            },
          ],
        }),
    ).toThrow('viewport:vtt:fog');
    expect(container.childElementCount).toBe(0);
  });

  it('disposes handles and start resources in reverse plugin order', () => {
    const order: string[] = [];
    const plugin = (name: string): ViewportPlugin => ({
      name,
      start(context) {
        context.addDisposer(() => order.push(`resource:${name}`));
        return { dispose: () => order.push(`handle:${name}`) };
      },
    });
    const viewport = new Viewport(container, { plugins: [plugin('a'), plugin('b')] });
    viewport.destroy();
    expect(order).toEqual(['handle:b', 'resource:b', 'handle:a', 'resource:a']);
  });

  it('uses per-viewport handles when one definition is reused', () => {
    const disposed: number[] = [];
    let instance = 0;
    const plugin: ViewportPlugin = {
      name: 'reusable',
      start(): PluginHandle {
        const id = ++instance;
        return { dispose: () => disposed.push(id) };
      },
    };
    const secondContainer = createContainer();
    const first = new Viewport(container, { plugins: [plugin] });
    const second = new Viewport(secondContainer, { plugins: [plugin] });
    first.destroy();
    second.destroy();
    secondContainer.remove();
    expect(disposed).toEqual([1, 2]);
  });

  it('round-trips per-instance plugin state', () => {
    let state = { count: 0 };
    const viewport = new Viewport(container, {
      plugins: [
        {
          name: 'stateful',
          start: () => ({
            dispose: () => undefined,
            exportState: () => state,
            loadState: (data) => {
              state = data as { count: number };
            },
          }),
        },
      ],
    });
    state = { count: 42 };
    const exported = viewport.exportState();
    state = { count: 0 };
    viewport.loadState(exported);
    expect(state).toEqual({ count: 42 });
    viewport.destroy();
  });

  it('rejects invalid plugin state before mutating core or notifying observers', () => {
    let state = { count: 1 };
    const viewport = new Viewport(container, {
      plugins: [
        {
          name: 'stateful',
          start: () => ({
            dispose: () => undefined,
            exportState: () => state,
            validateState: (data) => {
              if ((data as { invalid?: boolean } | undefined)?.invalid) throw new Error('invalid');
            },
            loadState: (data) => {
              state = data as { count: number };
            },
          }),
        },
      ],
    });
    const id = viewport.addShape({ position: { x: 10, y: 20 } });
    const before = viewport.exportState();
    const incoming = structuredClone(before);
    const element = incoming.elements.find((candidate) => candidate.id === id);
    if (!element) throw new Error('shape was not created');
    element.position = { x: 300, y: 400 };
    incoming.extensions = { stateful: { version: 1, data: { count: 9, invalid: true } } };
    const observed = vi.fn();
    const unsubscribe = viewport.store.on('clear', observed);

    expect(() => viewport.loadState(incoming)).toThrow('state validation failed');
    expect(viewport.store.getById(id)?.position).toEqual({ x: 10, y: 20 });
    expect(state).toEqual({ count: 1 });
    expect(observed).not.toHaveBeenCalled();
    unsubscribe();
    viewport.destroy();
  });

  it('rolls back core, plugin, and history state without notifications when commit fails', () => {
    let state = { count: 1, fail: false };
    let notifyChange: () => void = () => undefined;
    const pluginNotifications = vi.fn();
    const viewport = new Viewport(container, {
      plugins: [
        {
          name: 'stateful',
          start: (context) => {
            notifyChange = context.notifyChange;
            context.onChange(pluginNotifications);
            return {
              dispose: () => undefined,
              exportState: () => state,
              loadState: (data) => {
                state = data as typeof state;
                notifyChange();
                if (state.fail) throw new Error('commit failed');
              },
            };
          },
        },
      ],
    });
    const id = viewport.addShape({ position: { x: 10, y: 20 } });
    const historyCount = viewport.history.undoCount;
    const incoming = structuredClone(viewport.exportState());
    const element = incoming.elements.find((candidate) => candidate.id === id);
    if (!element) throw new Error('shape was not created');
    element.position = { x: 300, y: 400 };
    incoming.camera = { position: { x: 50, y: 60 }, zoom: 2 };
    incoming.extensions = { stateful: { version: 1, data: { count: 9, fail: true } } };
    const storeNotifications = vi.fn();
    const layerNotifications = vi.fn();
    const cameraNotifications = vi.fn();
    const historyNotifications = vi.fn();
    const unsubscribers = [
      viewport.store.onChange(storeNotifications),
      viewport.layerManager.on('change', layerNotifications),
      viewport.camera.onChange(cameraNotifications),
      viewport.history.onChange(historyNotifications),
    ];

    expect(() => viewport.loadState(incoming)).toThrow('Plugin state commit failed');
    expect(viewport.store.getById(id)?.position).toEqual({ x: 10, y: 20 });
    expect(viewport.camera.position).toEqual({ x: 0, y: 0 });
    expect(viewport.camera.zoom).toBe(1);
    expect(viewport.history.undoCount).toBe(historyCount);
    expect(state).toEqual({ count: 1, fail: false });
    expect(storeNotifications).not.toHaveBeenCalled();
    expect(layerNotifications).not.toHaveBeenCalled();
    expect(cameraNotifications).not.toHaveBeenCalled();
    expect(historyNotifications).not.toHaveBeenCalled();
    expect(pluginNotifications).not.toHaveBeenCalled();
    unsubscribers.forEach((unsubscribe) => unsubscribe());
    viewport.destroy();
  });

  it('flushes load notifications only after every subsystem has committed', () => {
    let state = { count: 1 };
    let notifyChange: () => void = () => undefined;
    const observations: { x: number; zoom: number; count: number; undo: number }[] = [];
    let storeNotifications = 0;
    let record = (): void => undefined;
    const viewport = new Viewport(container, {
      plugins: [
        {
          name: 'stateful',
          start: (context) => {
            notifyChange = context.notifyChange;
            context.onChange(() => record());
            return {
              dispose: () => undefined,
              exportState: () => state,
              loadState: (data) => {
                state = data as typeof state;
                notifyChange();
              },
            };
          },
        },
      ],
    });
    const id = viewport.addShape({ position: { x: 10, y: 20 } });
    record = (): void => {
      observations.push({
        x: viewport.store.getById(id)?.position.x ?? -1,
        zoom: viewport.camera.zoom,
        count: state.count,
        undo: viewport.history.undoCount,
      });
    };
    const incoming = structuredClone(viewport.exportState());
    const element = incoming.elements.find((candidate) => candidate.id === id);
    if (!element) throw new Error('shape was not created');
    element.position = { x: 300, y: 400 };
    incoming.camera = { position: { x: 50, y: 60 }, zoom: 2 };
    incoming.extensions = { stateful: { version: 1, data: { count: 9 } } };
    const unsubscribers = [
      viewport.store.onChange(() => {
        storeNotifications += 1;
        record();
      }),
      viewport.layerManager.on('change', record),
      viewport.camera.onChange(record),
      viewport.history.onChange(record),
    ];

    viewport.loadState(incoming);

    expect(observations.length).toBeGreaterThan(0);
    expect(storeNotifications).toBe(1);
    expect(observations).toEqual(observations.map(() => ({ x: 300, zoom: 2, count: 9, undo: 0 })));
    unsubscribers.forEach((unsubscribe) => unsubscribe());
    viewport.destroy();
  });
});
