import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Point } from '@fieldnotes/core';
import type { RemotePathOverlayHost } from '../remote-path-overlay';
import type { MovementRenderModel } from './movement-render';
import type { MovementEmission } from './movement-tracker';
import {
  isMovementPresence,
  MOVEMENT_PRESENCE_KIND,
  RemoteMovementOverlay,
  toMovementPresence,
} from './remote-movement-overlay';

const model: MovementRenderModel = {
  grid: { type: 'hex', cellSize: 40, orientation: 'pointy' },
  trail: [
    [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
    ],
  ],
  path: [
    { x: 40, y: 0 },
    { x: 80, y: 0 },
    { x: 120, y: 0 },
  ],
  segmentColors: ['#2E7D32', '#F9A825'],
  cells: [
    { x: 80, y: 0, color: '#2E7D32' },
    { x: 120, y: 0, color: '#F9A825' },
  ],
  label: '10 ft · 20 left',
  over: false,
};

const active = { kind: 'movement', elementId: 'token-1', ...model };

function emission(visibility: 'all' | 'dm'): MovementEmission {
  return { elementId: 'token-1', visibility, model };
}

function pts(count: number): Point[] {
  return Array.from({ length: count }, (_v, i) => ({ x: i, y: 0 }));
}

describe('toMovementPresence', () => {
  it('returns null for a dm emission so hidden movement is never sent', () => {
    expect(toMovementPresence(emission('dm'))).toBeNull();
  });

  it('maps a null emission to the cleared form', () => {
    expect(toMovementPresence(null)).toEqual({ kind: 'movement', cleared: true });
  });

  it('carries the element id and model, and not the visibility', () => {
    const presence = toMovementPresence(emission('all'));
    expect(presence).toEqual(active);
    expect(presence && 'visibility' in presence).toBe(false);
    expect(isMovementPresence(presence)).toBe(true);
  });
});

describe('isMovementPresence', () => {
  it('accepts the cleared form and a square grid without orientation', () => {
    expect(isMovementPresence({ kind: MOVEMENT_PRESENCE_KIND, cleared: true })).toBe(true);
    expect(isMovementPresence({ ...active, grid: { type: 'square', cellSize: 40 } })).toBe(true);
  });

  it('accepts 256 points across trail and path, and rejects 257', () => {
    expect(isMovementPresence({ ...active, trail: [pts(253)] })).toBe(true);
    expect(isMovementPresence({ ...active, trail: [pts(254)] })).toBe(false);
  });

  it('accepts 512 cells and rejects 513', () => {
    const cell = { x: 0, y: 0, color: 'red' };
    expect(isMovementPresence({ ...active, cells: Array(512).fill(cell) })).toBe(true);
    expect(isMovementPresence({ ...active, cells: Array(513).fill(cell) })).toBe(false);
  });

  it.each<[string, Record<string, unknown>]>([
    ['wrong kind', { kind: 'path' }],
    ['non-true cleared', { cleared: false }],
    [
      'NaN path point',
      {
        path: [
          { x: 0, y: 0 },
          { x: Number.NaN, y: 0 },
          { x: 1, y: 0 },
        ],
      },
    ],
    ['Infinity trail point', { trail: [[{ x: 0, y: Infinity }]] }],
    ['trail run not an array', { trail: [{ x: 0, y: 0 }] }],
    ['label over 64 chars', { label: 'a'.repeat(65) }],
    ['non-string label', { label: 7 }],
    ['segment colour over 64 chars', { segmentColors: ['a'.repeat(65), 'red'] }],
    ['segmentColors not one per segment', { segmentColors: ['red'] }],
    ['cell colour over 64 chars', { cells: [{ x: 0, y: 0, color: 'a'.repeat(65) }] }],
    ['NaN cell', { cells: [{ x: Number.NaN, y: 0, color: 'red' }] }],
    ['unknown grid type', { grid: { type: 'iso', cellSize: 40 } }],
    ['zero cellSize', { grid: { type: 'square', cellSize: 0 } }],
    ['infinite cellSize', { grid: { type: 'square', cellSize: Infinity } }],
    ['unknown orientation', { grid: { type: 'hex', cellSize: 40, orientation: 'up' } }],
    ['non-boolean over', { over: 'yes' }],
    ['missing elementId', { elementId: undefined }],
    ['elementId over 256 chars', { elementId: 'a'.repeat(257) }],
  ])('rejects %s', (_name, patch) => {
    expect(isMovementPresence({ ...active, ...patch })).toBe(false);
  });

  it('rejects a sparse path (holes are not points)', () => {
    const path = [...model.path];
    delete path[1];
    expect(isMovementPresence({ ...active, path })).toBe(false);
  });

  it('rejects null and primitives', () => {
    expect(isMovementPresence(null)).toBe(false);
    expect(isMovementPresence('movement')).toBe(false);
  });

  it('accepts a 64-char label and a 256-char elementId', () => {
    expect(
      isMovementPresence({ ...active, label: 'a'.repeat(64), elementId: 'a'.repeat(256) }),
    ).toBe(true);
  });
});

