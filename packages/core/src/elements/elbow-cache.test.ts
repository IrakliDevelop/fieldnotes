import { describe, expect, it } from 'vitest';
import { createArrow, createShape } from './element-factory';
import { getElbowRoute } from './elbow-cache';
import { ElementStore } from './element-store';
import { ElementRegistry } from './element-registry';
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
          clipBounds: (element: ExtensionElementEnvelope) =>
            element.data['visible'] === true
              ? { x: 40, y: -10, w: 20, h: 20 }
              : { x: 200, y: 200, w: 20, h: 20 },
        }
      : {}),
  };
}

describe('elbow route cache', () => {
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
});
