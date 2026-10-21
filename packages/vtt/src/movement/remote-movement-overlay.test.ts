import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Point } from '@fieldnotes/core';
import type { RemotePathOverlayHost } from '../remote-path-overlay';
import type { MovementRenderModel } from './movement-render';
import type { MovementEmission } from './movement-tracker';
import {
  decodeMovementPresence,
  isMovementPresence,
  MOVEMENT_PRESENCE_KIND,
  MOVEMENT_PRESENCE_MAX_BYTES,
  RemoteMovementOverlay,
  toMovementPresence,
} from './remote-movement-overlay';

const G = '#2E7D32';
const Y = '#F9A825';

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
  segmentColors: [G, Y],
  cells: [
    { x: 80, y: 0, color: G },
    { x: 120, y: 0, color: Y },
  ],
  label: '10 ft · 20 left',
  over: false,
};

const active = {
  kind: 'movement',
  elementId: 'token-1',
  grid: { type: 'hex', cellSize: 40, orientation: 'pointy' },
  palette: [G, Y],
  path: [40, 0, 80, 0, 120, 0],
  segments: [0, 1],
  trail: [[0, 0, 40, 0]],
  cells: [80, 0, 0, 120, 0, 1],
  label: '10 ft · 20 left',
  over: false,
};

function emission(visibility: 'all' | 'dm', m: MovementRenderModel = model): MovementEmission {
  return { elementId: 'token-1', visibility, model: m };
}

// Fractional coordinates, so rounding is observable.
function run(count: number, from: number, step: number): Point[] {
  return Array.from({ length: count }, (_v, i) => ({ x: from + i * step + 0.4, y: from - 0.6 }));
}

function rounded(points: readonly Point[]): Point[] {
  return points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
}

function size(data: unknown): number {
  return JSON.stringify(data).length;
}

function bytes(data: unknown): number {
  return new TextEncoder().encode(JSON.stringify(data)).length;
}

describe('toMovementPresence', () => {
  it('returns null for a dm emission so hidden movement is never sent', () => {
    expect(toMovementPresence(emission('dm'))).toBeNull();
  });

  it('maps a null emission to the cleared form', () => {
    expect(toMovementPresence(null)).toEqual({ kind: 'movement', cleared: true });
  });

  it('encodes the compact wire form without the visibility', () => {
    expect(toMovementPresence(emission('all'))).toEqual(active);
  });

  it('fits a 64-point trail and 40-cell drag in the byte budget and round-trips rounded', () => {
    const path = run(8, 1000, 34.64);
    const cells = run(40, 1200, 34.64).map((p, i) => ({ ...p, color: i < 20 ? G : Y }));
    const big: MovementRenderModel = {
      ...model,
      trail: [run(32, 2000, 17.3), run(32, 3000, 17.3)],
      path,
      segmentColors: Array.from({ length: 7 }, (_v, i) => (i < 4 ? G : Y)),
      cells,
    };
    const presence = toMovementPresence(emission('all', big));
    expect(size(presence)).toBeLessThanOrEqual(MOVEMENT_PRESENCE_MAX_BYTES);
    expect(decodeMovementPresence(presence)).toEqual({
      ...big,
      trail: big.trail.map(rounded),
      path: rounded(path),
      cells: cells.map((c) => ({ x: Math.round(c.x), y: Math.round(c.y), color: c.color })),
    });
  });

  it('drops empty trail runs', () => {
    const presence = toMovementPresence(emission('all', { ...model, trail: [[], ...model.trail] }));
    expect(presence).toEqual(active);
  });

  it('trims a pathological model to the budget, keeping path and label', () => {
    const path = run(64, -5000, 33.3);
    const huge: MovementRenderModel = {
      ...model,
      trail: [run(48, -9000, 7), run(48, -8000, 7), run(48, -7000, 7), run(48, -6000, 7)],
      path,
      segmentColors: Array.from({ length: 63 }, () => G),
      cells: run(512, -4000, 13).map((p) => ({ ...p, color: Y })),
    };
    const presence = toMovementPresence(emission('all', huge));
    expect(size(presence)).toBeLessThanOrEqual(MOVEMENT_PRESENCE_MAX_BYTES);
    const decoded = decodeMovementPresence(presence);
    expect(decoded?.path).toEqual(rounded(path));
    expect(decoded?.label).toBe(model.label);
  });

  it('drops the oldest trail run first and keeps cells when that suffices', () => {
    const trail = [run(63, -12000, 7), run(63, -13000, 7), run(63, -14000, 7), run(63, -15000, 7)];
    const cells = run(10, -16000, 40).map((p) => ({ ...p, color: G }));
    const over: MovementRenderModel = { ...model, trail, cells };
    const flat = (points: readonly Point[]): number[] => rounded(points).flatMap((p) => [p.x, p.y]);
    const untrimmed = {
      ...active,
      trail: trail.map(flat),
      cells: flat(cells).flatMap((v, i) => (i % 2 ? [v, 0] : [v])),
    };
    expect(size(untrimmed)).toBeGreaterThan(MOVEMENT_PRESENCE_MAX_BYTES);
    const decoded = decodeMovementPresence(toMovementPresence(emission('all', over)));
    expect(decoded?.trail).toEqual(trail.slice(1).map(rounded));
    expect(decoded?.cells).toHaveLength(10);
  });

  it('measures the budget in UTF-8 bytes, so a multibyte id and label trim the trail', () => {
    const elementId = '€'.repeat(256);
    const label = '€'.repeat(64);
    const trail = [run(63, -12000, 7), run(63, -13000, 7), run(63, -14000, 7)];
    const over: MovementRenderModel = { ...model, trail, label };
    const flat = (points: readonly Point[]): number[] => rounded(points).flatMap((p) => [p.x, p.y]);
    const untrimmed = { ...active, elementId, label, trail: trail.map(flat) };
    expect(size(untrimmed)).toBeLessThanOrEqual(MOVEMENT_PRESENCE_MAX_BYTES);
    expect(bytes(untrimmed)).toBeGreaterThan(MOVEMENT_PRESENCE_MAX_BYTES);

    const presence = toMovementPresence({ elementId, visibility: 'all', model: over });

    expect(bytes(presence)).toBeLessThanOrEqual(MOVEMENT_PRESENCE_MAX_BYTES);
    expect(decodeMovementPresence(presence)?.trail).toEqual(trail.slice(1).map(rounded));
  });
});

