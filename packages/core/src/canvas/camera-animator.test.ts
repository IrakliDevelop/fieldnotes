// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { Camera } from './camera';
import { CameraAnimator, type CameraAnimationEndReason } from './camera-animator';
import type { CameraView } from './camera-view';

const TARGET: CameraView = { x: 0, y: 0, w: 400, h: 300 };
const SIZE = { w: 800, h: 600 };

/** Deterministic frame + clock harness. */
function makeHarness(size: { w: number; h: number } = SIZE) {
  let pending: (() => void)[] = [];
  let nextId = 1;
  let clock = 0;
  const cancelled: number[] = [];
  const requestFrame = vi.fn((cb: () => void) => {
    pending.push(cb);
    return nextId++;
  });
  const cancelFrame = vi.fn((id: number) => {
    cancelled.push(id);
  });
  const element = document.createElement('div');
  const camera = new Camera();
  const current = { ...size };
  const animator = new CameraAnimator(element, camera, {
    getCanvasSize: () => ({ ...current }),
    frames: { requestFrame, cancelFrame },
    now: () => clock,
    durationMs: 400,
  });
  return {
    element,
    camera,
    animator,
    requestFrame,
    cancelFrame,
    cancelled,
    setSize: (w: number, h: number) => {
      current.w = w;
      current.h = h;
    },
    advance: (ms: number) => {
      clock += ms;
    },
    /** Runs every queued frame callback once. */
    flush: () => {
      const due = pending;
      pending = [];
      for (const cb of due) cb();
    },
    pendingCount: () => pending.length,
  };
}

function collectReasons(animator: CameraAnimator): CameraAnimationEndReason[] {
  const reasons: CameraAnimationEndReason[] = [];
  animator.onEnd((r) => reasons.push(r));
  return reasons;
}

describe('CameraAnimator construction', () => {
  it('rejects a one-sided frames pair', () => {
    const element = document.createElement('div');
    const camera = new Camera();
    const opts = { getCanvasSize: () => SIZE };
    expect(
      () =>
        new CameraAnimator(element, camera, {
          ...opts,
          frames: { requestFrame: (_cb: () => void) => 1 } as never,
        }),
    ).toThrow();
    expect(
      () =>
        new CameraAnimator(element, camera, {
          ...opts,
          frames: { cancelFrame: () => undefined } as never,
        }),
    ).toThrow();
    expect(
      () =>
        new CameraAnimator(element, camera, {
          ...opts,
          frames: { requestFrame: 1, cancelFrame: 2 } as never,
        }),
    ).toThrow();
  });
});

describe('animation to completion', () => {
  it('animates toward the target and ends with complete', () => {
    const h = makeHarness();
    const reasons = collectReasons(h.animator);
    h.animator.animateTo(TARGET);
    expect(h.animator.animating).toBe(true);

    h.advance(200);
    h.flush();
    expect(reasons).toEqual([]); // still mid-flight

    h.advance(200);
    h.flush();
    expect(reasons).toEqual(['complete']);
    expect(h.animator.animating).toBe(false);

    const framed = h.camera.getVisibleRect(SIZE.w, SIZE.h);
    expect(framed.x + framed.w / 2).toBeCloseTo(TARGET.x + TARGET.w / 2, 4);
    expect(framed.y + framed.h / 2).toBeCloseTo(TARGET.y + TARGET.h / 2, 4);
  });

  it('emits exactly one reason per animation', () => {
    const h = makeHarness();
    const reasons = collectReasons(h.animator);
    h.animator.animateTo(TARGET);
    h.advance(1000);
    h.flush();
    h.flush(); // extra flush must not re-emit
    expect(reasons).toEqual(['complete']);
  });

  it('an already-framed target completes synchronously with no frames', () => {
    const h = makeHarness();
    h.animator.jumpTo(TARGET);
    const reasons = collectReasons(h.animator);
    h.requestFrame.mockClear();
    h.animator.animateTo(TARGET);
    expect(reasons).toEqual(['complete']);
    expect(h.requestFrame).not.toHaveBeenCalled();
  });

  it('retargeting mid-flight supersedes rather than cancels', () => {
    const h = makeHarness();
    const reasons = collectReasons(h.animator);
    h.animator.animateTo(TARGET);
    h.advance(100);
    h.flush();
    h.animator.animateTo({ x: 900, y: 900, w: 200, h: 150 });
    expect(reasons).toEqual(['superseded']);
    expect(h.animator.animating).toBe(true);
  });

  it('jumpTo writes once and schedules no frames', () => {
    const h = makeHarness();
    h.requestFrame.mockClear();
    h.animator.jumpTo(TARGET);
    expect(h.requestFrame).not.toHaveBeenCalled();
    expect(h.animator.animating).toBe(false);
    const framed = h.camera.getVisibleRect(SIZE.w, SIZE.h);
    expect(framed.x + framed.w / 2).toBeCloseTo(TARGET.x + TARGET.w / 2, 4);
  });

  it('jumpTo mid-flight supersedes the running animation', () => {
    const h = makeHarness();
    const reasons = collectReasons(h.animator);
    h.animator.animateTo(TARGET);
    h.animator.jumpTo({ x: 10, y: 10, w: 100, h: 75 });
    expect(reasons).toEqual(['superseded']);
    expect(h.animator.animating).toBe(false);
  });

  it('cancel with nothing in flight emits nothing', () => {
    const h = makeHarness();
    const reasons = collectReasons(h.animator);
    h.animator.cancel();
    h.animator.jumpTo(TARGET);
    expect(reasons).toEqual([]);
  });

  it('isolates a throwing onEnd listener and still runs later listeners', () => {
    const h = makeHarness();
    const seen: string[] = [];
    h.animator.onEnd(() => {
      throw new Error('boom');
    });
    h.animator.onEnd(() => seen.push('second'));
    h.animator.animateTo(TARGET);
    h.advance(1000);
    expect(() => h.flush()).not.toThrow();
    expect(seen).toEqual(['second']);
  });
});

