import type { Point } from '../core/types';
import type { HexOrientation } from '../elements/types';
import type { Tool, ToolContext, PointerState } from './types';
import { snapPoint, snapToHexCenter, snapToCellCenter } from '../core/snap';
import type { Footprint } from '../core/snap';
import { pathDistanceCells } from '../core/grid-metric';
import type { DiagonalRule } from '../core/grid-metric';
import { drawPath, resolveSegmentColors } from '../canvas/path-render';

/** A running-total threshold: segments up to `feet` are drawn in `color`. */
export interface PathRangeBand {
  readonly feet: number;
  readonly color: string;
}

/**
 * Where a path starts. A host resolves the pointer to the thing being moved
 * (a token, a marker) so the path anchors on it instead of the raw cursor;
 * `anchorKey` is opaque to the tool and echoed back on every emission so the
 * host can apply the move it asked for.
 */
export interface PathAnchor {
  origin: Point;
  footprint?: Footprint;
  anchorKey?: string;
}

export interface PathToolOptions {
  feetPerCell?: number;
  color?: string;
  diagonalRule?: DiagonalRule;
  footprint?: Footprint;
  rangeBands?: readonly PathRangeBand[];
  /**
   * Screen-space radius, in CSS pixels, around the last waypoint inside which a
   * tap finishes the path instead of adding a corner. Default `12`. Screen
   * space so the target keeps its physical size at any zoom; `0` restores
   * exact-match-only commits (a fingertip can never hit an exact world point on
   * a gridless canvas, so a touch commit needs the tolerance).
   */
  commitTapRadiusPx?: number;
  /** Returning `null` vetoes the gesture — no path opens and nothing is emitted. */
  resolveStart?: (world: Point, ctx: ToolContext) => PathAnchor | null;
}

export interface PathSegment {
  readonly cells: number;
  readonly feet: number;
}

/**
 * A raf-coalesced snapshot of the in-progress path. `waypoints` are the
 * committed corners; `cursor` is the rubber-banding end (null once the path
 * closes) and is counted in the totals without being a waypoint. Ephemeral by
 * contract: presence only — never elements, history, or persisted state.
 */
export interface PathEmission {
  readonly anchorKey?: string;
  readonly waypoints: readonly Point[];
  readonly cursor: Point | null;
  readonly segments: readonly PathSegment[];
  readonly totalCells: number;
  readonly totalFeet: number;
  readonly color: string;
  readonly rangeBands: readonly PathRangeBand[];
}

const EPS = 1e-6;

const DEFAULT_COMMIT_TAP_RADIUS_PX = 12;

function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS;
}

/**
 * Multi-waypoint movement measuring: tap to anchor, drag or click to add
 * corners, tap on or near the last waypoint (or press Enter) to finish, Escape
 * or a pointer takeover to abandon.
 *
 * Store-free by contract: the tool never creates, moves, or deletes elements
 * and never opens a history transaction — it only measures. A completed path
 * is handed to `onCommit` listeners and the HOST applies the move (inside its
 * own transaction) if it wants one. Path snapshots are ephemeral in the same
 * sense as `MeasureTool`'s: presence only — never elements, history, or
 * persisted state.
 */
export class PathTool implements Tool {
  readonly name = 'path';
  private feetPerCell: number;
  private color: string;
  private diagonalRule: DiagonalRule;
  private footprintOption: Footprint;
  private rangeBands: readonly PathRangeBand[];
  private commitTapRadiusPx: number;
  private resolveStart: PathToolOptions['resolveStart'];

  private waypoints: Point[] = [];
  private cursor: Point | null = null;
  private anchorKey: string | undefined;
  private footprint: Footprint = 1;
  private pointerDown = false;
  private commitOnUp = false;

  // Grid state is captured at the opening pointer-down so a path measured on
  // one grid keeps that metric even if the host reconfigures mid-gesture.
  private gridSize = 0;
  private gridType: 'square' | 'hex' | undefined;
  private hexOrientation: HexOrientation | undefined;
  private snapEnabled = false;

  private optionListeners = new Set<() => void>();
  private pathListeners = new Set<(emission: PathEmission | null) => void>();
  private commitListeners = new Set<(emission: PathEmission) => void>();
  private emissionRafId: number | null = null;

  constructor(options: PathToolOptions = {}) {
    this.feetPerCell = options.feetPerCell ?? 5;
    this.color = options.color ?? '#FF5722';
    this.diagonalRule = options.diagonalRule ?? 'euclidean';
    this.footprintOption = options.footprint ?? 1;
    this.rangeBands = options.rangeBands ?? [];
    this.commitTapRadiusPx = options.commitTapRadiusPx ?? DEFAULT_COMMIT_TAP_RADIUS_PX;
    this.resolveStart = options.resolveStart;
  }

  getOptions(): PathToolOptions {
    return {
      feetPerCell: this.feetPerCell,
      color: this.color,
      diagonalRule: this.diagonalRule,
      footprint: this.footprintOption,
      rangeBands: this.rangeBands,
      commitTapRadiusPx: this.commitTapRadiusPx,
      resolveStart: this.resolveStart,
    };
  }

