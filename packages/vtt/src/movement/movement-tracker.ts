import { SelectTool } from '@fieldnotes/core';
import type {
  CanvasElement,
  ElementChangeMeta,
  ElementStore,
  OverlayRenderer,
  Point,
  SelectDragInfo,
  SelectDragObserver,
  Tool,
  ToolContext,
  ToolManager,
} from '@fieldnotes/core';
import type { DiagonalRule, GridMetric } from '../grid/grid-metric';
import { footprintFromSize } from '../grid/snap';
import type { Footprint } from '../grid/snap';
import type { PathRangeBand } from '../path-tool';
import {
  MOVEMENT_RECORD_ID_PREFIX,
  appendTrail,
  createMovementRecord,
  movementRecordId,
  movementRecordTypeDefinition,
} from './movement-record';
import type { MovementKind, MovementRecordElement, MovementVisibility } from './movement-types';
import { measureMove } from './movement-path';
import { MOVEMENT_OVER_COLOR, buildMovementModel, drawMovement } from './movement-render';
import type { MovementRenderModel } from './movement-render';
import { PlaceTool } from './place-tool';
import type { PlacementView } from './place-tool';

/** Cell size (world units) when no grid constrains the drag; matches `PathTool`. */
const FALLBACK_CELL_SIZE = 24;
/** A touch or pen pointer held this long within `DWELL_SLOP_PX` screen px drops a waypoint. */
const DWELL_MS = 500;
const DWELL_SLOP_PX = 6;

/** What the tracker needs from its viewport; `Viewport` satisfies it structurally. */
export interface MovementTrackerHost {
  readonly camera: { readonly zoom: number };
  readonly store: ElementStore;
  readonly toolManager: ToolManager;
  readonly historyRecorder: { pause(): void; resume(): void };
  registerOverlay(draw: OverlayRenderer): () => void;
  requestOverlayRender(): void;
  setTool(name: string): void;
  transaction<T>(fn: () => T): T;
}

/** Table-wide measuring rules: feet per cell (5), diagonal rule (chebyshev), over-budget color. */
export interface MovementTrackerOptions {
  feetPerCell?: number;
  diagonalRule?: DiagonalRule;
  overColor?: string;
}

/** Per-element tracking: a record from another `epoch` counts as empty. */
export interface MovementTrackOptions {
  epoch: string;
  bands: readonly PathRangeBand[];
  visibility: MovementVisibility;
}

/** Feet spent this epoch; `remaining` is left in the current band, null beyond the last. */
export interface MovementState {
  readonly feet: number;
  readonly remaining: number | null;
}

/** The labelled element's live model, raf-coalesced during a drag. */
export interface MovementEmission {
  readonly elementId: string;
  readonly visibility: MovementVisibility;
  readonly model: MovementRenderModel;
}

/** How a host-started placement ended. */
export interface MovementPlacementResult {
  readonly elementId: string;
  readonly kind: MovementKind;
  readonly placed: boolean;
}

interface Placement {
  readonly elementId: string;
  readonly kind: MovementKind;
  readonly hint: string;
  readonly previousTool: string;
  readonly selection: string[];
}

interface LiveMove {
  readonly start: Point;
  readonly waypoints: Point[];
  readonly footprint: Footprint;
  model: MovementRenderModel | null;
}

interface LiveDrag {
  readonly grid: GridMetric;
  readonly moves: Map<string, LiveMove>;
  /** The tracked element nearest the pointer at drag start; only it is labelled and emitted. */
  readonly labelId: string | null;
}

function isLocal(meta: ElementChangeMeta): boolean {
  return meta.origin === undefined || meta.origin === 'local';
}

// A throwing host listener must not skip a record write or strand SelectTool mid-gesture.
function notifyAll<T>(listeners: Iterable<(value: T) => void>, value: T): void {
  for (const listener of listeners) {
    try {
      listener(value);
    } catch (error) {
      console.error('[fieldnotes] movement listener failed', error);
    }
  }
}

