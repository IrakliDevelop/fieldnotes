import type { Point } from '../core/types';
import type { PointerState, ToolContext } from './types';

/** A live SelectTool drag, as seen by drag observers. */
export interface SelectDragInfo {
  /** Unlocked directly selected ids that move; descendants may move through hierarchy expansion. */
  readonly ids: readonly string[];
  /** The directly selected roots' positions at drag start. */
  readonly origins: ReadonlyMap<string, Point>;
  /** Current unsnapped world pointer. */
  readonly pointer: Point;
  readonly pointerType: PointerState['pointerType'];
}

/** Hooks into SelectTool drags; register with `SelectTool.addDragObserver`. */
export interface SelectDragObserver {
  onDragStart?(info: SelectDragInfo, ctx: ToolContext): void;
  onDragMove?(info: SelectDragInfo, ctx: ToolContext): void;
  /** Runs inside the gesture's open history transaction; store writes join the same undo step. */
  onDragEnd?(info: SelectDragInfo, ctx: ToolContext): void;
  /** After positions were restored by Escape. */
  onDragCancel?(info: SelectDragInfo, ctx: ToolContext): void;
  /** Offered every keydown while a drag is live, before SelectTool's own handling. */
  onDragKeyDown?(e: KeyboardEvent, info: SelectDragInfo, ctx: ToolContext): boolean;
}
