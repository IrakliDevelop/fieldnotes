import type { Bounds, Point } from '../core/types';
import type { ArrowFixedSegment } from './types';

export const ELBOW_ROUTE_MARGIN = 256;
const ELBOW_ROUTE_CLEARANCE = 12;
const MAX_AXES = 140;
const MAX_EXPANDED_STATES = 20_000;

interface ElbowArrowData {
  readonly from: Point;
  readonly to: Point;
  readonly fixedSegments?: readonly ArrowFixedSegment[];
  readonly width?: number;
}

export interface ElbowRoute {
  points: Point[];
  segments: { fixedIndex?: number }[];
}

export function getElbowRouteBounds(arrow: ElbowArrowData): Bounds {
  return routeRegion(buildAuthoredElbowPath(arrow).points);
}

interface Segment {
  from: Point;
  to: Point;
  fixedIndex?: number;
}

interface State {
  x: number;
  y: number;
  direction: number;
  cost: number;
  score: number;
  previous?: State;
}

class MinHeap {
  private readonly values: State[] = [];

  push(value: State): void {
    this.values.push(value);
    let index = this.values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      const parentValue = this.values[parent];
      if (!parentValue || compareStates(parentValue, value) <= 0) break;
      this.values[index] = parentValue;
      index = parent;
    }
    this.values[index] = value;
  }

  pop(): State | undefined {
    const first = this.values[0];
    const last = this.values.pop();
    if (!first || !last || this.values.length === 0) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let child = left;
      if (right < this.values.length) {
        const leftValue = this.values[left];
        const rightValue = this.values[right];
        if (leftValue && rightValue && compareStates(rightValue, leftValue) < 0) child = right;
      }
      const childValue = this.values[child];
      if (!childValue || compareStates(last, childValue) <= 0) break;
      this.values[index] = childValue;
      index = child;
    }
    this.values[index] = last;
    return first;
  }
}

function compareStates(a: State, b: State): number {
  return (
    a.score - b.score || a.cost - b.cost || a.x - b.x || a.y - b.y || a.direction - b.direction
  );
}

export function buildAuthoredElbowPath(arrow: ElbowArrowData): ElbowRoute {
  const points: Point[] = [arrow.from];
  const segments: { fixedIndex?: number }[] = [];
  const append = (point: Point, fixedIndex?: number): void => {
    const previous = points[points.length - 1];
    if (!previous || (previous.x === point.x && previous.y === point.y)) return;
    points.push(point);
    segments.push(fixedIndex === undefined ? {} : { fixedIndex });
  };
  const fixed = arrow.fixedSegments ?? [];

  if (fixed.length === 0) {
    if (arrow.from.x === arrow.to.x || arrow.from.y === arrow.to.y) {
      append(arrow.to);
      return { points, segments };
    }
    if (Math.abs(arrow.to.x - arrow.from.x) >= Math.abs(arrow.to.y - arrow.from.y)) {
      append({ x: (arrow.from.x + arrow.to.x) / 2, y: arrow.from.y });
      append({ x: (arrow.from.x + arrow.to.x) / 2, y: arrow.to.y });
    } else {
      append({ x: arrow.from.x, y: (arrow.from.y + arrow.to.y) / 2 });
      append({ x: arrow.to.x, y: (arrow.from.y + arrow.to.y) / 2 });
    }
    append(arrow.to);
    return { points, segments };
  }

  for (let index = 0; index < fixed.length; index += 1) {
    const segment = fixed[index];
    if (!segment) continue;
    const next = fixed[index + 1];
    const previous = points[points.length - 1] ?? arrow.from;
    if (segment.axis === 'x') {
      append({ x: segment.value, y: previous.y });
      let y = arrow.to.y;
      if (next) {
        y =
          next.axis === 'y'
            ? next.value
            : arrow.from.y + ((arrow.to.y - arrow.from.y) * (index + 1)) / fixed.length;
      }
      append({ x: segment.value, y }, index);
    } else {
      append({ x: previous.x, y: segment.value });
      let x = arrow.to.x;
      if (next) {
        x =
          next.axis === 'x'
            ? next.value
            : arrow.from.x + ((arrow.to.x - arrow.from.x) * (index + 1)) / fixed.length;
      }
      append({ x, y: segment.value }, index);
    }
  }
  append(arrow.to);
  return { points, segments };
}