  setOptions(options: PathToolOptions): void {
    if (options.feetPerCell !== undefined) this.feetPerCell = options.feetPerCell;
    if (options.color !== undefined) this.color = options.color;
    if (options.diagonalRule !== undefined) this.diagonalRule = options.diagonalRule;
    if (options.footprint !== undefined) this.footprintOption = options.footprint;
    if (options.rangeBands !== undefined) this.rangeBands = options.rangeBands;
    if (options.commitTapRadiusPx !== undefined) {
      this.commitTapRadiusPx = options.commitTapRadiusPx;
    }
    if (options.resolveStart !== undefined) this.resolveStart = options.resolveStart;
    this.notifyOptionsChange();
  }

  onOptionsChange(listener: () => void): () => void {
    this.optionListeners.add(listener);
    return () => this.optionListeners.delete(listener);
  }

  /**
   * Subscribes to raf-coalesced path snapshots. While a path is open,
   * listeners receive at most one snapshot per animation frame carrying the
   * latest state; `null` is delivered synchronously when the path closes
   * (commit, cancel, or deactivate).
   */
  onPath(listener: (emission: PathEmission | null) => void): () => void {
    this.pathListeners.add(listener);
    return () => this.pathListeners.delete(listener);
  }

  /**
   * Subscribes to finished paths. The emission carries `cursor: null` and the
   * final waypoints; applying the move (and recording history for it) is the
   * host's job — the tool has already forgotten the path by then.
   */
  onCommit(listener: (emission: PathEmission) => void): () => void {
    this.commitListeners.add(listener);
    return () => this.commitListeners.delete(listener);
  }

  get isOpen(): boolean {
    return this.waypoints.length > 0;
  }

  /** Synchronous snapshot of the open path; `null` when no path is open. */
  getEmission(): PathEmission | null {
    if (!this.isOpen) return null;
    return this.buildEmission(this.cursor);
  }

  onPointerDown(state: PointerState, ctx: ToolContext): void {
    const world = ctx.camera.screenToWorld({ x: state.x, y: state.y });
    if (!this.isOpen) {
      const anchor = this.resolveStart ? this.resolveStart(world, ctx) : { origin: world };
      if (!anchor) return;
      this.gridSize = ctx.gridSize ?? 0;
      this.gridType = ctx.gridType;
      this.hexOrientation = ctx.hexOrientation;
      this.snapEnabled = ctx.snapToGrid === true;
      this.footprint = anchor.footprint ?? this.footprintOption;
      const origin = this.snap(anchor.origin);
      this.waypoints = [origin];
      this.cursor = { ...origin };
      this.anchorKey = anchor.anchorKey;
      this.pointerDown = true;
      this.scheduleEmission();
      ctx.requestRender();
      return;
    }
    const point = this.snap(world);
    const last = this.lastWaypoint();
    // Pressing on or near the last waypoint arms a commit; dragging out of the
    // radius disarms it. While armed the cursor is PINNED to the waypoint, so
    // the path does not rubber-band by a few pixels under a fingertip.
    if (last && this.withinCommitRadius(point, last, ctx)) {
      this.commitOnUp = true;
      this.cursor = { ...last };
    } else {
      this.cursor = point;
    }
    this.pointerDown = true;
    this.scheduleEmission();
    ctx.requestRender();
  }

  onPointerMove(state: PointerState, ctx: ToolContext): void {
    if (!this.isOpen) return;
    const world = ctx.camera.screenToWorld({ x: state.x, y: state.y });
    const point = this.snap(world);
    const last = this.lastWaypoint();
    if (this.commitOnUp && last && this.withinCommitRadius(point, last, ctx)) {
      this.cursor = { ...last };
    } else {
      this.commitOnUp = false;
      this.cursor = point;
    }
    this.scheduleEmission();
    ctx.requestRender();
  }

  onPointerUp(_state: PointerState, ctx: ToolContext): void {
    if (!this.isOpen) return;
    this.pointerDown = false;
    if (this.commitOnUp) {
      this.commit(ctx);
      return;
    }
    const last = this.lastWaypoint();
    if (this.cursor && last && !samePoint(this.cursor, last)) {
      this.waypoints.push({ ...this.cursor });
    }
    this.scheduleEmission();
    ctx.requestRender();
  }

  onHover(state: PointerState, ctx: ToolContext): void {
    if (!this.isOpen || this.pointerDown) return;
    const world = ctx.camera.screenToWorld({ x: state.x, y: state.y });
    this.cursor = this.snap(world);
    this.scheduleEmission();
    ctx.requestRender();
  }

  /** A takeover (second pointer, platform cancel) abandons the path outright. */
  onPointerCancel(_state: PointerState, ctx: ToolContext): void {
    this.cancel(ctx);
  }

  onDeactivate(ctx: ToolContext): void {
    this.cancel(ctx);
  }

  onKeyDown(event: KeyboardEvent, ctx: ToolContext): boolean {
    if (!this.isOpen) return false;
    if (event.key === 'Enter') {
      this.commit(ctx);
      return true;
    }
    if (event.key === 'Escape') {
      this.cancel(ctx);
      return true;
    }
    return false;
  }