describe('isMovementPresence', () => {
  it('accepts the cleared form and a square grid without orientation', () => {
    expect(isMovementPresence({ kind: MOVEMENT_PRESENCE_KIND, cleared: true })).toBe(true);
    expect(isMovementPresence({ ...active, grid: { type: 'square', cellSize: 40 } })).toBe(true);
  });

  it('accepts 256 points across trail and path, and rejects 257', () => {
    expect(isMovementPresence({ ...active, trail: [Array(2 * 253).fill(0)] })).toBe(true);
    expect(isMovementPresence({ ...active, trail: [Array(2 * 254).fill(0)] })).toBe(false);
  });

  it('accepts 512 cells and rejects 513', () => {
    expect(isMovementPresence({ ...active, cells: Array(3 * 512).fill(0) })).toBe(true);
    expect(isMovementPresence({ ...active, cells: Array(3 * 513).fill(0) })).toBe(false);
  });

  it('accepts 8 palette colors of 64 chars, a 64-char label, and a 256-char elementId', () => {
    expect(
      isMovementPresence({
        ...active,
        palette: Array(8).fill('a'.repeat(64)),
        label: 'a'.repeat(64),
        elementId: 'a'.repeat(256),
      }),
    ).toBe(true);
  });

  it.each<[string, Record<string, unknown>]>([
    ['wrong kind', { kind: 'path' }],
    ['non-true cleared', { cleared: false }],
    ['odd-length path', { path: [40, 0, 80, 0, 120] }],
    ['non-integer path coordinate', { path: [40.5, 0, 80, 0, 120, 0] }],
    ['NaN trail coordinate', { trail: [[0, Number.NaN]] }],
    ['empty trail run', { trail: [[]] }],
    ['odd-length trail run', { trail: [[0, 0, 40]] }],
    ['trail run not an array', { trail: [5] }],
    ['segment palette index out of range', { segments: [0, 2] }],
    ['negative segment index', { segments: [-1, 1] }],
    ['segments not one per path segment', { segments: [0] }],
    ['cells length not divisible by 3', { cells: [80, 0] }],
    ['cell palette index out of range', { cells: [80, 0, 2] }],
    ['non-integer cell coordinate', { cells: [80.5, 0, 0] }],
    ['more than 8 palette colors', { palette: Array(9).fill(G) }],
    ['palette color over 64 chars', { palette: [G, 'a'.repeat(65)] }],
    ['label over 64 chars', { label: 'a'.repeat(65) }],
    ['non-string label', { label: 7 }],
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

  it('rejects a sparse path (holes are not coordinates)', () => {
    const path = [...active.path];
    delete path[2];
    expect(isMovementPresence({ ...active, path })).toBe(false);
  });

  it('rejects null and primitives', () => {
    expect(isMovementPresence(null)).toBe(false);
    expect(isMovementPresence('movement')).toBe(false);
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
