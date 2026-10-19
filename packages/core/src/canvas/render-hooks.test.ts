/* eslint-disable @typescript-eslint/no-empty-function */
import { afterEach, describe, it, expect, expectTypeOf, vi } from 'vitest';
import { TypedHookRegistry, createRenderHooks } from './render-hooks';

// ─── Test fixture: a simple hook shape ───────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- type alias required for Record<string, unknown> constraint
type TestHooks = {
  beforeRender?(ctx: { frame: number }): void;
  afterRender?(ctx: { frame: number }): void;
};

describe('TypedHookRegistry', () => {
  describe('register and iterate', () => {
    it('returns a dispose function', () => {
      const registry = new TypedHookRegistry<TestHooks>();
      const dispose = registry.register({ afterRender: () => {} });

      expect(typeof dispose).toBe('function');
    });

    it('iterates registered hooks', () => {
      const registry = new TypedHookRegistry<TestHooks>();
      const fn = vi.fn();
      registry.register({ afterRender: fn });

      const hooks = [...registry.iterate('afterRender')];
      expect(hooks).toHaveLength(1);
    });

    it('returns empty iterator for unregistered hook name', () => {
      const registry = new TypedHookRegistry<TestHooks>();
      expect([...registry.iterate('beforeRender')]).toHaveLength(0);
    });

    it('supports multiple hooks', () => {
      const registry = new TypedHookRegistry<TestHooks>();
      const fn1 = vi.fn();
      const fn2 = vi.fn();
      registry.register({ afterRender: fn1 });
      registry.register({ afterRender: fn2 });

      const hooks = [...registry.iterate('afterRender')];
      expect(hooks).toHaveLength(2);
    });
  });

  describe('priority ordering', () => {
    it('iterates hooks in priority order (lower first)', () => {
      const registry = new TypedHookRegistry<TestHooks>();
      const order: string[] = [];

      registry.register({ afterRender: () => order.push('low') }, { priority: 10 });
      registry.register({ afterRender: () => order.push('high') }, { priority: -1 });
      registry.register({ afterRender: () => order.push('default') });

      for (const hook of registry.iterate('afterRender')) {
        hook({ frame: 1 });
      }

      expect(order).toEqual(['high', 'default', 'low']);
    });

    it('preserves registration order for equal priority', () => {
      const registry = new TypedHookRegistry<TestHooks>();
      const order: number[] = [];

      registry.register({ afterRender: () => order.push(1) });
      registry.register({ afterRender: () => order.push(2) });
      registry.register({ afterRender: () => order.push(3) });

      for (const hook of registry.iterate('afterRender')) {
        hook({ frame: 1 });
      }

      expect(order).toEqual([1, 2, 3]);
    });
  });

  describe('dispose', () => {
    it('removes the hook from iteration', () => {
      const registry = new TypedHookRegistry<TestHooks>();
      const dispose = registry.register({ afterRender: () => {} });

      expect([...registry.iterate('afterRender')]).toHaveLength(1);

      dispose();

      expect([...registry.iterate('afterRender')]).toHaveLength(0);
    });

    it('only removes the disposed hook, not others', () => {
      const registry = new TypedHookRegistry<TestHooks>();
      const fn1 = vi.fn();
      const fn2 = vi.fn();
      const dispose1 = registry.register({ afterRender: fn1 });
      registry.register({ afterRender: fn2 });

      dispose1();

      const hooks = [...registry.iterate('afterRender')];
      expect(hooks).toHaveLength(1);
    });

    it('is idempotent', () => {
      const registry = new TypedHookRegistry<TestHooks>();
      const dispose = registry.register({ afterRender: () => {} });

      dispose();
      expect(() => dispose()).not.toThrow();
    });
  });

  describe('slot-based ordering', () => {
    it('groups hooks by slot and orders by priority within slot', () => {
      const registry = new TypedHookRegistry<TestHooks>();
      const order: string[] = [];

      registry.register(
        { afterRender: () => order.push('overlay-low') },
        { slot: 'afterOverlay', priority: 10 },
      );
      registry.register(
        { afterRender: () => order.push('scene-high') },
        { slot: 'afterSceneBeforeOverlay', priority: -1 },
      );
      registry.register(
        { afterRender: () => order.push('scene-default') },
        { slot: 'afterSceneBeforeOverlay' },
      );
      registry.register(
        { afterRender: () => order.push('overlay-high') },
        { slot: 'afterOverlay', priority: -1 },
      );

      for (const hook of registry.iterate('afterRender')) {
        hook({ frame: 1 });
      }

      expect(order).toEqual(['scene-high', 'scene-default', 'overlay-high', 'overlay-low']);
    });
  });

  describe('capability tracking', () => {
    it('tracks satisfied capabilities', () => {
      const registry = new TypedHookRegistry<TestHooks>();
      registry.register({ afterRender: () => {} }, { satisfies: ['vtt:fog'] });

      expect(registry.getSatisfiedCapabilities()).toContain('vtt:fog');
    });

    it('removes capabilities when hook is disposed', () => {
      const registry = new TypedHookRegistry<TestHooks>();
      const dispose = registry.register({ afterRender: () => {} }, { satisfies: ['vtt:fog'] });

      expect(registry.getSatisfiedCapabilities()).toContain('vtt:fog');

      dispose();

      expect(registry.getSatisfiedCapabilities()).not.toContain('vtt:fog');
    });

    it('keeps capability if another hook also satisfies it', () => {
      const registry = new TypedHookRegistry<TestHooks>();
      const dispose1 = registry.register({ afterRender: () => {} }, { satisfies: ['vtt:fog'] });
      registry.register({ afterRender: () => {} }, { satisfies: ['vtt:fog'] });

      dispose1();

      expect(registry.getSatisfiedCapabilities()).toContain('vtt:fog');
    });

    it('tracks multiple capabilities from one hook', () => {
      const registry = new TypedHookRegistry<TestHooks>();
      registry.register({ afterRender: () => {} }, { satisfies: ['vtt:fog', 'vtt:grid'] });

      const caps = registry.getSatisfiedCapabilities();
      expect(caps).toContain('vtt:fog');
      expect(caps).toContain('vtt:grid');
    });
  });

  describe('call', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('runs every enabled hook in slot and priority order with the given arguments', () => {
      const registry = new TypedHookRegistry<TestHooks>();
      const order: string[] = [];
      const frame = { frame: 7 };
      registry.register(
        { afterRender: (ctx) => order.push(`overlay:${ctx.frame}`) },
        { slot: 'afterOverlay' },
      );
      registry.register({ afterRender: (ctx) => order.push(`late:${ctx.frame}`) }, { priority: 5 });
      registry.register({ afterRender: (ctx) => order.push(`early:${ctx.frame}`) });
      registry.register({ afterRender: () => order.push('disabled') }, { enabled: () => false });

      registry.call('afterRender', frame);

      expect(order).toEqual(['early:7', 'late:7', 'overlay:7']);
    });

    it('quarantines a throwing hook: later hooks still run, it is reported once and skipped next call', () => {
      const reportSpy = vi.fn();
      vi.stubGlobal('reportError', reportSpy);
      const registry = new TypedHookRegistry<TestHooks>();
      const error = new Error('fog failed');
      const failing = vi.fn(() => {
        throw error;
      });
      const later = vi.fn();
      registry.register({ afterRender: failing });
      registry.register({ afterRender: later });

      registry.call('afterRender', { frame: 1 });
      registry.call('afterRender', { frame: 2 });

      expect(failing).toHaveBeenCalledTimes(1);
      expect(later).toHaveBeenCalledTimes(2);
      expect(reportSpy).toHaveBeenCalledTimes(1);
      expect(reportSpy).toHaveBeenCalledWith(error);
      expect(registry.has('afterRender')).toBe(true);
      expect([...registry.iterate('afterRender')]).toHaveLength(1);
    });

    it('gives a disposed and re-registered hook a fresh, unquarantined entry', () => {
      vi.stubGlobal('reportError', vi.fn());
      const registry = new TypedHookRegistry<TestHooks>();
      let shouldThrow = true;
      const hook = vi.fn(() => {
        if (shouldThrow) throw new Error('boom');
      });
      const dispose = registry.register({ afterRender: hook });
      registry.call('afterRender', { frame: 1 });
      dispose();
      shouldThrow = false;
      registry.register({ afterRender: hook });

      registry.call('afterRender', { frame: 2 });

      expect(hook).toHaveBeenCalledTimes(2);
    });
  });

  describe('render-time capability enforcement', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    function quarantine(registry: TypedHookRegistry<TestHooks>): void {
      vi.stubGlobal('reportError', vi.fn());
      registry.call('afterRender', { frame: 0 });
    }

    const throwing = (): void => {
      throw new Error('boom');
    };

    it('is not fail-closed without requirements', () => {
      const registry = new TypedHookRegistry<TestHooks>();
      expect(registry.getMissingCapabilities()).toEqual([]);
      expect(registry.isFailClosed()).toBe(false);
    });

    it('treats a required capability with a registered, enabled satisfier as satisfied', () => {
      const registry = new TypedHookRegistry<TestHooks>();
      registry.register({ afterRender: () => {} }, { satisfies: ['x'] });
      registry.setRequiredCapabilities(['x']);

      expect(registry.getMissingCapabilities()).toEqual([]);
      expect(registry.isFailClosed()).toBe(false);
    });

    it('reports a capability missing when its only satisfier is disabled', () => {
      const registry = new TypedHookRegistry<TestHooks>();
      registry.register({ afterRender: () => {} }, { satisfies: ['x'], enabled: () => false });
      registry.setRequiredCapabilities(['x']);

      expect(registry.getSatisfiedCapabilities()).toContain('x');
      expect(registry.getMissingCapabilities()).toEqual(['x']);
      expect(registry.isFailClosed()).toBe(true);
    });

    it('reports a capability missing once its only satisfier is disposed', () => {
      const registry = new TypedHookRegistry<TestHooks>();
      const dispose = registry.register({ afterRender: () => {} }, { satisfies: ['x'] });
      registry.setRequiredCapabilities(['x']);

      dispose();

      expect(registry.getMissingCapabilities()).toEqual(['x']);
      expect(registry.isFailClosed()).toBe(true);
    });

    it('reports a capability missing and fails closed when its satisfier is quarantined', () => {
      const registry = new TypedHookRegistry<TestHooks>();
      registry.register({ afterRender: throwing }, { satisfies: ['x'] });
      registry.setRequiredCapabilities(['x']);

      quarantine(registry);

      expect(registry.getMissingCapabilities()).toEqual(['x']);
      expect(registry.isFailClosed()).toBe(true);
    });

    it('fails closed when a quarantined satisfier has an active sibling satisfier', () => {
      const registry = new TypedHookRegistry<TestHooks>();
      registry.register({ afterRender: throwing }, { satisfies: ['x'] });
      registry.register({ afterRender: () => {} }, { satisfies: ['x'] });
      registry.setRequiredCapabilities(['x']);

      quarantine(registry);

      expect(registry.getMissingCapabilities()).toEqual([]);
      expect(registry.isFailClosed()).toBe(true);
    });

    it('fails closed when a quarantined entry is marked required, even without capabilities', () => {
      const registry = new TypedHookRegistry<TestHooks>();
      registry.register({ afterRender: throwing }, { required: true });

      quarantine(registry);

      expect(registry.getMissingCapabilities()).toEqual([]);
      expect(registry.isFailClosed()).toBe(true);
    });

    it('stays open when a quarantined entry is neither required nor satisfies a requirement', () => {
      const registry = new TypedHookRegistry<TestHooks>();
      registry.register({ afterRender: throwing }, { satisfies: ['y'] });
      registry.setRequiredCapabilities(['x']);
      registry.register({ afterRender: () => {} }, { satisfies: ['x'] });

      quarantine(registry);

      expect(registry.isFailClosed()).toBe(false);
    });

    it('adds the extra argument to the stored requirement, deduplicated in order', () => {
      const registry = new TypedHookRegistry<TestHooks>();
      registry.register({ afterRender: () => {} }, { satisfies: ['b'] });
      registry.setRequiredCapabilities(['a', 'b']);

      expect(registry.getMissingCapabilities(['c', 'a', 'b'])).toEqual(['a', 'c']);
      expect(registry.isFailClosed(['b'])).toBe(true);
    });

    it('fails closed for an extra requirement alone', () => {
      const registry = new TypedHookRegistry<TestHooks>();
      expect(registry.getMissingCapabilities(['x'])).toEqual(['x']);
      expect(registry.isFailClosed(['x'])).toBe(true);
      expect(registry.isFailClosed()).toBe(false);
    });

    it('fails closed when a quarantined entry satisfies an extra requirement', () => {
      const registry = new TypedHookRegistry<TestHooks>();
      registry.register({ afterRender: throwing }, { satisfies: ['x'] });
      registry.register({ afterRender: () => {} }, { satisfies: ['x'] });

      quarantine(registry);

      expect(registry.isFailClosed()).toBe(false);
      expect(registry.isFailClosed(['x'])).toBe(true);
    });

    it('copies the stored requirement', () => {
      const registry = new TypedHookRegistry<TestHooks>();
      const required = ['x'];
      registry.setRequiredCapabilities(required);
      required.length = 0;

      expect(registry.getMissingCapabilities()).toEqual(['x']);
    });
  });

  describe('runtime enablement', () => {
    it('keeps a disabled hook capability registered without activating its render slot', () => {
      const registry = new TypedHookRegistry<TestHooks>();
      let enabled = false;
      registry.register(
        { afterRender: () => {} },
        { required: true, satisfies: ['vtt:fog'], enabled: () => enabled },
      );

      expect(registry.getSatisfiedCapabilities()).toContain('vtt:fog');
      expect(registry.has('afterRender')).toBe(false);
      expect([...registry.iterate('afterRender')]).toEqual([]);

      enabled = true;
      expect(registry.has('afterRender')).toBe(true);
      expect([...registry.iterate('afterRender')]).toHaveLength(1);
    });

    it('isolates a throwing enablement predicate as disabled', () => {
      const registry = new TypedHookRegistry<TestHooks>();
      registry.register(
        { afterRender: () => {} },
        {
          enabled: () => {
            throw new Error('unavailable');
          },
        },
      );

      expect(registry.has('afterRender')).toBe(false);
      expect([...registry.iterate('afterRender')]).toEqual([]);
    });
  });

  describe('clear', () => {
    it('removes all hooks', () => {
      const registry = new TypedHookRegistry<TestHooks>();
      registry.register({ afterRender: () => {} });
      registry.register({ beforeRender: () => {} });

      registry.clear();

      expect([...registry.iterate('afterRender')]).toHaveLength(0);
      expect([...registry.iterate('beforeRender')]).toHaveLength(0);
    });

    it('clears satisfied capabilities', () => {
      const registry = new TypedHookRegistry<TestHooks>();
      registry.register({ afterRender: () => {} }, { satisfies: ['vtt:fog'] });

      registry.clear();

      expect(registry.getSatisfiedCapabilities()).not.toContain('vtt:fog');
    });

    it('clears the stored requirement', () => {
      const registry = new TypedHookRegistry<TestHooks>();
      registry.setRequiredCapabilities(['vtt:fog']);

      registry.clear();

      expect(registry.isFailClosed()).toBe(false);
    });
  });
});