  renderOverlay(ctx: CanvasRenderingContext2D): void {
    if (!this.isOpen) return;
    const { points, cumulative, total } = this.measure(this.cursor);
    const cumulativeFeet = cumulative.map((cells) => cells * this.feetPerCell);
    drawPath(ctx, {
      points,
      segmentColors: resolveSegmentColors(cumulativeFeet, this.rangeBands, this.color),
      color: this.color,
      feet: total * this.feetPerCell,
    });
  }

  private lastWaypoint(): Point | undefined {
    return this.waypoints[this.waypoints.length - 1];
  }

  /**
   * Is `point` close enough to `last` to mean "finish here"? The exact match is
   * a subset: on a grid the snapped tap IS the waypoint, so grid behaviour is
   * unchanged. The tolerance is screen-space, converted to world units with the
   * live zoom, so the target keeps its physical size as the camera moves.
   */
  private withinCommitRadius(point: Point, last: Point, ctx: ToolContext): boolean {
    if (samePoint(point, last)) return true;
    const zoom = ctx.camera.zoom;
    if (!(zoom > 0)) return false;
    const radius = this.commitTapRadiusPx / zoom;
    if (radius <= 0) return false;
    const dx = point.x - last.x;
    const dy = point.y - last.y;
    return dx * dx + dy * dy <= radius * radius;
  }

  private snap(point: Point): Point {
    if (this.gridSize <= 0) return point;
    if (this.gridType === 'hex' && this.hexOrientation) {
      return snapToHexCenter(point, this.gridSize, this.hexOrientation);
    }
    if (this.gridType === 'square') {
      return snapToCellCenter(point, this.gridSize, this.footprint);
    }
    if (this.snapEnabled) {
      return snapPoint(point, this.gridSize);
    }
    return point;
  }

  /** The measured polyline: waypoints, plus the cursor when it adds a leg. */
  private measure(cursor: Point | null): {
    points: Point[];
    cumulative: number[];
    total: number;
  } {
    const points = this.waypoints.map((p) => ({ ...p }));
    const last = points[points.length - 1];
    if (cursor && (!last || !samePoint(cursor, last))) points.push({ ...cursor });
    const { total, cumulative } = pathDistanceCells(points, {
      gridSize: this.gridSize,
      gridType: this.gridType,
      hexOrientation: this.hexOrientation,
      diagonalRule: this.diagonalRule,
    });
    return { points, cumulative, total };
  }

  private buildEmission(cursor: Point | null): PathEmission {
    const { cumulative, total } = this.measure(cursor);
    const segments: PathSegment[] = [];
    for (let i = 1; i < cumulative.length; i++) {
      // A segment's cost is the DIFFERENCE of running totals: stateful rules
      // (`alternate`) accumulate over the whole path, not per segment.
      const cells = (cumulative[i] ?? 0) - (cumulative[i - 1] ?? 0);
      segments.push({ cells, feet: cells * this.feetPerCell });
    }
    return {
      anchorKey: this.anchorKey,
      waypoints: this.waypoints.map((p) => ({ ...p })),
      cursor: cursor ? { ...cursor } : null,
      segments,
      totalCells: total,
      totalFeet: total * this.feetPerCell,
      color: this.color,
      rangeBands: this.rangeBands,
    };
  }

  private commit(ctx: ToolContext): void {
    if (this.waypoints.length < 2) {
      this.cancel(ctx);
      return;
    }
    const emission = this.buildEmission(null);
    this.reset();
    this.emitCommit(emission);
    this.emitClear();
    ctx.requestRender();
  }

  private cancel(ctx: ToolContext): void {
    if (!this.isOpen) return;
    this.reset();
    this.emitClear();
    ctx.requestRender();
  }

  private reset(): void {
    this.waypoints = [];
    this.cursor = null;
    this.anchorKey = undefined;
    this.footprint = this.footprintOption;
    this.pointerDown = false;
    this.commitOnUp = false;
  }

  private notifyOptionsChange(): void {
    for (const listener of this.optionListeners) listener();
  }

  private scheduleEmission(): void {
    if (this.pathListeners.size === 0) return;
    if (this.emissionRafId !== null) return;
    this.emissionRafId = requestAnimationFrame(() => {
      this.emissionRafId = null;
      const emission = this.getEmission();
      if (!emission) return; // cleared before the frame; the sync null already went out
      this.emitPath(emission);
    });
  }

  private emitClear(): void {
    if (this.emissionRafId !== null) {
      cancelAnimationFrame(this.emissionRafId);
      this.emissionRafId = null;
    }
    if (this.pathListeners.size === 0) return;
    this.emitPath(null);
  }

  private emitPath(emission: PathEmission | null): void {
    for (const listener of this.pathListeners) {
      try {
        listener(emission);
      } catch {
        // A throwing host listener must not break path input.
      }
    }
  }

  private emitCommit(emission: PathEmission): void {
    for (const listener of this.commitListeners) {
      try {
        listener(emission);
      } catch {
        // A throwing host listener must not break path input.
      }
    }
  }
}
