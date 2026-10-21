import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { ElementRegistry, SelectTool, Viewport, createShape } from '@fieldnotes/core';
import type { PointerState } from '@fieldnotes/core';
import { registerVttElementTypes } from '../register';
import { GridController } from '../grid/grid-controller';
import { createMovementRecord, movementRecordTypeDefinition } from './movement-record';
import { MovementTracker } from './movement-tracker';
import type { MovementEmission, MovementTrackerOptions } from './movement-tracker';
import type { MovementVisibility } from './movement-types';

const BANDS = [{ feet: 30, color: '#2E7D32' }];
const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.unstubAllGlobals();
});

/** Records every 2D-context method call by name; jsdom has no real context. */
function recordingCtx(): { ctx: CanvasRenderingContext2D; calls: [string, ...unknown[]][] } {
  const calls: [string, ...unknown[]][] = [];
  const target: Record<string, unknown> = {
    measureText: () => ({ width: 40 }),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
  };
  const ctx = new Proxy(target, {
    get: (t, name: string) => t[name] ?? ((...args: unknown[]) => void calls.push([name, ...args])),
    set: () => true,
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

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

  // Like gesture, but stepwise so a test can press keys or advance time between moves.
  const press = (x: number, y: number, pointerType: PointerState['pointerType'] = 'mouse') => {
    const ctx = vp.toolContext;
    let last: PointerState = { ...pt(x, y), pointerType };
    vp.historyRecorder.begin();
    vp.toolManager.handlePointerDown(last, ctx);
    return {
      move: (mx: number, my: number): void => {
        last = { ...pt(mx, my), pointerType };
        vp.toolManager.handlePointerMove(last, ctx);
      },
      up: (): void => {
        vp.toolManager.handlePointerUp(last, ctx);
        vp.historyRecorder.commit();
      },
    };
  };

  const key = (key: string, repeat = false): boolean =>
    vp.toolManager.activeTool?.onKeyDown?.(
      new KeyboardEvent('keydown', { key, repeat }),
      vp.toolContext,
    ) ?? false;

  const record = (id: string) => vp.store.getById(`vtt-movement:${id}`);
  const position = (id: string) => vp.store.getById(id)?.position;
  const track = (id: string, epoch = 'e1', visibility: MovementVisibility = 'all') =>
    tracker.track(id, { epoch, bands: BANDS, visibility });

  return { vp, tracker, select, token, gesture, press, key, record, position, track };
}

function drawOverlay(vp: ReturnType<typeof setup>['vp']) {
  const { ctx, calls } = recordingCtx();
  vp.renderHooks.viewport.call('overlay', ctx, vp.camera, { width: 100, height: 100, dpr: 1 });
  return calls.filter(([name]) => name !== 'save' && name !== 'restore');
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

  describe('waypoints', () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
    afterEach(() => vi.useRealTimers());

    it("F adds a waypoint at the element's current snapped center", () => {
      const { tracker, token, press, key, record, track } = setup();
      const a = token(0, 0);
      track(a);

      const drag = press(25, 25);
      drag.move(145, 25);
      expect(key('f')).toBe(true);
      drag.move(145, 145);
      drag.up();

      expect(tracker.getMovement(a)?.feet).toBe(30);
      expect(record(a)).toMatchObject({
        data: {
          trail: [
            [
              { x: 20, y: 20 },
              { x: 140, y: 20 },
              { x: 140, y: 140 },
            ],
          ],
        },
      });
    });

    it('F auto-repeat (e.repeat) and a second F on the same cell add nothing', () => {
      const { tracker, token, press, key, record, track } = setup();
      const a = token(0, 0);
      track(a);

      const drag = press(25, 25);
      drag.move(65, 25);
      key('f');
      expect(key('F')).toBe(true);
      drag.move(145, 25);
      expect(key('f', true)).toBe(true);
      drag.move(65, 145);
      drag.up();

      expect(tracker.getMovement(a)?.feet).toBe(20);
      expect(record(a)).toMatchObject({
        data: {
          trail: [
            [
              { x: 20, y: 20 },
              { x: 60, y: 20 },
              { x: 60, y: 140 },
            ],
          ],
        },
      });
    });

    it('Backspace removes the last waypoint and redraws at once', () => {
      const { vp, tracker, token, press, key, record, track } = setup();
      const a = token(0, 0);
      track(a);

      const drag = press(25, 25);
      drag.move(65, 25);
      key('f');
      drag.move(145, 25);
      key('f');
      drag.move(145, 145);
      expect(key('Backspace')).toBe(true);
      const texts = drawOverlay(vp).filter(([name]) => name === 'fillText');
      drag.up();

      expect(texts).toEqual([['fillText', '20 ft · 10 left', 140, expect.any(Number)]]);
      expect(tracker.getMovement(a)?.feet).toBe(20);
      expect(record(a)).toMatchObject({
        data: {
          trail: [
            [
              { x: 20, y: 20 },
              { x: 60, y: 20 },
              { x: 140, y: 140 },
            ],
          ],
        },
      });
    });

    it('F and Backspace are not consumed in a drag without a tracked element', () => {
      const { token, press, key, record } = setup();
      const a = token(0, 0);

      const drag = press(25, 25);
      drag.move(145, 25);
      const consumed = [key('f'), key('Backspace')];
      drag.up();

      expect(consumed).toEqual([false, false]);
      expect(record(a)).toBeUndefined();
    });

    it.each(['touch', 'pen'] as const)(
      '%s dwell of 500 ms within 6 screen px adds a waypoint',
      (pointerType) => {
        const { tracker, token, press, record, track } = setup();
        const a = token(0, 0);
        track(a);

        const drag = press(25, 25, pointerType);
        drag.move(145, 25);
        vi.advanceTimersByTime(300);
        drag.move(149, 29);
        vi.advanceTimersByTime(200);
        drag.move(145, 145);
        drag.up();

        expect(tracker.getMovement(a)?.feet).toBe(30);
        expect(record(a)).toMatchObject({
          data: {
            trail: [
              [
                { x: 20, y: 20 },
                { x: 140, y: 20 },
                { x: 140, y: 140 },
              ],
            ],
          },
        });
      },
    );

    it('dwell measures screen px: 4 world units at zoom 2 restart the timer', () => {
      const { vp, tracker, token, press, track } = setup();
      const a = token(0, 0);
      track(a);
      vp.camera.setZoom(2);

      // Pointer coordinates are screen px: world (25, 25) is screen (50, 50) at zoom 2.
      const drag = press(50, 50, 'touch');
      drag.move(290, 50);
      vi.advanceTimersByTime(300);
      drag.move(298, 50);
      vi.advanceTimersByTime(200);
      drag.move(290, 290);
      drag.up();

      expect(tracker.getMovement(a)?.feet).toBe(15);
    });

    it('a second dwell on the same cell adds nothing', () => {
      const { token, press, record, track } = setup();
      const a = token(0, 0);
      track(a);

      const drag = press(25, 25, 'touch');
      drag.move(145, 25);
      vi.advanceTimersByTime(500);
      drag.move(155, 25);
      vi.advanceTimersByTime(500);
      drag.move(145, 145);
      drag.up();

      expect(record(a)).toMatchObject({
        data: {
          feet: 30,
          trail: [
            [
              { x: 20, y: 20 },
              { x: 140, y: 20 },
              { x: 140, y: 140 },
            ],
          ],
        },
      });
    });

    it('mouse dwell adds nothing', () => {
      const { tracker, token, press, track } = setup();
      const a = token(0, 0);
      track(a);

      const drag = press(25, 25);
      drag.move(145, 25);
      vi.advanceTimersByTime(500);
      drag.move(145, 145);
      drag.up();

      expect(tracker.getMovement(a)?.feet).toBe(15);
    });

    it('pointerup before 500 ms clears the timer', () => {
      const { tracker, token, press, record, track } = setup();
      const a = token(0, 0);
      track(a);
      const timers = vi.getTimerCount();

      const drag = press(25, 25, 'touch');
      drag.move(145, 25);
      vi.advanceTimersByTime(400);
      drag.up();

      expect(vi.getTimerCount()).toBe(timers);
      vi.advanceTimersByTime(1000);
      expect(tracker.getMovement(a)?.feet).toBe(15);
      expect(record(a)).toMatchObject({
        data: {
          trail: [
            [
              { x: 20, y: 20 },
              { x: 140, y: 20 },
            ],
          ],
        },
      });
    });
  });

  describe('live overlay', () => {
    it('draws tinted cells and the label while a tracked drag is live, nothing after drop', () => {
      const { vp, token, gesture, track } = setup();
      const a = token(0, 0);
      track(a);
      let during: [string, ...unknown[]][] = [];

      gesture(
        [
          [25, 25],
          [145, 25],
        ],
        () => (during = drawOverlay(vp)),
      );

      expect(during.filter(([name]) => name === 'fillRect')).toHaveLength(3);
      expect(during.filter(([name]) => name === 'fillText')).toEqual([
        ['fillText', '15 ft · 15 left', 140, expect.any(Number)],
      ]);
      expect(drawOverlay(vp)).toEqual([]);
    });

    it('labels only the tracked element nearest the pointer in a multi-select drag', () => {
      const { vp, select, token, gesture, track } = setup();
      const a = token(0, 0);
      const b = token(0, 80);
      track(a);
      track(b);
      select.setSelection([a, b]);
      let texts: unknown[] = [];

      gesture(
        [
          [25, 105],
          [145, 105],
        ],
        () => (texts = drawOverlay(vp).filter(([name]) => name === 'fillText')),
      );

      expect(texts).toEqual([['fillText', '15 ft · 15 left', 140, expect.any(Number)]]);
    });

    it('onMovement emits the labelled model once per frame during a drag and null after', () => {
      const frames: FrameRequestCallback[] = [];
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
      vi.stubGlobal('cancelAnimationFrame', vi.fn());
      const { tracker, token, gesture, track } = setup();
      const a = token(0, 0);
      track(a, 'e1', 'dm');
      const emissions: (MovementEmission | null)[] = [];
      tracker.onMovement((e) => emissions.push(e));

      gesture(
        [
          [25, 25],
          [65, 25],
          [145, 25],
        ],
        () => {
          for (const frame of frames.splice(0)) frame(0);
        },
      );

      expect(emissions).toEqual([
        {
          elementId: a,
          visibility: 'dm',
          model: expect.objectContaining({
            path: [
              { x: 20, y: 20 },
              { x: 140, y: 20 },
            ],
            label: '15 ft · 15 left',
          }),
        },
        null,
      ]);
    });
  });
});