export function routeElbowArrow(
  arrow: ElbowArrowData,
  fromBounds: Bounds | null,
  toBounds: Bounds | null,
  obstacles: readonly Bounds[],
): ElbowRoute {
  const authored = buildAuthoredElbowPath(arrow);
  if (authored.points.length < 2 || (arrow.from.x === arrow.to.x && arrow.from.y === arrow.to.y)) {
    return trimRoute(authored, fromBounds, toBounds);
  }

  const region = routeRegion(authored.points);
  const clearance = ELBOW_ROUTE_CLEARANCE + (arrow.width ?? 0) / 2;
  const blocked = obstacles.map((obstacle) => inflateAndClip(obstacle, clearance, region));
  const result: ElbowRoute = { points: [authored.points[0] ?? arrow.from], segments: [] };
  const authoredSegments = toSegments(authored);
  let expanded = 0;

  for (const segment of authoredSegments) {
    if (segment.fixedIndex !== undefined) {
      appendRoute(result, [segment.from, segment.to], segment.fixedIndex);
      continue;
    }
    const path = findPath(segment.from, segment.to, blocked, region, () => {
      expanded += 1;
      return expanded <= MAX_EXPANDED_STATES;
    });
    if (!path) return trimRoute(authored, fromBounds, toBounds);
    appendRoute(result, path);
  }
  return trimRoute(simplifyRoute(result), fromBounds, toBounds);
}

/** Builds the persisted-data path used for elbow labels without obstacle routing. */
export function getAuthoredElbowRoute(
  arrow: ElbowArrowData,
  fromBounds: Bounds | null,
  toBounds: Bounds | null,
): ElbowRoute {
  return trimRoute(buildAuthoredElbowPath(arrow), fromBounds, toBounds);
}

function trimRoute(
  route: ElbowRoute,
  fromBounds: Bounds | null,
  toBounds: Bounds | null,
): ElbowRoute {
  const points = route.points.map((point) => ({ ...point }));
  if (fromBounds && points[0] && points[1])
    points[0] = trimEndpoint(points[0], points[1], fromBounds);
  const lastIndex = points.length - 1;
  const last = points[lastIndex];
  const penultimate = points[lastIndex - 1];
  if (toBounds && last && penultimate) {
    points[lastIndex] = trimEndpoint(last, penultimate, toBounds);
  }
  return dedupeRoute({ points, segments: route.segments });
}

function dedupeRoute(route: ElbowRoute): ElbowRoute {
  const points = [route.points[0] ?? { x: 0, y: 0 }];
  const segments: { fixedIndex?: number }[] = [];
  for (let index = 1; index < route.points.length; index += 1) {
    const point = route.points[index];
    const previous = points[points.length - 1];
    if (!point || !previous || (point.x === previous.x && point.y === previous.y)) continue;
    points.push(point);
    segments.push(route.segments[index - 1] ?? {});
  }
  return { points, segments };
}

function trimEndpoint(endpoint: Point, join: Point, bounds: Bounds): Point {
  if (
    endpoint.x < bounds.x ||
    endpoint.x > bounds.x + bounds.w ||
    endpoint.y < bounds.y ||
    endpoint.y > bounds.y + bounds.h
  ) {
    return endpoint;
  }
  const dx = join.x - endpoint.x;
  const dy = join.y - endpoint.y;
  if (dx === 0 && dy === 0) return endpoint;
  let horizontal = Infinity;
  if (dx > 0) horizontal = (bounds.x + bounds.w - endpoint.x) / dx;
  if (dx < 0) horizontal = (bounds.x - endpoint.x) / dx;
  let vertical = Infinity;
  if (dy > 0) vertical = (bounds.y + bounds.h - endpoint.y) / dy;
  if (dy < 0) vertical = (bounds.y - endpoint.y) / dy;
  const distances = [horizontal, vertical];
  const distance = Math.min(...distances.filter((value) => value >= 0));
  if (!Number.isFinite(distance)) return endpoint;
  const t = Math.min(1, distance);
  return { x: endpoint.x + dx * t, y: endpoint.y + dy * t };
}

function routeRegion(points: readonly Point[]): Bounds {
  let minX = points[0]?.x ?? 0;
  let maxX = minX;
  let minY = points[0]?.y ?? 0;
  let maxY = minY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  return {
    x: minX - ELBOW_ROUTE_MARGIN,
    y: minY - ELBOW_ROUTE_MARGIN,
    w: maxX - minX + ELBOW_ROUTE_MARGIN * 2,
    h: maxY - minY + ELBOW_ROUTE_MARGIN * 2,
  };
}

function inflateAndClip(bounds: Bounds, amount: number, region: Bounds): Bounds {
  const left = Math.max(region.x, bounds.x - amount);
  const top = Math.max(region.y, bounds.y - amount);
  const right = Math.min(region.x + region.w, bounds.x + bounds.w + amount);
  const bottom = Math.min(region.y + region.h, bounds.y + bounds.h + amount);
  return { x: left, y: top, w: Math.max(0, right - left), h: Math.max(0, bottom - top) };
}

function toSegments(route: ElbowRoute): Segment[] {
  const result: Segment[] = [];
  for (let index = 0; index < route.segments.length; index += 1) {
    const from = route.points[index];
    const to = route.points[index + 1];
    const metadata = route.segments[index];
    if (from && to) result.push({ from, to, fixedIndex: metadata?.fixedIndex });
  }
  return result;
}

