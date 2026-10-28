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

function setup() {
  const registry = new ElementRegistry();
  const store = new ElementStore(registry);
  const layers = new LayerManager(store);
  const layerId = layers.activeLayerId;
  const shape = (id: string, x: number, index: string) =>
    createShape({ id, position: { x, y: 20 }, size: { w: 40, h: 30 }, layerId, index });
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
    const frame = {
      ...createFrame({ position: { x: 0, y: 0 }, size: { w: 200, h: 120 }, layerId, index: 'a0' }),
      id: 'frame',
    };
    const lower = { ...shape('', 10, 'a'), id: 'lower', parentId: frame.id, index: 'a' };
    const upper = { ...shape('', 30, 'A'), id: 'upper', parentId: frame.id, index: 'A' };
    store.add(frame);
    store.add(lower);
    store.add(upper);

    expect(
      planDissolveFrame(frame.id, store, registry, layers).updates.map((update) => update.id),
    ).toEqual(['upper', 'lower']);
  });
});
