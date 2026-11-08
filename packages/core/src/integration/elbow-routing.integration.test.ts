import { describe, expect, it } from 'vitest';
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

    const first = getElbowRoute(store, installed).points;
    store.update(obstacle.id, { position: { x: 80, y: 80 } });
    const second = getElbowRoute(store, installed).points;

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
});
