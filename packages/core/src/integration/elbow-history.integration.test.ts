// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createViewportHarness } from '../test-helpers/viewport-harness';
import { drag, pointerDown, pointerMove, pointerUp } from '../test-helpers/pointer-helpers';
import type { ViewportHarness } from '../test-helpers/viewport-harness';
import type { ArrowTool } from '../tools/arrow-tool';
import type { SelectTool } from '../tools/select-tool';
import { createArrow } from '../elements/element-factory';
import { createBoundText } from '../elements/bound-text';
import { getElbowRoute } from '../elements/elbow-cache';
import { hitTestArrowHandles } from '../tools/arrow-handles';

describe('Integration: elbow arrow history', () => {
  let harness: ViewportHarness;

  beforeEach(() => {
    harness = createViewportHarness();
    const tool = harness.viewport.toolManager.getTool<ArrowTool>('arrow');
    if (!tool) throw new Error('expected arrow tool');
    tool.setOptions({ routing: 'elbow' });
    harness.viewport.toolManager.setTool('arrow', harness.viewport.toolContext);
  });

  afterEach(() => harness.cleanup());

  it('creates one elbow arrow and one undo step with mouse', () => {
    drag(harness.wrapper, [100, 100], [300, 200]);

    expect(harness.viewport.store.getElementsByType('arrow')[0]?.routing).toBe('elbow');
    expect(harness.viewport.history.undoCount).toBe(1);
  });

  it('creates one elbow arrow and one undo step with touch', () => {
    pointerDown(harness.wrapper, 100, 100, { pointerType: 'touch' });
    pointerMove(harness.wrapper, 110, 100, { pointerType: 'touch' });
    pointerMove(harness.wrapper, 300, 200, { pointerType: 'touch' });
    pointerUp(harness.wrapper, 300, 200, { pointerType: 'touch' });

    expect(harness.viewport.store.getElementsByType('arrow')[0]?.routing).toBe('elbow');
    expect(harness.viewport.history.undoCount).toBe(1);
  });

  it('creates one elbow arrow and one undo step with pen', () => {
    pointerDown(harness.wrapper, 100, 100, { pointerType: 'pen' });
    pointerMove(harness.wrapper, 300, 200, { pointerType: 'pen' });
    pointerUp(harness.wrapper, 300, 200, { pointerType: 'pen' });

    expect(harness.viewport.store.getElementsByType('arrow')[0]?.routing).toBe('elbow');
    expect(harness.viewport.history.undoCount).toBe(1);
  });

  it('leaves no arrow or undo entry when cancelled or taken over by a pinch', () => {
    pointerDown(harness.wrapper, 100, 100);
    pointerMove(harness.wrapper, 300, 200);
    harness.wrapper.dispatchEvent(
      new PointerEvent('pointercancel', {
        bubbles: true,
        pointerId: 1,
        clientX: 300,
        clientY: 200,
      }),
    );

    expect(harness.viewport.store.getElementsByType('arrow')).toHaveLength(0);
    expect(harness.viewport.history.undoCount).toBe(0);

    pointerDown(harness.wrapper, 100, 100);
    pointerMove(harness.wrapper, 300, 200);
    pointerDown(harness.wrapper, 200, 100, { pointerId: 2, pointerType: 'touch' });
    pointerUp(harness.wrapper, 200, 100, { pointerId: 2, pointerType: 'touch' });
    pointerUp(harness.wrapper, 300, 200);

    expect(harness.viewport.store.getElementsByType('arrow')).toHaveLength(0);
    expect(harness.viewport.history.undoCount).toBe(0);
  });

  it.each([
    [
      'mouse cancel',
      { pointerType: 'mouse' },
      (wrapper: HTMLElement) =>
        wrapper.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 })),
    ],
    [
      'deferred touch cancel',
      { pointerType: 'touch' },
      (wrapper: HTMLElement) =>
        wrapper.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 })),
    ],
    [
      'pen cancel',
      { pointerType: 'pen' },
      (wrapper: HTMLElement) =>
        wrapper.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 })),
    ],
    [
      'lost pointer capture',
      {},
      (wrapper: HTMLElement) =>
        wrapper.dispatchEvent(
          new PointerEvent('lostpointercapture', { bubbles: true, pointerId: 1 }),
        ),
    ],
    [
      'second pointer takeover',
      {},
      (wrapper: HTMLElement) =>
        pointerDown(wrapper, 25, 50, { pointerId: 2, pointerType: 'touch' }),
    ],
    ['window blur', {}, () => window.dispatchEvent(new Event('blur'))],
    ['visibility loss', {}, () => document.dispatchEvent(new Event('visibilitychange'))],
  ])('restores an edited segment and label with %s', (_name, options, cancel) => {
    const arrow = createArrow({
      from: { x: 0, y: 0 },
      to: { x: 100, y: 100 },
      routing: 'elbow',
    });
    const label = createBoundText(arrow, { text: 'label' });
    harness.viewport.store.add(arrow);
    harness.viewport.store.add(label);
    const originalLabel = { position: { ...label.position }, size: { ...label.size } };
    const select = harness.viewport.toolManager.getTool<SelectTool>('select');
    if (!select) throw new Error('expected select tool');
    select.setSelection([arrow.id]);
    harness.viewport.toolManager.setTool('select', harness.viewport.toolContext);
    harness.viewport.history.clear();

    pointerDown(harness.wrapper, 50, 50, options);
    if ('pointerType' in options && options.pointerType === 'touch')
      pointerMove(harness.wrapper, 54, 50, options);
    pointerMove(harness.wrapper, 70, 50, options);
    cancel(harness.wrapper);

    expect(harness.viewport.store.getById(arrow.id)).toMatchObject({ fixedSegments: undefined });
    expect(harness.viewport.store.getById(label.id)).toMatchObject(originalLabel);
    expect(harness.viewport.history.undoCount).toBe(0);
  });

  it('restores on Escape and ignores segment moves until pointer up', () => {
    const arrow = createArrow({
      from: { x: 0, y: 0 },
      to: { x: 100, y: 100 },
      routing: 'elbow',
    });
    harness.viewport.store.add(arrow);
    const select = harness.viewport.toolManager.getTool<SelectTool>('select');
    if (!select) throw new Error('expected select tool');
    select.setSelection([arrow.id]);
    harness.viewport.toolManager.setTool('select', harness.viewport.toolContext);
    harness.viewport.history.clear();

    pointerDown(harness.wrapper, 50, 50);
    pointerMove(harness.wrapper, 70, 50);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    pointerMove(harness.wrapper, 80, 50);
    pointerUp(harness.wrapper, 80, 50);

    expect(harness.viewport.store.getById(arrow.id)).toMatchObject({ fixedSegments: undefined });
    expect(harness.viewport.history.undoCount).toBe(0);
  });

  it('records one undo that restores the arrow and its authored label geometry', () => {
    const arrow = createArrow({
      from: { x: 0, y: 0 },
      to: { x: 100, y: 100 },
      routing: 'elbow',
    });
    const label = createBoundText(arrow, { text: 'label' });
    harness.viewport.store.add(arrow);
    harness.viewport.store.add(label);
    const originalLabel = { position: { ...label.position }, size: { ...label.size } };
    const select = harness.viewport.toolManager.getTool<SelectTool>('select');
    if (!select) throw new Error('expected select tool');
    select.setSelection([arrow.id]);
    harness.viewport.toolManager.setTool('select', harness.viewport.toolContext);
    harness.viewport.history.clear();

    drag(harness.wrapper, [50, 50], [70, 50]);
    expect(harness.viewport.store.getById(arrow.id)).toMatchObject({
      fixedSegments: [{ axis: 'x', value: 70 }],
    });
    expect(harness.viewport.history.undoCount).toBe(1);

    harness.viewport.undo();
    expect(harness.viewport.store.getById(arrow.id)).toMatchObject({ fixedSegments: undefined });
    expect(harness.viewport.store.getById(label.id)).toMatchObject(originalLabel);
  });

  it('keeps one captured pin across repeated completed drags', () => {
    const arrow = createArrow({
      from: { x: 0, y: 0 },
      to: { x: 100, y: 100 },
      routing: 'elbow',
    });
    harness.viewport.store.add(arrow);
    const select = harness.viewport.toolManager.getTool<SelectTool>('select');
    if (!select) throw new Error('expected select tool');
    select.setSelection([arrow.id]);
    harness.viewport.toolManager.setTool('select', harness.viewport.toolContext);
    harness.viewport.history.clear();

    drag(harness.wrapper, [50, 50], [70, 50]);
    drag(harness.wrapper, [70, 50], [75, 50]);

    expect(harness.viewport.store.getById(arrow.id)).toMatchObject({
      fixedSegments: [{ axis: 'x', value: 75 }],
    });
    expect(harness.viewport.history.undoCount).toBe(2);
    harness.viewport.undo();
    expect(harness.viewport.store.getById(arrow.id)).toMatchObject({
      fixedSegments: [{ axis: 'x', value: 70 }],
    });
  });

  it('cancels a loaded elbow without a cached control point without history', () => {
    const snapshotArrow = createArrow({
      from: { x: 0, y: 0 },
      to: { x: 100, y: 100 },
      bend: 0,
      routing: 'elbow',
    });
    harness.viewport.store.add(snapshotArrow);
    harness.viewport.loadState(harness.viewport.exportState());
    const arrow = harness.viewport.store.getById(snapshotArrow.id);
    if (!arrow || arrow.type !== 'arrow') throw new Error('expected loaded arrow');
    expect(arrow.cachedControlPoint).toBeUndefined();
    const select = harness.viewport.toolManager.getTool<SelectTool>('select');
    if (!select) throw new Error('expected select tool');
    select.setSelection([arrow.id]);
    harness.viewport.toolManager.setTool('select', harness.viewport.toolContext);
    harness.viewport.history.clear();

    pointerDown(harness.wrapper, 50, 50);
    pointerMove(harness.wrapper, 70, 50);
    harness.wrapper.dispatchEvent(
      new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 }),
    );

    expect(harness.viewport.store.getById(arrow.id)).toMatchObject({ fixedSegments: undefined });
    expect(harness.viewport.history.undoCount).toBe(0);
  });

  it.each([
    ['mouse', { pointerType: 'mouse' }],
    ['deferred touch', { pointerType: 'touch' }],
    ['pen', { pointerType: 'pen' }],
  ])('keeps a whole remote replacement on %s cancellation', (_name, options) => {
    const arrow = createArrow({
      from: { x: 0, y: 0 },
      to: { x: 100, y: 100 },
      routing: 'elbow',
      color: '#111111',
    });
    harness.viewport.store.add(arrow);
    const select = harness.viewport.toolManager.getTool<SelectTool>('select');
    if (!select) throw new Error('expected select tool');
    select.setSelection([arrow.id]);
    harness.viewport.toolManager.setTool('select', harness.viewport.toolContext);
    harness.viewport.history.clear();

    pointerDown(harness.wrapper, 50, 50, options);
    if (options.pointerType === 'touch') pointerMove(harness.wrapper, 54, 50, options);
    pointerMove(harness.wrapper, 70, 50, options);
    expect(harness.viewport.store.getById(arrow.id)).toMatchObject({
      fixedSegments: [{ axis: 'x', value: 70 }],
    });
    const remote = {
      ...arrow,
      color: '#ff0000',
      version: arrow.version + 10,
      editor: 'remote-peer',
      fixedSegments: undefined,
    };
    harness.viewport.store.update(arrow.id, remote, { origin: 'remote' });
    const update = vi.spyOn(harness.viewport.store, 'update');
    harness.wrapper.dispatchEvent(
      new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 }),
    );

    expect(harness.viewport.store.getById(arrow.id)).toEqual(remote);
    expect(update).not.toHaveBeenCalled();
    expect(harness.viewport.history.canUndo).toBe(false);
  });

  it('keeps an external arrow replacement and bound label change on cancellation', () => {
    const arrow = createArrow({
      from: { x: 0, y: 0 },
      to: { x: 100, y: 100 },
      routing: 'elbow',
    });
    const label = createBoundText(arrow, { text: 'local' });
    harness.viewport.store.add(arrow);
    harness.viewport.store.add(label);
    const select = harness.viewport.toolManager.getTool<SelectTool>('select');
    if (!select) throw new Error('expected select tool');
    select.setSelection([arrow.id]);
    harness.viewport.toolManager.setTool('select', harness.viewport.toolContext);
    harness.viewport.history.clear();

    pointerDown(harness.wrapper, 50, 50);
    pointerMove(harness.wrapper, 70, 50);
    const remoteArrow = {
      ...arrow,
      color: '#ff0000',
      version: arrow.version + 10,
      editor: 'remote-peer',
      fixedSegments: undefined,
    };
    const remoteLabel = {
      ...label,
      text: 'remote',
      color: '#008800',
      position: { x: 16, y: 24 },
      size: { w: 88, h: 30 },
      version: label.version + 10,
      editor: 'remote-peer',
    };
    harness.viewport.store.update(arrow.id, remoteArrow, { origin: 'remote' });
    harness.viewport.store.update(label.id, remoteLabel, { origin: 'remote' });
    harness.wrapper.dispatchEvent(
      new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 }),
    );

    expect(harness.viewport.store.getById(arrow.id)).toEqual(remoteArrow);
    expect(harness.viewport.store.getById(label.id)).toEqual(remoteLabel);
    expect(harness.viewport.history.canUndo).toBe(false);
  });

  it('restores segment pins and label geometry while retaining an external colour update', () => {
    const arrow = createArrow({
      from: { x: 0, y: 0 },
      to: { x: 100, y: 100 },
      routing: 'elbow',
      color: '#111111',
    });
    const label = createBoundText(arrow, { text: 'label' });
    harness.viewport.store.add(arrow);
    harness.viewport.store.add(label);
    const originalLabel = { position: { ...label.position }, size: { ...label.size } };
    const select = harness.viewport.toolManager.getTool<SelectTool>('select');
    if (!select) throw new Error('expected select tool');
    select.setSelection([arrow.id]);
    harness.viewport.toolManager.setTool('select', harness.viewport.toolContext);
    harness.viewport.history.clear();

    pointerDown(harness.wrapper, 50, 50);
    pointerMove(harness.wrapper, 70, 50);
    harness.viewport.store.update(arrow.id, { color: '#ff0000' }, { origin: 'remote' });
    harness.wrapper.dispatchEvent(
      new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 }),
    );

    expect(harness.viewport.store.getById(arrow.id)).toMatchObject({
      color: '#ff0000',
      fixedSegments: undefined,
    });
    expect(harness.viewport.store.getById(label.id)).toMatchObject(originalLabel);
    expect(harness.viewport.history.undoCount).toBe(0);
  });

  it('undoes a completed segment drag without undoing an external colour update', () => {
    const arrow = createArrow({
      from: { x: 0, y: 0 },
      to: { x: 100, y: 100 },
      routing: 'elbow',
      color: '#111111',
    });
    const label = createBoundText(arrow, { text: 'label' });
    harness.viewport.store.add(arrow);
    harness.viewport.store.add(label);
    const originalLabel = { position: { ...label.position }, size: { ...label.size } };
    const select = harness.viewport.toolManager.getTool<SelectTool>('select');
    if (!select) throw new Error('expected select tool');
    select.setSelection([arrow.id]);
    harness.viewport.toolManager.setTool('select', harness.viewport.toolContext);
    harness.viewport.history.clear();

    pointerDown(harness.wrapper, 50, 50);
    pointerMove(harness.wrapper, 70, 50);
    expect(harness.viewport.store.getById(label.id)).not.toMatchObject(originalLabel);
    harness.viewport.store.update(arrow.id, { color: '#ff0000' }, { origin: 'remote' });
    pointerUp(harness.wrapper, 70, 50);
    expect(harness.viewport.history.undoCount).toBe(1);
    harness.viewport.undo();

    expect(harness.viewport.store.getById(arrow.id)).toMatchObject({
      color: '#ff0000',
      fixedSegments: undefined,
    });
    expect(harness.viewport.store.getById(label.id)).toMatchObject(originalLabel);
  });

  it('does not write or record an untagged segment drag at the pin cap', () => {
    const fixedSegments = Array.from({ length: 16 }, (_, index) => ({
      axis: 'x' as const,
      value: (index + 1) * 100,
    }));
    const arrow = createArrow({
      from: { x: 0, y: 0 },
      to: { x: 1700, y: 1700 },
      routing: 'elbow',
      fixedSegments,
    });
    harness.viewport.store.add(arrow);
    const installed = harness.viewport.store.getById(arrow.id);
    if (!installed || installed.type !== 'arrow') throw new Error('expected installed arrow');
    const original = structuredClone(installed);
    const route = getElbowRoute(harness.viewport.store, installed);
    const index = route?.segments.findIndex(
      (segment, candidate) =>
        candidate > 0 && candidate < route.segments.length - 1 && segment.fixedIndex === undefined,
    );
    if (index === undefined || index < 0 || !route) throw new Error('expected untagged segment');
    const from = route.points[index];
    const to = route.points[index + 1];
    if (!from || !to) throw new Error('expected untagged segment points');
    const point = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    const select = harness.viewport.toolManager.getTool<SelectTool>('select');
    if (!select) throw new Error('expected select tool');
    select.setSelection([arrow.id]);
    harness.viewport.toolManager.setTool('select', harness.viewport.toolContext);
    harness.viewport.history.clear();

    expect(hitTestArrowHandles(point, [arrow.id], harness.viewport.toolContext)).toEqual({
      elementId: arrow.id,
      handle: `segment:${index}`,
    });
    const update = vi.spyOn(harness.viewport.store, 'update');
    pointerDown(harness.wrapper, point.x, point.y);
    pointerMove(harness.wrapper, point.x, point.y + 15);
    pointerUp(harness.wrapper, point.x, point.y + 15);

    expect(update).not.toHaveBeenCalled();
    expect(harness.viewport.store.getById(arrow.id)).toEqual(original);
    expect(harness.viewport.history.canUndo).toBe(false);
  });
});
