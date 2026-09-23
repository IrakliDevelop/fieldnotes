import { describe, it, expect, vi } from 'vitest';

import type { Viewport } from '../canvas/viewport';
import type { ElementStore } from '../elements/element-store';
import type { ActionContext, ActionDefinition, ActionInvocation } from './types';
import { ActionRegistry } from './action-registry';
import type { ShortcutDefaultsSink } from './action-registry';

function createContextFactory(): () => ActionContext {
  return () => ({
    viewport: {} as unknown as Viewport,
    store: {} as unknown as ElementStore,
    selectedIds: ['el-1', 'el-2'],
  });
}

function createAction(overrides: Partial<ActionDefinition> & { id: string }): ActionDefinition {
  return {
    label: overrides.id,
    perform: () => undefined,
    ...overrides,
  };
}

describe('ActionRegistry', () => {
  it('register returns an unregister function and list keeps registration order', () => {
    const registry = new ActionRegistry(createContextFactory());
    const unregA = registry.register(createAction({ id: 'a.first' }));
    registry.register(createAction({ id: 'b.second' }));
    registry.register(createAction({ id: 'c.third' }));

    const ids = registry.list().map((d) => d.id);
    expect(ids).toEqual(['a.first', 'b.second', 'c.third']);
    expect(typeof unregA).toBe('function');

    unregA();
    expect(registry.list().map((d) => d.id)).toEqual(['b.second', 'c.third']);
  });

  it('register throws on duplicate id', () => {
    const registry = new ActionRegistry(createContextFactory());
    registry.register(createAction({ id: 'dup.action' }));
    expect(() => registry.register(createAction({ id: 'dup.action' }))).toThrowError('dup.action');
  });

  it('register throws on empty id', () => {
    const registry = new ActionRegistry(createContextFactory());
    expect(() => registry.register(createAction({ id: '' }))).toThrowError();
  });

  it.each([
    ['undo', 'edit.undo'],
    ['tool:pencil', 'tool.pencil'],
  ])('register rejects legacy id %s in favor of %s before mutation', (id, canonicalId) => {
    const registry = new ActionRegistry(createContextFactory());
    const sink: ShortcutDefaultsSink = {
      setDefault: vi.fn(),
      clearDefault: vi.fn(),
    };
    const onChange = vi.fn();
    registry.attachShortcuts(sink);
    registry.onChange(onChange);

    expect(() => registry.register(createAction({ id, shortcut: ['mod+k'] }))).toThrow(
      new RegExp(`${id}.*${canonicalId}`),
    );

    expect(registry.get(id)).toBeUndefined();
    expect(registry.get(canonicalId)).toBeUndefined();
    expect(registry.list()).toEqual([]);
    expect(sink.setDefault).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not retain or announce an action when shortcut installation throws', () => {
    const registry = new ActionRegistry(createContextFactory());
    const setDefault = vi.fn(() => {
      throw new Error('invalid shortcut');
    });
    const onChange = vi.fn();
    registry.attachShortcuts({ setDefault, clearDefault: vi.fn() });
    registry.onChange(onChange);

    expect(() =>
      registry.register(createAction({ id: 'plugin.bad', shortcut: ['ctrl+'] })),
    ).toThrow('invalid shortcut');

    expect(registry.get('plugin.bad')).toBeUndefined();
    expect(registry.list()).toEqual([]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('run passes a fresh context and full invocation defaults', () => {
    const registry = new ActionRegistry(createContextFactory());
    const spy = vi.fn();
    registry.register(createAction({ id: 'test.spy', perform: spy }));

    registry.run('test.spy');

    expect(spy).toHaveBeenCalledOnce();
    const [ctx, inv] = spy.mock.calls[0] as [ActionContext, ActionInvocation];
    expect(inv).toEqual({ source: 'api', shiftKey: false });
    expect(ctx.selectedIds).toEqual(['el-1', 'el-2']);
  });

  it('run returns false for unknown id, disabled action, and perform returning false', () => {
    const registry = new ActionRegistry(createContextFactory());

    // unknown
    expect(registry.run('no.such.action')).toBe(false);

    // disabled
    registry.register(createAction({ id: 'dis.abled', enabled: () => false }));
    expect(registry.run('dis.abled')).toBe(false);

    // perform returns false
    registry.register(createAction({ id: 'false.return', perform: () => false }));
    expect(registry.run('false.return')).toBe(false);
  });

  it('run returns true when perform returns undefined or true', () => {
    const registry = new ActionRegistry(createContextFactory());

    registry.register(createAction({ id: 'void.action', perform: () => undefined }));
    expect(registry.run('void.action')).toBe(true);

    registry.register(createAction({ id: 'true.action', perform: () => true }));
    expect(registry.run('true.action')).toBe(true);
  });

  it('get/isEnabled/run resolve legacy ids', () => {
    const registry = new ActionRegistry(createContextFactory());
    registry.register(createAction({ id: 'edit.undo' }));

    expect(registry.get('undo')).toBeDefined();
    expect(registry.get('undo')?.id).toBe('edit.undo');
    expect(registry.isEnabled('undo')).toBe(true);
    expect(registry.run('undo')).toBe(true);
  });

  it('onChange fires on register and unregister; a throwing listener does not block others', () => {
    const registry = new ActionRegistry(createContextFactory());
    const calls: string[] = [];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    registry.onChange(() => {
      throw new Error('boom');
    });
    registry.onChange(() => calls.push('second'));

    registry.register(createAction({ id: 'change.test' }));
    expect(calls).toEqual(['second']);
    expect(errorSpy).toHaveBeenCalledOnce();
    expect(errorSpy.mock.calls[0]?.[0]).toContain('[fieldnotes]');

    calls.length = 0;
    errorSpy.mockClear();

    // unregister also fires onChange
    const unreg = registry.register(createAction({ id: 'change.test2' }));
    calls.length = 0;
    errorSpy.mockClear();
    unreg();
    expect(calls).toEqual(['second']);
    expect(errorSpy).toHaveBeenCalledOnce();

    errorSpy.mockRestore();
  });

  it('attachShortcuts replays defaults for earlier registrations in order, then forwards later ones; unregister calls clearDefault', () => {
    const registry = new ActionRegistry(createContextFactory());

    registry.register(createAction({ id: 'first.action', shortcut: ['mod+a'], allowShift: true }));
    registry.register(createAction({ id: 'second.action', shortcut: ['mod+b'] }));

    const sink: ShortcutDefaultsSink = {
      setDefault: vi.fn(),
      clearDefault: vi.fn(),
    };

    registry.attachShortcuts(sink);

    // replay order matches registration order
    expect(sink.setDefault).toHaveBeenCalledTimes(2);
    const calls = (sink.setDefault as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0]).toEqual(['first.action', ['mod+a'], true]);
    expect(calls[1]).toEqual(['second.action', ['mod+b'], false]);

    // new registration after attach forwards immediately
    (sink.setDefault as ReturnType<typeof vi.fn>).mockClear();
    const unreg = registry.register(createAction({ id: 'third.action', shortcut: ['mod+c'] }));
    expect(sink.setDefault).toHaveBeenCalledWith('third.action', ['mod+c'], false);

    // unregister calls clearDefault
    unreg();
    expect(sink.clearDefault).toHaveBeenCalledWith('third.action');
  });

  it('run passes the same context to enabled and perform', () => {
    const registry = new ActionRegistry(createContextFactory());
    let enabledCtx: unknown;
    let performCtx: unknown;
    registry.register(
      createAction({
        id: 'ctx.shared',
        enabled: (ctx) => {
          enabledCtx = ctx;
          return true;
        },
        perform: (ctx) => {
          performCtx = ctx;
        },
      }),
    );

    registry.run('ctx.shared');

    expect(enabledCtx).toBeDefined();
    expect(performCtx).toBeDefined();
    // Both callbacks must have received the identical context object
    expect(enabledCtx).toBe(performCtx);
  });

  it('unregister without shortcut does not call clearDefault', () => {
    const registry = new ActionRegistry(createContextFactory());
    const sink: ShortcutDefaultsSink = {
      setDefault: vi.fn(),
      clearDefault: vi.fn(),
    };
    registry.attachShortcuts(sink);

    const unreg = registry.register(createAction({ id: 'no.keys' }));
    unreg();
    expect(sink.clearDefault).not.toHaveBeenCalled();
  });

  it('accepts a perform callback that returns nothing', () => {
    const registry = new ActionRegistry(createContextFactory());
    let calls = 0;
    registry.register({
      id: 'probe.void',
      label: 'Probe',
      perform: () => {
        calls += 1;
      },
    });

    const result = registry.run('probe.void');
    expect(result).toBe(true);
    expect(calls).toBe(1);
  });

  it('throwing enabled() makes isEnabled return false and run return false without calling perform', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const registry = new ActionRegistry(createContextFactory());
    const performSpy = vi.fn();
    registry.register(
      createAction({
        id: 'boom.enabled',
        enabled: () => {
          throw new Error('plugin bug');
        },
        perform: performSpy,
      }),
    );

    expect(registry.isEnabled('boom.enabled')).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[fieldnotes]'),
      expect.any(Error),
    );
    errorSpy.mockClear();

    expect(registry.run('boom.enabled')).toBe(false);
    expect(performSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it('register without shortcut never calls the sink', () => {
    const registry = new ActionRegistry(createContextFactory());
    const sink: ShortcutDefaultsSink = {
      setDefault: vi.fn(),
      clearDefault: vi.fn(),
    };
    registry.attachShortcuts(sink);

    registry.register(createAction({ id: 'no.shortcut' }));
    expect(sink.setDefault).not.toHaveBeenCalled();
  });
});
