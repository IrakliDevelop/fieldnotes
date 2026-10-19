/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServiceKey } from '../core/service-key';
import type { PluginHandle } from '../core/plugin-state-manager';
import { Viewport } from './viewport';
import type { ViewportPlugin } from './viewport-plugin';
import { SelectTool } from '../tools/select-tool';
import { createArrow, createNote } from '../elements/element-factory';
import { getDefaultElementRegistry } from '../elements/default-registry';
import type { BaseElement, ElementTypeDefinition } from '../elements/types';

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
    expect(viewport.exportState().version).toBe(5);
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

  it('leaves no DOM and no live store subscriptions when a required plugin fails to start', () => {
    let failed: Viewport | undefined;
    expect(
      () =>
        new Viewport(container, {
          plugins: [
            {
              name: 'required',
              required: true,
              start(context) {
                failed = context.viewport;
                throw new Error('required start failed');
              },
            },
          ],
        }),
    ).toThrow('required start failed');
    if (!failed) throw new Error('plugin did not start');
    const render = vi.spyOn(failed, 'requestRender');

    failed.store.add(createNote({ position: { x: 0, y: 0 } }));

    expect(container.childElementCount).toBe(0);
    expect(failed.history.canUndo).toBe(false);
    expect(render).not.toHaveBeenCalled();
  });

  it.each([
    ['destroy()', undefined],
    ['a required-capability failure', { viewport: ['missing'] }],
  ])('unbinds arrows from elements a plugin removes on dispose during %s', (_, required) => {
    let store: Viewport['store'] | undefined;
    let arrowId = '';
    const plugin: ViewportPlugin = {
      name: 'remover',
      start(context) {
        store = context.store;
        const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 100 } });
        const arrow = createArrow({
          from: { x: 50, y: 50 },
          to: { x: 300, y: 300 },
          fromBinding: { elementId: note.id },
        });
        arrowId = arrow.id;
        context.store.add(note);
        context.store.add(arrow);
        context.addDisposer(() => context.store.remove(note.id));
        return undefined;
      },
    };
    const create = () =>
      new Viewport(container, { plugins: [plugin], requiredCapabilities: required });
    if (required) expect(create).toThrow('viewport:missing');
    else create().destroy();

    const arrow = store?.getById(arrowId);
    expect(arrow?.type).toBe('arrow');
    expect(arrow?.type === 'arrow' && arrow.fromBinding).toBeFalsy();
  });

  it('clears resize listeners registered by a required plugin that fails to start', () => {
    let failed: Viewport | undefined;
    expect(
      () =>
        new Viewport(container, {
          plugins: [
            {
              name: 'required',
              required: true,
              start(context) {
                failed = context.viewport;
                context.viewport.onResize(() => undefined);
                throw new Error('required start failed');
              },
            },
          ],
        }),
    ).toThrow('required start failed');
    if (!failed) throw new Error('plugin did not start');

    expect((failed as unknown as { resizeListeners: Set<() => void> }).resizeListeners.size).toBe(
      0,
    );
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

  it('rejects exports once the only satisfier of a required capability is disposed', async () => {
    let disposeSatisfiers = (): void => undefined;
    const viewport = new Viewport(container, {
      requiredCapabilities: { imageExport: ['x'], svgExport: ['x'] },
      plugins: [
        {
          name: 'fog',
          start(context) {
            const hooks = context.viewport.renderHooks;
            const offImage = hooks.imageExport.register({}, { satisfies: ['x'] });
            const offSvg = hooks.svgExport.register({}, { satisfies: ['x'] });
            disposeSatisfiers = () => {
              offImage();
              offSvg();
            };
            return undefined;
          },
        },
      ],
    });

    disposeSatisfiers();

    await expect(viewport.exportImage()).rejects.toThrow('missing on imageExport: x');
    await expect(viewport.exportSVG()).rejects.toThrow('missing on svgExport: x');
    viewport.destroy();
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

  it('registerAction makes the action visible in viewport.actions and in the context menu under its own group after the built-ins', () => {
    const viewport = new Viewport(container, {
      plugins: [
        {
          name: 'my-plugin',
          configure(context) {
            context.registerAction({
              id: 'my-plugin.frobnicate',
              label: 'Frobnicate',
              menu: { group: 'my-plugin', order: 10 },
              perform: () => undefined,
            });
          },
        },
      ],
    });
    // Action is visible in the registry
    expect(viewport.actions.get('my-plugin.frobnicate')).toBeDefined();
    expect(viewport.actions.get('my-plugin.frobnicate')?.label).toBe('Frobnicate');

    // Action appears in context menu under its own group after built-ins
    const sel = new SelectTool();
    viewport.toolManager.register(sel);
    viewport.toolManager.setTool('select', viewport.toolContext);
    (sel as unknown as { setSelection: (ids: string[]) => void }).setSelection(['dummy']);

    viewport.openContextMenu({ x: 5, y: 5 });
    const root = document.querySelector('.fieldnotes-context-menu');
    const entries = root
      ? Array.from(root.children).map((el) => {
          if (el.getAttribute('role') === 'separator') return '---';
          return el.textContent ?? '';
        })
      : [];
    // Frobnicate should appear after the Lock built-in group's separator
    const frobIdx = entries.indexOf('Frobnicate');
    const lockIdx = entries.indexOf('Lock');
    expect(frobIdx).toBeGreaterThan(-1);
    expect(lockIdx).toBeGreaterThan(-1);
    expect(frobIdx).toBeGreaterThan(lockIdx);
    viewport.destroy();
  });

  it("registerAction with a duplicate id throws inside configure and rolls back the plugin's other registrations", () => {
    const viewport = new Viewport(container, {
      plugins: [
        {
          name: 'dup-plugin',
          configure(context) {
            // Register a tool first (to verify rollback)
            context.registerTool({
              name: 'dup-tool',
              onPointerDown: () => undefined,
              onPointerMove: () => undefined,
              onPointerUp: () => undefined,
              onActivate: () => undefined,
              onDeactivate: () => undefined,
            });
            // Then register a duplicate action (edit.cut is a built-in)
            context.registerAction({
              id: 'edit.cut',
              label: 'Duplicate Cut',
              perform: () => undefined,
            });
          },
        },
      ],
    });
    // Tool was rolled back because configure threw
    expect(viewport.toolManager.getTool('dup-tool')).toBeUndefined();
    viewport.destroy();
  });

  it('continues after an optional plugin registers an action with an invalid shortcut without retaining it', () => {
    const viewport = new Viewport(container, {
      plugins: [
        {
          name: 'invalid-shortcut-plugin',
          configure(context) {
            context.registerAction({
              id: 'invalid-shortcut-plugin.action',
              label: 'Invalid shortcut',
              shortcut: ['ctrl+'],
              perform: () => undefined,
            });
          },
        },
      ],
    });

    expect(viewport.actions.get('invalid-shortcut-plugin.action')).toBeUndefined();
    expect(viewport.shortcuts.getBindings()['invalid-shortcut-plugin.action']).toBeUndefined();
    viewport.destroy();
  });

  it('dispose removes plugin actions', () => {
    const viewport = new Viewport(container, {
      plugins: [
        {
          name: 'disposable',
          configure(context) {
            context.registerAction({
              id: 'disposable.action',
              label: 'Disposable',
              perform: () => undefined,
            });
          },
        },
      ],
    });
    expect(viewport.actions.get('disposable.action')).toBeDefined();
    viewport.destroy();
    expect(viewport.actions.get('disposable.action')).toBeUndefined();
  });
});

describe('Viewport plugin warnings', () => {
  let container: HTMLDivElement;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    container = createContainer();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
    container.remove();
  });

  it('warns when a duplicate plugin name is skipped', () => {
    const definition: ViewportPlugin = { name: 'twin' };
    const viewport = new Viewport(container, { plugins: [definition, definition] });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^\[fieldnotes\].*twin/));
    viewport.destroy();
  });

  it('warns with the plugin name and error when an optional configure fails', () => {
    const viewport = new Viewport(container, {
      plugins: [
        {
          name: 'bad-configure',
          configure() {
            throw new Error('configure exploded');
          },
        },
      ],
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/^\[fieldnotes\].*bad-configure.*configure exploded/),
    );
    viewport.destroy();
  });

  it('warns with the plugin name and error when an optional start fails', () => {
    const viewport = new Viewport(container, {
      plugins: [
        {
          name: 'bad-start',
          start() {
            throw new Error('start exploded');
          },
        },
      ],
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/^\[fieldnotes\].*bad-start.*start exploded/),
    );
    viewport.destroy();
  });

  it('warns for each plugin whose saved state is dropped on load', () => {
    let state: unknown = { count: 1 };
    const viewport = new Viewport(container, {
      plugins: [
        {
          name: 'versioned',
          start: () => ({
            dispose: () => undefined,
            stateVersion: 2,
            exportState: () => state,
            loadState: (data) => {
              state = data;
            },
          }),
        },
      ],
    });
    const saved = viewport.exportState();
    viewport.loadState({
      ...saved,
      extensions: { versioned: { version: 1, data: { count: 9 } } },
    });
    expect(state).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^\[fieldnotes\].*versioned/));
    viewport.destroy();
  });
});