function appendRoute(route: ElbowRoute, points: readonly Point[], fixedIndex?: number): void {
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    const previous = route.points[route.points.length - 1];
    if (!point || !previous || (point.x === previous.x && point.y === previous.y)) continue;
    route.points.push(point);
    route.segments.push(fixedIndex === undefined ? {} : { fixedIndex });
  }
}

function findPath(
  from: Point,
  to: Point,
  obstacles: readonly Bounds[],
  region: Bounds,
  consumeExpansion: () => boolean,
): Point[] | null {
  if (from.x === to.x && from.y === to.y) return [from];
  const xs = uniqueSorted([
    from.x,
    to.x,
    region.x,
    region.x + region.w,
    ...obstacles.flatMap((b) => [b.x, b.x + b.w]),
  ]);
  const ys = uniqueSorted([
    from.y,
    to.y,
    region.y,
    region.y + region.h,
    ...obstacles.flatMap((b) => [b.y, b.y + b.h]),
  ]);
  if (xs.length > MAX_AXES || ys.length > MAX_AXES) return null;
  const startX = xs.indexOf(from.x);
  const startY = ys.indexOf(from.y);
  const targetX = xs.indexOf(to.x);
  const targetY = ys.indexOf(to.y);
  if (startX < 0 || startY < 0 || targetX < 0 || targetY < 0) return null;

  const queue = new MinHeap();
  const start: State = { x: startX, y: startY, direction: 4, cost: 0, score: manhattan(from, to) };
  queue.push(start);
  const costs = new Map<string, number>();
  costs.set(stateKey(start), 0);
  const directions = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ] as const;

  for (let state = queue.pop(); state; state = queue.pop()) {
    if (!consumeExpansion()) return null;
    if (state.x === targetX && state.y === targetY) return reconstruct(state, xs, ys);
    const point = { x: xs[state.x] ?? 0, y: ys[state.y] ?? 0 };
    for (let direction = 0; direction < directions.length; direction += 1) {
      const delta = directions[direction];
      if (!delta) continue;
      const x = state.x + delta[0];
      const y = state.y + delta[1];
      const xValue = xs[x];
      const yValue = ys[y];
      if (xValue === undefined || yValue === undefined) continue;
      const nextPoint = { x: xValue, y: yValue };
      if (crossesObstacle(point, nextPoint, obstacles)) continue;
      const cost =
        state.cost +
        manhattan(point, nextPoint) +
        (state.direction === 4 || state.direction === direction ? 0 : 20);
      const next: State = {
        x,
        y,
        direction,
        cost,
        score: cost + manhattan(nextPoint, to),
        previous: state,
      };
      const key = stateKey(next);
      const previousCost = costs.get(key);
      if (previousCost !== undefined && previousCost <= cost) continue;
      costs.set(key, cost);
      queue.push(next);
    }
  }
  return null;
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function crossesObstacle(from: Point, to: Point, obstacles: readonly Bounds[]): boolean {
  for (const obstacle of obstacles) {
    const right = obstacle.x + obstacle.w;
    const bottom = obstacle.y + obstacle.h;
    if (from.y === to.y && from.y > obstacle.y && from.y < bottom) {
      if (Math.max(from.x, to.x) > obstacle.x && Math.min(from.x, to.x) < right) return true;
    }
    if (from.x === to.x && from.x > obstacle.x && from.x < right) {
      if (Math.max(from.y, to.y) > obstacle.y && Math.min(from.y, to.y) < bottom) return true;
    }
  }
  return false;
}

function reconstruct(state: State, xs: readonly number[], ys: readonly number[]): Point[] {
  const points: Point[] = [];
  for (let current: State | undefined = state; current; current = current.previous) {
    const x = xs[current.x];
    const y = ys[current.y];
    if (x !== undefined && y !== undefined) points.push({ x, y });
  }
  return points.reverse();
}

function stateKey(state: State): string {
  return `${state.x}:${state.y}:${state.direction}`;
}

function manhattan(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function simplifyRoute(route: ElbowRoute): ElbowRoute {
  const result: ElbowRoute = { points: [route.points[0] ?? { x: 0, y: 0 }], segments: [] };
  for (let index = 0; index < route.segments.length; index += 1) {
    const point = route.points[index + 1];
    const segment = route.segments[index];
    const previous = result.points[result.points.length - 1];
    const before = result.points[result.points.length - 2];
    if (!point || !segment || !previous) continue;
    if (
      before &&
      segment.fixedIndex === undefined &&
      result.segments[result.segments.length - 1]?.fixedIndex === undefined
    ) {
      if (
        (before.x === previous.x && previous.x === point.x) ||
        (before.y === previous.y && previous.y === point.y)
      ) {
        result.points[result.points.length - 1] = point;
        continue;
      }
    }
    result.points.push(point);
    result.segments.push(segment);
  }
  return result;
}
