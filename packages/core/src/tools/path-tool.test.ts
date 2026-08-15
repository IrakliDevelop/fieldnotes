// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PathTool } from './path-tool';
import type { PathEmission } from './path-tool';
import { ElementStore } from '../elements/element-store';
import { Camera } from '../canvas/camera';
import { snapToCellCenter, snapToHexCenter } from '../core/snap';
import { getHexDistance } from '../elements/hex-fill';
import type { ToolContext, PointerState } from './types';

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    camera: new Camera(),
    store: new ElementStore(),
    requestRender: vi.fn(),
    snapToGrid: true,
    gridSize: 40,
    gridType: 'square',
    ...overrides,
  };
}

function pt(x: number, y: number): PointerState {
  return { x, y, pressure: 0.5, pointerType: 'mouse', shiftKey: false };
}

function key(k: string): KeyboardEvent {
  return new KeyboardEvent('keydown', { key: k });
}

/** Recording call shape: [method-or-property, ...args-or-value]. */
type Call = [string, ...unknown[]];

/**
 * jsdom provides no real 2D context; a recording stub is enough — the
 * pixel-level contract lives in `path-render.test.ts` (copied from there so
 * property sets are ordered, not just final values).
 */
function makeRecordingCanvas(): CanvasRenderingContext2D & { calls: Call[] } {
  const calls: Call[] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
    };
  return {
    calls,
    save: vi.fn(record('save')),
    restore: vi.fn(record('restore')),
    beginPath: vi.fn(record('beginPath')),
    moveTo: vi.fn(record('moveTo')),
    lineTo: vi.fn(record('lineTo')),
    stroke: vi.fn(record('stroke')),
    arc: vi.fn(record('arc')),
    fill: vi.fn(record('fill')),
    setLineDash: vi.fn(record('setLineDash')),
    roundRect: vi.fn(record('roundRect')),
    fillText: vi.fn(record('fillText')),
    measureText: vi.fn(() => ({ width: 40 })),
    set strokeStyle(v: string) {
      calls.push(['strokeStyle', v]);
    },
    set fillStyle(v: string) {
      calls.push(['fillStyle', v]);
    },
    set globalAlpha(v: number) {
      calls.push(['globalAlpha', v]);
    },
    set lineWidth(v: number) {
      calls.push(['lineWidth', v]);
    },
    set font(v: string) {
      calls.push(['font', v]);
    },
    set textAlign(v: string) {
      calls.push(['textAlign', v]);
    },
    set textBaseline(v: string) {
      calls.push(['textBaseline', v]);
    },
  } as unknown as CanvasRenderingContext2D & { calls: Call[] };
}