function centerOf(el: CanvasElement, position: Point): Point {
  const size = 'size' in el ? el.size : undefined;
  return size ? { x: position.x + size.w / 2, y: position.y + size.h / 2 } : position;
}

// Same grid capture as PathTool: no active snapping means gridless euclidean cells.
function gridMetric(ctx: ToolContext, diagonalRule: DiagonalRule): GridMetric {
  const cs = ctx.constraintService;
  const info = cs?.isActive ? cs.getConstraintInfo() : null;
  const cellSize = info?.['cellSize'];
  const gridType = info?.['gridType'];
  const orientation = info?.['hexOrientation'];
  return {
    gridSize: typeof cellSize === 'number' ? cellSize : FALLBACK_CELL_SIZE,
    gridType: gridType === 'square' || gridType === 'hex' ? gridType : undefined,
    hexOrientation: orientation === 'pointy' || orientation === 'flat' ? orientation : undefined,
    diagonalRule,
  };
}

/** Measures select drags of host-tracked elements into synced `vtt:movement` records. */
export class MovementTracker {
  private readonly options: Required<MovementTrackerOptions>;
  private readonly tracked = new Map<string, MovementTrackOptions>();
  private readonly listeners = new Set<(elementId: string) => void>();
  private readonly movementListeners = new Set<(emission: MovementEmission | null) => void>();
  private readonly placementListeners = new Set<(result: MovementPlacementResult) => void>();
  private readonly disposers: (() => void)[] = [];
  private live: LiveDrag | null = null;
  private frame: number | null = null;
  private dwellTimer: ReturnType<typeof setTimeout> | null = null;
  private dwellAnchor: Point | null = null;
  private placeTool: PlaceTool | null = null;
  private placement: Placement | null = null;

  // Starts and ends are not guaranteed to pair, so every boundary replaces the live state.
  private readonly observer: SelectDragObserver = {
    onDragStart: (info, ctx) => this.startDrag(info, ctx),
    onDragMove: (info) => {
      this.updateModels();
      this.dwell(info);
    },
    onDragEnd: () => this.endDrag(),
    onDragCancel: () => this.clearLive(),
    onDragKeyDown: (e) => this.keyDown(e),
  };

  constructor(
    private readonly host: MovementTrackerHost,
    options: MovementTrackerOptions = {},
  ) {
    this.options = {
      feetPerCell: options.feetPerCell ?? 5,
      diagonalRule: options.diagonalRule ?? 'chebyshev',
      overColor: options.overColor ?? MOVEMENT_OVER_COLOR,
    };
    const observe = (tool: Tool): void => {
      if (tool instanceof SelectTool) this.disposers.push(tool.addDragObserver(this.observer));
    };
    const select = host.toolManager.getTool('select');
    if (select) observe(select);
    const { store } = host;
    this.disposers.push(
      host.registerOverlay((ctx) => this.draw(ctx)),
      host.toolManager.onRegister(observe),
      store.on('add', (el, meta) => this.recordChanged(el, meta)),
      store.on('update', ({ current }, meta) => this.recordChanged(current, meta)),
      store.on('remove', (el, meta) => {
        this.notifyRecord(el);
        // Only the client that removed the target removes its record.
        if (isLocal(meta)) this.removeRecordOf(el.id);
      }),
      store.on('clear', () => this.notifyTracked()),
      store.on('batch', () => this.notifyTracked()),
    );
  }

  /** Counts select drags of `elementId` from now on, against `options.epoch`. */
  track(elementId: string, options: MovementTrackOptions): void {
    this.tracked.set(elementId, options);
  }

  /** Stops counting locally; the record stays as it is. */
  untrack(elementId: string): void {
    this.tracked.delete(elementId);
  }

  /** Whether drags of `elementId` are counted. */
  isTracked(elementId: string): boolean {
    return this.tracked.has(elementId);
  }

