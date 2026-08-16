import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Point } from '../core/types';
import type { PathEmission } from '../tools/path-tool';
import {
  isPathPresence,
  toPathPresence,
  PATH_PRESENCE_KIND,
  PATH_PRESENCE_MAX_POINTS,
  RemotePathOverlay,
  type RemotePathOverlayHost,
} from './remote-path-overlay';

const active = {
  kind: 'path',
  points: [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 40 },
  ],
  segmentColors: ['green', 'red'],
  feet: 20,
  color: '#FF5722',
};

function points(count: number): Point[] {
  return Array.from({ length: count }, (_v, i) => ({ x: i, y: 0 }));
}

function colors(count: number): string[] {
  return Array.from({ length: count }, () => 'green');
}

describe('isPathPresence', () => {
  it('accepts an active payload and the cleared form', () => {
    expect(isPathPresence(active)).toBe(true);
    expect(isPathPresence({ kind: 'path', cleared: true })).toBe(true);
  });

  it('accepts an active payload without the optional color', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { color: _color, ...noColor } = active;
    expect(isPathPresence(noColor)).toBe(true);
  });

  it('accepts the minimal valid path: one point and no segment colours', () => {
    expect(
      isPathPresence({ kind: 'path', points: [{ x: 1, y: 2 }], segmentColors: [], feet: 0 }),
    ).toBe(true);
  });

  it('rejects wrong kinds, primitives, and null', () => {
    expect(isPathPresence({ ...active, kind: 'measure' })).toBe(false);
    expect(isPathPresence('path')).toBe(false);
    expect(isPathPresence(null)).toBe(false);
    expect(isPathPresence(undefined)).toBe(false);
  });

  it('rejects points that are not an array and an empty point list', () => {
    expect(isPathPresence({ ...active, points: 'nope', segmentColors: [] })).toBe(false);
    expect(isPathPresence({ ...active, points: {}, segmentColors: [] })).toBe(false);
    expect(isPathPresence({ ...active, points: [], segmentColors: [] })).toBe(false);
  });

  it(`accepts ${PATH_PRESENCE_MAX_POINTS} points and rejects one more`, () => {
    expect(
      isPathPresence({
        ...active,
        points: points(PATH_PRESENCE_MAX_POINTS),
        segmentColors: colors(PATH_PRESENCE_MAX_POINTS - 1),
      }),
    ).toBe(true);
    expect(
      isPathPresence({
        ...active,
        points: points(PATH_PRESENCE_MAX_POINTS + 1),
        segmentColors: colors(PATH_PRESENCE_MAX_POINTS),
      }),
    ).toBe(false);
  });

  it('rejects a non-finite or malformed point anywhere in the list', () => {
    expect(
      isPathPresence({
        ...active,
        points: [
          { x: 0, y: 0 },
          { x: Number.NaN, y: 0 },
          { x: 1, y: 1 },
        ],
      }),
    ).toBe(false);
    expect(isPathPresence({ ...active, points: [{ x: 0, y: 0 }, { x: 1 }, { x: 1, y: 1 }] })).toBe(
      false,
    );
    expect(
      isPathPresence({
        ...active,
        points: [
          { x: 0, y: 0 },
          { x: 1, y: Infinity },
          { x: 1, y: 1 },
        ],
      }),
    ).toBe(false);
  });

  it('rejects a sparse points array (holes are not finite points)', () => {
    // `Array.prototype.every` SKIPS holes, so a sparse array sails through a
    // naive `.every(isFinitePoint)` and reaches the renderer as `undefined`.
    const sparse = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 40 },
    ];
    delete sparse[1];
    expect(isPathPresence({ ...active, points: sparse })).toBe(false);

    const holeAtEnd: Point[] = new Array<Point>(3);
    holeAtEnd[0] = { x: 0, y: 0 };
    holeAtEnd[1] = { x: 40, y: 0 };
    expect(isPathPresence({ ...active, points: holeAtEnd })).toBe(false);
  });

  it('rejects a sparse segmentColors array', () => {
    const sparse = ['green', 'red'];
    delete sparse[1];
    expect(isPathPresence({ ...active, segmentColors: sparse })).toBe(false);
  });

  it('accepts a 64-character colour and rejects a longer one', () => {
    const ok = 'a'.repeat(64);
    const tooLong = 'a'.repeat(65);
    expect(isPathPresence({ ...active, color: ok })).toBe(true);
    expect(isPathPresence({ ...active, color: tooLong })).toBe(false);
    expect(isPathPresence({ ...active, segmentColors: [ok, 'red'] })).toBe(true);
    expect(isPathPresence({ ...active, segmentColors: ['green', tooLong] })).toBe(false);
  });

  it('rejects segmentColors whose length is not points.length - 1', () => {
    expect(isPathPresence({ ...active, segmentColors: ['green'] })).toBe(false);
    expect(isPathPresence({ ...active, segmentColors: ['green', 'red', 'blue'] })).toBe(false);
    expect(isPathPresence({ ...active, segmentColors: [] })).toBe(false);
  });

  it('rejects segmentColors that are not an array of strings', () => {
    expect(isPathPresence({ ...active, segmentColors: 'green,red' })).toBe(false);
    expect(isPathPresence({ ...active, segmentColors: ['green', 7] })).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { segmentColors: _segmentColors, ...missing } = active;
    expect(isPathPresence(missing)).toBe(false);
  });

  it('rejects non-finite or missing feet', () => {
    expect(isPathPresence({ ...active, feet: Number.NaN })).toBe(false);
    expect(isPathPresence({ ...active, feet: Infinity })).toBe(false);
    expect(isPathPresence({ ...active, feet: '20' })).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { feet: _feet, ...missingFeet } = active;
    expect(isPathPresence(missingFeet)).toBe(false);
  });

  it('rejects a non-string color and a non-true cleared', () => {
    expect(isPathPresence({ ...active, color: 7 })).toBe(false);
    expect(isPathPresence({ kind: 'path', cleared: 1 })).toBe(false);
  });

  it('accepts a cleared payload even with bogus extra fields (cleared branch ignores active fields)', () => {
    expect(isPathPresence({ kind: 'path', cleared: true, points: 'x', feet: 'y' })).toBe(true);
  });

  it('rejects cleared present but not exactly true, even with valid active fields', () => {
    expect(isPathPresence({ ...active, cleared: false })).toBe(false);
  });
});

