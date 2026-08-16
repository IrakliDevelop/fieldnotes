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

/**
 * Every mutating door into `ElementStore`, plus the subscription. `PathTool` is
 * store-free by contract, so a real empty store proves nothing — a call to any
 * of these must fail the test loudly.
 */
function makeStoreSpies() {
  return {
    add: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
    loadSnapshot: vi.fn(),
    onChange: vi.fn(() => () => undefined),
  };
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
  let cancelAnimationFrameSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    rafCallbacks = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    cancelAnimationFrameSpy = vi.fn((id: number) => {
      rafCallbacks[id - 1] = () => undefined;
    });
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrameSpy);
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
    expect(cancelAnimationFrameSpy).not.toHaveBeenCalled();
    const pendingId = rafCallbacks.length;

    tool.onKeyDown(key('Escape'), ctx);
    expect(cancelAnimationFrameSpy).toHaveBeenCalledTimes(1);
    expect(cancelAnimationFrameSpy).toHaveBeenCalledWith(pendingId);

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
      commitTapRadiusPx: 12,
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
      commitTapRadiusPx: 20,
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(tool.getOptions()).toEqual({
      feetPerCell: 10,
      color: '#00FF00',
      diagonalRule: 'manhattan',
      footprint: { w: 2, h: 3 },
      rangeBands: bands,
      commitTapRadiusPx: 20,
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

  describe('commit tap radius', () => {
    /** Opens a gridless path from world (0,0) to world (100,0) at `zoom`. */
    function openGridlessLeg(tool: PathTool, ctx: ToolContext, zoom = 1): void {
      tool.onPointerDown(pt(0, 0), ctx);
      tool.onPointerMove(pt(100 * zoom, 0), ctx);
      tool.onPointerUp(pt(100 * zoom, 0), ctx);
    }

    it('commits on a tap NEAR the last waypoint on a gridless canvas', () => {
      const tool = new PathTool();
      const ctx = makeCtx({ gridSize: 0 });
      const commits: PathEmission[] = [];
      tool.onCommit((e) => commits.push(e));

      openGridlessLeg(tool, ctx);
      // 5 world px away — inside the default 12 screen-px radius at zoom 1.
      tool.onPointerDown(pt(105, 0), ctx);
      tool.onPointerUp(pt(105, 0), ctx);

      expect(commits).toHaveLength(1);
      expect(commits[0]?.waypoints).toEqual([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ]);
      expect(tool.isOpen).toBe(false);
    });

    it('adds a waypoint on a tap OUTSIDE the radius', () => {
      const tool = new PathTool();
      const ctx = makeCtx({ gridSize: 0 });
      const commits: PathEmission[] = [];
      tool.onCommit((e) => commits.push(e));

      openGridlessLeg(tool, ctx);
      tool.onPointerDown(pt(120, 0), ctx);
      tool.onPointerUp(pt(120, 0), ctx);

      expect(commits).toHaveLength(0);
      expect(tool.isOpen).toBe(true);
      expect(tool.getEmission()?.waypoints).toEqual([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 120, y: 0 },
      ]);
    });

    it('the radius is screen-space: zoom shrinks it in world units', () => {
      const camera = new Camera();
      camera.setZoom(2);
      const farTool = new PathTool();
      const farCtx = makeCtx({ gridSize: 0, camera });
      const farCommits: PathEmission[] = [];
      farTool.onCommit((e) => farCommits.push(e));

      openGridlessLeg(farTool, farCtx, 2);
      // 8 world px = 16 screen px at zoom 2 — outside 12 screen px.
      farTool.onPointerDown(pt(108 * 2, 0), farCtx);
      farTool.onPointerUp(pt(108 * 2, 0), farCtx);

      expect(farCommits).toHaveLength(0);
      expect(farTool.isOpen).toBe(true);

      const nearTool = new PathTool();
      const nearCtx = makeCtx({ gridSize: 0, camera });
      const nearCommits: PathEmission[] = [];
      nearTool.onCommit((e) => nearCommits.push(e));

      openGridlessLeg(nearTool, nearCtx, 2);
      // 5 world px = 10 screen px at zoom 2 — inside 12 screen px.
      nearTool.onPointerDown(pt(105 * 2, 0), nearCtx);
      nearTool.onPointerUp(pt(105 * 2, 0), nearCtx);

      expect(nearCommits).toHaveLength(1);
      expect(nearTool.isOpen).toBe(false);
    });

    it('an armed commit pins the cursor to the last waypoint (no rubber-banding inside the radius)', () => {
      const tool = new PathTool();
      const ctx = makeCtx({ gridSize: 0 });

      openGridlessLeg(tool, ctx);
      tool.onPointerDown(pt(105, 0), ctx);
      expect(tool.getEmission()?.cursor).toEqual({ x: 100, y: 0 });

      tool.onPointerMove(pt(103, 0), ctx);
      expect(tool.getEmission()?.cursor).toEqual({ x: 100, y: 0 });

      // Leaving the radius disarms and the cursor rubber-bands again.
      tool.onPointerMove(pt(140, 0), ctx);
      expect(tool.getEmission()?.cursor).toEqual({ x: 140, y: 0 });
      tool.onPointerUp(pt(140, 0), ctx);
      expect(tool.isOpen).toBe(true);
    });

    it('commitTapRadiusPx 0 restores exact-match-only commits', () => {
      const tool = new PathTool({ commitTapRadiusPx: 0 });
      const ctx = makeCtx({ gridSize: 0 });
      const commits: PathEmission[] = [];
      tool.onCommit((e) => commits.push(e));

      openGridlessLeg(tool, ctx);
      tool.onPointerDown(pt(105, 0), ctx);
      tool.onPointerUp(pt(105, 0), ctx);
      expect(commits).toHaveLength(0);
      expect(tool.getEmission()?.waypoints).toHaveLength(3);

      // An EXACT re-tap still commits.
      tool.onPointerDown(pt(105, 0), ctx);
      tool.onPointerUp(pt(105, 0), ctx);
      expect(commits).toHaveLength(1);
    });

    it('on a snapping grid, a tap on the ADJACENT cell centre adds a waypoint instead of committing (radius does not apply on a grid)', () => {
      const camera = new Camera();
      camera.setZoom(0.25);
      const tool = new PathTool();
      const ctx = makeCtx({ gridSize: 40, gridType: 'square', camera });
      const commits: PathEmission[] = [];
      tool.onCommit((e) => commits.push(e));

      // world (20,20) -> screen (5,5) at zoom 0.25; already a cell centre.
      tool.onPointerDown(pt(5, 5), ctx);
      // Adjacent cell centre world (60,20): 40 world units = 10 screen px at
      // zoom 0.25, inside the default 12 screen-px radius — the OLD bug (radius
      // applied unconditionally) would wrongly commit here.
      tool.onPointerDown(pt(15, 5), ctx);
      tool.onPointerUp(pt(15, 5), ctx);

      expect(commits).toHaveLength(0);
      expect(tool.isOpen).toBe(true);
      expect(tool.getEmission()?.waypoints).toEqual([
        { x: 20, y: 20 },
        { x: 60, y: 20 },
      ]);
    });

    it('on a snapping grid, tapping the SAME cell centre again still commits (exact match is unaffected)', () => {
      const camera = new Camera();
      camera.setZoom(0.25);
      const tool = new PathTool();
      const ctx = makeCtx({ gridSize: 40, gridType: 'square', camera });
      const commits: PathEmission[] = [];
      tool.onCommit((e) => commits.push(e));

      tool.onPointerDown(pt(5, 5), ctx);
      tool.onPointerDown(pt(15, 5), ctx);
      tool.onPointerUp(pt(15, 5), ctx);
      expect(tool.isOpen).toBe(true);

      // Exact re-tap on the last waypoint's cell centre.
      tool.onPointerDown(pt(15, 5), ctx);
      tool.onPointerUp(pt(15, 5), ctx);

      expect(commits).toHaveLength(1);
      expect(tool.isOpen).toBe(false);
    });

    it('gridSize 10 at zoom 1: a tap on the adjacent cell centre adds a waypoint instead of committing', () => {
      const tool = new PathTool();
      const ctx = makeCtx({ gridSize: 10, gridType: 'square' });
      const commits: PathEmission[] = [];
      tool.onCommit((e) => commits.push(e));

      // Opens at cell centre (5,5).
      tool.onPointerDown(pt(5, 5), ctx);
      // Adjacent cell centre (15,5): 10 world/screen px away at zoom 1, inside
      // the default 12 screen-px radius.
      tool.onPointerDown(pt(15, 5), ctx);
      tool.onPointerUp(pt(15, 5), ctx);

      expect(commits).toHaveLength(0);
      expect(tool.isOpen).toBe(true);
      expect(tool.getEmission()?.waypoints).toEqual([
        { x: 5, y: 5 },
        { x: 15, y: 5 },
      ]);
    });
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

  it('never touches the store, through a committed path and through a cancelled one', () => {
    const spies = makeStoreSpies();
    const tool = new PathTool({ diagonalRule: 'chebyshev' });
    const ctx = makeCtx({ store: spies as unknown as ToolContext['store'] });

    // A full gesture that COMMITS.
    drawFirstLeg(tool, ctx);
    tool.onHover(pt(220, 140), ctx);
    tool.onPointerDown(pt(220, 140), ctx);
    tool.onPointerUp(pt(220, 140), ctx);
    tool.onKeyDown(key('Enter'), ctx);
    flushRaf();
    expect(tool.isOpen).toBe(false);

    // A full gesture that is CANCELLED.
    drawFirstLeg(tool, ctx);
    tool.onHover(pt(220, 140), ctx);
    tool.onKeyDown(key('Escape'), ctx);
    flushRaf();
    expect(tool.isOpen).toBe(false);

    for (const [name, spy] of Object.entries(spies)) {
      expect(spy, `store.${name} was called`).not.toHaveBeenCalled();
    }
  });

  it('re-arms the rAF: two flushes with a move between them yield two distinct emissions', () => {
    const tool = new PathTool({ diagonalRule: 'chebyshev' });
    const ctx = makeCtx();
    const paths: (PathEmission | null)[] = [];
    tool.onPath((e) => paths.push(e));

    tool.onPointerDown(pt(60, 60), ctx);
    flushRaf();
    expect(paths).toHaveLength(1);

    tool.onPointerMove(pt(140, 60), ctx);
    flushRaf();

    // A tool that never clears `emissionRafId` would stop after the first frame.
    expect(paths).toHaveLength(2);
    expect(paths[0]?.cursor).toEqual({ x: 60, y: 60 });
    expect(paths[1]?.cursor).toEqual({ x: 140, y: 60 });
  });

  it('coalesces moves inside one frame into a single emission carrying the LAST cursor', () => {
    const tool = new PathTool({ diagonalRule: 'chebyshev' });
    const ctx = makeCtx();
    const paths: (PathEmission | null)[] = [];
    tool.onPath((e) => paths.push(e));

    tool.onPointerDown(pt(60, 60), ctx);
    flushRaf();
    paths.length = 0;

    tool.onPointerMove(pt(140, 60), ctx);
    tool.onPointerMove(pt(220, 60), ctx);
    flushRaf();

    expect(paths).toHaveLength(1);
    expect(paths[0]?.cursor).toEqual({ x: 220, y: 60 });
  });

  it('emits nothing further after a commit, even if a frame was already pending', () => {
    const tool = new PathTool({ diagonalRule: 'chebyshev' });
    const ctx = makeCtx();
    const paths: (PathEmission | null)[] = [];
    tool.onPath((e) => paths.push(e));

    drawFirstLeg(tool, ctx);
    tool.onKeyDown(key('Enter'), ctx);
    const countAfterCommit = paths.length;
    expect(paths[paths.length - 1]).toBeNull();

    flushRaf();

    expect(paths).toHaveLength(countAfterCommit);
  });

  it('resolveStart receives WORLD coordinates and the tool context', () => {
    const camera = new Camera();
    camera.moveTo(30, -50);
    camera.setZoom(2);
    const resolveStart = vi.fn(() => null);
    const tool = new PathTool({ resolveStart });
    const ctx = makeCtx({ camera });

    tool.onPointerDown(pt(150, 90), ctx);

    const expected = camera.screenToWorld({ x: 150, y: 90 });
    // Screen and world must differ, or the assertion would prove nothing.
    expect(expected).not.toEqual({ x: 150, y: 90 });
    expect(resolveStart).toHaveBeenCalledTimes(1);
    expect(resolveStart).toHaveBeenCalledWith(expected, ctx);
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

  it('captures the grid at the opening pointer-down and keeps it for the whole path, even if ctx is mutated mid-gesture', () => {
    const tool = new PathTool({ diagonalRule: 'chebyshev' });
    const ctx = makeCtx(); // snapToGrid: true, gridSize: 40, gridType: 'square'

    tool.onPointerDown(pt(55, 70), ctx);
    expect(tool.getEmission()?.waypoints).toEqual([{ x: 60, y: 60 }]);

    // Reconfigure the grid mid-gesture; the already-open path must ignore this
    // and keep measuring on the grid captured at pointer-down.
    ctx.gridSize = 100;
    ctx.gridType = undefined;

    tool.onPointerMove(pt(140, 60), ctx);
    tool.onPointerUp(pt(140, 60), ctx);

    const e = tool.getEmission();
    expect(e?.waypoints).toEqual([
      { x: 60, y: 60 },
      { x: 140, y: 60 },
    ]);
    // Chebyshev distance on the ORIGINAL 40-size grid: 80/40 = 2 cells.
    expect(e?.segments).toEqual([{ cells: 2, feet: 10 }]);
  });

  it('snaps through snapPoint (intersections) when snapToGrid is true but gridType is unset', () => {
    const tool = new PathTool();
    const ctx = makeCtx({ gridType: undefined });

    tool.onPointerDown(pt(55, 70), ctx);

    expect(tool.getEmission()?.waypoints).toEqual([{ x: 40, y: 80 }]);
  });

  it('does not snap (identity) when snapToGrid is false and gridType is unset', () => {
    const tool = new PathTool();
    const ctx = makeCtx({ snapToGrid: false, gridType: undefined });

    tool.onPointerDown(pt(55, 70), ctx);

    expect(tool.getEmission()?.waypoints).toEqual([{ x: 55, y: 70 }]);
  });
});
