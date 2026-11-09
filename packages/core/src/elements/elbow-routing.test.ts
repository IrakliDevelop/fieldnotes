import { describe, expect, it } from 'vitest';
import { buildAuthoredElbowPath, routeElbowArrow } from './elbow-routing';

describe('routeElbowArrow', () => {
  it('routes an automatic Z gap around its blocked authored corner', () => {
    const route = routeElbowArrow(
      { from: { x: 120, y: 220 }, to: { x: 560, y: 300 }, width: 4 },
      null,
      null,
      [{ x: 300, y: 180, w: 90, h: 80 }],
    );
    const inflated = { x: 286, y: 166, w: 118, h: 108 };

    expect(route.points).not.toContainEqual({ x: 340, y: 220 });
    for (let index = 1; index < route.points.length; index += 1) {
      const from = route.points[index - 1];
      const to = route.points[index];
      if (!from || !to) throw new Error('expected route segment');
      if (from.x === to.x)
        expect(from.x <= inflated.x || from.x >= inflated.x + inflated.w).toBe(true);
      else expect(from.y <= inflated.y || from.y >= inflated.y + inflated.h).toBe(true);
    }
  });

  it('routes around a blocking rectangle without diagonal segments', () => {
    const route = routeElbowArrow({ from: { x: 0, y: 0 }, to: { x: 100, y: 0 } }, null, null, [
      { x: 40, y: -10, w: 20, h: 20 },
    ]);

    expect(route.points).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: -22 },
      { x: 100, y: -22 },
      { x: 100, y: 0 },
    ]);
    expect(route.segments).toEqual([{}, {}, {}]);
  });

  it('trims the first and last segments at bound-element edges', () => {
    expect(
      routeElbowArrow(
        { from: { x: 0, y: 0 }, to: { x: 100, y: 0 } },
        { x: -10, y: -10, w: 20, h: 20 },
        { x: 90, y: -10, w: 20, h: 20 },
        [],
      ).points,
    ).toEqual([
      { x: 10, y: 0 },
      { x: 90, y: 0 },
    ]);
  });

  it('removes a port-trimmed segment that collapses at its join', () => {
    expect(
      routeElbowArrow(
        { from: { x: 0, y: 0 }, to: { x: 5, y: 0 } },
        { x: -10, y: -10, w: 20, h: 20 },
        null,
        [],
      ),
    ).toEqual({ points: [{ x: 5, y: 0 }], segments: [] });
  });

  it('keeps a truly coincident route empty', () => {
    expect(routeElbowArrow({ from: { x: -3, y: 4 }, to: { x: -3, y: 4 } }, null, null, [])).toEqual(
      { points: [{ x: -3, y: 4 }], segments: [] },
    );
  });
});

describe('buildAuthoredElbowPath', () => {
  it('uses a horizontal-first Z on a distance tie and a straight path for collinear endpoints', () => {
    expect(buildAuthoredElbowPath({ from: { x: 0, y: 0 }, to: { x: 100, y: 100 } }).points).toEqual(
      [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 50, y: 100 },
        { x: 100, y: 100 },
      ],
    );
    expect(buildAuthoredElbowPath({ from: { x: 0, y: 0 }, to: { x: 100, y: 0 } }).points).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
  });

  it('uses a vertical-first Z when the vertical distance is greater', () => {
    expect(buildAuthoredElbowPath({ from: { x: 0, y: 0 }, to: { x: 50, y: 100 } })).toEqual({
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 50 },
        { x: 50, y: 50 },
        { x: 50, y: 100 },
      ],
      segments: [{}, {}, {}],
    });
  });

  it('constructs and tags a single horizontal fixed segment', () => {
    expect(
      buildAuthoredElbowPath({
        from: { x: 0, y: 0 },
        to: { x: 100, y: 100 },
        fixedSegments: [{ axis: 'y', value: 30 }],
      }),
    ).toEqual({
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 30 },
        { x: 100, y: 30 },
        { x: 100, y: 100 },
      ],
      segments: [{}, { fixedIndex: 0 }, {}],
    });
  });

  it('keeps fixed axis tags while constructing perpendicular and parallel constraints', () => {
    const route = buildAuthoredElbowPath({
      from: { x: 0, y: 0 },
      to: { x: 120, y: 120 },
      fixedSegments: [
        { axis: 'x', value: 10 },
        { axis: 'x', value: 20 },
        { axis: 'y', value: 70 },
      ],
    });

    expect(route.points).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 40 },
      { x: 20, y: 40 },
      { x: 20, y: 70 },
      { x: 120, y: 70 },
      { x: 120, y: 120 },
    ]);
    expect(route.segments).toEqual([
      {},
      { fixedIndex: 0 },
      {},
      { fixedIndex: 1 },
      { fixedIndex: 2 },
      {},
    ]);
  });

  it('deduplicates a zero-length fixed segment without dropping its document constraint', () => {
    const route = buildAuthoredElbowPath({
      from: { x: 0, y: 0 },
      to: { x: 100, y: 100 },
      fixedSegments: [{ axis: 'x', value: 0 }],
    });

    expect(route.points).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 100 },
    ]);
    expect(route.segments).toEqual([{ fixedIndex: 0 }, {}]);
  });
});

describe('routeElbowArrow constraints', () => {
  it('keeps fixed segment tags deterministic', () => {
    const arrow = {
      from: { x: 0, y: 0 },
      to: { x: 100, y: 100 },
      fixedSegments: [
        { axis: 'x' as const, value: 30 },
        { axis: 'y' as const, value: 40 },
      ],
    };
    const first = routeElbowArrow(arrow, null, null, []);

    expect(first).toEqual({
      points: [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
        { x: 30, y: 40 },
        { x: 100, y: 40 },
        { x: 100, y: 100 },
      ],
      segments: [{}, { fixedIndex: 0 }, { fixedIndex: 1 }, {}],
    });
    expect(routeElbowArrow(arrow, null, null, [])).toEqual(first);
  });

  it('falls back to the authored path when the graph exceeds its axis bound', () => {
    const obstacles = Array.from({ length: 70 }, (_, index) => ({
      x: index * 2,
      y: index * 2,
      w: 1,
      h: 1,
    }));

    expect(
      routeElbowArrow(
        {
          from: { x: 0, y: 0 },
          to: { x: 100, y: 100 },
          fixedSegments: [
            { axis: 'x', value: 20 },
            { axis: 'y', value: 30 },
          ],
        },
        null,
        null,
        obstacles,
      ),
    ).toEqual({
      points: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 30 },
        { x: 100, y: 30 },
        { x: 100, y: 100 },
      ],
      segments: [{}, { fixedIndex: 0 }, { fixedIndex: 1 }, {}],
    });
  });

  it('routes a negative-coordinate constrained gap around an obstacle', () => {
    expect(
      routeElbowArrow(
        {
          from: { x: -100, y: -100 },
          to: { x: 100, y: 100 },
          fixedSegments: [{ axis: 'x', value: -50 }],
        },
        null,
        null,
        [{ x: 0, y: 80, w: 20, h: 40 }],
      ),
    ).toEqual({
      points: [
        { x: -100, y: -100 },
        { x: -50, y: -100 },
        { x: -50, y: 100 },
        { x: -50, y: 68 },
        { x: 100, y: 68 },
        { x: 100, y: 100 },
      ],
      segments: [{}, { fixedIndex: 0 }, {}, {}, {}],
    });
  });
});