function emission(overrides: Partial<PathEmission> = {}): PathEmission {
  return {
    waypoints: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ],
    cursor: { x: 20, y: 0 },
    segments: [
      { cells: 3, feet: 15 },
      { cells: 3, feet: 15 },
    ],
    totalCells: 6,
    totalFeet: 30,
    color: 'red',
    rangeBands: [{ feet: 20, color: 'green' }],
    ...overrides,
  };
}

describe('toPathPresence', () => {
  it('maps null to the cleared form', () => {
    expect(toPathPresence(null)).toEqual({ kind: PATH_PRESENCE_KIND, cleared: true });
  });

  it('appends the cursor as the last point and colours segments by running total', () => {
    const presence = toPathPresence(emission());
    expect(presence).toEqual({
      kind: PATH_PRESENCE_KIND,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
      ],
      // cumulative feet [0, 15, 30]: 15 is inside the 20ft band, 30 is beyond it.
      segmentColors: ['green', 'red'],
      feet: 30,
      color: 'red',
    });
    expect(isPathPresence(presence)).toBe(true);
  });

  it('does not append a cursor that equals the last waypoint', () => {
    const presence = toPathPresence(
      emission({
        cursor: { x: 10 + 1e-9, y: 0 },
        segments: [{ cells: 3, feet: 15 }],
        totalFeet: 15,
      }),
    );
    expect('cleared' in presence).toBe(false);
    if ('cleared' in presence) return;
    expect(presence.points).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
    expect(presence.segmentColors).toEqual(['green']);
  });

  it('omits a null cursor', () => {
    const presence = toPathPresence(
      emission({ cursor: null, segments: [{ cells: 3, feet: 15 }], totalFeet: 15 }),
    );
    expect('cleared' in presence).toBe(false);
    if ('cleared' in presence) return;
    expect(presence.points).toHaveLength(2);
  });

  it('never puts anchorKey on the wire', () => {
    const presence = toPathPresence(emission({ anchorKey: 'token-7' }));
    expect('anchorKey' in presence).toBe(false);
    expect(JSON.stringify(presence)).not.toContain('token-7');
  });

  it('always emits one segment colour per segment, even for a short segments array', () => {
    const presence = toPathPresence(emission({ segments: [] }));
    expect('cleared' in presence).toBe(false);
    if ('cleared' in presence) return;
    expect(presence.segmentColors).toHaveLength(presence.points.length - 1);
    expect(isPathPresence(presence)).toBe(true);
  });
});

/** Recording call shape: [method-or-property, ...args-or-value]. */
type Call = [string, ...unknown[]];

function makeCtx(calls: Call[]): CanvasRenderingContext2D {
  // jsdom provides no real 2D context; a recording stub is enough — the
  // pixel-level contract is covered by e2e. Copied from path-render.test.ts.
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
    };
  return {
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
  } as unknown as CanvasRenderingContext2D;
}

function makeHost(): RemotePathOverlayHost & {
  draws: number;
  drawFrame: () => Call[];
  unregistered: boolean;
  requestRender: ReturnType<typeof vi.fn>;
} {
  let renderer: ((ctx: CanvasRenderingContext2D) => void) | null = null;
  const host = {
    draws: 0,
    unregistered: false,
    registerOverlay(draw: (ctx: CanvasRenderingContext2D) => void) {
      renderer = draw;
      return () => {
        host.unregistered = true;
        renderer = null;
      };
    },
    requestRender: vi.fn(),
    drawFrame(): Call[] {
      host.draws += 1;
      const calls: Call[] = [];
      renderer?.(makeCtx(calls));
      return calls;
    },
  };
  return host;
}