describe('Viewport element registry', () => {
  const pinDefinition: ElementTypeDefinition<BaseElement> = {
    type: 'test:pin',
    legacyTypes: [],
    decodeLegacy: () => {
      throw new Error('unused');
    },
    validateData: () => true,
    unwrap: (env) => ({ ...env, type: 'pin' }),
    wrap: (el) => ({ ...el, type: 'extension', extensionType: 'test:pin', data: {} }),
    bounds: (el) => ({ x: el.position.x, y: el.position.y, w: 1, h: 1 }),
  };
  let container: HTMLDivElement;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    container.remove();
    getDefaultElementRegistry().unregister(pinDefinition.type);
  });

  it('keeps a plugin element type on one viewport when another installing it is destroyed', () => {
    const plugin: ViewportPlugin = {
      name: 'pin',
      configure: (ctx) => ctx.registerElementType(pinDefinition),
    };
    const first = new Viewport(container, { plugins: [plugin] });
    const second = new Viewport(container, { plugins: [plugin] });
    expect(getDefaultElementRegistry().has(pinDefinition.type)).toBe(false);

    first.destroy();

    expect(second.elementRegistry.has(pinDefinition.type)).toBe(true);
    expect(getDefaultElementRegistry().has(pinDefinition.type)).toBe(false);
    second.destroy();
  });

  it('sees types registered on the global default registry before construction', () => {
    getDefaultElementRegistry().register(pinDefinition);
    const viewport = new Viewport(container);
    expect(viewport.elementRegistry.has(pinDefinition.type)).toBe(true);
    viewport.destroy();
  });
});
