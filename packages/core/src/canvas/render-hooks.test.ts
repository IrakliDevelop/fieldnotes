/* eslint-disable @typescript-eslint/no-empty-function */
import { describe, it, expect, vi } from 'vitest';
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

  describe('required hooks', () => {
    it('tracks which hooks are marked required', () => {
      const registry = new TypedHookRegistry<TestHooks>();
      registry.register({ afterRender: () => {} }, { required: true });
      registry.register({ afterRender: () => {} });

      const required = [...registry.iterateRequired()];
      expect(required).toHaveLength(1);
    });

    it('required hook dispose removes it from required iteration', () => {
      const registry = new TypedHookRegistry<TestHooks>();
      const dispose = registry.register({ afterRender: () => {} }, { required: true });

      expect([...registry.iterateRequired()]).toHaveLength(1);

      dispose();

      expect([...registry.iterateRequired()]).toHaveLength(0);
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
      expect([...registry.iterateRequired()]).toEqual([]);

      enabled = true;
      expect(registry.has('afterRender')).toBe(true);
      expect([...registry.iterate('afterRender')]).toHaveLength(1);
      expect([...registry.iterateRequired()]).toHaveLength(1);
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