  /** Movement this epoch; null when untracked. */
  getMovement(elementId: string): MovementState | null {
    const tracking = this.tracked.get(elementId);
    if (!tracking) return null;
    const feet = this.spent(elementId, tracking.epoch)?.feet ?? 0;
    const band = [...tracking.bands].sort((a, b) => a.feet - b.feet).find((b) => b.feet >= feet);
    return { feet, remaining: band ? band.feet - feet : null };
  }

  /** Zeroes this epoch's movement as one undo step; the element stays where it is. */
  reset(elementId: string): void {
    const tracking = this.tracked.get(elementId);
    const spent = tracking ? this.spent(elementId, tracking.epoch) : null;
    if (!spent) return;
    this.host.transaction(() => this.write({ ...spent, feet: 0, diagonals: 0, trail: [] }));
  }

  /** Rewrites who may read the movement outside history; never call it during undo/redo. */
  setVisibility(elementId: string, visibility: MovementVisibility): void {
    const tracking = this.tracked.get(elementId);
    if (tracking) this.tracked.set(elementId, { ...tracking, visibility });
    if (visibility === 'dm' && this.live?.labelId === elementId) this.emitMovement(null);
    const record = this.record(elementId);
    if (!record || record.visibility === visibility) return;
    this.writeUnrecorded({ ...record, visibility });
  }

