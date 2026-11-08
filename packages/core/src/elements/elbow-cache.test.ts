import { describe, expect, it } from 'vitest';
import { createArrow, createShape, createStroke, createText } from './element-factory';
import { getElbowRoute, setElbowVisibleLayers, takeAffectedElbowLayers } from './elbow-cache';
import { ElementStore } from './element-store';
import { ElementRegistry } from './element-registry';
import { HistoryRecorder } from '../history/history-recorder';
import { HistoryStack } from '../history/history-stack';
import type { ElementTypeDefinition, ExtensionElementEnvelope } from './types';

function elbow(store: ElementStore) {
  const arrow = createArrow({
    from: { x: 0, y: 0 },
    to: { x: 100, y: 0 },
    routing: 'elbow',
  });
  store.add(arrow);
  const installed = store.getById(arrow.id);
  if (!installed || installed.type !== 'arrow') throw new Error('expected arrow');
  return installed;
}

function detours(route: ReturnType<typeof getElbowRoute>): boolean {
  return route?.points.some((point) => point.y !== 0) ?? false;
}

function extension(
  id: string,
  overrides: Partial<ExtensionElementEnvelope> = {},
): ExtensionElementEnvelope {
  return {
    id,
    type: 'extension',
    extensionType: 'test:bounds',
    position: { x: 1_000, y: 1_000 },
    index: 'a0',
    version: 1,
    locked: false,
    layerId: '',
    data: {},
    ...overrides,
  };
}

function boundsDefinition(clip = false): ElementTypeDefinition<ExtensionElementEnvelope> {
  return {
    type: 'test:bounds',
    legacyTypes: [],
    renderMode: 'canvas',
    decodeLegacy: () => extension('legacy'),
    validateData: () => true,
    unwrap: (element: ExtensionElementEnvelope) => element,
    wrap: (element: ExtensionElementEnvelope) => element,
    bounds: (element: ExtensionElementEnvelope) =>
      element.data['obstacle'] === true
        ? { x: 40, y: -10, w: 20, h: 20 }
        : { x: element.position.x, y: element.position.y, w: 10, h: 10 },
    ...(clip
      ? {
          clipBounds: (element: ExtensionElementEnvelope) => {
            if (element.data['clip'] === 'partial') return { x: 50, y: -10, w: 10, h: 20 };
            if (element.data['visible'] === true) return { x: 40, y: -10, w: 20, h: 20 };
            return { x: 200, y: 200, w: 20, h: 20 };
          },
        }
      : {}),
  };
}

