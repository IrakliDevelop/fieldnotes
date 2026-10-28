import { describe, it, expect, vi } from 'vitest';
import { buildContextMenuItems } from './context-menu-items';
import type { ActionDefinition, ActionContext, ActionsApi } from './types';
import type { Viewport } from '../canvas/viewport';
import type { ElementStore } from '../elements/element-store';
import { ElementStore as Store } from '../elements/element-store';
import { ElementRegistry } from '../elements/element-registry';
import { createShape } from '../elements/element-factory';
import { createFrame } from '../elements/frame-element';
import { LayerManager } from '../layers/layer-manager';
import { createBuiltinActions } from './builtin-actions';

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

  it.each([
    ['a root selection', ['root'], 'Frame selection'],
    ['direct members of one frame', ['member'], 'Remove from frame'],
    ['one frame', ['frame'], 'Dissolve frame'],
  ])('uses real frame definitions for %s', (_name, selectedIds, expected) => {
    const registry = new ElementRegistry();
    const store = new Store(registry);
    const layers = new LayerManager(store);
    const layerId = layers.activeLayerId;
    const root = {
      ...createShape({ position: { x: 0, y: 0 }, size: { w: 20, h: 20 }, layerId, index: 'a0' }),
      id: 'root',
    };
    const frame = {
      ...createFrame({ position: { x: 0, y: 0 }, size: { w: 100, h: 80 }, layerId, index: 'a1' }),
      id: 'frame',
    };
    const member = {
      ...createShape({ position: { x: 30, y: 0 }, size: { w: 20, h: 20 }, layerId, index: 'a0' }),
      id: 'member',
      parentId: frame.id,
    };
    store.add(root);
    store.add(frame);
    store.add(member);
    const viewport = { elementRegistry: registry, layerManager: layers } as Viewport;
    const ctx: ActionContext = { viewport, store, selectedIds };
    const defs = createBuiltinActions({
      keyboardActions: {} as never,
      zoomByFactor: () => undefined,
      zoomToLevel: () => undefined,
      canPaste: () => false,
    });
    const labels = buildContextMenuItems(fakeRegistry(defs, ctx), ctx)
      .filter((item) => 'label' in item)
      .map((item) => ('label' in item ? item.label : ''));

    expect(labels).toContain(expected);
    expect(labels).not.toContain('Add to frame');
  });

  it('hides all frame entries for empty, locked, and mixed-parent selections', () => {
    const registry = new ElementRegistry();
    const store = new Store(registry);
    const layers = new LayerManager(store);
    const layerId = layers.activeLayerId;
    const frame = {
      ...createFrame({ position: { x: 0, y: 0 }, size: { w: 100, h: 80 }, layerId, index: 'a0' }),
      id: 'frame',
    };
    const locked = {
      ...createShape({
        position: { x: 0, y: 0 },
        size: { w: 20, h: 20 },
        layerId,
        index: 'a0',
        locked: true,
      }),
      id: 'locked',
    };
    const member = {
      ...createShape({ position: { x: 30, y: 0 }, size: { w: 20, h: 20 }, layerId, index: 'a0' }),
      id: 'member',
      parentId: 'frame',
    };
    store.add(frame);
    store.add(locked);
    store.add(member);
    const viewport = { elementRegistry: registry, layerManager: layers } as Viewport;
    const defs = createBuiltinActions({
      keyboardActions: {} as never,
      zoomByFactor: () => undefined,
      zoomToLevel: () => undefined,
      canPaste: () => false,
    });

    for (const selectedIds of [[], ['locked'], ['member', 'locked']]) {
      const ctx: ActionContext = { viewport, store, selectedIds };
      const labels = buildContextMenuItems(fakeRegistry(defs, ctx), ctx)
        .filter((item) => 'label' in item)
        .map((item) => ('label' in item ? item.label : ''));
      expect(labels).not.toContain('Frame selection');
      expect(labels).not.toContain('Remove from frame');
      expect(labels).not.toContain('Dissolve frame');
    }
  });

  it.each([
    ['an eligible root', ['root'], 'Frame selection'],
    [
      'a direct member with its redundant grandchild',
      ['member', 'grandchild'],
      'Remove from frame',
    ],
    ['one eligible frame', ['frame'], 'Dissolve frame'],
  ])(
    'adds exactly one frame command to the complete ordinary menu for %s',
    (_name, selectedIds, label) => {
      const registry = new ElementRegistry();
      const store = new Store(registry);
      const layers = new LayerManager(store);
      const layerId = layers.activeLayerId;
      const root = {
        ...createShape({ position: { x: 0, y: 0 }, size: { w: 20, h: 20 }, layerId, index: 'a0' }),
        id: 'root',
      };
      const frame = {
        ...createFrame({
          position: { x: 40, y: 0 },
          size: { w: 100, h: 80 },
          layerId,
          index: 'a1',
        }),
        id: 'frame',
      };
      const member = {
        ...createShape({
          position: { x: 50, y: 30 },
          size: { w: 20, h: 20 },
          layerId,
          index: 'a0',
        }),
        id: 'member',
        parentId: frame.id,
      };
      const grandchild = {
        ...createShape({
          position: { x: 55, y: 35 },
          size: { w: 10, h: 10 },
          layerId,
          index: 'a0',
        }),
        id: 'grandchild',
        parentId: member.id,
      };
      store.add(root);
      store.add(frame);
      store.add(member);
      store.add(grandchild);
      const viewport = { elementRegistry: registry, layerManager: layers } as Viewport;
      const ctx: ActionContext = { viewport, store, selectedIds };
      const defs = createBuiltinActions({
        keyboardActions: {} as never,
        zoomByFactor: () => undefined,
        zoomToLevel: () => undefined,
        canPaste: () => false,
      });
      const items = buildContextMenuItems(fakeRegistry(defs, ctx), ctx);
      expect(items).toEqual([
        { label: 'Cut', action: 'edit.cut' },
        { label: 'Copy', action: 'edit.copy' },
        { label: 'Duplicate', action: 'edit.duplicate' },
        { label: 'Delete', action: 'edit.delete' },
        { separator: true },
        { label: 'Bring to Front', action: 'arrange.bring-to-front' },
        { label: 'Bring Forward', action: 'arrange.bring-forward' },
        { label: 'Send Backward', action: 'arrange.send-backward' },
        { label: 'Send to Back', action: 'arrange.send-to-back' },
        {
          label,
          action:
            label === 'Frame selection'
              ? 'selection.frame'
              : label === 'Remove from frame'
                ? 'selection.remove-from-frame'
                : 'selection.dissolve-frame',
        },
        { separator: true },
        { label: 'Rotate 90° CW', action: 'arrange.rotate-cw' },
        { label: 'Rotate 90° CCW', action: 'arrange.rotate-ccw' },
        { separator: true },
        { label: 'Lock', action: 'arrange.toggle-lock' },
      ]);
    },
  );
});
