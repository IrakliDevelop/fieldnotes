import { SelectTool } from '@fieldnotes/core';
import type {
  CanvasElement,
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
import type { PathRangeBand } from '../path-tool';
import {
  MOVEMENT_RECORD_ID_PREFIX,
  appendTrail,
  createMovementRecord,
  movementRecordId,
  movementRecordTypeDefinition,
} from './movement-record';
import type { MovementRecordElement, MovementVisibility } from './movement-types';
import { measureMove } from './movement-path';

/** Cell size (world units) when no grid constrains the drag; matches `PathTool`. */
const FALLBACK_CELL_SIZE = 24;

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

interface LiveMove {
  readonly start: Point;
  readonly waypoints: Point[];
}

interface LiveDrag {
  readonly grid: GridMetric;
  readonly moves: Map<string, LiveMove>;
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
  private readonly disposers: (() => void)[] = [];
  private live: LiveDrag | null = null;

  // Starts and ends are not guaranteed to pair, so every boundary replaces the live state.
  private readonly observer: SelectDragObserver = {
    onDragStart: (info, ctx) => this.startDrag(info, ctx),
    onDragEnd: () => this.endDrag(),
    onDragCancel: () => {
      this.live = null;
    },
  };

  constructor(
    private readonly host: MovementTrackerHost,
    options: MovementTrackerOptions = {},
  ) {
    this.options = {
      feetPerCell: options.feetPerCell ?? 5,
      diagonalRule: options.diagonalRule ?? 'chebyshev',
      overColor: options.overColor ?? '#C62828',
    };
    const observe = (tool: Tool): void => {
      if (tool instanceof SelectTool) this.disposers.push(tool.addDragObserver(this.observer));
    };
    const select = host.toolManager.getTool('select');
    if (select) observe(select);
    const { store } = host;
    this.disposers.push(
      host.toolManager.onRegister(observe),
      store.on('add', (el) => this.notifyRecord(el)),
      store.on('update', ({ current }) => this.notifyRecord(current)),
      store.on('remove', (el, meta) => {
        this.notifyRecord(el);
        // Only the client that removed the target removes its record.
        if (meta.origin === undefined || meta.origin === 'local') this.removeRecordOf(el.id);
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

  /** Changes who may read the movement; an existing record is rewritten outside undo history. */
  setVisibility(elementId: string, visibility: MovementVisibility): void {
    const tracking = this.tracked.get(elementId);
    if (tracking) this.tracked.set(elementId, { ...tracking, visibility });
    const record = this.record(elementId);
    if (!record || record.visibility === visibility) return;
    this.host.historyRecorder.pause();
    this.write({ ...record, visibility });
    this.host.historyRecorder.resume();
  }

  /** Fires with the target id whenever its record changes, locally or remotely. */
  onChange(listener: (elementId: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Detaches from the viewport; safe to call twice. */
  dispose(): void {
    for (const dispose of this.disposers.splice(0)) dispose();
    this.listeners.clear();
    this.tracked.clear();
    this.live = null;
  }

  private startDrag(info: SelectDragInfo, ctx: ToolContext): void {
    const moves = new Map<string, LiveMove>();
    for (const id of info.ids) {
      const el = this.host.store.getById(id);
      const origin = info.origins.get(id);
      if (!this.tracked.has(id) || !el || !origin) continue;
      moves.set(id, { start: centerOf(el, origin), waypoints: [] });
    }
    this.live = { grid: gridMetric(ctx, this.options.diagonalRule), moves };
  }

  // Runs inside the gesture transaction, so the record write shares the move's undo step.
  private endDrag(): void {
    const live = this.live;
    this.live = null;
    if (!live) return;
    for (const [id, move] of live.moves) {
      const target = this.host.store.getById(id);
      const tracking = this.tracked.get(id);
      if (!target || !tracking) continue;
      const end = centerOf(target, target.position);
      if (move.waypoints.length === 0 && end.x === move.start.x && end.y === move.start.y) {
        continue;
      }
      const path = [move.start, ...move.waypoints, end];
      const base =
        this.spent(id, tracking.epoch) ??
        createMovementRecord({ target, epoch: tracking.epoch, visibility: tracking.visibility });
      const { feet, diagonals } = measureMove({
        path,
        grid: live.grid,
        feetPerCell: this.options.feetPerCell,
        start: base,
      });
      this.write({
        ...base,
        layerId: target.layerId,
        visibility: tracking.visibility,
        feet,
        diagonals,
        trail: appendTrail(base.trail, path, false),
      });
    }
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
    const envelope = movementRecordTypeDefinition.wrap(record);
    if (store.getById(envelope.id)) {
      store.update(envelope.id, { layerId: envelope.layerId, data: envelope.data });
    } else {
      store.add(envelope);
    }
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
    for (const listener of this.listeners) listener(elementId);
  }
}
