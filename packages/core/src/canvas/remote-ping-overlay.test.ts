// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  RemotePingOverlay,
  isPingPresence,
  toPingPresence,
  PING_PRESENCE_KIND,
} from './remote-ping-overlay';
import type { RemotePingOverlayHost } from './remote-ping-overlay';
import type { OverlayRenderer } from './render-loop';

interface OverlayLike {
  now(): number;
}

function makeHost(): {
  host: RemotePingOverlayHost;
  getRenderer: () => OverlayRenderer | null;
  unregister: ReturnType<typeof vi.fn>;
  requestRender: ReturnType<typeof vi.fn>;
} {
  let renderer: OverlayRenderer | null = null;
  const unregister = vi.fn(() => {
    renderer = null;
  });
  const requestRender = vi.fn();
  return {
    host: {
      registerOverlay: (draw: OverlayRenderer) => {
        renderer = draw;
        return unregister;
      },
      requestRender,
    },
    getRenderer: () => renderer,
    unregister,
    requestRender,
  };
}

function makeMockCtx(arcs: number[], alphas: number[]): CanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn((_x: number, _y: number, r: number) => arcs.push(r)),
    stroke: vi.fn(),
    fill: vi.fn(),
    set globalAlpha(v: number) {
      alphas.push(v);
    },
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 0,
  } as unknown as CanvasRenderingContext2D;
}

function setNow(overlay: RemotePingOverlay, value: number): void {
  vi.spyOn(overlay as unknown as OverlayLike, 'now').mockReturnValue(value);
}

let rafCallbacks: FrameRequestCallback[];

beforeEach(() => {
  rafCallbacks = [];
  let id = 0;
  globalThis.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
    rafCallbacks.push(cb);
    return ++id;
  }) as unknown as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = vi.fn() as unknown as typeof cancelAnimationFrame;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function flushFrame(): void {
  const cbs = rafCallbacks;
  rafCallbacks = [];
  for (const cb of cbs) cb(0);
}

describe('isPingPresence', () => {
  it('accepts a minimal payload and a fully specified payload', () => {
    expect(isPingPresence({ kind: 'ping', x: 1, y: 2 })).toBe(true);
    expect(
      isPingPresence({ kind: 'ping', x: 0, y: -5.5, color: '#fff', durationMs: 100, radius: 8 }),
    ).toBe(true);
  });

  it('rejects other presence kinds — laser trails and hub pokes stay untouched', () => {
    expect(isPingPresence({ kind: 'laser', points: [{ x: 1, y: 2 }] })).toBe(false);
    expect(isPingPresence({ kind: 'poke', payload: 'initiative' })).toBe(false);
  });

  it('rejects malformed payloads', () => {
    expect(isPingPresence(null)).toBe(false);
    expect(isPingPresence(undefined)).toBe(false);
    expect(isPingPresence('ping')).toBe(false);
    expect(isPingPresence({ kind: 'ping' })).toBe(false);
    expect(isPingPresence({ kind: 'ping', x: 1 })).toBe(false);
    expect(isPingPresence({ kind: 'ping', x: NaN, y: 0 })).toBe(false);
    expect(isPingPresence({ kind: 'ping', x: Infinity, y: 0 })).toBe(false);
    expect(isPingPresence({ kind: 'ping', x: '1', y: 2 })).toBe(false);
    expect(isPingPresence({ kind: 'ping', x: 1, y: 2, color: 7 })).toBe(false);
    expect(isPingPresence({ kind: 'ping', x: 1, y: 2, durationMs: 0 })).toBe(false);
    expect(isPingPresence({ kind: 'ping', x: 1, y: 2, durationMs: -5 })).toBe(false);
    expect(isPingPresence({ kind: 'ping', x: 1, y: 2, radius: 0 })).toBe(false);
    expect(isPingPresence({ kind: 'ping', x: 1, y: 2, radius: NaN })).toBe(false);
  });
});

describe('toPingPresence', () => {
  it('builds a validated payload from an emission', () => {
    const presence = toPingPresence({
      x: 10,
      y: 20,
      color: '#f4c430',
      durationMs: 1500,
      radius: 32,
    });
    expect(presence).toEqual({
      kind: PING_PRESENCE_KIND,
      x: 10,
      y: 20,
      color: '#f4c430',
      durationMs: 1500,
      radius: 32,
    });
    expect(isPingPresence(presence)).toBe(true);
  });
});