describe('re-entrancy from a superseded listener', () => {
  it('animateTo does not overwrite an animation started during its own supersede', () => {
    const h = makeHarness();
    const NESTED: CameraView = { x: 5000, y: 5000, w: 100, h: 75 };
    const reasons: CameraAnimationEndReason[] = [];
    h.animator.onEnd((r) => {
      reasons.push(r);
      if (r === 'superseded' && reasons.length === 1) {
        h.animator.animateTo(NESTED); // nested op takes ownership
      }
    });

    h.animator.animateTo(TARGET);
    h.animator.animateTo({ x: 900, y: 900, w: 200, h: 150 }); // outer; supersedes

    // The nested animation must own the animator; the outer call must NOT
    // silently overwrite it (which would leave the nested one with no reason).
    h.advance(1000);
    h.flush();
    expect(reasons).toEqual(['superseded', 'complete']);

    const framed = h.camera.getVisibleRect(SIZE.w, SIZE.h);
    expect(framed.x + framed.w / 2).toBeCloseTo(NESTED.x + NESTED.w / 2, 3);
  });

  it('jumpTo does not overwrite an animation started during its own supersede', () => {
    const h = makeHarness();
    const NESTED: CameraView = { x: 5000, y: 5000, w: 100, h: 75 };
    const reasons: CameraAnimationEndReason[] = [];
    h.animator.onEnd((r) => {
      reasons.push(r);
      if (r === 'superseded' && reasons.length === 1) {
        h.animator.animateTo(NESTED);
      }
    });

    h.animator.animateTo(TARGET);
    h.animator.jumpTo({ x: 10, y: 10, w: 100, h: 75 }); // outer jump supersedes

    // The nested animation is still running — the jump must not have written
    // over it, and it must still reach its own end reason.
    expect(h.animator.animating).toBe(true);
    h.advance(1000);
    h.flush();
    expect(reasons).toEqual(['superseded', 'complete']);
  });

  it('every started operation reports exactly one reason under nesting', () => {
    const h = makeHarness();
    const reasons: CameraAnimationEndReason[] = [];
    let nested = 0;
    h.animator.onEnd((r) => {
      reasons.push(r);
      if (r === 'superseded' && nested === 0) {
        nested++;
        h.animator.animateTo({ x: 5000, y: 5000, w: 100, h: 75 });
      }
    });
    h.animator.animateTo(TARGET);
    h.animator.animateTo({ x: 900, y: 900, w: 200, h: 150 });
    h.advance(1000);
    h.flush();
    // 2 animations actually started (outer TARGET, nested) -> 2 reasons.
    expect(reasons).toHaveLength(2);
  });
});

describe('target validation ordering', () => {
  const BAD: CameraView = { x: 0, y: 0, w: 0, h: 100 };

  it('animateTo throws synchronously and schedules nothing when idle', () => {
    const h = makeHarness();
    h.requestFrame.mockClear();
    expect(() => h.animator.animateTo(BAD)).toThrow();
    expect(h.requestFrame).not.toHaveBeenCalled();
    expect(h.animator.animating).toBe(false);
  });

  it('an invalid animateTo during an active animation leaves it untouched', () => {
    const h = makeHarness();
    const reasons = collectReasons(h.animator);
    h.animator.animateTo(TARGET);
    h.advance(100);
    h.flush();

    expect(() => h.animator.animateTo(BAD)).toThrow();
    expect(reasons).toEqual([]); // NOT 'superseded'
    expect(h.animator.animating).toBe(true);

    h.advance(1000);
    h.flush();
    expect(reasons).toEqual(['complete']); // original still completes
  });

  it('an invalid jumpTo during an active animation leaves it untouched', () => {
    const h = makeHarness();
    const reasons = collectReasons(h.animator);
    h.animator.animateTo(TARGET);
    expect(() => h.animator.jumpTo(BAD)).toThrow();
    expect(reasons).toEqual([]);
    expect(h.animator.animating).toBe(true);
  });
});
