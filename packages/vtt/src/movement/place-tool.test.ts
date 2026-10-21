import { describe, it, expect, afterEach } from 'vitest';
import { ElementRegistry, SelectTool, Viewport, createShape } from '@fieldnotes/core';
import type { PointerState } from '@fieldnotes/core';
import { registerVttElementTypes } from '../register';
import { GridController } from '../grid/grid-controller';
import { MovementTracker } from './movement-tracker';
import type { MovementKind } from './movement-types';

const MISTY_STEP: MovementKind = {
  id: 'misty-step',
  label: 'Misty Step',
  counts: false,
  maxFeet: 30,
};
const WALK: MovementKind = { id: 'walk', counts: true };
const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
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
    set: (t, name: string, value: unknown) => {
      if (name === 'lineWidth') calls.push(['lineWidth', value]);
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

function setup() {
  const registry = new ElementRegistry();
  registerVttElementTypes(registry);
  const vp = new Viewport(document.createElement('div'), {
    elementRegistry: registry,
    tools: [new SelectTool()],
  });
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
  vp.setTool('select');
  const tracker = new MovementTracker(vp);
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

  // Mirrors InputHandler: one history transaction from pointerdown to pointerup.
  const gesture = (
    points: readonly [number, number][],
    pointerType: PointerState['pointerType'] = 'mouse',
  ): void => {
    const [first, ...moves] = points;
    if (first === undefined) throw new Error('empty gesture');
    const pt = (x: number, y: number): PointerState => ({
      x,
      y,
      pressure: 0.5,
      pointerType,
      shiftKey: false,
    });
    const ctx = vp.toolContext;
    vp.historyRecorder.begin();
    vp.toolManager.handlePointerDown(pt(...first), ctx);
    for (const p of moves) vp.toolManager.handlePointerMove(pt(...p), ctx);
    vp.toolManager.handlePointerUp(pt(...(moves.at(-1) ?? first)), ctx);
    vp.historyRecorder.commit();
  };
  const click = (x: number, y: number, pointerType: PointerState['pointerType'] = 'mouse') =>
    gesture([[x, y]], pointerType);

  const key = (key: string): boolean =>
    vp.toolManager.activeTool?.onKeyDown?.(new KeyboardEvent('keydown', { key }), vp.toolContext) ??
    false;

  const toolName = () => vp.toolManager.activeTool?.name;
  const record = (id: string) => vp.store.getById(`vtt-movement:${id}`);
  const position = (id: string) => vp.store.getById(id)?.position;
  const track = (id: string) => tracker.track(id, { epoch: 'e1', bands: [], visibility: 'all' });
  const ends: { elementId: string; kind: MovementKind; placed: boolean }[] = [];
  tracker.onPlacementEnd((result) => ends.push(result));

  return {
    vp,
    tracker,
    select,
    token,
    gesture,
    click,
    key,
    toolName,
    record,
    position,
    track,
    ends,
  };
}

describe('MovementTracker placement', () => {
  it('in-range click moves the element, keeps feet, and starts a new trail run', () => {
    const { tracker, token, gesture, click, toolName, record, position, track, ends } = setup();
    const a = token(0, 0);
    track(a);
    gesture([
      [25, 25],
      [145, 25],
    ]);

    expect(tracker.startPlacement(a, MISTY_STEP)).toBe(true);
    expect(toolName()).toBe('vtt-place');
    click(285, 105);

    expect(position(a)).toEqual({ x: 280, y: 80 });
    expect(tracker.getMovement(a)?.feet).toBe(15);
    expect(record(a)).toMatchObject({
      data: {
        feet: 15,
        diagonals: 0,
        trail: [
          [
            { x: 20, y: 20 },
            { x: 140, y: 20 },
          ],
          [{ x: 300, y: 100 }],
        ],
      },
    });
    expect(toolName()).toBe('select');
    expect(ends).toEqual([{ elementId: a, kind: MISTY_STEP, placed: true }]);
  });

  it('out-of-range click does nothing and the tool stays active', () => {
    const { vp, tracker, token, click, toolName, position, track, ends } = setup();
    const a = token(0, 0);
    track(a);
    tracker.startPlacement(a, MISTY_STEP);
    const before = vp.store.getAll();

    click(305, 25);

    expect(position(a)).toEqual({ x: 0, y: 0 });
    expect(vp.store.getAll()).toEqual(before);
    expect(toolName()).toBe('vtt-place');
    expect(ends).toEqual([]);
  });

  it('counts:true adds the straight grid distance', () => {
    const { tracker, token, click, record, track } = setup();
    const a = token(0, 0);
    track(a);
    tracker.startPlacement(a, WALK);

    click(185, 105);

    expect(tracker.getMovement(a)?.feet).toBe(20);
    expect(record(a)).toMatchObject({
      data: {
        trail: [
          [
            { x: 20, y: 20 },
            { x: 180, y: 100 },
          ],
        ],
      },
    });
  });

  it('Escape restores the previous tool and selection without a store change', () => {
    const { vp, tracker, select, token, key, toolName, track, ends } = setup();
    const a = token(0, 0);
    track(a);
    select.setSelection([a]);
    const before = vp.store.getAll();
    tracker.startPlacement(a, MISTY_STEP);

    expect(key('Escape')).toBe(true);

    expect(toolName()).toBe('select');
    expect(select.selectedIds).toEqual([a]);
    expect(vp.store.getAll()).toEqual(before);
    expect(ends).toEqual([{ elementId: a, kind: MISTY_STEP, placed: false }]);
  });

  it('cancelPlacement ends the placement like Escape', () => {
    const { tracker, token, toolName, ends } = setup();
    const a = token(0, 0);
    tracker.startPlacement(a, MISTY_STEP);

    tracker.cancelPlacement();

    expect(toolName()).toBe('select');
    expect(ends).toEqual([{ elementId: a, kind: MISTY_STEP, placed: false }]);
  });

  it('a placement restores the selection that was active before it', () => {
    const { tracker, select, token, click } = setup();
    const a = token(0, 0);
    select.setSelection([a]);
    tracker.startPlacement(a, MISTY_STEP);

    click(105, 25);

    expect(select.selectedIds).toEqual([a]);
  });

  it('one undo reverts the placement and its record', () => {
    const { vp, tracker, token, gesture, click, position, track } = setup();
    const a = token(0, 0);
    track(a);
    gesture([
      [25, 25],
      [145, 25],
    ]);
    tracker.startPlacement(a, WALK);
    click(145, 105);
    expect(tracker.getMovement(a)?.feet).toBe(25);

    vp.undo();

    expect(position(a)).toEqual({ x: 120, y: 0 });
    expect(tracker.getMovement(a)?.feet).toBe(15);
  });

  it('untracked element placement moves it without creating a record', () => {
    const { tracker, token, click, record, position } = setup();
    const a = token(0, 0);
    tracker.startPlacement(a, MISTY_STEP);

    click(105, 25);

    expect(position(a)).toEqual({ x: 80, y: 0 });
    expect(record(a)).toBeUndefined();
  });

  it('touch tap places', () => {
    const { tracker, token, click, position, track } = setup();
    const a = token(0, 0);
    track(a);
    tracker.startPlacement(a, MISTY_STEP);

    click(105, 25, 'touch');

    expect(position(a)).toEqual({ x: 80, y: 0 });
    expect(tracker.getMovement(a)?.feet).toBe(0);
  });

  it('refuses a missing or locked element', () => {
    const { tracker, token, toolName } = setup();

    expect(tracker.startPlacement('missing', MISTY_STEP)).toBe(false);
    expect(tracker.startPlacement(token(0, 0, true), MISTY_STEP)).toBe(false);
    expect(toolName()).toBe('select');
  });

  it('draws a 2 CSS px range ring around the element and the hint near the pointer', () => {
    const { vp, tracker, token } = setup();
    const a = token(0, 0);
    tracker.startPlacement(a, MISTY_STEP);
    vp.toolManager.activeTool?.onHover?.(
      { x: 105, y: 65, pressure: 0, pointerType: 'mouse', shiftKey: false },
      vp.toolContext,
    );
    const { ctx, calls } = recordingCtx();

    vp.toolManager.activeTool?.renderOverlay?.(ctx);

    expect(calls).toContainEqual(['arc', 20, 20, 240, 0, Math.PI * 2]);
    expect(calls).toContainEqual(['lineWidth', 2]);
    expect(calls).toContainEqual(['fillText', 'Click where to appear', 105, expect.any(Number)]);
  });
});
