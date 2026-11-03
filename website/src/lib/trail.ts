import type { Roadmap } from './roadmap';
export type WaypointKind = 'built' | 'next' | 'notBuilt';
export interface Point {
  readonly x: number;
  readonly y: number;
}
export interface Waypoint extends Point {
  /** 1-based across all sections. */
  readonly n: number;
  readonly kind: WaypointKind;
}
export interface TrailMap {
  /** Always 460. */
  readonly width: number;
  readonly height: number;
  readonly built: string;
  readonly next: string;
  readonly unexplored: string;
  readonly camp: Point;
  /** Anchor coordinates for baseline-left note text. */
  readonly notes: {
    readonly here: Point;
    /** Absent when Not built yet is empty. */
    readonly unexplored?: Point;
  };
  readonly waypoints: readonly Waypoint[];
  readonly terrain: readonly string[];
  readonly hills: readonly string[];
}
const round = (value: number) => Math.round(value * 10) / 10;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** Draws the roadmap as a switchback trail; the same roadmap always gives the same map. */
export function trailMap(roadmap: Roadmap): TrailMap {
  const nb = roadmap.built.length;
  const nn = roadmap.next.length;
  const nnb = roadmap.notBuilt.length;
  const total = nb + nn + nnb;
  const width = 460;
  const height = 120 + 26 * total;
  const cycles = 2 * Math.round((total - 10) / 20) + 1.3;
  const slot = 1 / (total + 3);
  const point = (t: number): Point => ({
    x: round(230 + 160 * Math.sin(Math.PI * cycles * t) + 3 * Math.sin(61 * t)),
    y: round(70 + t * (height - 152) + 2 * Math.sin(47 * t)),
  });
  const path = (start: number, end: number) =>
    Array.from({ length: 81 }, (_, index) => {
      const { x, y } = point(start + ((end - start) * index) / 80);
      return `${index === 0 ? 'M' : 'L'}${x} ${y}`;
    }).join('');
  const waypoints: Waypoint[] = [];
  const addWaypoints = (length: number, offset: number, kind: WaypointKind) => {
    for (let index = 0; index < length; index += 1)
      waypoints.push({ ...point((offset + index) * slot), n: waypoints.length + 1, kind });
  };
  addWaypoints(nb, 1, 'built');
  addWaypoints(nn, nb + 2, 'next');
  addWaypoints(nnb, nb + nn + 3, 'notBuilt');
  const camp = nn > 0 ? point((nb + 2) * slot) : point(nb * slot);
  const hereX = round(clamp(camp.x - 168, 8, 328));
  const x0 = hereX;
  const x1 = hereX + 124;
  const y0 = camp.y - 41;
  const y1 = camp.y - 10;
  const hereY = round(
    !waypoints.some(({ x, y }) => x0 < x + 26 && x - 8 < x1 && y0 < y + 9 && y - 9 < y1) &&
      !Array.from({ length: 241 }, (_, index) => point(index / 240)).some(
        ({ x, y }) => x >= x0 && x <= x1 && y >= y0 && y <= y1,
      )
      ? camp.y - 16
      : camp.y + 30,
  );
  const end = point(1);
  const here = { x: hereX, y: hereY };
  const notes = {
    here,
    ...(nnb > 0 && {
      unexplored: { x: round(clamp(end.x - 112, 8, 356)), y: round(end.y - 18) },
    }),
  };
  return {
    width,
    height,
    built: path(0, (nb + 1) * slot),
    next: path((nb + 1) * slot, (nb + nn + 2) * slot),
    unexplored: path((nb + nn + 2) * slot, 1),
    camp,
    notes,
    waypoints,
    terrain: [
      `M18 ${round(0.122 * height)}c40-6 70 10 96 4`,
      `M300 ${round(0.061 * height)}c30 8 60-4 100 6`,
      `M30 ${round(0.53 * height)}c50 6 80-8 120 0`,
      `M320 ${round(0.449 * height)}c34-6 62 6 110-2`,
    ],
    hills: [
      `M250 ${height - 28}l40-62 26 34 22-30 46 58`,
      `M280 ${height - 74}l10-16 9 12M330 ${height - 78}l8-8 7 9`,
      `M20 ${height - 22}l28-40 22 30 18-22 34 32`,
    ],
  };
}
