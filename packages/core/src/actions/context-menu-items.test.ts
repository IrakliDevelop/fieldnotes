import { describe, it, expect, vi } from 'vitest';
import { buildContextMenuItems } from './context-menu-items';
import type { ActionDefinition, ActionContext, ActionsApi } from './types';
import type { Viewport } from '../canvas/viewport';
import type { ElementStore } from '../elements/element-store';

function fakeContext(): ActionContext {
  return {
    viewport: {} as Viewport,
    store: {} as ElementStore,
    selectedIds: ['a'],
  };
}

function fakeRegistry(definitions: ActionDefinition[], ctx: ActionContext): ActionsApi {
  const map = new Map<string, ActionDefinition>();
  for (const d of definitions) map.set(d.id, d);
  return {
    register: () => () => undefined,
    get: (id: string) => map.get(id),
    list: () => definitions,
    isEnabled: (id: string) => {
      const def = map.get(id);
      if (!def) return false;
      if (def.enabled) {
        try {
          return def.enabled(ctx);
        } catch {
          return false;
        }
      }
      return true;
    },
    run: () => true,
    onChange: () => () => undefined,
  };
}

describe('buildContextMenuItems', () => {
  it('returns [] when no enabled action has menu placement', () => {
    const ctx = fakeContext();
    const defs: ActionDefinition[] = [
      {
        id: 'no-menu',
        label: 'No menu',
        perform: () => undefined,
      },
      {
        id: 'disabled-menu',
        label: 'Disabled',
        menu: { group: 'clipboard', order: 10 },
        enabled: () => false,
        perform: () => undefined,
      },
    ];
    const api = fakeRegistry(defs, ctx);
    expect(buildContextMenuItems(api, ctx)).toEqual([]);
  });

  it('orders built-in groups clipboard, arrange, transform, lock, then unknown groups in first-seen order, with one separator between groups and none at the ends', () => {
    const ctx = fakeContext();
    const defs: ActionDefinition[] = [
      {
        id: 'custom.a',
        label: 'Custom A',
        menu: { group: 'custom', order: 10 },
        perform: () => undefined,
      },
      {
        id: 'lock.a',
        label: 'Lock A',
        menu: { group: 'lock', order: 10 },
        perform: () => undefined,
      },
      {
        id: 'clip.a',
        label: 'Clip A',
        menu: { group: 'clipboard', order: 10 },
        perform: () => undefined,
      },
      {
        id: 'arr.a',
        label: 'Arr A',
        menu: { group: 'arrange', order: 10 },
        perform: () => undefined,
      },
      {
        id: 'xform.a',
        label: 'Xform A',
        menu: { group: 'transform', order: 10 },
        perform: () => undefined,
      },
      {
        id: 'other.a',
        label: 'Other A',
        menu: { group: 'other', order: 10 },
        perform: () => undefined,
      },
    ];
    const api = fakeRegistry(defs, ctx);
    const items = buildContextMenuItems(api, ctx);
    expect(items).toEqual([
      { label: 'Clip A', action: 'clip.a' },
      { separator: true },
      { label: 'Arr A', action: 'arr.a' },
      { separator: true },
      { label: 'Xform A', action: 'xform.a' },
      { separator: true },
      { label: 'Lock A', action: 'lock.a' },
      { separator: true },
      { label: 'Custom A', action: 'custom.a' },
      { separator: true },
      { label: 'Other A', action: 'other.a' },
    ]);
  });

  it('sorts by order within a group and resolves function labels with the context', () => {
    const ctx = fakeContext();
    const defs: ActionDefinition[] = [
      { id: 'a.z', label: 'Z', menu: { group: 'clipboard', order: 30 }, perform: () => undefined },
      {
        id: 'a.a',
        label: (c) => `A-${c.selectedIds.length}`,
        menu: { group: 'clipboard', order: 10 },
        perform: () => undefined,
      },
      { id: 'a.m', label: 'M', menu: { group: 'clipboard', order: 20 }, perform: () => undefined },
    ];
    const api = fakeRegistry(defs, ctx);
    const items = buildContextMenuItems(api, ctx);
    expect(items).toEqual([
      { label: 'A-1', action: 'a.a' },
      { label: 'M', action: 'a.m' },
      { label: 'Z', action: 'a.z' },
    ]);
  });

  it('a throwing enabled() omits only that item; other items are unaffected', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const ctx = fakeContext();
    const defs: ActionDefinition[] = [
      {
        id: 'clip.ok',
        label: 'OK Action',
        menu: { group: 'clipboard', order: 10 },
        perform: () => undefined,
      },
      {
        id: 'clip.boom',
        label: 'Boom',
        menu: { group: 'clipboard', order: 20 },
        enabled: () => {
          throw new Error('plugin bug');
        },
        perform: () => undefined,
      },
    ];
    const api = fakeRegistry(defs, ctx);
    const items = buildContextMenuItems(api, ctx);
    // The throwing action should be treated as disabled and omitted
    expect(items).toEqual([{ label: 'OK Action', action: 'clip.ok' }]);
    errorSpy.mockRestore();
  });

  it('a throwing function label falls back to the action id', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const ctx = fakeContext();
    const defs: ActionDefinition[] = [
      {
        id: 'clip.bad-label',
        label: () => {
          throw new Error('label bug');
        },
        menu: { group: 'clipboard', order: 10 },
        perform: () => undefined,
      },
    ];
    const api = fakeRegistry(defs, ctx);
    const items = buildContextMenuItems(api, ctx);
    expect(items).toEqual([{ label: 'clip.bad-label', action: 'clip.bad-label' }]);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[fieldnotes]'),
      expect.any(Error),
    );
    errorSpy.mockRestore();
  });

  it('omits disabled actions and drops a group that becomes empty (no double separators)', () => {
    const ctx = fakeContext();
    const defs: ActionDefinition[] = [
      {
        id: 'clip.a',
        label: 'Clip A',
        menu: { group: 'clipboard', order: 10 },
        perform: () => undefined,
      },
      {
        id: 'arr.a',
        label: 'Arr Disabled',
        menu: { group: 'arrange', order: 10 },
        enabled: () => false,
        perform: () => undefined,
      },
      {
        id: 'xform.a',
        label: 'Xform A',
        menu: { group: 'transform', order: 10 },
        perform: () => undefined,
      },
    ];
    const api = fakeRegistry(defs, ctx);
    const items = buildContextMenuItems(api, ctx);
    // arrange group is empty (disabled) → no double separator between clipboard and transform
    expect(items).toEqual([
      { label: 'Clip A', action: 'clip.a' },
      { separator: true },
      { label: 'Xform A', action: 'xform.a' },
    ]);
  });
});
