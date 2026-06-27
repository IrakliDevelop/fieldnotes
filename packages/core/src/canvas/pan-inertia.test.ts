import { describe, it, expect } from 'vitest';
import { PanInertia } from './pan-inertia';

function makeHarness(enabled = true) {
  let t = 0;
  const frames: (() => void)[] = [];
  const panCalls: [number, number][] = [];
  let cancelled = 0;
  const inertia = new PanInertia({
    pan: (dx, dy) => panCalls.push([dx, dy]),
    now: () => t,
    requestFrame: (cb) => {
      frames.push(cb);
      return frames.length;
    },
    cancelFrame: () => {
      cancelled++;
    },
    enabled: () => enabled,
  });
  return {
    inertia,
    panCalls,
    advance: (ms: number) => {
      t += ms;
    },
    sampleMove: (dx: number, dy: number, dt = 16) => {
      t += dt;
      inertia.sample(dx, dy);
    },
    flushOne: () => {
      const cb = frames.shift();
      if (cb) cb();
    },
    flushAll: () => {
      let g = 0;
      while (frames.length && g++ < 2000) {
        const cb = frames.shift();
        if (cb) cb();
      }
    },
    pending: () => frames.length,
    cancelled: () => cancelled,
  };
}

describe('PanInertia', () => {
  it('flick coasts and decays with friction', () => {
    const h = makeHarness();
    h.sampleMove(10, 0);
    h.sampleMove(10, 0);
    h.sampleMove(10, 0);
    h.sampleMove(10, 0);
    h.inertia.release();
    h.flushAll();

    expect(h.panCalls.length).toBeGreaterThan(1);
    expect(h.panCalls.length).toBeLessThanOrEqual(80);
    expect(h.panCalls[0]?.[0]).toBeCloseTo(10);
    expect(h.panCalls[0]?.[1]).toBe(0);

    for (let i = 1; i < h.panCalls.length; i++) {
      const prevX = h.panCalls[i - 1]?.[0] ?? 0;
      const curX = h.panCalls[i]?.[0] ?? 0;
      expect(curX).toBeCloseTo(prevX * 0.92, 3);
      expect(h.panCalls[i]?.[1]).toBe(0);
    }

    const last = h.panCalls[h.panCalls.length - 1];
    expect(Math.hypot(last?.[0] ?? 0, last?.[1] ?? 0)).toBeLessThan(0.3 / 0.92);
  });

  it('paused drag does not coast (velocity window prunes stale samples)', () => {
    const h = makeHarness();
    h.sampleMove(10, 0);
    h.sampleMove(10, 0);
    h.sampleMove(10, 0);
    h.advance(200);
    h.inertia.release();

    expect(h.pending()).toBe(0);
    expect(h.panCalls.length).toBe(0);
  });

  it('slow drag does not coast (below MIN_START_SPEED)', () => {
    const h = makeHarness();
    h.sampleMove(1, 0);
    h.sampleMove(1, 0);
    h.sampleMove(1, 0);
    h.inertia.release();

    expect(h.panCalls.length).toBe(0);
    expect(h.pending()).toBe(0);
  });

  it('cancel stops the coast mid-flight', () => {
    const h = makeHarness();
    h.sampleMove(10, 0);
    h.sampleMove(10, 0);
    h.sampleMove(10, 0);
    h.sampleMove(10, 0);
    h.inertia.release();
    h.flushOne();
    const n = h.panCalls.length;
    h.inertia.cancel();
    h.flushAll();

    expect(h.panCalls.length).toBe(n);
  });

  it('disabled does not coast', () => {
    const h = makeHarness(false);
    h.sampleMove(10, 0);
    h.sampleMove(10, 0);
    h.sampleMove(10, 0);
    h.sampleMove(10, 0);
    h.inertia.release();

    expect(h.panCalls.length).toBe(0);
    expect(h.pending()).toBe(0);
  });

  it('preserves direction for a negative-direction flick', () => {
    const h = makeHarness();
    h.sampleMove(-8, -8);
    h.sampleMove(-8, -8);
    h.sampleMove(-8, -8);
    h.sampleMove(-8, -8);
    h.inertia.release();
    h.flushAll();

    expect(h.panCalls[0]?.[0]).toBeCloseTo(-8);
    expect(h.panCalls[0]?.[1]).toBeCloseTo(-8);

    for (const call of h.panCalls) {
      expect(call[0]).toBeLessThan(0);
      expect(call[1]).toBeLessThan(0);
    }
    for (let i = 1; i < h.panCalls.length; i++) {
      const prev = h.panCalls[i - 1];
      const cur = h.panCalls[i];
      expect(Math.hypot(cur?.[0] ?? 0, cur?.[1] ?? 0)).toBeLessThan(
        Math.hypot(prev?.[0] ?? 0, prev?.[1] ?? 0),
      );
    }
  });

  it('decays a diagonal flick proportionally', () => {
    const h = makeHarness();
    h.sampleMove(6, 8);
    h.sampleMove(6, 8);
    h.sampleMove(6, 8);
    h.sampleMove(6, 8);
    h.inertia.release();
    h.flushAll();

    expect(h.panCalls[0]?.[0]).toBeCloseTo(6);
    expect(h.panCalls[0]?.[1]).toBeCloseTo(8);
    expect(h.panCalls[1]?.[0]).toBeCloseTo(6 * 0.92);
    expect(h.panCalls[1]?.[1]).toBeCloseTo(8 * 0.92);
  });
});
