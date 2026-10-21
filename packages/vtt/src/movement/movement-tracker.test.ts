import { describe, it, expect, afterEach } from 'vitest';
import { ElementRegistry, SelectTool, Viewport, createShape } from '@fieldnotes/core';
import type { PointerState } from '@fieldnotes/core';
import { registerVttElementTypes } from '../register';
import { GridController } from '../grid/grid-controller';
import { createMovementRecord, movementRecordTypeDefinition } from './movement-record';
import { MovementTracker } from './movement-tracker';
import type { MovementTrackerOptions } from './movement-tracker';
import type { MovementVisibility } from './movement-types';

const BANDS = [{ feet: 30, color: '#2E7D32' }];
const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function setup(opts: { grid?: boolean; tracker?: MovementTrackerOptions } = {}) {
  const registry = new ElementRegistry();
  registerVttElementTypes(registry);
  const vp = new Viewport(document.createElement('div'), {
    elementRegistry: registry,
    tools: [new SelectTool()],
  });
  if (opts.grid !== false) {
    new GridController({
      store: vp.store,
      recorder: vp.historyRecorder,
      requestRender: () => vp.requestRender(),
      getActiveLayerId: () => vp.layerManager.activeLayerId,
      toolContext: vp.toolContext,
      defaultGridSize: 40,
      elementRegistry: registry,
      constraintService: vp.constraintProxy,
    }).add({ gridType: 'square', cellSize: 40 });
    vp.setSnapToGrid(true);
  }
  const tracker = new MovementTracker(vp, opts.tracker);
  cleanups.push(() => {
    tracker.dispose();
    vp.destroy();
  });

  const select = vp.toolManager.getTool('select');
  if (!(select instanceof SelectTool)) throw new Error('select tool missing');

  const token = (x: number, y: number, locked = false): string => {
    const shape = createShape({
      position: { x, y },
      size: { w: 40, h: 40 },
      layerId: vp.layerManager.activeLayerId,
      locked,
    });
    vp.store.add(shape);
    return shape.id;
  };

  const pt = (x: number, y: number): PointerState => ({
    x,
    y,
    pressure: 0.5,
    pointerType: 'mouse',
    shiftKey: false,
  });

  // Mirrors InputHandler: one history transaction from pointerdown to pointerup.
  const gesture = (points: readonly [number, number][], beforeUp?: () => void): void => {
    const [first, ...moves] = points;
    if (first === undefined) throw new Error('empty gesture');
    const ctx = vp.toolContext;
    vp.historyRecorder.begin();
    vp.toolManager.handlePointerDown(pt(...first), ctx);
    for (const p of moves) vp.toolManager.handlePointerMove(pt(...p), ctx);
    beforeUp?.();
    vp.toolManager.handlePointerUp(pt(...(moves.at(-1) ?? first)), ctx);
    vp.historyRecorder.commit();
  };

  const record = (id: string) => vp.store.getById(`vtt-movement:${id}`);
  const position = (id: string) => vp.store.getById(id)?.position;
  const track = (id: string, epoch = 'e1', visibility: MovementVisibility = 'all') =>
    tracker.track(id, { epoch, bands: BANDS, visibility });

  return { vp, tracker, select, token, gesture, record, position, track };
}