describe('RemotePingOverlay', () => {
  it('registers an overlay on construction and unregisters on dispose (idempotent)', () => {
    const { host, getRenderer, unregister } = makeHost();
    const overlay = new RemotePingOverlay(host);
    expect(getRenderer()).not.toBeNull();

    overlay.dispose();
    expect(unregister).toHaveBeenCalledTimes(1);
    overlay.dispose();
    expect(unregister).toHaveBeenCalledTimes(1);
  });

  it('apply accepts only valid ping payloads and reports the result', () => {
    const { host, requestRender } = makeHost();
    const overlay = new RemotePingOverlay(host);
    setNow(overlay, 100);

    expect(overlay.apply('conn-1', { kind: 'laser', points: [] })).toBe(false);
    expect(overlay.apply('conn-1', { kind: 'poke', payload: 'x' })).toBe(false);
    expect(overlay.activeSenderCount).toBe(0);
    expect(requestRender).not.toHaveBeenCalled();

    expect(overlay.apply('conn-1', { kind: 'ping', x: 5, y: 6 })).toBe(true);
    expect(overlay.activeSenderCount).toBe(1);
    expect(requestRender).toHaveBeenCalled();
  });

  it('apply after dispose is ignored', () => {
    const { host } = makeHost();
    const overlay = new RemotePingOverlay(host);
    overlay.dispose();
    expect(overlay.apply('conn-1', { kind: 'ping', x: 1, y: 2 })).toBe(false);
  });

  it('stamps pings with local receive time and renders them with payload style', () => {
    const { host, getRenderer } = makeHost();
    const overlay = new RemotePingOverlay(host);
    setNow(overlay, 1000);
    overlay.apply('conn-1', { kind: 'ping', x: 50, y: 60, durationMs: 1000, radius: 40 });

    const arcs: number[] = [];
    const alphas: number[] = [];
    const ctx = makeMockCtx(arcs, alphas);

    setNow(overlay, 1200); // age 200 of 1000
    getRenderer()?.(ctx);
    expect(arcs.length).toBeGreaterThan(0);
    expect(Math.max(...arcs)).toBeLessThan(40);

    // Past expiry nothing draws (renderer guards on age).
    arcs.length = 0;
    setNow(overlay, 2100);
    getRenderer()?.(ctx);
    expect(arcs.length).toBe(0);
  });

  it('caps live pings per sender, dropping oldest first', () => {
    const { host, getRenderer } = makeHost();
    const overlay = new RemotePingOverlay(host, { maxPingsPerSender: 2, durationMs: 10_000 });
    setNow(overlay, 0);
    overlay.apply('conn-1', { kind: 'ping', x: 1, y: 0, radius: 30 });
    overlay.apply('conn-1', { kind: 'ping', x: 2, y: 0, radius: 30 });
    overlay.apply('conn-1', { kind: 'ping', x: 3, y: 0, radius: 30 });

    const drawnAt: number[] = [];
    const alphaSink: number[] = [];
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn((x: number) => drawnAt.push(x)),
      stroke: vi.fn(),
      fill: vi.fn(),
      set globalAlpha(v: number) {
        alphaSink.push(v);
      },
      strokeStyle: '',
      fillStyle: '',
      lineWidth: 0,
    } as unknown as CanvasRenderingContext2D;
    setNow(overlay, 100);
    getRenderer()?.(ctx);
    expect(drawnAt).not.toContain(1); // oldest dropped
    expect(drawnAt).toContain(2);
    expect(drawnAt).toContain(3);
  });

  it('self-expires pings after their duration and stops the animation loop', () => {
    const { host } = makeHost();
    const overlay = new RemotePingOverlay(host);
    setNow(overlay, 0);
    overlay.apply('conn-1', { kind: 'ping', x: 0, y: 0, durationMs: 500 });
    overlay.apply('conn-2', { kind: 'ping', x: 5, y: 5, durationMs: 2000 });
    expect(overlay.activeSenderCount).toBe(2);

    setNow(overlay, 1000);
    flushFrame();
    expect(overlay.activeSenderCount).toBe(1); // conn-1 expired, conn-2 alive

    setNow(overlay, 3000);
    flushFrame();
    expect(overlay.activeSenderCount).toBe(0);
    expect(rafCallbacks.length).toBe(0); // loop stopped
  });

  it('remove(sender) erases that sender immediately, leaving others', () => {
    const { host, requestRender } = makeHost();
    const overlay = new RemotePingOverlay(host, { durationMs: 10_000 });
    setNow(overlay, 0);
    overlay.apply('conn-1', { kind: 'ping', x: 0, y: 0 });
    overlay.apply('conn-2', { kind: 'ping', x: 5, y: 5 });

    requestRender.mockClear();
    overlay.remove('conn-1'); // presence-leave
    expect(overlay.activeSenderCount).toBe(1);
    expect(requestRender).toHaveBeenCalledTimes(1);

    overlay.remove('conn-1'); // unknown sender: no extra render
    expect(requestRender).toHaveBeenCalledTimes(1);
  });

  it('clear() erases every sender', () => {
    const { host } = makeHost();
    const overlay = new RemotePingOverlay(host, { durationMs: 10_000 });
    setNow(overlay, 0);
    overlay.apply('conn-1', { kind: 'ping', x: 0, y: 0 });
    overlay.apply('conn-2', { kind: 'ping', x: 5, y: 5 });
    overlay.clear();
    expect(overlay.activeSenderCount).toBe(0);
  });

  it('uses option fallbacks when a payload omits style fields', () => {
    const { host, getRenderer } = makeHost();
    const overlay = new RemotePingOverlay(host, { color: '#123456', durationMs: 400, radius: 10 });
    setNow(overlay, 0);
    overlay.apply('conn-1', { kind: 'ping', x: 0, y: 0 });

    const arcs: number[] = [];
    const alphas: number[] = [];
    const ctx = makeMockCtx(arcs, alphas);
    setNow(overlay, 100);
    getRenderer()?.(ctx);
    expect(arcs.length).toBeGreaterThan(0);
    expect(Math.max(...arcs)).toBeLessThanOrEqual(10);

    // Fallback duration governs expiry.
    setNow(overlay, 500);
    flushFrame();
    expect(overlay.activeSenderCount).toBe(0);
  });

  it('dispose cancels a live animation loop', () => {
    const { host } = makeHost();
    const overlay = new RemotePingOverlay(host);
    setNow(overlay, 0);
    overlay.apply('conn-1', { kind: 'ping', x: 0, y: 0 });
    overlay.dispose();
    expect(cancelAnimationFrame).toHaveBeenCalled();
    expect(overlay.activeSenderCount).toBe(0);
  });
});