function makeHost(): RemotePathOverlayHost & { drawFrame: () => string[] } {
  let renderer: ((ctx: CanvasRenderingContext2D) => void) | null = null;
  return {
    registerOverlay(draw) {
      renderer = draw;
      return () => {
        renderer = null;
      };
    },
    requestRender: vi.fn(),
    drawFrame() {
      const calls: string[] = [];
      // jsdom has no 2D context; record method names, swallow property writes.
      const ctx = new Proxy(
        {},
        {
          get: (_t, name) =>
            name === 'getTransform'
              ? undefined
              : (..._args: unknown[]) => {
                  calls.push(String(name));
                  return { width: 40 };
                },
          set: () => true,
        },
      ) as CanvasRenderingContext2D;
      renderer?.(ctx);
      return calls;
    },
  };
}

describe('RemoteMovementOverlay', () => {
  let rafCallbacks: FrameRequestCallback[];
  beforeEach(() => {
    vi.useFakeTimers();
    rafCallbacks = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => rafCallbacks.push(cb));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('draws an applied payload and nothing right after a cleared one', () => {
    const host = makeHost();
    const overlay = new RemoteMovementOverlay(host);
    expect(overlay.apply('a', active)).toBe(true);
    expect(host.drawFrame()).toContain('stroke');
    expect(overlay.apply('a', { kind: 'movement', cleared: true })).toBe(true);
    expect(host.drawFrame()).toEqual([]);
  });

  it('ignores a malformed payload', () => {
    const host = makeHost();
    const overlay = new RemoteMovementOverlay(host);
    expect(overlay.apply('a', { ...active, over: 1 })).toBe(false);
    expect(host.drawFrame()).toEqual([]);
  });

  it('expires a stale entry after maxAgeMs', () => {
    const host = makeHost();
    const overlay = new RemoteMovementOverlay(host, { maxAgeMs: 1000, holdMs: 0, fadeMs: 0 });
    overlay.apply('a', active);
    vi.advanceTimersByTime(999);
    for (const cb of rafCallbacks.splice(0)) cb(0);
    expect(host.drawFrame()).toContain('stroke');
    vi.advanceTimersByTime(1);
    for (const cb of rafCallbacks.splice(0)) cb(0);
    expect(host.drawFrame()).toEqual([]);
  });

  it('remove and clear drop entries immediately', () => {
    const host = makeHost();
    const overlay = new RemoteMovementOverlay(host);
    overlay.apply('a', active);
    overlay.apply('b', active);
    overlay.remove('a');
    expect(host.drawFrame()).toContain('stroke');
    overlay.clear();
    expect(host.drawFrame()).toEqual([]);
  });
});
