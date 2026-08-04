// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  RemoteLaserOverlay,
  isLaserTrailPresence,
  toLaserTrailPresence,
  type RemoteLaserOverlayHost,
} from './remote-laser-overlay';
import type { OverlayRenderer } from './render-loop';

interface OverlayInternals {
  now(): number;
  rafId: number | null;
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

function makeHost(): RemoteLaserOverlayHost & {
  registered: OverlayRenderer[];
  unregisterCalls: number;
  requestRender: ReturnType<typeof vi.fn>;
} {
  const host = {
    registered: [] as OverlayRenderer[],
    unregisterCalls: 0,
    requestRender: vi.fn(),
    registerOverlay(draw: OverlayRenderer): () => void {
      host.registered.push(draw);
      return () => {
        host.unregisterCalls += 1;
        host.registered = host.registered.filter((d) => d !== draw);
      };
    },
  };
  return host;
}

function setNow(overlay: RemoteLaserOverlay, value: number): void {
  vi.spyOn(overlay as unknown as OverlayInternals, 'now').mockReturnValue(value);
}

function strokeCtx(alphas: number[]): CanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    set globalAlpha(v: number) {
      alphas.push(v);
    },
    strokeStyle: '',
    lineWidth: 0,
    lineCap: '',
    lineJoin: '',
  } as unknown as CanvasRenderingContext2D;
}

const points = [
  { x: 0, y: 0 },
  { x: 10, y: 10 },
];

describe('isLaserTrailPresence', () => {
  it('accepts a minimal payload and a fully styled payload', () => {
    expect(isLaserTrailPresence({ kind: 'laser', points })).toBe(true);
    expect(
      isLaserTrailPresence({ kind: 'laser', points, color: '#fff', width: 2, fadeMs: 500 }),
    ).toBe(true);
  });

  it('rejects non-laser kinds, malformed points, and bad styles', () => {
    expect(isLaserTrailPresence(null)).toBe(false);
    expect(isLaserTrailPresence('laser')).toBe(false);
    expect(isLaserTrailPresence({ kind: 'poke', points })).toBe(false);
    expect(isLaserTrailPresence({ kind: 'laser' })).toBe(false);
    expect(isLaserTrailPresence({ kind: 'laser', points: [{ x: 1 }] })).toBe(false);
    expect(isLaserTrailPresence({ kind: 'laser', points: [{ x: 1, y: Infinity }] })).toBe(false);
    expect(isLaserTrailPresence({ kind: 'laser', points, width: -1 })).toBe(false);
    expect(isLaserTrailPresence({ kind: 'laser', points, fadeMs: 0 })).toBe(false);
    expect(isLaserTrailPresence({ kind: 'laser', points, color: 7 })).toBe(false);
  });
});

describe('toLaserTrailPresence', () => {
  it('copies an emission into a validated wire payload', () => {
    const payload = toLaserTrailPresence({
      points,
      color: '#123456',
      width: 3,
      fadeMs: 800,
    });
    expect(payload).toEqual({ kind: 'laser', points, color: '#123456', width: 3, fadeMs: 800 });
    expect(isLaserTrailPresence(payload)).toBe(true);
    expect(payload.points).not.toBe(points); // defensive copy
  });
});

describe('RemoteLaserOverlay', () => {
  it('registers an overlay on construction and unregisters on dispose (idempotent)', () => {
    const host = makeHost();
    const overlay = new RemoteLaserOverlay(host);
    expect(host.registered.length).toBe(1);
    overlay.dispose();
    overlay.dispose();
    expect(host.unregisterCalls).toBe(1);
    expect(host.registered.length).toBe(0);
  });

  it('apply validates payloads, stamps receive time, and requests a render', () => {
    const host = makeHost();
    const overlay = new RemoteLaserOverlay(host);
    setNow(overlay, 100);
    expect(overlay.apply('sender-1', { kind: 'poke' })).toBe(false);
    expect(overlay.activeSenderCount).toBe(0);
    expect(host.requestRender).not.toHaveBeenCalled();

    expect(overlay.apply('sender-1', { kind: 'laser', points })).toBe(true);
    expect(overlay.activeSenderCount).toBe(1);
    expect(host.requestRender).toHaveBeenCalled();
  });

  it('renders per-sender trails with their own style and age-based alpha', () => {
    const host = makeHost();
    const overlay = new RemoteLaserOverlay(host, { fadeMs: 1000 });
    setNow(overlay, 0);
    overlay.apply('a', { kind: 'laser', points, color: '#00ff00', width: 7 });
    setNow(overlay, 500);
    overlay.apply('b', { kind: 'laser', points });

    const alphas: number[] = [];
    const ctx = strokeCtx(alphas);
    setNow(overlay, 500);
    host.registered[0]?.(ctx);
    // sender a: age 500 of 1000 → 0.5; sender b: age 0 → 1
    expect(alphas).toEqual([0.5, 1]);
  });

  it('fades trails out and stops the raf loop when everything expired', () => {
    const host = makeHost();
    const overlay = new RemoteLaserOverlay(host, { fadeMs: 1000 });
    setNow(overlay, 0);
    overlay.apply('a', { kind: 'laser', points });
    expect((overlay as unknown as OverlayInternals).rafId).not.toBeNull();

    setNow(overlay, 500);
    flushFrame();
    expect(overlay.activeSenderCount).toBe(1); // still fading

    setNow(overlay, 2000);
    flushFrame();
    expect(overlay.activeSenderCount).toBe(0);
    expect((overlay as unknown as OverlayInternals).rafId).toBeNull();
  });

  it('remove drops a sender immediately; clear drops everyone', () => {
    const host = makeHost();
    const overlay = new RemoteLaserOverlay(host);
    setNow(overlay, 0);
    overlay.apply('a', { kind: 'laser', points });
    overlay.apply('b', { kind: 'laser', points });

    overlay.remove('a');
    expect(overlay.activeSenderCount).toBe(1);
    overlay.remove('a'); // unknown sender is a no-op
    overlay.clear();
    expect(overlay.activeSenderCount).toBe(0);
  });

  it('caps stored points per sender, dropping oldest first', () => {
    const host = makeHost();
    const overlay = new RemoteLaserOverlay(host, { maxPointsPerSender: 3 });
    setNow(overlay, 0);
    overlay.apply('a', {
      kind: 'laser',
      points: [
        { x: 1, y: 1 },
        { x: 2, y: 2 },
        { x: 3, y: 3 },
        { x: 4, y: 4 },
      ],
    });
    const trail = (
      overlay as unknown as { trails: Map<string, { points: { x: number }[] }> }
    ).trails.get('a');
    expect(trail?.points.map((p) => p.x)).toEqual([2, 3, 4]);
  });

  it('ignores apply after dispose', () => {
    const host = makeHost();
    const overlay = new RemoteLaserOverlay(host);
    overlay.dispose();
    expect(overlay.apply('a', { kind: 'laser', points })).toBe(false);
  });

  it('style fallbacks come from options when the payload omits them', () => {
    const host = makeHost();
    const overlay = new RemoteLaserOverlay(host, { color: '#abcdef', width: 9, fadeMs: 300 });
    setNow(overlay, 0);
    overlay.apply('a', { kind: 'laser', points });
    const trail = (
      overlay as unknown as {
        trails: Map<string, { color: string; width: number; fadeMs: number }>;
      }
    ).trails.get('a');
    expect(trail).toMatchObject({ color: '#abcdef', width: 9, fadeMs: 300 });
  });
});