describe('elbow route cache', () => {
  it('recomputes the same non-store-owned draft after an obstacle changes without document writes', () => {
    const store = new ElementStore();
    const draft = createArrow({
      from: { x: 0, y: 0 },
      to: { x: 200, y: 0 },
      routing: 'elbow',
    });
    const obstacle = createShape({
      position: { x: 80, y: -20 },
      size: { w: 40, h: 40 },
      shape: 'rectangle',
    });
    store.add(obstacle);
    const owned = elbow(store);
    const history = new HistoryStack();
    new HistoryRecorder(store, history);
    const changes: string[] = [];
    store.on('add', (current) => changes.push(current.id));
    store.on('update', ({ current }) => changes.push(current.id));

    getElbowRoute(store, owned);
    takeAffectedElbowLayers(store);
    const before = getElbowRoute(store, draft);
    expect(changes).toEqual([]);
    expect(takeAffectedElbowLayers(store)).toEqual([]);
    expect(history.undoCount).toBe(0);

    changes.length = 0;
    store.update(obstacle.id, { position: { x: 80, y: 80 } }, { origin: 'remote' });
    expect(changes).toEqual([obstacle.id]);
    expect(takeAffectedElbowLayers(store)).toEqual([owned.layerId]);
    expect(history.undoCount).toBe(0);

    changes.length = 0;
    const after = getElbowRoute(store, draft);

    expect(detours(before)).toBe(true);
    expect(detours(after)).toBe(false);
    expect(changes).toEqual([]);
    expect(takeAffectedElbowLayers(store)).toEqual([]);
    expect(history.undoCount).toBe(0);
    expect(store.getById(draft.id)).toBeUndefined();
  });

  it('reuses a route for obstacle and arrow style-only updates', () => {
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
    const route = getElbowRoute(store, installed);

    store.update(obstacle.id, { fillColor: '#ff0000' });
    expect(getElbowRoute(store, installed)).toBe(route);
    store.update(arrow.id, { color: '#ff0000' });
    const recolored = store.getById(arrow.id);
    if (!recolored || recolored.type !== 'arrow') throw new Error('expected arrow');
    expect(getElbowRoute(store, recolored)).toBe(route);
  });

  it('keeps an out-of-region obstacle edit out of a cached route', () => {
    const store = new ElementStore();
    const arrow = createArrow({
      from: { x: 0, y: 0 },
      to: { x: 200, y: 0 },
      routing: 'elbow',
    });
    const obstacle = createShape({
      position: { x: 2_000, y: 0 },
      size: { w: 40, h: 40 },
      shape: 'rectangle',
    });
    store.add(arrow);
    store.add(obstacle);
    const installed = store.getById(arrow.id);
    if (!installed || installed.type !== 'arrow') throw new Error('expected arrow');
    const route = getElbowRoute(store, installed);

    store.update(obstacle.id, { position: { x: 2_100, y: 0 } });

    expect(getElbowRoute(store, installed)).toBe(route);
  });

  it('shared input arrow objects do not share cache ownership', () => {
    const shared = createArrow({
      from: { x: 0, y: 0 },
      to: { x: 200, y: 0 },
      routing: 'elbow',
    });
    shared.id = 'arrow';
    const first = new ElementStore();
    const second = new ElementStore();
    const firstObstacle = createShape({
      position: { x: 80, y: -20 },
      size: { w: 40, h: 40 },
      shape: 'rectangle',
    });
    const secondObstacle = createShape({
      position: { x: 120, y: 80 },
      size: { w: 40, h: 40 },
      shape: 'rectangle',
    });
    first.add(shared);
    first.add(firstObstacle);
    second.loadSnapshot([shared, secondObstacle]);
    const firstArrow = first.getById(shared.id);
    const secondArrow = second.getById(shared.id);
    if (firstArrow?.type !== 'arrow' || secondArrow?.type !== 'arrow')
      throw new Error('expected arrows');

    const firstRoute = getElbowRoute(first, firstArrow);
    const secondRoute = getElbowRoute(second, secondArrow);

    expect(firstArrow).not.toBe(shared);
    expect(secondArrow).not.toBe(shared);
    expect(secondArrow).not.toBe(firstArrow);
    expect(firstRoute?.points).not.toEqual(secondRoute?.points);
    first.update(firstObstacle.id, { position: { x: 80, y: 80 } });
    expect(getElbowRoute(first, firstArrow)?.points).not.toEqual(firstRoute?.points);
    expect(getElbowRoute(second, secondArrow)).toBe(secondRoute);
  });

  it('updateMany and loadSnapshot invalidate final-scene routes coherently', () => {
    const store = new ElementStore();
    const arrow = elbow(store);
    const left = createShape({
      position: { x: 25, y: -10 },
      size: { w: 20, h: 20 },
      shape: 'rectangle',
    });
    const right = createShape({
      position: { x: 55, y: -10 },
      size: { w: 20, h: 20 },
      shape: 'rectangle',
    });
    store.add(left);
    store.add(right);
    const initial = getElbowRoute(store, arrow);
    const eventRoutes: string[] = [];
    const updates: string[] = [];
    store.on('update', ({ current }) => {
      updates.push(current.id);
      const installed = store.getById(arrow.id);
      if (installed?.type === 'arrow')
        eventRoutes.push(JSON.stringify(getElbowRoute(store, installed)));
    });

    store.updateMany([
      { id: left.id, partial: { position: { x: 25, y: 80 } } },
      { id: right.id, partial: { position: { x: 55, y: 80 } } },
    ]);

    const final = getElbowRoute(store, arrow);
    expect(final?.points).not.toEqual(initial?.points);
    expect(eventRoutes).toEqual([JSON.stringify(final), JSON.stringify(final)]);
    expect(updates).not.toContain(arrow.id);

    const registry = new ElementRegistry();
    registry.register(boundsDefinition(true));
    const clipped = new ElementStore(registry);
    const clippedArrow = elbow(clipped);
    const parent = extension('parent', { data: { visible: true } });
    const child = extension('child', { parentId: parent.id, data: { obstacle: true } });
    clipped.add(parent);
    clipped.add(child);
    expect(detours(getElbowRoute(clipped, clippedArrow))).toBe(true);
    const snapshotRoutes: string[] = [];
    const clippedUpdates: string[] = [];
    clipped.on('update', ({ current }) => clippedUpdates.push(current.id));
    clipped.on('add', () => {
      const installed = clipped.getById(clippedArrow.id);
      if (installed?.type === 'arrow')
        snapshotRoutes.push(JSON.stringify(getElbowRoute(clipped, installed)));
    });

    clipped.loadSnapshot(
      [
        clippedArrow,
        extension(parent.id, { data: { visible: false } }),
        extension(child.id, { parentId: parent.id, data: { obstacle: true } }),
      ],
      { origin: 'remote' },
    );

    const reloadedArrow = clipped.getById(clippedArrow.id);
    if (reloadedArrow?.type !== 'arrow') throw new Error('expected arrow');
    const reloaded = getElbowRoute(clipped, reloadedArrow);
    expect(detours(reloaded)).toBe(false);
    expect(snapshotRoutes).toEqual([
      JSON.stringify(reloaded),
      JSON.stringify(reloaded),
      JSON.stringify(reloaded),
    ]);
    expect(clippedUpdates).not.toContain(clippedArrow.id);
  });

  it('admits a child-first obstacle when its far-away root arrives and removes it with that root', () => {
    const store = new ElementStore();
    const arrow = elbow(store);
    const arrowVersion = arrow.version;
    const arrowUpdates: string[] = [];
    store.on('update', ({ current }) => {
      if (current.id === arrow.id) arrowUpdates.push(current.id);
    });
    const child = createShape({
      position: { x: 40, y: -10 },
      size: { w: 20, h: 20 },
      shape: 'rectangle',
    });
    child.parentId = 'parent';
    store.add(child, { origin: 'remote' });
    expect(detours(getElbowRoute(store, arrow))).toBe(false);

    const parent = createShape({
      position: { x: 1_000, y: 1_000 },
      size: { w: 10, h: 10 },
      shape: 'rectangle',
    });
    parent.id = 'parent';
    store.add(parent, { origin: 'remote' });
    expect(detours(getElbowRoute(store, arrow))).toBe(true);
    expect(store.getById(arrow.id)?.version).toBe(arrowVersion);
    expect(arrowUpdates).toEqual([]);

    store.remove(parent.id, { origin: 'remote' });
    expect(detours(getElbowRoute(store, arrow))).toBe(false);
  });

  it.each(['local', 'host'] as const)(
    'local and host parent additions repair cached child-first obstacles: %s',
    (origin) => {
      const store = new ElementStore();
      const arrow = elbow(store);
      const rawArrow = structuredClone(arrow);
      const arrowVersion = arrow.version;
      const arrowUpdates: string[] = [];
      store.on('update', ({ current }) => {
        if (current.id === arrow.id) arrowUpdates.push(current.id);
      });
      const child = createShape({
        position: { x: 40, y: -10 },
        size: { w: 20, h: 20 },
        shape: 'rectangle',
        parentId: 'parent',
      });
      store.add(child, { origin: 'remote' });
      const before = getElbowRoute(store, arrow);
      const parent = createShape({
        position: { x: 1_000, y: 1_000 },
        size: { w: 10, h: 10 },
        shape: 'rectangle',
      });
      parent.id = 'parent';

      store.add(parent, origin === 'host' ? { origin } : undefined);

      expect(detours(before)).toBe(false);
      expect(detours(getElbowRoute(store, arrow))).toBe(true);
      expect(store.getById(arrow.id)).toEqual(rawArrow);
      expect(store.getById(arrow.id)?.version).toBe(arrowVersion);
      expect(arrowUpdates).toEqual([]);
    },
  );

  it('excluded root elements leave unrelated cached routes and layers clean', () => {
    const store = new ElementStore();
    const first = elbow(store);
    const second = createArrow({
      from: { x: 0, y: 40 },
      to: { x: 100, y: 40 },
      routing: 'elbow',
      layerId: 'other',
    });
    store.add(second);
    const installed = store.getById(second.id);
    if (installed?.type !== 'arrow') throw new Error('expected arrow');
    const firstRoute = getElbowRoute(store, first);
    const secondRoute = getElbowRoute(store, installed);
    takeAffectedElbowLayers(store);
    const excluded = [
      createArrow({
        from: { x: 20, y: 0 },
        to: { x: 80, y: 0 },
        routing: 'bezier',
        layerId: 'ignored-bezier',
      }),
      createArrow({
        from: { x: 20, y: 0 },
        to: { x: 80, y: 0 },
        routing: 'elbow',
        layerId: 'ignored-elbow',
      }),
      createStroke({
        layerId: 'ignored-stroke',
        points: [
          { x: 40, y: -10, pressure: 0.5 },
          { x: 60, y: 10, pressure: 0.5 },
        ],
      }),
      createShape({
        position: { x: 40, y: -10 },
        size: { w: 20, h: 20 },
        shape: 'line',
        layerId: 'ignored-line',
      }),
    ];
    for (const element of excluded) {
      store.add(element);
      expect(getElbowRoute(store, first)).toBe(firstRoute);
      expect(getElbowRoute(store, installed)).toBe(secondRoute);
      const addedLayers = takeAffectedElbowLayers(store);
      expect(addedLayers).not.toContain(first.layerId);
      expect(addedLayers).not.toContain(installed.layerId);
      const own = store.getById(element.id);
      const ownRoute = own?.type === 'arrow' ? getElbowRoute(store, own) : undefined;
      store.update(
        element.id,
        element.type === 'arrow'
          ? { from: { x: 25, y: 0 }, to: { x: 85, y: 0 }, position: { x: 45, y: -10 } }
          : { position: { x: 45, y: -10 } },
      );
      const changed = store.getById(element.id);
      if (changed?.type === 'arrow' && changed.routing === 'elbow')
        expect(getElbowRoute(store, changed)).not.toBe(ownRoute);
      expect(getElbowRoute(store, first)).toBe(firstRoute);
      expect(getElbowRoute(store, installed)).toBe(secondRoute);
      const movedLayers = takeAffectedElbowLayers(store);
      expect(movedLayers).not.toContain(first.layerId);
      expect(movedLayers).not.toContain(installed.layerId);
      store.remove(element.id);
      expect(getElbowRoute(store, first)).toBe(firstRoute);
      expect(getElbowRoute(store, installed)).toBe(secondRoute);
      const removedLayers = takeAffectedElbowLayers(store);
      expect(removedLayers).not.toContain(first.layerId);
      expect(removedLayers).not.toContain(installed.layerId);
    }
    expect(getElbowRoute(store, first)).toBe(firstRoute);
    expect(getElbowRoute(store, installed)).toBe(secondRoute);
    expect(takeAffectedElbowLayers(store)).toEqual([]);

    store.update(first.id, { from: { x: 10, y: 0 } });
    const moved = store.getById(first.id);
    if (moved?.type !== 'arrow') throw new Error('expected arrow');
    expect(getElbowRoute(store, moved)).not.toBe(firstRoute);
    expect(getElbowRoute(store, installed)).toBe(secondRoute);
    expect(takeAffectedElbowLayers(store)).toEqual([first.layerId]);

    const obstacle = createShape({
      position: { x: 40, y: -10 },
      size: { w: 20, h: 20 },
      shape: 'rectangle',
    });
    obstacle.id = 'replacement';
    store.add(obstacle);
    expect(detours(getElbowRoute(store, moved))).toBe(true);
    const line = createShape({
      position: obstacle.position,
      size: obstacle.size,
      shape: 'line',
    });
    line.id = obstacle.id;
    store.add(line);
    expect(detours(getElbowRoute(store, moved))).toBe(false);
    store.add(obstacle);
    expect(detours(getElbowRoute(store, moved))).toBe(true);
  });

  it('excluded bound line targets still invalidate only their dependent elbow', () => {
    const store = new ElementStore();
    const target = createShape({
      position: { x: -10, y: -10 },
      size: { w: 20, h: 20 },
      shape: 'line',
    });
    target.id = 'target';
    const dependent = createArrow({
      from: { x: 0, y: 0 },
      to: { x: 100, y: 0 },
      routing: 'elbow',
      fromBinding: { elementId: target.id },
    });
    const unrelated = createArrow({
      from: { x: 0, y: 0 },
      to: { x: 100, y: 0 },
      routing: 'elbow',
      layerId: 'other',
    });
    store.add(target);
    store.add(dependent);
    store.add(unrelated);
    const a = store.getById(dependent.id);
    const b = store.getById(unrelated.id);
    if (a?.type !== 'arrow' || b?.type !== 'arrow') throw new Error('expected arrows');
    const first = getElbowRoute(store, a);
    const other = getElbowRoute(store, b);
    const rawArrow = structuredClone(a);
    const version = a.version;
    const updates: string[] = [];
    store.on('update', ({ current }) => {
      if (current.id === a.id) updates.push(current.id);
    });
    takeAffectedElbowLayers(store);

    expect(first?.points[0]).toEqual({ x: 10, y: 0 });
    store.update(target.id, { size: { w: 40, h: 20 } });
    const current = store.getById(a.id);
    if (current?.type !== 'arrow') throw new Error('expected arrow');

    expect(getElbowRoute(store, current)).not.toBe(first);
    expect(getElbowRoute(store, current)?.points[0]).toEqual({ x: 30, y: 0 });
    expect(getElbowRoute(store, b)).toBe(other);
    expect(takeAffectedElbowLayers(store)).toEqual([a.layerId]);
    store.remove(target.id);
    expect(getElbowRoute(store, current)?.points[0]).toEqual({ x: 0, y: 0 });
    expect(getElbowRoute(store, b)).toBe(other);
    expect(takeAffectedElbowLayers(store)).toEqual([a.layerId]);
    store.add({ ...target, size: { w: 40, h: 20 } });
    expect(getElbowRoute(store, current)?.points[0]).toEqual({ x: 30, y: 0 });
    expect(getElbowRoute(store, b)).toBe(other);
    expect(takeAffectedElbowLayers(store)).toEqual([a.layerId]);
    expect(store.getById(a.id)).toEqual(rawArrow);
    expect(store.getById(a.id)?.version).toBe(version);
    expect(updates).toEqual([]);
  });

  it('an excluded parent can still admit eligible descendants', () => {
    const store = new ElementStore();
    const arrow = elbow(store);
    const child = createShape({
      position: { x: 40, y: -10 },
      size: { w: 20, h: 20 },
      shape: 'rectangle',
      parentId: 'line-parent',
    });
    store.add(child, { origin: 'remote' });
    expect(detours(getElbowRoute(store, arrow))).toBe(false);
    const parent = createShape({
      position: { x: 1_000, y: 1_000 },
      size: { w: 10, h: 10 },
      shape: 'line',
    });
    parent.id = 'line-parent';

    store.add(parent);

    expect(detours(getElbowRoute(store, arrow))).toBe(true);
  });

  it('remote same-bounds reparenting invalidates projected descendants', () => {
    const store = new ElementStore();
    const arrow = elbow(store);
    const arrowVersion = arrow.version;
    const arrowUpdates: string[] = [];
    store.on('update', ({ current }) => {
      if (current.id === arrow.id) arrowUpdates.push(current.id);
    });
    const container = createShape({
      position: { x: 1_000, y: 1_000 },
      size: { w: 10, h: 10 },
      shape: 'rectangle',
    });
    container.id = 'container';
    const child = createShape({
      position: { x: 40, y: -10 },
      size: { w: 20, h: 20 },
      shape: 'rectangle',
    });
    child.parentId = container.id;
    store.add(container, { origin: 'remote' });
    store.add(child, { origin: 'remote' });
    expect(detours(getElbowRoute(store, arrow))).toBe(true);

    store.update(container.id, { parentId: 'missing' }, { origin: 'remote' });
    expect(detours(getElbowRoute(store, arrow))).toBe(false);

    const parent = createShape({
      position: { x: 2_000, y: 2_000 },
      size: { w: 10, h: 10 },
      shape: 'rectangle',
    });
    parent.id = 'parent';
    store.add(parent, { origin: 'remote' });
    store.updateMany([{ id: container.id, partial: { parentId: parent.id } }], {
      origin: 'remote',
    });
    expect(detours(getElbowRoute(store, arrow))).toBe(true);
    expect(store.getById(arrow.id)?.version).toBe(arrowVersion);
    expect(arrowUpdates).toEqual([]);
  });

  it('invalidates same-bounds eligibility and effective clips', () => {
    const store = new ElementStore();
    const arrow = elbow(store);
    const obstacle = createShape({
      position: { x: 40, y: -10 },
      size: { w: 20, h: 20 },
      shape: 'rectangle',
    });
    store.add(obstacle);
    expect(detours(getElbowRoute(store, arrow))).toBe(true);
    store.update(obstacle.id, { shape: 'line' });
    expect(detours(getElbowRoute(store, arrow))).toBe(false);

    const registry = new ElementRegistry();
    registry.register(boundsDefinition(true));
    const clippedStore = new ElementStore(registry);
    const clippedArrow = elbow(clippedStore);
    const parent = extension('parent', { data: { visible: true } });
    const child = extension('child', { parentId: parent.id, data: { obstacle: true } });
    clippedStore.add(parent);
    clippedStore.add(child);
    expect(detours(getElbowRoute(clippedStore, clippedArrow))).toBe(true);
    clippedStore.update(parent.id, { data: { visible: false } });
    expect(detours(getElbowRoute(clippedStore, clippedArrow))).toBe(false);
  });

  it('refreshes registry tokens before a route cache hit', () => {
    const registry = new ElementRegistry();
    const store = new ElementStore(registry);
    const arrow = elbow(store);
    const obstacle = extension('obstacle', { data: { obstacle: true } });
    store.add(obstacle);
    expect(detours(getElbowRoute(store, arrow))).toBe(false);

    registry.register(boundsDefinition());
    expect(detours(getElbowRoute(store, arrow))).toBe(true);
    expect(store.queryPoint({ x: 45, y: 0 }).map((element) => element.id)).toContain(obstacle.id);

    registry.unregister('test:bounds');
    expect(detours(getElbowRoute(store, arrow))).toBe(false);
    expect(store.queryPoint({ x: 45, y: 0 }).map((element) => element.id)).not.toContain(
      obstacle.id,
    );

    registry.register(boundsDefinition());
    expect(detours(getElbowRoute(store, arrow))).toBe(true);
    expect(store.queryPoint({ x: 45, y: 0 }).map((element) => element.id)).toContain(obstacle.id);

    registry.unregister('test:bounds');
    expect(detours(getElbowRoute(store, arrow))).toBe(false);
  });

  it.each([
    ['source', { elementId: 'bound', focus: 0, gap: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 }, 0],
    ['target', { elementId: 'bound', focus: 0, gap: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 }, -1],
  ] as const)(
    'ignores a projected-out bound target when trimming ports: %s',
    (_end, binding, from, to, endpoint) => {
      const store = new ElementStore();
      const bound = createShape({
        position: endpoint === 0 ? { x: -20, y: -10 } : { x: 80, y: -10 },
        size: { w: 40, h: 20 },
        shape: 'rectangle',
      });
      bound.id = 'bound';
      bound.parentId = 'parent';
      store.add(bound, { origin: 'remote' });
      const arrow = createArrow({
        from,
        to,
        routing: 'elbow',
        ...(endpoint === 0 ? { fromBinding: binding } : { toBinding: binding }),
      });
      store.add(arrow, { origin: 'remote' });
      const installed = store.getById(arrow.id);
      if (!installed || installed.type !== 'arrow') throw new Error('expected arrow');
      expect(getElbowRoute(store, installed)?.points.at(endpoint)).toEqual(
        endpoint === 0 ? from : to,
      );

      const parent = createShape({
        position: { x: 1_000, y: 1_000 },
        size: { w: 10, h: 10 },
        shape: 'rectangle',
      });
      parent.id = 'parent';
      store.add(parent, { origin: 'remote' });
      expect(getElbowRoute(store, installed)?.points.at(endpoint)).toEqual(
        endpoint === 0 ? { x: 20, y: 0 } : { x: 80, y: 0 },
      );
    },
  );

  it('ranks mixed-size rectangles by AABB distance rather than center', () => {
    const store = new ElementStore();
    const arrow = elbow(store);
    for (let index = 0; index < 32; index += 1) {
      const nearby = createShape({
        position: { x: 45, y: 40 },
        size: { w: 10, h: 1 },
        shape: 'rectangle',
      });
      nearby.id = `near-${index}`;
      store.add(nearby);
    }
    const touching = createShape({
      position: { x: 40, y: -1_000 },
      size: { w: 20, h: 1_000 },
      shape: 'rectangle',
    });
    touching.id = 'touching';
    store.add(touching);

    const route = getElbowRoute(store, arrow);
    expect(route?.points).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 13 },
      { x: 100, y: 13 },
      { x: 100, y: 0 },
    ]);
  });

  it('breaks equal-distance ties by raw id consistently across insertion orders', () => {
    const candidates = Array.from({ length: 33 }, (_, index) => ({
      id: index === 0 ? 'A0' : index === 1 ? 'a0' : `B${String(index).padStart(2, '0')}`,
      position: index === 1 ? { x: 60, y: -13 } : { x: 20, y: 12 },
    }));
    const routeFor = (order: readonly (typeof candidates)[number][]) => {
      const store = new ElementStore();
      const arrow = elbow(store);
      for (const candidate of order) {
        const obstacle = createShape({
          position: candidate.position,
          size: { w: 1, h: 1 },
          shape: 'rectangle',
        });
        obstacle.id = candidate.id;
        store.add(obstacle);
      }
      return getElbowRoute(store, arrow);
    };

    const forward = routeFor(candidates);
    expect(forward).toEqual(routeFor([...candidates].reverse()));
    expect(forward?.points).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: -1 },
      { x: 100, y: -1 },
      { x: 100, y: 0 },
    ]);
  });

  it('excludes its own bound label when it is added, removed and readded', () => {
    const store = new ElementStore();
    const arrow = elbow(store);
    const label = createText({
      position: { x: 40, y: -10 },
      size: { w: 10, h: 10 },
      parentId: arrow.id,
      containerId: arrow.id,
    });
    store.add(label);
    expect(detours(getElbowRoute(store, arrow))).toBe(false);
    store.remove(label.id);
    expect(detours(getElbowRoute(store, arrow))).toBe(false);
    store.add(label);
    expect(detours(getElbowRoute(store, arrow))).toBe(false);
  });

  it('excludes non-text descendants when they are added, removed and readded', () => {
    const store = new ElementStore();
    const arrow = elbow(store);
    const child = createShape({
      position: { x: 40, y: -10 },
      size: { w: 20, h: 20 },
      shape: 'rectangle',
      parentId: arrow.id,
    });
    store.add(child);
    expect(detours(getElbowRoute(store, arrow))).toBe(false);
    store.remove(child.id);
    expect(detours(getElbowRoute(store, arrow))).toBe(false);
    store.add(child);
    expect(detours(getElbowRoute(store, arrow))).toBe(false);
  });

  it('treats an ancestor as an obstacle only while the arrow is detached', () => {
    const store = new ElementStore();
    const parent = createShape({
      position: { x: 40, y: -10 },
      size: { w: 20, h: 20 },
      shape: 'rectangle',
    });
    parent.id = 'parent';
    store.add(parent);
    const arrow = createArrow({
      from: { x: 0, y: 0 },
      to: { x: 100, y: 0 },
      routing: 'elbow',
      parentId: parent.id,
    });
    store.add(arrow);
    const currentArrow = () => {
      const current = store.getById(arrow.id);
      if (!current || current.type !== 'arrow') throw new Error('expected arrow');
      return current;
    };

    expect(detours(getElbowRoute(store, currentArrow()))).toBe(false);
    store.update(arrow.id, { parentId: undefined });
    expect(detours(getElbowRoute(store, currentArrow()))).toBe(true);
    store.remove(parent.id);
    expect(detours(getElbowRoute(store, currentArrow()))).toBe(false);
    store.add(parent);
    expect(detours(getElbowRoute(store, currentArrow()))).toBe(true);
    store.update(arrow.id, { parentId: parent.id });
    expect(detours(getElbowRoute(store, currentArrow()))).toBe(false);
  });

  it('excludes endpoint targets while routing around a third blocker', () => {
    const store = new ElementStore();
    const source = createShape({
      position: { x: -10, y: -10 },
      size: { w: 20, h: 20 },
      shape: 'rectangle',
    });
    source.id = 'source';
    const target = createShape({
      position: { x: 90, y: -10 },
      size: { w: 20, h: 20 },
      shape: 'rectangle',
    });
    target.id = 'target';
    const blocker = createShape({
      position: { x: 40, y: -10 },
      size: { w: 20, h: 20 },
      shape: 'rectangle',
    });
    store.add(source);
    store.add(target);
    store.add(blocker);
    const arrow = createArrow({
      from: { x: 0, y: 0 },
      to: { x: 100, y: 0 },
      routing: 'elbow',
      fromBinding: { elementId: source.id },
      toBinding: { elementId: target.id },
    });
    store.add(arrow);
    const currentArrow = () => {
      const current = store.getById(arrow.id);
      if (!current || current.type !== 'arrow') throw new Error('expected arrow');
      return current;
    };
    const route = () => getElbowRoute(store, currentArrow());
    const expectDetour = () => {
      const points = route()?.points ?? [];
      expect(detours(route())).toBe(true);
      expect(
        points.some((point, index) => {
          const previous = points[index - 1];
          if (!previous) return false;
          if (point.y === previous.y)
            return (
              point.y > -10 &&
              point.y < 10 &&
              Math.max(point.x, previous.x) > 40 &&
              Math.min(point.x, previous.x) < 60
            );
          return (
            point.x > 40 &&
            point.x < 60 &&
            Math.max(point.y, previous.y) > -10 &&
            Math.min(point.y, previous.y) < 10
          );
        }),
      ).toBe(false);
    };

    expectDetour();
    expect(route()?.points[0]).toEqual({ x: 0, y: -10 });
    store.remove(source.id);
    expectDetour();
    expect(route()?.points[0]).toEqual({ x: 0, y: 0 });
    store.add(source);
    expectDetour();
    expect(route()?.points.at(-1)).toEqual({ x: 100, y: -10 });
    store.remove(target.id);
    expectDetour();
    expect(route()?.points.at(-1)).toEqual({ x: 100, y: 0 });
    store.add(target);
    expectDetour();
    expect(route()?.points.at(-1)).toEqual({ x: 100, y: -10 });
  });

  it('uses effective clipped rotated bounds and visible layers', () => {
    const registry = new ElementRegistry();
    registry.register(boundsDefinition(true));
    const store = new ElementStore(registry);
    const arrow = elbow(store);
    const clipParent = extension('clip-parent', { data: { clip: 'partial' } });
    const clipped = extension('clipped', {
      parentId: clipParent.id,
      data: { obstacle: true },
    });
    store.add(clipParent);
    store.add(clipped);
    expect(detours(getElbowRoute(store, arrow))).toBe(true);
    store.update(clipParent.id, { data: { clip: 'hidden' } });
    expect(detours(getElbowRoute(store, arrow))).toBe(false);

    const rotated = createShape({
      position: { x: 30, y: 14 },
      size: { w: 40, h: 10 },
      shape: 'rectangle',
      layerId: 'other',
    });
    rotated.rotation = Math.PI / 2;
    store.add(rotated);
    let otherVisible = true;
    const isVisible = (layerId: string) => layerId !== 'other' || otherVisible;
    setElbowVisibleLayers(store, isVisible);
    const visibleRoute = getElbowRoute(store, arrow);
    expect(detours(visibleRoute)).toBe(true);

    otherVisible = false;
    setElbowVisibleLayers(store, isVisible);
    const hiddenRoute = getElbowRoute(store, arrow);
    expect(detours(hiddenRoute)).toBe(false);
    expect(hiddenRoute).not.toBe(visibleRoute);
  });
});
