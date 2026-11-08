import { describe, expect, it } from 'vitest';
import { exportState } from '../core/state-serializer';
import { createBoundText } from '../elements/bound-text';
import { ElementStore } from '../elements/element-store';
import { createArrow, createShape } from '../elements/element-factory';
import { getElbowRoute } from '../elements/elbow-cache';

describe('elbow route cache', () => {
  it('moving an obstacle changes the next local detour without changing arrow revision or emitting arrow updates', () => {
    const store = new ElementStore();
    const arrow = createArrow({
      from: { x: 0, y: 0 },
      to: { x: 200, y: 0 },
      routing: 'elbow',
    });
    const obstacle = createShape({
      position: { x: 80, y: -20 },
      size: { w: 40, h: 40 },
      shape: 'rectangle',
    });
    store.add(arrow);
    store.add(obstacle);
    const installed = store.getById(arrow.id);
    if (!installed || installed.type !== 'arrow') throw new Error('expected arrow');
    const updates: string[] = [];
    store.on('update', ({ current }) => updates.push(current.id));

    const firstRoute = getElbowRoute(store, installed);
    if (!firstRoute) throw new Error('expected elbow route');
    const first = firstRoute.points;
    store.update(obstacle.id, { position: { x: 80, y: 80 } });
    const secondRoute = getElbowRoute(store, installed);
    if (!secondRoute) throw new Error('expected elbow route');
    const second = secondRoute.points;

    expect(second).not.toEqual(first);
    expect(store.getById(arrow.id)?.version).toBe(1);
    expect(updates).not.toContain(arrow.id);
  });

  it('queries a detour beyond endpoint bounds after remote snapshot and obstacle movement', () => {
    const store = new ElementStore();
    const arrow = createArrow({
      from: { x: 0, y: 0 },
      to: { x: 200, y: 0 },
      routing: 'elbow',
    });
    const obstacle = createShape({
      position: { x: 80, y: -20 },
      size: { w: 40, h: 40 },
      shape: 'rectangle',
    });
    store.loadSnapshot([arrow, obstacle], { origin: 'remote' });
    store.update(obstacle.id, { position: { x: 80, y: 80 } }, { origin: 'remote' });

    expect(store.queryPoint({ x: 100, y: 200 }).map((element) => element.id)).toContain(arrow.id);
  });

  it('a third obstacle changes only the local route, not persisted label geometry', () => {
    const arrow = {
      ...createArrow({
        from: { x: 0, y: 0 },
        to: { x: 200, y: 0 },
        routing: 'elbow',
        index: 'a0',
      }),
      id: 'arrow',
    };
    const label = {
      ...createBoundText(arrow, { text: 'label', index: 'a1' }),
      id: 'label',
      size: { w: 20, h: 10 },
    };
    label.parentId = arrow.id;
    label.containerId = arrow.id;
    const publicStore = new ElementStore();
    const privateStore = new ElementStore();
    for (const store of [publicStore, privateStore]) {
      store.add(arrow);
      store.add(label);
    }
    const obstacle = {
      ...createShape({ position: { x: 80, y: -20 }, size: { w: 40, h: 40 }, shape: 'rectangle' }),
      id: 'private-obstacle',
    };
    privateStore.add(obstacle);
    const publicArrow = publicStore.getById(arrow.id);
    const privateArrow = privateStore.getById(arrow.id);
    if (publicArrow?.type !== 'arrow' || privateArrow?.type !== 'arrow')
      throw new Error('expected arrows');
    const publicRoute = getElbowRoute(publicStore, publicArrow);
    const privateRoute = getElbowRoute(privateStore, privateArrow);
    expect(privateRoute?.points).not.toEqual(publicRoute?.points);
    const persist = (store: ElementStore) =>
      JSON.stringify(
        exportState(
          [store.getById(arrow.id), store.getById(label.id)].filter(
            (element): element is NonNullable<typeof element> => element !== undefined,
          ),
          { position: { x: 0, y: 0 }, zoom: 1 },
        ),
      );
    const before = persist(privateStore);
    const arrowVersion = privateStore.getById(arrow.id)?.version;
    const labelVersion = privateStore.getById(label.id)?.version;
    const updates: string[] = [];
    privateStore.on('update', ({ current }) => updates.push(current.id));

    privateStore.update(obstacle.id, { position: { x: 80, y: 80 } });

    expect(getElbowRoute(privateStore, privateArrow)?.points).not.toEqual(privateRoute?.points);
    expect(persist(privateStore)).toBe(before);
    expect(privateStore.getById(arrow.id)?.version).toBe(arrowVersion);
    expect(privateStore.getById(label.id)?.version).toBe(labelVersion);
    expect(updates).not.toContain(arrow.id);
    expect(updates).not.toContain(label.id);
  });
});