function setNow(overlay: RemotePathOverlay, value: number): void {
  vi.spyOn(overlay as unknown as { now: () => number }, 'now').mockReturnValue(value);
}

describe('RemotePathOverlay', () => {
  let rafCallbacks: FrameRequestCallback[];
  beforeEach(() => {
    vi.useFakeTimers();
    rafCallbacks = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      rafCallbacks[id - 1] = () => undefined;
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('applies an active payload per sender and replaces on update', () => {
    const host = makeHost();
    const overlay = new RemotePathOverlay(host);
    expect(overlay.apply('a', active)).toBe(true);
    expect(overlay.apply('a', { ...active, feet: 60 })).toBe(true);
    expect(overlay.activeSenderCount).toBe(1);
    expect(overlay.apply('b', active)).toBe(true);
    expect(overlay.activeSenderCount).toBe(2);
    expect(host.requestRender).toHaveBeenCalled();
  });

  it('ignores malformed and foreign payloads and draws nothing', () => {
    const host = makeHost();
    const overlay = new RemotePathOverlay(host);
    expect(overlay.apply('a', { kind: 'laser', points: [] })).toBe(false);
    expect(overlay.apply('a', { ...active, feet: Number.NaN })).toBe(false);
    expect(overlay.apply('a', { ...active, segmentColors: ['green'] })).toBe(false);
    expect(overlay.activeSenderCount).toBe(0);
    expect(host.drawFrame()).toEqual([]);
  });

  it('draws the path with the payload segment colours', () => {
    const host = makeHost();
    const overlay = new RemotePathOverlay(host);
    overlay.apply('a', active);
    const calls = host.drawFrame();
    expect(calls.filter((c) => c[0] === 'strokeStyle').map((c) => c[1])).toEqual(['green', 'red']);
    expect(calls.filter((c) => c[0] === 'stroke')).toHaveLength(2);
    expect(calls.filter((c) => c[0] === 'arc')).toHaveLength(3);
  });

  it('falls back to the configured colour when the payload omits one', () => {
    const host = makeHost();
    const overlay = new RemotePathOverlay(host, { color: '#123456' });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { color: _color, ...noColor } = active;
    expect(overlay.apply('a', noColor)).toBe(true);
    // The base colour paints the waypoint dots; segment colours paint strokes.
    expect(host.drawFrame()).toContainEqual(['fillStyle', '#123456']);
  });

  it('cleared payload holds, then fades, then deletes', () => {
    const host = makeHost();
    const overlay = new RemotePathOverlay(host); // holdMs 1500, fadeMs 400
    setNow(overlay, 1_000);
    overlay.apply('a', active);
    expect(overlay.apply('a', { kind: 'path', cleared: true })).toBe(true);
    expect(overlay.activeSenderCount).toBe(1); // lingering

    setNow(overlay, 1_000 + 1500 + 200); // halfway through the fade
    rafCallbacks.splice(0).forEach((cb) => cb(0));
    expect(overlay.activeSenderCount).toBe(1);
    expect(host.drawFrame()).toContainEqual(['globalAlpha', 0.5]);

    setNow(overlay, 1_000 + 1500 + 400);
    rafCallbacks.splice(0).forEach((cb) => cb(0));
    expect(overlay.activeSenderCount).toBe(0);
    expect(host.drawFrame()).toEqual([]);
  });

  it('remove deletes immediately without linger and cancels the timer', () => {
    const host = makeHost();
    const overlay = new RemotePathOverlay(host);
    overlay.apply('a', active);
    overlay.remove('a');
    expect(overlay.activeSenderCount).toBe(0);
    expect(host.drawFrame()).toEqual([]);
    vi.advanceTimersByTime(60_000); // no leaked timer fires
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clear removes every sender immediately', () => {
    const host = makeHost();
    const overlay = new RemotePathOverlay(host);
    overlay.apply('a', active);
    overlay.apply('b', active);
    overlay.clear();
    expect(overlay.activeSenderCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('dispose is idempotent, cancels timers, unregisters, and renders once', () => {
    const host = makeHost();
    const overlay = new RemotePathOverlay(host);
    overlay.apply('a', active);
    host.requestRender.mockClear();
    overlay.dispose();
    expect(host.requestRender).toHaveBeenCalledTimes(1); // final erase render
    overlay.dispose();
    expect(host.requestRender).toHaveBeenCalledTimes(1); // not called again
    expect(host.unregistered).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(overlay.apply('a', active)).toBe(false);
    expect(overlay.activeSenderCount).toBe(0);
  });
});
