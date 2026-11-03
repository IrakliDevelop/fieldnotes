import { describe, expect, it } from 'vitest';
import { trailMap } from './trail';

const six = { built: ['a', 'b', 'c'], next: ['d'], notBuilt: ['e', 'f'] };
const five = { built: ['a', 'b', 'c'], next: [], notBuilt: ['e', 'f'] };

const round = (value: number) => Math.round(value * 10) / 10;

function trailPoint(total: number, t: number) {
  const height = 120 + 26 * total;
  const cycles = 2 * Math.round((total - 10) / 20) + 1.3;
  return {
    x: round(230 + 160 * Math.sin(Math.PI * cycles * t) + 3 * Math.sin(61 * t)),
    y: round(70 + t * (height - 152) + 2 * Math.sin(47 * t)),
  };
}

function intersects(
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
) {
  return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
}

const counts: [number, number, number][] = [];
for (let built = 20; built <= 45; built += 1) {
  for (let next = 0; next <= 2; next += 1) {
    for (let notBuilt = 0; notBuilt <= 4; notBuilt += 1) {
      counts.push([built, next, notBuilt]);
    }
  }
}

describe('trailMap', () => {
  it('places one numbered waypoint per item in section order', () => {
    expect(trailMap(six).waypoints).toEqual([
      { n: 1, x: 301.6, y: 82, kind: 'built' },
      { n: 2, x: 358.6, y: 95.9, kind: 'built' },
      { n: 3, x: 389.5, y: 111.4, kind: 'built' },
      { n: 4, x: 354.4, y: 140.5, kind: 'next' },
      { n: 5, x: 223.5, y: 164.6, kind: 'notBuilt' },
      { n: 6, x: 152.7, y: 178.6, kind: 'notBuilt' },
    ]);
  });

  it('splits the trail at the section boundaries and shares the boundary points', () => {
    const map = trailMap(six);
    expect(map.built.startsWith('M230 70L')).toBe(true);
    expect(map.built.endsWith('L388 126.9')).toBe(true);
    expect(map.next.startsWith('M388 126.9L')).toBe(true);
    expect(map.next.endsWith('L295.6 152.5')).toBe(true);
    expect(map.unexplored.startsWith('M295.6 152.5L')).toBe(true);
    expect(map.unexplored.endsWith('L97.7 194.2')).toBe(true);
  });

  it('pitches the tent on the first Next waypoint and writes the notes beside it', () => {
    const map = trailMap(six);
    expect(map.camp).toEqual({ x: 354.4, y: 140.5 });
    expect(map.notes).toEqual({ here: { x: 186.4, y: 124.5 }, unexplored: { x: 8, y: 176.2 } });
  });

  it('sizes the paper to the item count', () => {
    expect(trailMap(six)).toMatchObject({ width: 460, height: 276 });
    expect(trailMap(five).height).toBe(250);
  });

  it('pitches the tent on the last Built waypoint when Next is empty and drops the note below it', () => {
    const map = trailMap(five);
    expect(map.waypoints).toEqual([
      { n: 1, x: 311.1, y: 81.5, kind: 'built' },
      { n: 2, x: 367.7, y: 93, kind: 'built' },
      { n: 3, x: 387.6, y: 104.9, kind: 'built' },
      { n: 4, x: 245.5, y: 142.2, kind: 'notBuilt' },
      { n: 5, x: 163.1, y: 155.2, kind: 'notBuilt' },
    ]);
    expect(map.camp).toEqual({ x: 387.6, y: 104.9 });
    expect(map.notes.here).toEqual({ x: 219.6, y: 134.9 });
    expect(map.next.startsWith('M370.2 117L')).toBe(true);
    expect(map.next.endsWith('L320.1 129.5')).toBe(true);
  });

  it('writes no Unexplored note when Not built yet is empty', () => {
    const map = trailMap({ built: ['a', 'b', 'c'], next: ['d'], notBuilt: [] });
    expect(map.height).toBe(224);
    expect(map.camp).toEqual({ x: 264.4, y: 123.1 });
    expect(map.notes).toEqual({ here: { x: 96.4, y: 107.1 } });
    expect(map.waypoints).toEqual([
      { n: 1, x: 320.1, y: 81.1, kind: 'built' },
      { n: 2, x: 374.2, y: 92.1, kind: 'built' },
      { n: 3, x: 390, y: 102.8, kind: 'built' },
      { n: 4, x: 264.4, y: 123.1, kind: 'next' },
    ]);
  });

  it('moves terrain and hills with the height', () => {
    const map = trailMap(six);
    expect(map.terrain[0]).toBe('M18 33.7c40-6 70 10 96 4');
    expect(map.hills[0]).toBe('M250 248l40-62 26 34 22-30 46 58');
    expect(map.terrain).toHaveLength(4);
    expect(map.hills).toHaveLength(3);
  });

  it.each(counts)(
    'keeps the notes on the paper, off the waypoints and off the trail: %i built, %i next, %i not built',
    (nb, nn, nnb) => {
      const roadmap = {
        built: Array.from({ length: nb }, String),
        next: Array.from({ length: nn }, String),
        notBuilt: Array.from({ length: nnb }, String),
      };
      const map = trailMap(roadmap);
      const samples = Array.from({ length: 241 }, (_, index) =>
        trailPoint(nb + nn + nnb, index / 240),
      );
      const noteBoxes = [{ point: map.notes.here, width: 124, top: 25, bottom: 6 }];
      if (map.notes.unexplored !== undefined) {
        noteBoxes.push({ point: map.notes.unexplored, width: 96, top: 15, bottom: 10 });
      }

      expect(map.notes.unexplored !== undefined).toBe(nnb > 0);
      for (const note of noteBoxes) {
        const box = [
          note.point.x,
          note.point.y - note.top,
          note.point.x + note.width,
          note.point.y + note.bottom,
        ] as const;
        expect(box[0]).toBeGreaterThanOrEqual(0);
        expect(box[2]).toBeLessThanOrEqual(map.width);
        expect(box[1]).toBeGreaterThanOrEqual(0);
        expect(box[3]).toBeLessThanOrEqual(map.height);
        for (const waypoint of map.waypoints) {
          expect(
            intersects(box, [waypoint.x - 8, waypoint.y - 9, waypoint.x + 26, waypoint.y + 9]),
          ).toBe(false);
        }
        for (const sample of samples) {
          expect(
            sample.x >= box[0] && sample.x <= box[2] && sample.y >= box[1] && sample.y <= box[3],
          ).toBe(false);
        }
      }
    },
  );
});
