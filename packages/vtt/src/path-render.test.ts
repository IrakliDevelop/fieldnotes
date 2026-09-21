import { describe, expect, it, vi } from 'vitest';
import { drawPath, resolveSegmentColors } from './path-render';

/** Recording call shape: [method-or-property, ...args-or-value]. */
type Call = [string, ...unknown[]];

function makeCtx(): CanvasRenderingContext2D & { calls: Call[] } {
  // jsdom provides no real 2D context; a recording stub is enough — the
  // pixel-level contract is covered by e2e. Copied from measure-render.test.ts
  // and extended to log property sets (strokeStyle, fillStyle, globalAlpha)
  // so call ORDER is discriminable, not just the final value.
  const calls: Call[] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
    };
  const ctx = {
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
  return ctx;
}

describe('resolveSegmentColors', () => {
  const bands = [
    { feet: 30, color: 'green' },
    { feet: 60, color: 'yellow' },
  ];

  it('colours each segment by the running total at its end', () => {
    expect(resolveSegmentColors([0, 15, 30, 45, 60, 75], bands, 'red')).toEqual([
      'green',
      'green',
      'yellow',
      'yellow',
      'red',
    ]);
  });

  it('unsorted bands are still applied ascending', () => {
    // end=20 is covered by both bands (30 and 60), so the correct answer is
    // the TIGHTEST one (30→green). Feeding bands in descending order proves
    // the result comes from an ascending sort, not array-encounter order —
    // an unsorted `find` would hit 60 first and wrongly return 'yellow'.
    expect(resolveSegmentColors([0, 20], [...bands].reverse(), 'red')).toEqual(['green']);
  });

  it('no bands → base colour; no segments → empty', () => {
    expect(resolveSegmentColors([0, 10], [], 'red')).toEqual(['red']);
    expect(resolveSegmentColors([0], bands, 'red')).toEqual([]);
  });
});

describe('drawPath', () => {
  const points = [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 40 },
  ];

  it('strokes one dashed segment per pair of points in its own colour, dots every point, one label at the end', () => {
    const ctx = makeCtx();
    drawPath(ctx, { points, segmentColors: ['green', 'red'], color: 'blue', feet: 10 });

    const strokeColours = ctx.calls.filter((c) => c[0] === 'strokeStyle').map((c) => c[1]);
    expect(strokeColours).toEqual(['green', 'red']);

    const dashCalls = ctx.calls.filter((c) => c[0] === 'setLineDash');
    // one [8,4] dash set immediately before each of the two strokes, plus a
    // final [] reset before the dots.
    expect(dashCalls).toEqual([
      ['setLineDash', [8, 4]],
      ['setLineDash', [8, 4]],
      ['setLineDash', []],
    ]);

    // dash-before-stroke ordering, per segment.
    const strokeIdx = ctx.calls.findIndex((c) => c[0] === 'stroke');
    const firstDashIdx = ctx.calls.findIndex((c) => c[0] === 'setLineDash');
    expect(firstDashIdx).toBeLessThan(strokeIdx);
    expect(ctx.stroke).toHaveBeenCalledTimes(2);

    expect(ctx.arc).toHaveBeenCalledTimes(points.length);

    expect(ctx.fillText).toHaveBeenCalledTimes(1);
    expect(ctx.fillText).toHaveBeenCalledWith('10 ft', 40, 40 - 18);
  });

  it('applies alpha and restores', () => {
    const ctx = makeCtx();
    drawPath(
      ctx,
      { points, segmentColors: ['green', 'red'], color: 'blue', feet: 10 },
      { alpha: 0.5 },
    );

    expect(ctx.calls).toContainEqual(['globalAlpha', 0.5]);
    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
  });

  it('never sets globalAlpha when alpha is omitted', () => {
    const ctx = makeCtx();
    drawPath(ctx, { points, segmentColors: ['green', 'red'], color: 'blue', feet: 10 });

    expect(ctx.calls.some((c) => c[0] === 'globalAlpha')).toBe(false);
  });

  it('a single point draws a dot and no segment or label', () => {
    const ctx = makeCtx();
    drawPath(ctx, { points: [{ x: 5, y: 5 }], segmentColors: [], color: 'blue', feet: 0 });

    expect(ctx.stroke).not.toHaveBeenCalled();
    expect(ctx.arc).toHaveBeenCalledTimes(1);
    expect(ctx.fillText).not.toHaveBeenCalled();
    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
  });

  it('empty points draws nothing at all', () => {
    const ctx = makeCtx();
    drawPath(ctx, { points: [], segmentColors: [], color: 'blue', feet: 0 });

    expect(ctx.save).not.toHaveBeenCalled();
    expect(ctx.restore).not.toHaveBeenCalled();
    expect(ctx.arc).not.toHaveBeenCalled();
    expect(ctx.stroke).not.toHaveBeenCalled();
    expect(ctx.fillText).not.toHaveBeenCalled();
  });
});