  /** Fires with the target id whenever its record changes, locally or remotely. */
  onChange(listener: (elementId: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Live drag model of the labelled element, at most once per frame; null when the drag ends. */
  onMovement(listener: (emission: MovementEmission | null) => void): () => void {
    this.movementListeners.add(listener);
    return () => this.movementListeners.delete(listener);
  }

  /** Lets the user click a destination for `elementId`; false when missing, locked, or unsized. */
  startPlacement(elementId: string, kind: MovementKind, options: { hint?: string } = {}): boolean {
    const el = this.host.store.getById(elementId);
    // Placement moves only `position`, which would leave an arrow's or stroke's points behind.
    if (!el || el.locked || !('size' in el) || !el.size) return false;
    this.cancelPlacement();
    if (!this.placeTool) {
      this.placeTool = new PlaceTool({
        view: (ctx) => this.placementView(ctx),
        place: (world, ctx) => this.place(world, ctx),
        cancel: (restoreTool) => this.endPlacement(false, restoreTool),
      });
      this.disposers.push(this.host.toolManager.register(this.placeTool));
    }
    const active = this.host.toolManager.activeTool;
    this.placement = {
      elementId,
      kind,
      hint: options.hint ?? 'Click where to appear',
      previousTool: active?.name ?? 'select',
      selection: active instanceof SelectTool ? [...active.selectedIds] : [],
    };
    this.host.setTool(this.placeTool.name);
    return true;
  }

  /** Ends the current placement without moving; the previous tool comes back. */
  cancelPlacement(): void {
    this.endPlacement(false, true);
  }

  /** Fires once per placement when it is placed or cancelled. */
  onPlacementEnd(listener: (result: MovementPlacementResult) => void): () => void {
    this.placementListeners.add(listener);
    return () => this.placementListeners.delete(listener);
  }

  /** Detaches from the viewport; safe to call twice. */
  dispose(): void {
    this.cancelPlacement();
    for (const dispose of this.disposers.splice(0)) dispose();
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.stopDwell();
    this.listeners.clear();
    this.movementListeners.clear();
    this.placementListeners.clear();
    this.tracked.clear();
    this.live = null;
  }

  private startDrag(info: SelectDragInfo, ctx: ToolContext): void {
    this.stopDwell();
    const grid = gridMetric(ctx, this.options.diagonalRule);
    const moves = new Map<string, LiveMove>();
    let labelId: string | null = null;
    let nearest = Infinity;
    for (const id of info.ids) {
      const el = this.host.store.getById(id);
      const origin = info.origins.get(id);
      if (!this.tracked.has(id) || !el || !origin) continue;
      const start = centerOf(el, origin);
      const footprint = 'size' in el && el.size ? footprintFromSize(el.size, grid.gridSize) : 1;
      moves.set(id, { start, waypoints: [], footprint, model: null });
      const distance = Math.hypot(start.x - info.pointer.x, start.y - info.pointer.y);
      if (distance < nearest) {
        nearest = distance;
        labelId = id;
      }
    }
    this.live = { grid, moves, labelId };
    this.updateModels();
  }

  private keyDown(e: KeyboardEvent): boolean {
    const moves = this.live?.moves;
    if (!moves || moves.size === 0) return false;
    const key = e.key.toLowerCase();
    if (key === 'f') {
      // Leaves Ctrl/Cmd+F to the browser's find.
      if (e.ctrlKey || e.metaKey || e.altKey) return false;
      if (!e.repeat) this.addWaypoint();
      return true;
    }
    if (key !== 'backspace') return false;
    for (const move of moves.values()) move.waypoints.pop();
    this.updateModels();
    return true;
  }

  /** Each tracked element's current center, unless it is already the path's last point. */
  private addWaypoint(): void {
    const moves = this.live?.moves;
    if (!moves) return;
    let added = false;
    for (const [id, move] of moves) {
      const target = this.host.store.getById(id);
      if (!target) continue;
      const point = centerOf(target, target.position);
      const last = move.waypoints.at(-1) ?? move.start;
      if (point.x === last.x && point.y === last.y) continue;
      move.waypoints.push(point);
      added = true;
    }
    if (added) this.updateModels();
  }

  // The timer restarts only when the pointer leaves the slop circle, so jitter still dwells.
  private dwell(info: SelectDragInfo): void {
    if (info.pointerType === 'mouse' || !this.live || this.live.moves.size === 0) return;
    const anchor = this.dwellAnchor;
    const zoom = this.host.camera.zoom;
    if (
      anchor &&
      Math.hypot(info.pointer.x - anchor.x, info.pointer.y - anchor.y) * zoom <= DWELL_SLOP_PX
    ) {
      return;
    }
    this.stopDwell();
    this.dwellAnchor = info.pointer;
    this.dwellTimer = setTimeout(() => {
      this.dwellTimer = null;
      this.addWaypoint();
    }, DWELL_MS);
  }

  private stopDwell(): void {
    if (this.dwellTimer !== null) clearTimeout(this.dwellTimer);
    this.dwellTimer = null;
    this.dwellAnchor = null;
  }

  // Models are built per move, not per frame, so drawing allocates nothing.
  private updateModels(): void {
    const live = this.live;
    if (!live || live.moves.size === 0) return;
    for (const [id, move] of live.moves) {
      const target = this.host.store.getById(id);
      const tracking = this.tracked.get(id);
      if (!target || !tracking) {
        move.model = null;
        continue;
      }
      const base = this.spent(id, tracking.epoch);
      const model = buildMovementModel({
        path: [move.start, ...move.waypoints, centerOf(target, target.position)],
        trail: base?.trail ?? [],
        grid: live.grid,
        feetPerCell: this.options.feetPerCell,
        start: base ?? { feet: 0, diagonals: 0 },
        bands: tracking.bands,
        overColor: this.options.overColor,
        footprint: move.footprint,
      });
      move.model = id === live.labelId ? model : { ...model, label: '' };
    }
    this.host.requestOverlayRender();
    this.scheduleEmission();
  }

  private draw(ctx: CanvasRenderingContext2D): void {
    if (!this.live) return;
    for (const { model } of this.live.moves.values()) {
      if (model) drawMovement(ctx, model);
    }
  }

  private scheduleEmission(): void {
    if (this.frame !== null || this.movementListeners.size === 0) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      const id = this.live?.labelId;
      const model = id ? this.live?.moves.get(id)?.model : null;
      const visibility = id ? this.tracked.get(id)?.visibility : undefined;
      if (!id || !model || !visibility) return;
      this.emitMovement({ elementId: id, visibility, model });
    });
  }