describe('PathTool', () => {
  let rafCallbacks: FrameRequestCallback[];
  beforeEach(() => {
    rafCallbacks = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      rafCallbacks[id - 1] = () => undefined;
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const flushRaf = () => {
    const pending = rafCallbacks.splice(0);
    for (const cb of pending) cb(0);
  };

  /** (60,60) → (140,60): one committed waypoint pair, path still open. */
  function drawFirstLeg(tool: PathTool, ctx: ToolContext): void {
    tool.onPointerDown(pt(60, 60), ctx);
    tool.onPointerMove(pt(140, 60), ctx);
    tool.onPointerUp(pt(140, 60), ctx);
  }

  it('has name "path"', () => {
    expect(new PathTool().name).toBe('path');
  });

  it('pointer down opens a path at the snapped cell centre and emits on the next frame', () => {
    const tool = new PathTool({ diagonalRule: 'chebyshev' });
    const ctx = makeCtx();
    const emissions: (PathEmission | null)[] = [];
    tool.onPath((e) => emissions.push(e));

    tool.onPointerDown(pt(55, 70), ctx);
    expect(emissions).toHaveLength(0);
    flushRaf();

    const last = emissions[emissions.length - 1];
    expect(last?.waypoints).toEqual([{ x: 60, y: 60 }]);
    expect(last?.cursor).toEqual({ x: 60, y: 60 });
    expect(last?.totalCells).toBe(0);
    expect(last?.segments).toEqual([]);
    expect(tool.isOpen).toBe(true);
  });

  it('drag then release adds a waypoint; the path stays open', () => {
    const tool = new PathTool({ diagonalRule: 'chebyshev' });
    const ctx = makeCtx();

    drawFirstLeg(tool, ctx);

    expect(tool.getEmission()?.waypoints).toEqual([
      { x: 60, y: 60 },
      { x: 140, y: 60 },
    ]);
    expect(tool.isOpen).toBe(true);
    expect(tool.getEmission()?.segments).toEqual([{ cells: 2, feet: 10 }]);
    expect(tool.getEmission()?.totalCells).toBe(2);
  });

  it('hover after release rubber-bands from the last waypoint (cursor counted in totals, not in waypoints)', () => {
    const tool = new PathTool({ diagonalRule: 'chebyshev' });
    const ctx = makeCtx();

    drawFirstLeg(tool, ctx);
    tool.onHover(pt(220, 140), ctx);

    const e = tool.getEmission();
    expect(e?.cursor).toEqual({ x: 220, y: 140 });
    expect(e?.waypoints).toHaveLength(2);
    expect(e?.totalCells).toBe(4);
    expect(e?.segments).toHaveLength(2);
  });

  it('click adds the hovered point as a waypoint', () => {
    const tool = new PathTool({ diagonalRule: 'chebyshev' });
    const ctx = makeCtx();

    drawFirstLeg(tool, ctx);
    tool.onHover(pt(220, 140), ctx);
    tool.onPointerDown(pt(220, 140), ctx);
    tool.onPointerUp(pt(220, 140), ctx);

    expect(tool.getEmission()?.waypoints).toHaveLength(3);
    expect(tool.isOpen).toBe(true);
  });

  it('tapping the last waypoint commits: onCommit once with cursor null, then a sync null path emission, and the path closes', () => {
    const tool = new PathTool({ diagonalRule: 'chebyshev' });
    const ctx = makeCtx();
    const log: string[] = [];
    const commits: PathEmission[] = [];
    const paths: (PathEmission | null)[] = [];
    tool.onCommit((e) => {
      commits.push(e);
      log.push('commit');
    });
    tool.onPath((e) => {
      paths.push(e);
      log.push(e === null ? 'clear' : 'path');
    });

    drawFirstLeg(tool, ctx);
    tool.onHover(pt(220, 140), ctx);
    tool.onPointerDown(pt(220, 140), ctx);
    tool.onPointerUp(pt(220, 140), ctx);
    flushRaf();

    // Tap the last waypoint again → commit.
    tool.onPointerDown(pt(220, 140), ctx);
    tool.onPointerUp(pt(220, 140), ctx);

    expect(commits).toHaveLength(1);
    expect(commits[0]?.waypoints).toHaveLength(3);
    expect(commits[0]?.cursor).toBeNull();
    expect(commits[0]?.totalCells).toBe(4);
    expect(paths[paths.length - 1]).toBeNull();
    expect(tool.isOpen).toBe(false);
    expect(tool.getEmission()).toBeNull();
    // commit is notified BEFORE the path listeners are cleared.
    expect(log.slice(-2)).toEqual(['commit', 'clear']);
  });

  it('Enter commits, Escape cancels; both return true only while a path is open', () => {
    const tool = new PathTool({ diagonalRule: 'chebyshev' });
    const ctx = makeCtx();
    const commits: PathEmission[] = [];
    const paths: (PathEmission | null)[] = [];
    tool.onCommit((e) => commits.push(e));
    tool.onPath((e) => paths.push(e));

    expect(tool.onKeyDown(key('Enter'), ctx)).toBe(false);
    expect(tool.onKeyDown(key('Escape'), ctx)).toBe(false);

    drawFirstLeg(tool, ctx);
    expect(tool.onKeyDown(key('Enter'), ctx)).toBe(true);
    expect(commits).toHaveLength(1);
    expect(tool.isOpen).toBe(false);

    tool.onPointerDown(pt(60, 60), ctx);
    expect(tool.onKeyDown(key('Escape'), ctx)).toBe(true);
    expect(commits).toHaveLength(1);
    expect(paths[paths.length - 1]).toBeNull();
    expect(tool.isOpen).toBe(false);

    // An unrelated key is never consumed, open or not.
    tool.onPointerDown(pt(60, 60), ctx);
    expect(tool.onKeyDown(key('a'), ctx)).toBe(false);
    expect(tool.isOpen).toBe(true);
  });

  it('Enter with fewer than two waypoints cancels instead of committing', () => {
    const tool = new PathTool();
    const ctx = makeCtx();
    const commits: PathEmission[] = [];
    const paths: (PathEmission | null)[] = [];
    tool.onCommit((e) => commits.push(e));
    tool.onPath((e) => paths.push(e));

    tool.onPointerDown(pt(60, 60), ctx);
    expect(tool.onKeyDown(key('Enter'), ctx)).toBe(true);

    expect(commits).toHaveLength(0);
    expect(paths[paths.length - 1]).toBeNull();
    expect(tool.isOpen).toBe(false);
    expect(tool.getEmission()).toBeNull();
  });

  it('onPointerCancel cancels (pinch takeover), never adds a waypoint or commits', () => {
    const tool = new PathTool({ diagonalRule: 'chebyshev' });
    const ctx = makeCtx();
    const commits: PathEmission[] = [];
    const paths: (PathEmission | null)[] = [];
    tool.onCommit((e) => commits.push(e));
    tool.onPath((e) => paths.push(e));

    tool.onPointerDown(pt(60, 60), ctx);
    tool.onPointerMove(pt(140, 60), ctx);
    tool.onPointerCancel(pt(140, 60), ctx);

    expect(tool.getEmission()).toBeNull();
    expect(tool.isOpen).toBe(false);
    expect(commits).toHaveLength(0);
    expect(paths[paths.length - 1]).toBeNull();
  });

  it('onDeactivate cancels', () => {
    const tool = new PathTool({ diagonalRule: 'chebyshev' });
    const ctx = makeCtx();
    const paths: (PathEmission | null)[] = [];
    tool.onPath((e) => paths.push(e));

    drawFirstLeg(tool, ctx);
    expect(tool.isOpen).toBe(true);

    tool.onDeactivate(ctx);
    expect(tool.isOpen).toBe(false);
    expect(tool.getEmission()).toBeNull();
    expect(paths[paths.length - 1]).toBeNull();
  });

  it('resolveStart null vetoes the gesture entirely', () => {
    const tool = new PathTool({ resolveStart: () => null });
    const ctx = makeCtx();
    const paths: (PathEmission | null)[] = [];
    tool.onPath((e) => paths.push(e));

    tool.onPointerDown(pt(55, 70), ctx);
    tool.onPointerMove(pt(140, 60), ctx);
    tool.onPointerUp(pt(140, 60), ctx);
    flushRaf();

    expect(tool.isOpen).toBe(false);
    expect(paths).toHaveLength(0);
    expect(ctx.requestRender).not.toHaveBeenCalled();
  });

  it('resolveStart origin, footprint, and anchorKey are honoured and anchorKey is echoed on every emission and the commit', () => {
    let calls = 0;
    const tool = new PathTool({
      diagonalRule: 'chebyshev',
      resolveStart: () =>
        calls++ === 0
          ? { origin: { x: 100, y: 100 }, footprint: 2, anchorKey: 'tok-1' }
          : { origin: { x: 100, y: 100 } },
    });
    const ctx = makeCtx();
    const paths: (PathEmission | null)[] = [];
    const commits: PathEmission[] = [];
    tool.onPath((e) => paths.push(e));
    tool.onCommit((e) => commits.push(e));

    // An even footprint snaps to intersections, not cell centres.
    tool.onPointerDown(pt(55, 70), ctx);
    expect(tool.getEmission()?.waypoints[0]).toEqual(snapToCellCenter({ x: 100, y: 100 }, 40, 2));
    expect(tool.getEmission()?.waypoints[0]).toEqual({ x: 120, y: 120 });
    flushRaf();
    expect(paths[paths.length - 1]?.anchorKey).toBe('tok-1');

    tool.onPointerMove(pt(200, 200), ctx);
    tool.onPointerUp(pt(200, 200), ctx);
    flushRaf();
    expect(tool.getEmission()?.waypoints[1]).toEqual({ x: 200, y: 200 });
    expect(paths[paths.length - 1]?.anchorKey).toBe('tok-1');

    tool.onPointerDown(pt(200, 200), ctx);
    tool.onPointerUp(pt(200, 200), ctx);
    expect(commits).toHaveLength(1);
    expect(commits[0]?.anchorKey).toBe('tok-1');
    expect(paths.every((e) => e === null || e.anchorKey === 'tok-1')).toBe(true);

    // The next path carries no anchorKey — nothing leaks across gestures.
    tool.onPointerDown(pt(55, 70), ctx);
    expect(tool.getEmission()?.anchorKey).toBeUndefined();
  });

  it('no rAF is scheduled with zero listeners', () => {
    const tool = new PathTool();
    const ctx = makeCtx();

    tool.onPointerDown(pt(60, 60), ctx);
    tool.onPointerMove(pt(140, 60), ctx);

    expect(rafCallbacks).toHaveLength(0);
  });

  it('a sync clear cancels a pending rAF (no stale emission after cancel)', () => {
    const tool = new PathTool();
    const ctx = makeCtx();
    const paths: (PathEmission | null)[] = [];
    tool.onPath((e) => paths.push(e));

    tool.onPointerDown(pt(60, 60), ctx);
    tool.onKeyDown(key('Escape'), ctx);
    flushRaf();

    expect(paths).toEqual([null]);
  });

  it('throwing listeners are isolated', () => {
    const tool = new PathTool();
    const ctx = makeCtx();
    const seenPaths: (PathEmission | null)[] = [];
    const seenCommits: PathEmission[] = [];
    tool.onPath(() => {
      throw new Error('boom');
    });
    tool.onPath((e) => seenPaths.push(e));
    tool.onCommit(() => {
      throw new Error('boom');
    });
    tool.onCommit((e) => seenCommits.push(e));

    drawFirstLeg(tool, ctx);
    flushRaf();
    expect(seenPaths).toHaveLength(1);

    tool.onKeyDown(key('Enter'), ctx);
    expect(seenCommits).toHaveLength(1);
    expect(seenPaths[seenPaths.length - 1]).toBeNull();
  });

  it('hex grids snap to hex centres and use hex distance', () => {
    const tool = new PathTool({ diagonalRule: 'chebyshev' });
    const ctx = makeCtx({ gridType: 'hex', hexOrientation: 'pointy' });

    tool.onPointerDown(pt(0, 0), ctx);
    tool.onPointerMove(pt(200, 120), ctx);
    tool.onPointerUp(pt(200, 120), ctx);

    const e = tool.getEmission();
    const w0 = e?.waypoints[0];
    const w1 = e?.waypoints[1];
    expect(w0).toEqual(snapToHexCenter({ x: 0, y: 0 }, 40, 'pointy'));
    expect(w1).toEqual(snapToHexCenter({ x: 200, y: 120 }, 40, 'pointy'));
    expect(w0).toBeDefined();
    expect(w1).toBeDefined();
    if (!w0 || !w1) throw new Error('unreachable');
    expect(e?.segments[0]?.cells).toBe(getHexDistance(w0, w1, 40, 'pointy'));
    expect(e?.segments[0]?.cells).toBeGreaterThan(0);
  });

  it('range bands colour segments by running total in renderOverlay', () => {
    const tool = new PathTool({
      diagonalRule: 'chebyshev',
      rangeBands: [{ feet: 10, color: 'green' }],
    });
    const ctx = makeCtx();

    tool.onPointerDown(pt(60, 60), ctx);
    tool.onPointerMove(pt(140, 60), ctx);
    tool.onPointerUp(pt(140, 60), ctx);
    tool.onHover(pt(220, 60), ctx);
    tool.onPointerDown(pt(220, 60), ctx);
    tool.onPointerUp(pt(220, 60), ctx);

    expect(tool.getEmission()?.segments).toEqual([
      { cells: 2, feet: 10 },
      { cells: 2, feet: 10 },
    ]);

    const canvas = makeRecordingCanvas();
    tool.renderOverlay(canvas);

    const strokeColours = canvas.calls.filter((c) => c[0] === 'strokeStyle').map((c) => c[1]);
    expect(strokeColours).toEqual(['green', '#FF5722']);
  });

  it('renderOverlay draws nothing when no path is open', () => {
    const tool = new PathTool();
    const canvas = makeRecordingCanvas();

    tool.renderOverlay(canvas);

    expect(canvas.calls).toHaveLength(0);
  });

  it('getOptions/setOptions round-trip and notify', () => {
    const tool = new PathTool();
    expect(tool.getOptions()).toEqual({
      feetPerCell: 5,
      color: '#FF5722',
      diagonalRule: 'euclidean',
      footprint: 1,
      rangeBands: [],
    });

    const listener = vi.fn();
    tool.onOptionsChange(listener);
    const bands = [{ feet: 30, color: 'green' }];
    tool.setOptions({
      feetPerCell: 10,
      color: '#00FF00',
      diagonalRule: 'manhattan',
      footprint: { w: 2, h: 3 },
      rangeBands: bands,
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(tool.getOptions()).toEqual({
      feetPerCell: 10,
      color: '#00FF00',
      diagonalRule: 'manhattan',
      footprint: { w: 2, h: 3 },
      rangeBands: bands,
    });

    const unsubscribed = vi.fn();
    tool.onOptionsChange(unsubscribed)();
    tool.setOptions({ color: '#123456' });
    expect(unsubscribed).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(tool.getOptions().color).toBe('#123456');
  });

  it('diagonalRule alternate is applied over the whole path', () => {
    const tool = new PathTool({ diagonalRule: 'alternate' });
    const ctx = makeCtx();

    tool.onPointerDown(pt(60, 60), ctx);
    tool.onPointerMove(pt(100, 100), ctx);
    tool.onPointerUp(pt(100, 100), ctx);
    tool.onHover(pt(140, 140), ctx);
    tool.onPointerDown(pt(140, 140), ctx);
    tool.onPointerUp(pt(140, 140), ctx);

    const e = tool.getEmission();
    expect(e?.waypoints).toEqual([
      { x: 60, y: 60 },
      { x: 100, y: 100 },
      { x: 140, y: 140 },
    ]);
    expect(e?.segments.map((s) => s.cells)).toEqual([1, 2]);
    expect(e?.totalCells).toBe(3);
  });

  it('dragging away from the last waypoint adds a waypoint instead of committing', () => {
    const tool = new PathTool({ diagonalRule: 'chebyshev' });
    const ctx = makeCtx();
    const commits: PathEmission[] = [];
    tool.onCommit((e) => commits.push(e));

    drawFirstLeg(tool, ctx);

    // Press ON the last waypoint (which would commit on a tap), then drag away.
    tool.onPointerDown(pt(140, 60), ctx);
    tool.onPointerMove(pt(220, 60), ctx);
    tool.onPointerUp(pt(220, 60), ctx);

    expect(commits).toHaveLength(0);
    expect(tool.isOpen).toBe(true);
    expect(tool.getEmission()?.waypoints).toEqual([
      { x: 60, y: 60 },
      { x: 140, y: 60 },
      { x: 220, y: 60 },
    ]);
  });

  it('hover is ignored while a pointer is down and while no path is open', () => {
    const tool = new PathTool({ diagonalRule: 'chebyshev' });
    const ctx = makeCtx();

    tool.onHover(pt(220, 140), ctx);
    expect(tool.getEmission()).toBeNull();

    tool.onPointerDown(pt(60, 60), ctx);
    tool.onHover(pt(220, 140), ctx);
    expect(tool.getEmission()?.cursor).toEqual({ x: 60, y: 60 });
  });

  it('never touches the store', () => {
    const tool = new PathTool({ diagonalRule: 'chebyshev' });
    const ctx = makeCtx();

    drawFirstLeg(tool, ctx);
    tool.onHover(pt(220, 140), ctx);
    tool.onPointerDown(pt(220, 140), ctx);
    tool.onPointerUp(pt(220, 140), ctx);
    tool.onKeyDown(key('Enter'), ctx);

    expect(ctx.store.getAll()).toHaveLength(0);
  });

  it('does not snap without a grid size', () => {
    const tool = new PathTool();
    const ctx = makeCtx({ gridSize: 0 });

    tool.onPointerDown(pt(13, 17), ctx);
    tool.onPointerMove(pt(113, 117), ctx);

    const e = tool.getEmission();
    expect(e?.waypoints).toEqual([{ x: 13, y: 17 }]);
    expect(e?.cursor).toEqual({ x: 113, y: 117 });
    expect(Number.isFinite(e?.totalCells)).toBe(true);
  });
});
