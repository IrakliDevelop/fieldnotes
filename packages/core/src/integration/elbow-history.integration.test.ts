// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createViewportHarness } from '../test-helpers/viewport-harness';
import { drag, pointerDown, pointerMove, pointerUp } from '../test-helpers/pointer-helpers';
import type { ViewportHarness } from '../test-helpers/viewport-harness';
import type { ArrowTool } from '../tools/arrow-tool';
import type { SelectTool } from '../tools/select-tool';
import { createArrow } from '../elements/element-factory';
import { createBoundText } from '../elements/bound-text';

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
});