describe('createRenderHooks', () => {
  it('creates all four surface registries', () => {
    const hooks = createRenderHooks();
    expect(hooks.viewport).toBeInstanceOf(TypedHookRegistry);
    expect(hooks.minimap).toBeInstanceOf(TypedHookRegistry);
    expect(hooks.imageExport).toBeInstanceOf(TypedHookRegistry);
    expect(hooks.svgExport).toBeInstanceOf(TypedHookRegistry);
  });

  it('viewport hooks receive camera and dimensions', () => {
    const hooks = createRenderHooks();
    const fn = vi.fn();
    hooks.viewport.register({ afterElements: fn });

    const camera = { position: { x: 0, y: 0 }, zoom: 1 } as never;
    const dims = { width: 800, height: 600, dpr: 2 };
    const ctx = {} as CanvasRenderingContext2D;

    for (const hook of hooks.viewport.iterate('afterElements')) {
      hook(ctx, camera, dims);
    }

    expect(fn).toHaveBeenCalledWith(ctx, camera, dims);
  });

  it('types the afterLayer layer id as a string', () => {
    const hooks = createRenderHooks();
    const fn = vi.fn();
    hooks.viewport.register({
      afterLayer: (_ctx, _camera, _dims, layerId) => {
        expectTypeOf(layerId).toEqualTypeOf<string>();
        fn(layerId);
      },
    });

    for (const hook of hooks.viewport.iterate('afterLayer')) {
      hook({} as CanvasRenderingContext2D, {} as never, { width: 1, height: 1, dpr: 1 }, 'L1');
    }

    expect(fn).toHaveBeenCalledWith('L1');
  });

  it('minimap hooks receive mapping', () => {
    const hooks = createRenderHooks();
    const fn = vi.fn();
    hooks.minimap.register({ afterElements: fn });

    const mapping = {
      ctx: {} as CanvasRenderingContext2D,
      canvasWidth: 200,
      canvasHeight: 140,
      worldBounds: { x: 0, y: 0, w: 1000, h: 1000 },
      scale: 0.2,
    };

    for (const hook of hooks.minimap.iterate('afterElements')) {
      hook(mapping);
    }

    expect(fn).toHaveBeenCalledWith(mapping);
  });

  it('svg export hooks receive appendSvg and viewBox', () => {
    const hooks = createRenderHooks();
    const fn = vi.fn();
    hooks.svgExport.register({ afterElements: fn });

    const fragments: string[] = [];
    const mapping = {
      appendSvg: (frag: string) => fragments.push(frag),
      viewBox: { x: 0, y: 0, w: 500, h: 400 },
    };

    for (const hook of hooks.svgExport.iterate('afterElements')) {
      hook(mapping);
    }

    expect(fn).toHaveBeenCalledWith(mapping);
  });

  it('each surface registry is independent', () => {
    const hooks = createRenderHooks();
    const viewportFn = vi.fn();
    const minimapFn = vi.fn();

    hooks.viewport.register({ afterElements: viewportFn });
    hooks.minimap.register({ afterElements: minimapFn });

    expect([...hooks.viewport.iterate('afterElements')]).toHaveLength(1);
    expect([...hooks.minimap.iterate('afterElements')]).toHaveLength(1);

    viewportFn.mockClear();
    minimapFn.mockClear();

    const ctx = {} as CanvasRenderingContext2D;
    for (const hook of hooks.viewport.iterate('afterElements')) {
      hook(ctx, null as never, { width: 0, height: 0, dpr: 1 });
    }

    expect(viewportFn).toHaveBeenCalledOnce();
    expect(minimapFn).not.toHaveBeenCalled();
  });
});