describe('MovementTracker', () => {
  it('drag of a tracked element adds grid distance', () => {
    const { vp, tracker, token, gesture, record, track } = setup();
    const a = token(0, 0);
    track(a);

    gesture([
      [25, 25],
      [145, 25],
    ]);

    expect(tracker.getMovement(a)).toEqual({ feet: 15, remaining: 15 });
    expect(record(a)).toMatchObject({
      id: `vtt-movement:${a}`,
      type: 'extension',
      extensionType: 'vtt:movement',
      locked: true,
      layerId: vp.layerManager.activeLayerId,
      data: {
        targetId: a,
        epoch: 'e1',
        feet: 15,
        diagonals: 0,
        visibility: 'all',
        trail: [
          [
            { x: 20, y: 20 },
            { x: 140, y: 20 },
          ],
        ],
      },
    });
  });

  it('beyond the last band remaining is null', () => {
    const { tracker, token, gesture, track } = setup();
    const a = token(0, 0);
    track(a);

    gesture([
      [25, 25],
      [305, 25],
    ]);

    expect(tracker.getMovement(a)).toEqual({ feet: 35, remaining: null });
  });

  it('two drags accumulate and keep 5-10-5 parity', () => {
    const { tracker, token, gesture, record, track } = setup({
      tracker: { diagonalRule: 'alternate' },
    });
    const a = token(0, 0);
    track(a);

    gesture([
      [25, 25],
      [65, 65],
    ]);
    expect(tracker.getMovement(a)?.feet).toBe(5);

    gesture([
      [65, 65],
      [105, 105],
    ]);
    expect(tracker.getMovement(a)?.feet).toBe(15);
    expect(record(a)).toMatchObject({
      data: {
        diagonals: 2,
        trail: [
          [
            { x: 20, y: 20 },
            { x: 60, y: 60 },
            { x: 100, y: 100 },
          ],
        ],
      },
    });
  });

  it('one undo restores element and record together', () => {
    const { vp, tracker, token, gesture, position, track } = setup();
    const a = token(0, 0);
    track(a);
    gesture([
      [25, 25],
      [65, 25],
    ]);
    gesture([
      [65, 25],
      [145, 25],
    ]);
    expect(tracker.getMovement(a)?.feet).toBe(15);

    vp.undo();

    expect(position(a)).toEqual({ x: 40, y: 0 });
    expect(tracker.getMovement(a)?.feet).toBe(5);
  });

  it('untracked element drag writes nothing', () => {
    const { tracker, token, gesture, record, position } = setup();
    const a = token(0, 0);

    gesture([
      [25, 25],
      [145, 25],
    ]);

    expect(position(a)).toEqual({ x: 120, y: 0 });
    expect(record(a)).toBeUndefined();
    expect(tracker.getMovement(a)).toBeNull();
  });

  it.each([
    ['a click', [[25, 25]]],
    [
      'a jittery click that never leaves the origin cell',
      [
        [25, 25],
        [27, 26],
        [23, 24],
      ],
    ],
  ] as const)('%s writes nothing', (_name, points) => {
    const { vp, token, gesture, record, position, track } = setup();
    const a = token(0, 0);
    track(a);
    const steps = vp.history.undoCount;

    gesture(points.map(([x, y]) => [x, y]));

    expect(position(a)).toEqual({ x: 0, y: 0 });
    expect(record(a)).toBeUndefined();
    expect(vp.history.undoCount).toBe(steps);
  });

  it('Escape-cancelled drag adds nothing', () => {
    const { vp, tracker, token, gesture, record, position, track } = setup();
    const a = token(0, 0);
    track(a);

    gesture(
      [
        [25, 25],
        [145, 25],
      ],
      () =>
        vp.toolManager.activeTool?.onKeyDown?.(
          new KeyboardEvent('keydown', { key: 'Escape' }),
          vp.toolContext,
        ),
    );

    expect(position(a)).toEqual({ x: 0, y: 0 });
    expect(record(a)).toBeUndefined();
    expect(tracker.getMovement(a)?.feet).toBe(0);
  });

  describe('stale epoch counts as zero and is overwritten', () => {
    it.each([
      ['seeded before track', false],
      ['added remotely after track', true],
    ])('record %s', (_name, remoteAfterTrack) => {
      const { vp, tracker, token, gesture, record, track } = setup();
      const a = token(0, 0);
      const target = vp.store.getById(a);
      if (!target) throw new Error('missing target');
      const stale = movementRecordTypeDefinition.wrap({
        ...createMovementRecord({ target, epoch: 'a', visibility: 'all' }),
        feet: 25,
        diagonals: 3,
        trail: [[{ x: 500, y: 500 }]],
      });
      if (!remoteAfterTrack) vp.store.add(stale);
      track(a, 'b');
      if (remoteAfterTrack) vp.store.add(stale, { origin: 'remote' });

      expect(tracker.getMovement(a)).toEqual({ feet: 0, remaining: 30 });

      gesture([
        [25, 25],
        [65, 25],
      ]);

      expect(record(a)).toMatchObject({
        data: {
          epoch: 'b',
          feet: 5,
          diagonals: 0,
          trail: [
            [
              { x: 20, y: 20 },
              { x: 60, y: 20 },
            ],
          ],
        },
      });
    });
  });

  it('a record whose targetId does not match is ignored', () => {
    const { vp, tracker, token, track } = setup();
    const a = token(0, 0);
    const b = token(80, 0);
    const other = vp.store.getById(b);
    if (!other) throw new Error('missing target');
    vp.store.add({
      ...movementRecordTypeDefinition.wrap({
        ...createMovementRecord({ target: other, epoch: 'e1', visibility: 'all' }),
        feet: 20,
      }),
      id: `vtt-movement:${a}`,
    });
    track(a);

    expect(tracker.getMovement(a)?.feet).toBe(0);
  });

  it('reset zeroes in one undo step and keeps the element in place', () => {
    const { vp, tracker, token, gesture, record, position, track } = setup();
    const a = token(0, 0);
    track(a);
    gesture([
      [25, 25],
      [145, 25],
    ]);
    const steps = vp.history.undoCount;

    tracker.reset(a);

    expect(tracker.getMovement(a)).toEqual({ feet: 0, remaining: 30 });
    expect(record(a)).toMatchObject({
      data: { epoch: 'e1', feet: 0, diagonals: 0, trail: [] },
    });
    expect(position(a)).toEqual({ x: 120, y: 0 });
    expect(vp.history.undoCount).toBe(steps + 1);

    vp.undo();

    expect(tracker.getMovement(a)?.feet).toBe(15);
    expect(position(a)).toEqual({ x: 120, y: 0 });
  });

  it('multi-select drag accumulates per tracked element only', () => {
    const { tracker, select, token, gesture, record, position, track } = setup();
    const a = token(0, 0);
    const b = token(0, 80);
    const c = token(0, 160, true);
    track(a);
    track(c);
    select.setSelection([a, b, c]);

    gesture([
      [25, 25],
      [145, 25],
    ]);

    expect(position(b)).toEqual({ x: 120, y: 80 });
    expect(position(c)).toEqual({ x: 0, y: 160 });
    expect(tracker.getMovement(a)?.feet).toBe(15);
    expect(record(b)).toBeUndefined();
    expect(record(c)).toBeUndefined();
  });

  describe('removing the target', () => {
    function dragged() {
      const env = setup();
      const a = env.token(0, 0);
      env.track(a);
      env.gesture([
        [25, 25],
        [65, 25],
      ]);
      return { ...env, a };
    }

    it('removes its record in the same transaction', () => {
      const { vp, a, record } = dragged();
      const steps = vp.history.undoCount;

      vp.removeElements([a]);

      expect(record(a)).toBeUndefined();
      expect(vp.history.undoCount).toBe(steps + 1);
      vp.undo();
      expect(vp.store.getById(a)).toBeDefined();
      expect(record(a)).toMatchObject({ data: { feet: 5 } });
    });

    it('outside a transaction removes the record as its own step', () => {
      const { vp, a, record } = dragged();
      const steps = vp.history.undoCount;

      vp.store.remove(a);

      expect(record(a)).toBeUndefined();
      expect(vp.history.undoCount).toBe(steps + 2);
    });

    it('a remote removal writes nothing', () => {
      const { vp, a, record } = dragged();

      vp.store.remove(a, { origin: 'remote' });

      expect(record(a)).toMatchObject({ data: { feet: 5 } });
    });
  });

  it('record layerId follows the target', () => {
    const { vp, token, gesture, record, track } = setup();
    const a = token(0, 0);
    track(a);
    gesture([
      [25, 25],
      [65, 25],
    ]);
    const layer = vp.layerManager.createLayer('Tokens');
    vp.store.update(a, { layerId: layer.id });

    gesture([
      [65, 25],
      [105, 25],
    ]);

    expect(record(a)).toMatchObject({ layerId: layer.id, data: { feet: 10 } });
  });

  it('reset moves the record to the target layer and re-locks it', () => {
    const { vp, tracker, token, gesture, record, track } = setup();
    const a = token(0, 0);
    track(a);
    gesture([
      [25, 25],
      [65, 25],
    ]);
    const layer = vp.layerManager.createLayer('Tokens');
    vp.store.update(a, { layerId: layer.id });
    vp.store.update(`vtt-movement:${a}`, { locked: false }, { origin: 'remote' });

    tracker.reset(a);

    expect(record(a)).toMatchObject({ layerId: layer.id, locked: true, data: { feet: 0 } });
  });

  it('a drag after a nudge starts a new trail run', () => {
    const { vp, select, token, gesture, record, track } = setup();
    const a = token(0, 0);
    track(a);
    gesture([
      [25, 25],
      [65, 25],
    ]);
    vp.transaction(() => select.nudgeSelection(40, 0, vp.toolContext));

    gesture([
      [105, 25],
      [145, 25],
    ]);

    expect(record(a)).toMatchObject({
      data: {
        feet: 10,
        trail: [
          [
            { x: 20, y: 20 },
            { x: 60, y: 20 },
          ],
          [
            { x: 100, y: 20 },
            { x: 140, y: 20 },
          ],
        ],
      },
    });
  });

  describe('visibility survives history', () => {
    function hiddenAfterTwoDrags() {
      const env = setup();
      const a = env.token(0, 0);
      env.track(a);
      env.gesture([
        [25, 25],
        [65, 25],
      ]);
      env.gesture([
        [65, 25],
        [105, 25],
      ]);
      env.tracker.setVisibility(a, 'dm');
      return { ...env, a };
    }

    it('undo restoring an older record keeps the configured visibility', async () => {
      const { vp, a, record } = hiddenAfterTwoDrags();

      vp.undo();
      await Promise.resolve();

      expect(record(a)).toMatchObject({ data: { feet: 5, visibility: 'dm' } });
    });

    it('redo keeps the configured visibility', async () => {
      const { vp, a, record } = hiddenAfterTwoDrags();
      vp.undo();
      await Promise.resolve();

      vp.redo();
      await Promise.resolve();

      expect(record(a)).toMatchObject({ data: { feet: 10, visibility: 'dm' } });
      expect(vp.history.redoCount).toBe(0);
    });
  });

  it('setVisibility rewrites the record without an undo entry', () => {
    const { vp, tracker, token, gesture, record, track } = setup();
    const a = token(0, 0);
    track(a);
    gesture([
      [25, 25],
      [65, 25],
    ]);
    const steps = vp.history.undoCount;

    tracker.setVisibility(a, 'dm');

    expect(record(a)).toMatchObject({ data: { visibility: 'dm', feet: 5 } });
    expect(vp.history.undoCount).toBe(steps);

    gesture([
      [65, 25],
      [105, 25],
    ]);
    expect(record(a)).toMatchObject({ data: { visibility: 'dm', feet: 10 } });
  });

  it('nudge, host store.update, and undo/redo do not add distance', () => {
    const { vp, tracker, select, token, gesture, position, track } = setup();
    const a = token(0, 0);
    track(a);
    gesture([
      [25, 25],
      [65, 25],
    ]);

    vp.transaction(() => select.nudgeSelection(40, 0, vp.toolContext));
    vp.store.update(a, { position: { x: 200, y: 200 } });
    expect(tracker.getMovement(a)?.feet).toBe(5);

    vp.undo();
    vp.undo();
    expect(position(a)).toEqual({ x: 40, y: 0 });
    expect(tracker.getMovement(a)?.feet).toBe(5);

    vp.undo();
    expect(tracker.getMovement(a)?.feet).toBe(0);
    vp.redo();
    expect(tracker.getMovement(a)?.feet).toBe(5);
  });

  it('gridless: euclidean over 24-unit cells', () => {
    const { tracker, token, gesture, track } = setup({ grid: false });
    const a = token(0, 0);
    track(a);

    gesture([
      [25, 25],
      [55, 65],
    ]);

    expect(tracker.getMovement(a)?.feet).toBeCloseTo((50 / 24) * 5, 10);
  });

  it('untrack keeps the record and stops counting', () => {
    const { tracker, token, gesture, record, track } = setup();
    const a = token(0, 0);
    track(a);
    gesture([
      [25, 25],
      [65, 25],
    ]);

    tracker.untrack(a);
    gesture([
      [65, 25],
      [105, 25],
    ]);

    expect(tracker.isTracked(a)).toBe(false);
    expect(tracker.getMovement(a)).toBeNull();
    expect(record(a)).toMatchObject({ data: { feet: 5 } });
  });

  it('onChange reports local and remote record changes by target id', () => {
    const { vp, tracker, token, gesture, track } = setup();
    const a = token(0, 0);
    const b = token(80, 0);
    const target = vp.store.getById(b);
    if (!target) throw new Error('missing target');
    track(a);
    const changed: string[] = [];
    tracker.onChange((id) => changed.push(id));

    gesture([
      [25, 25],
      [65, 25],
    ]);
    vp.store.add(
      movementRecordTypeDefinition.wrap(
        createMovementRecord({ target, epoch: 'e1', visibility: 'all' }),
      ),
      { origin: 'remote' },
    );

    expect(changed).toEqual([a, b]);
  });

  it('dispose stops recording drags', () => {
    const { tracker, token, gesture, record, track } = setup();
    const a = token(0, 0);
    track(a);

    tracker.dispose();
    gesture([
      [25, 25],
      [65, 25],
    ]);

    expect(record(a)).toBeUndefined();
  });
});