  private emitMovement(emission: MovementEmission | null): void {
    notifyAll(this.movementListeners, emission);
  }

  /** Ends the live drag: the overlay draws nothing and listeners get null. */
  private clearLive(): void {
    const live = this.live;
    this.live = null;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.stopDwell();
    if (!live || live.moves.size === 0) return;
    this.host.requestOverlayRender();
    if (live.labelId !== null) this.emitMovement(null);
  }

  // Runs inside the gesture transaction, so the record write shares the move's undo step.
  private endDrag(): void {
    const live = this.live;
    if (live) {
      for (const [id, move] of live.moves) {
        const target = this.host.store.getById(id);
        const tracking = this.tracked.get(id);
        if (!target || !tracking) continue;
        const end = centerOf(target, target.position);
        if (move.waypoints.length === 0 && end.x === move.start.x && end.y === move.start.y) {
          continue;
        }
        this.recordMove(target, tracking, [move.start, ...move.waypoints, end], live.grid, true);
      }
    }
    // Records are written first so listeners that run on clear already see them.
    this.clearLive();
  }

  private placementView(ctx: ToolContext): PlacementView | null {
    const placement = this.placement;
    const el = placement && this.host.store.getById(placement.elementId);
    if (!placement || !el) return null;
    const { maxFeet } = placement.kind;
    const { gridSize } = gridMetric(ctx, this.options.diagonalRule);
    return {
      center: centerOf(el, el.position),
      radius: maxFeet === undefined ? null : (maxFeet / this.options.feetPerCell) * gridSize,
      hint: placement.hint,
    };
  }

  // Runs inside the place tool's gesture transaction, so move and record are one undo step.
  private place(world: Point, ctx: ToolContext): void {
    const placement = this.placement;
    if (!placement) return;
    const el = this.host.store.getById(placement.elementId);
    if (!el || el.locked) {
      this.cancelPlacement();
      return;
    }
    const size = 'size' in el ? el.size : undefined;
    const cs = ctx.constraintService;
    // Mirrors SelectTool: sized non-extensions snap their center unless smart guides are on.
    const snapsCenter = size && !ctx.smartGuides && el.type !== 'extension';
    const end = cs?.isActive
      ? cs.constrainPoint(world, snapsCenter ? { elementSize: size } : undefined)
      : world;
    const start = centerOf(el, el.position);
    const grid = gridMetric(ctx, this.options.diagonalRule);
    const { maxFeet, counts } = placement.kind;
    const jump = measureMove({
      path: [start, end],
      grid,
      feetPerCell: this.options.feetPerCell,
      start: { feet: 0, diagonals: 0 },
    }).feet;
    if (maxFeet !== undefined && jump > maxFeet) return;
    const position = size ? { x: end.x - size.w / 2, y: end.y - size.h / 2 } : end;
    this.host.store.update(el.id, { position });
    const tracking = this.tracked.get(el.id);
    if (tracking) this.recordMove(el, tracking, [start, end], grid, counts);
    this.endPlacement(true, true);
  }

  private endPlacement(placed: boolean, restoreTool: boolean): void {
    const placement = this.placement;
    if (!placement) return;
    this.placement = null;
    this.host.requestOverlayRender();
    if (restoreTool) {
      this.host.setTool(placement.previousTool);
      // Leaving select cleared its selection.
      const active = this.host.toolManager.activeTool;
      if (active instanceof SelectTool) active.setSelection(placement.selection);
    }
    const { elementId, kind } = placement;
    notifyAll(this.placementListeners, { elementId, kind, placed });
  }

