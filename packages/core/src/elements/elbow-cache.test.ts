import { describe, expect, it } from 'vitest';
import { createArrow, createShape } from './element-factory';
import { getElbowRoute } from './elbow-cache';
import { ElementStore } from './element-store';

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
});
