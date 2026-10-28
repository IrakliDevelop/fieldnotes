import { describe, expect, it } from 'vitest';
import { createShape } from './element-factory';
import { ElementStore } from './element-store';
import { ElementRegistry } from './element-registry';
import { createFrame } from './frame-element';
import {
  planAddToFrame,
  canFrameSelection,
  planDissolveFrame,
  planFrameSelection,
  planRemoveFromFrame,
} from './frame-commands';
import { LayerManager } from '../layers/layer-manager';
import { isValidIndexKey } from '../core/fractional-index';

function setup() {
  const registry = new ElementRegistry();
  const store = new ElementStore(registry);
  const layers = new LayerManager(store);
  const layerId = layers.activeLayerId;
  const shape = (id: string, x: number, index: string) => ({
    ...createShape({ position: { x, y: 20 }, size: { w: 40, h: 30 }, layerId, index }),
    id,
  });
  return { registry, store, layers, layerId, shape };
}

describe('frame commands', () => {
  it('plans one frame around normalized roots and preserves a selected subtree', () => {
    const { registry, store, layers, layerId, shape } = setup();
    const root = shape('root', 10, 'a0');
    const child = { ...shape('child', 20, 'a1'), parentId: root.id, index: 'a0' };
    const other = shape('other', 100, 'a2');
    store.add(root);
    store.add(child);
    store.add(other);

    const plan = planFrameSelection([child.id, root.id], {}, 'frame', store, registry, layers);

    expect(plan.add).toMatchObject({ id: 'frame', layerId, index: 'a0' });
    expect(plan.updates).toEqual([{ id: root.id, partial: { parentId: 'frame', index: 'a0' } }]);
    expect(store.getById(root.id)?.parentId).toBeUndefined();
    expect(store.getById(child.id)?.parentId).toBe(root.id);
  });

  it('rejects a missing id before mutating a valid candidate', () => {
    const { registry, store, layers, shape } = setup();
    const root = shape('root', 10, 'a0');
    store.add(root);
    const before = structuredClone(store.snapshot());

    expect(() =>
      planFrameSelection([root.id, 'missing'], {}, 'frame', store, registry, layers),
    ).toThrow('element "missing" is missing');
    expect(store.snapshot()).toEqual(before);
  });

  it('plans append, removal, and dissolve without changing live membership', () => {
    const { registry, store, layers, layerId, shape } = setup();
    const frame = {
      ...createFrame({ position: { x: 0, y: 0 }, size: { w: 200, h: 120 }, layerId, index: 'a0' }),
      id: 'frame',
    };
    const member = { ...shape('member', 10, 'a0'), parentId: frame.id };
    const incoming = shape('incoming', 90, 'a1');
    store.add(frame);
    store.add(member);
    store.add(incoming);

    expect(planAddToFrame(frame.id, [incoming.id], store, registry, layers).updates).toHaveLength(
      1,
    );
    expect(
      planRemoveFromFrame(frame.id, [member.id], store, registry, layers).updates,
    ).toHaveLength(1);
    const dissolve = planDissolveFrame(frame.id, store, registry, layers);
    expect(dissolve.removeId).toBe(frame.id);
    expect(store.getById(member.id)?.parentId).toBe(frame.id);
    expect(store.getById(incoming.id)?.parentId).toBeUndefined();
  });

  it('keeps frame eligibility pure when the default preflight id already exists', () => {
    const { registry, store, layers, shape } = setup();
    store.add({ ...shape('', 10, 'a0'), id: '__frame_preflight__' });
    store.add({ ...shape('', 80, 'a1'), id: 'root' });

    expect(canFrameSelection(['root'], store, registry, layers)).toBe(true);
    expect(store.getById('__frame_preflight__')).toMatchObject({ id: '__frame_preflight__' });
  });

  it('dissolves an empty frame without requiring an insertion interval', () => {
    const { registry, store, layers, layerId, shape } = setup();
    const before = shape('before', 0, 'a0');
    const frame = {
      ...createFrame({ position: { x: 0, y: 0 }, size: { w: 200, h: 120 }, layerId, index: 'a0' }),
      id: 'frame',
    };
    const after = shape('after', 100, 'a0');
    store.add(before);
    store.add(frame);
    store.add(after);

    expect(planDissolveFrame(frame.id, store, registry, layers)).toEqual({
      updates: [],
      removeId: frame.id,
    });
  });

  it('keeps binary fractional-key order when dissolving direct children', () => {
    const { registry, store, layers, layerId, shape } = setup();
    const previous = shape('previous', 0, 'Zz');
    const frame = {
      ...createFrame({ position: { x: 0, y: 0 }, size: { w: 200, h: 120 }, layerId, index: 'a0' }),
      id: 'frame',
    };
    const next = shape('next', 100, 'a1');
    const lower = { ...shape('', 10, 'a0'), id: 'lower', parentId: frame.id, index: 'a0' };
    const upper = { ...shape('', 30, 'Zz'), id: 'upper', parentId: frame.id, index: 'Zz' };
    store.add(previous);
    store.add(frame);
    store.add(lower);
    store.add(upper);
    store.add(next);

    const plan = planDissolveFrame(frame.id, store, registry, layers);
    expect(
      [previous.index, frame.index, next.index, lower.index, upper.index].every(isValidIndexKey),
    ).toBe(true);
    expect(plan.updates).toEqual([
      { id: 'upper', partial: { parentId: undefined, index: 'ZzV' } },
      { id: 'lower', partial: { parentId: undefined, index: 'a0' } },
    ]);
    expect(plan.updates.map((update) => update.partial.index).every(isValidIndexKey)).toBe(true);
  });

  it.each([
    ['descendant then root', ['c', 's', 'r']],
    ['root then descendant', ['r', 's', 'c']],
  ])('uses rotated closure bounds in %s input order', (_name, ids) => {
    const { registry, store, layers, layerId, shape } = setup();
    const r = {
      ...shape('r', 10, 'Zz'),
      position: { x: 10, y: 20 },
      size: { w: 40, h: 20 },
      rotation: Math.PI / 2,
    };
    const c = {
      ...shape('c', 100, 'a0'),
      position: { x: 100, y: 60 },
      size: { w: 20, h: 10 },
      parentId: r.id,
    };
    const s = { ...shape('s', 60, 'a1'), position: { x: 60, y: 30 }, size: { w: 10, h: 10 } };
    const u = shape('u', 0, 'a0');
    store.add(r);
    store.add(c);
    store.add(s);
    store.add(u);

    const plan = planFrameSelection(ids, {}, 'frame', store, registry, layers);
    expect(plan.add).toMatchObject({
      id: 'frame',
      layerId,
      index: 'Zz',
      position: { x: -4, y: -38 },
      size: { w: 148, h: 132 },
    });
    expect(plan.updates).toEqual([
      { id: 'r', partial: { parentId: 'frame', index: 'a0' } },
      { id: 's', partial: { parentId: 'frame', index: 'a1' } },
    ]);
    expect(store.getById('r')).toMatchObject({ index: 'Zz' });
    expect(store.getById('r')?.parentId).toBeUndefined();
    expect(store.getById('c')?.parentId).toBe('r');
    expect(store.getById('u')?.index).toBe('a0');

    const custom = planFrameSelection(
      ['r', 's'],
      { padding: 10, title: 'T', color: '#123' },
      'custom',
      store,
      registry,
      layers,
    );
    expect(custom.add).toMatchObject({
      position: { x: 10, y: -24 },
      size: { w: 120, h: 104 },
      data: { title: 'T', color: '#123' },
    });
  });

  it('plans exact append and removal keys without changing descendant membership', () => {
    const { registry, store, layers, layerId, shape } = setup();
    const frame = {
      ...createFrame({ position: { x: 0, y: 0 }, size: { w: 200, h: 120 }, layerId, index: 'a0' }),
      id: 'frame',
    };
    const e0 = { ...shape('e0', 0, 'a0'), parentId: frame.id };
    const e1 = { ...shape('e1', 0, 'a2'), parentId: frame.id };
    const i0 = shape('i0', 999, 'a4');
    const i1 = shape('i1', 999, 'a5');
    const g = { ...shape('g', 999, 'a0'), parentId: i0.id };
    store.add(frame);
    store.add(e0);
    store.add(e1);
    store.add(i0);
    store.add(i1);
    store.add(g);
    expect(planAddToFrame(frame.id, [i1.id, g.id, i0.id], store, registry, layers).updates).toEqual(
      [
        { id: 'i0', partial: { parentId: frame.id, index: 'a3' } },
        { id: 'i1', partial: { parentId: frame.id, index: 'a4' } },
      ],
    );
    expect(store.getById('g')?.parentId).toBe('i0');
    expect(store.getById('e0')?.index).toBe('a0');
  });

  it('uses the header minimum when framing a 1 by 2 root without padding', () => {
    const { registry, store, layers, layerId, shape } = setup();
    const root = { ...shape('tiny', 5, 'a0'), position: { x: 5, y: 6 }, size: { w: 1, h: 2 } };
    store.add(root);
    expect(
      planFrameSelection([root.id], { padding: 0 }, 'frame', store, registry, layers).add,
    ).toMatchObject({
      layerId,
      position: { x: 5, y: -18 },
      size: { w: 80, h: 48 },
    });
  });

  it('detaches normalized direct members into the exact root interval', () => {
    const { registry, store, layers, layerId, shape } = setup();
    const frame = {
      ...createFrame({ position: { x: 0, y: 0 }, size: { w: 100, h: 80 }, layerId, index: 'a0' }),
      id: 'frame',
    };
    const next = shape('next', 100, 'a1');
    const c0 = { ...shape('c0', 0, 'Zz'), parentId: frame.id };
    const c1 = { ...shape('c1', 0, 'a0'), parentId: frame.id };
    const g = { ...shape('g', 0, 'a0'), parentId: c0.id };
    store.add(frame);
    store.add(next);
    store.add(c0);
    store.add(c1);
    store.add(g);
    expect(
      planRemoveFromFrame(frame.id, [c1.id, g.id, c0.id], store, registry, layers).updates,
    ).toEqual([
      { id: 'c0', partial: { parentId: undefined, index: 'a0G' } },
      { id: 'c1', partial: { parentId: undefined, index: 'a0V' } },
    ]);
    expect(store.getById(g.id)?.parentId).toBe(c0.id);
  });

  it.each([
    [
      'negative padding',
      (store: ElementStore, registry: ElementRegistry, layers: LayerManager) =>
        planFrameSelection(['root'], { padding: -1 }, 'frame', store, registry, layers),
    ],
    [
      'non-finite padding',
      (store: ElementStore, registry: ElementRegistry, layers: LayerManager) =>
        planFrameSelection(['root'], { padding: Infinity }, 'frame', store, registry, layers),
    ],
    [
      'locked incoming root',
      (store: ElementStore, registry: ElementRegistry, layers: LayerManager) =>
        planFrameSelection(['locked'], {}, 'frame', store, registry, layers),
    ],
    [
      'descendant alone',
      (store: ElementStore, registry: ElementRegistry, layers: LayerManager) =>
        planFrameSelection(['child'], {}, 'frame', store, registry, layers),
    ],
  ])('rejects %s without changing the planner store', (_name, invoke) => {
    const { registry, store, layers, shape } = setup();
    const root = shape('root', 0, 'a0');
    const locked = { ...shape('locked', 50, 'a1'), locked: true };
    const child = { ...shape('child', 1, 'a0'), parentId: root.id };
    store.add(root);
    store.add(locked);
    store.add(child);
    const before = structuredClone(store.snapshot());
    expect(() => invoke(store, registry, layers)).toThrow('Cannot change frame membership:');
    expect(store.snapshot()).toEqual(before);
  });

  it('rejects a genuine exhausted append interval without mutating it', () => {
    const { registry, store, layers, layerId, shape } = setup();
    const frame = {
      ...createFrame({ position: { x: 0, y: 0 }, size: { w: 100, h: 80 }, layerId, index: 'a0' }),
      id: 'frame',
    };
    const last = { ...shape('last', 0, 'z'.repeat(128)), parentId: frame.id };
    const incoming = shape('incoming', 0, 'a1');
    store.add(frame);
    store.add(last);
    store.add(incoming);
    expect(isValidIndexKey(last.index)).toBe(true);
    expect(() => planAddToFrame(frame.id, [incoming.id], store, registry, layers)).toThrow(
      'order keys cannot be generated',
    );
    expect(store.getById(incoming.id)?.parentId).toBeUndefined();
  });

  it('rejects incomplete remote hierarchy without exposing its raw record', () => {
    const { registry, store, layers, shape } = setup();
    const root = shape('root', 0, 'a0');
    const orphan = { ...shape('orphan', 1, 'a1'), parentId: 'missing-parent' };
    store.add(root);
    store.add(orphan, { origin: 'remote' });
    const before = structuredClone(store.snapshot());
    expect(() => planFrameSelection([root.id], {}, 'frame', store, registry, layers)).toThrow(
      'scene contains invalid remote hierarchy',
    );
    expect(canFrameSelection([root.id], store, registry, layers)).toBe(false);
    expect(store.count).toBe(2);
    expect(store.getById(orphan.id)).toEqual(orphan);
    expect(store.snapshot()).toEqual(before);
  });
});