  /** Writes a move along `path` into the target's record; an uncounted move keeps the totals. */
  private recordMove(
    target: CanvasElement,
    tracking: MovementTrackOptions,
    path: [Point, ...Point[]],
    grid: GridMetric,
    counts: boolean,
  ): void {
    const base =
      this.spent(target.id, tracking.epoch) ??
      createMovementRecord({ target, epoch: tracking.epoch, visibility: tracking.visibility });
    const start = path[0];
    const last = base.trail.at(-1)?.at(-1);
    const joins = counts && last !== undefined && last.x === start.x && last.y === start.y;
    const { feet, diagonals } = counts
      ? measureMove({ path, grid, feetPerCell: this.options.feetPerCell, start: base })
      : base;
    this.write({
      ...base,
      visibility: tracking.visibility,
      feet,
      diagonals,
      // Continuing from the trail's end extends its run; a jump starts one, uncounted at its end.
      trail: joins
        ? appendTrail(base.trail, path.slice(1), false)
        : appendTrail(base.trail, counts ? path : path.slice(-1), true),
    });
  }

  private record(targetId: string): MovementRecordElement | null {
    const el = this.host.store.getById(movementRecordId(targetId));
    if (
      el?.type !== 'extension' ||
      el.extensionType !== movementRecordTypeDefinition.type ||
      !movementRecordTypeDefinition.validateData(el.data)
    ) {
      return null;
    }
    const record = movementRecordTypeDefinition.unwrap(el);
    return record.targetId === targetId ? record : null;
  }

  private spent(targetId: string, epoch: string): MovementRecordElement | null {
    const record = this.record(targetId);
    return record?.epoch === epoch ? record : null;
  }

  private write(record: MovementRecordElement): void {
    const { store } = this.host;
    const layerId = store.getById(record.targetId)?.layerId ?? record.layerId;
    const envelope = movementRecordTypeDefinition.wrap({ ...record, layerId, locked: true });
    if (store.getById(envelope.id)) {
      store.update(envelope.id, { layerId, locked: true, data: envelope.data });
    } else {
      store.add(envelope);
    }
  }

  private writeUnrecorded(record: MovementRecordElement): void {
    this.host.historyRecorder.pause();
    try {
      this.write(record);
    } finally {
      this.host.historyRecorder.resume();
    }
  }

  /** The record with the configured visibility, when it is tracked and stored with another. */
  private visibilityFix(targetId: string): MovementRecordElement | null {
    const visibility = this.tracked.get(targetId)?.visibility;
    const record = this.record(targetId);
    if (!record || !visibility || record.visibility === visibility) return null;
    return { ...record, visibility };
  }

  private recordChanged(el: CanvasElement, meta: ElementChangeMeta): void {
    this.notifyRecord(el);
    if (!el.id.startsWith(MOVEMENT_RECORD_ID_PREFIX) || !isLocal(meta)) return;
    const targetId = el.id.slice(MOVEMENT_RECORD_ID_PREFIX.length);
    if (!this.visibilityFix(targetId)) return;
    // Undo/redo can restore an older visibility; fix it once history has resumed.
    queueMicrotask(() => {
      const fixed = this.visibilityFix(targetId);
      if (fixed) this.writeUnrecorded(fixed);
    });
  }

  // Without an open transaction this is its own undo step, after the target's removal.
  private removeRecordOf(targetId: string): void {
    const id = movementRecordId(targetId);
    if (this.host.store.getById(id)) this.host.transaction(() => this.host.store.remove(id));
  }

  private notifyRecord(el: CanvasElement): void {
    if (!el.id.startsWith(MOVEMENT_RECORD_ID_PREFIX)) return;
    this.emit(el.id.slice(MOVEMENT_RECORD_ID_PREFIX.length));
  }

  private notifyTracked(): void {
    for (const id of this.tracked.keys()) this.emit(id);
  }

  private emit(elementId: string): void {
    notifyAll(this.listeners, elementId);
  }
}
