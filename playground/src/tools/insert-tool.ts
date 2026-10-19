import type { PointerState, Tool, ToolContext, Viewport } from '@fieldnotes/core';
import { insertWidget } from '../widgets';
import type { WidgetDef } from '../widgets';

// A press that moves farther than this (screen px) is a drag, not a placement.
const DRAG_PX = 6;

/** Places the chosen widget where the pointer is released without dragging. */
export class InsertTool implements Tool {
  readonly name = 'insert';
  private start: { x: number; y: number } | null = null;

  constructor(
    private readonly viewport: Viewport,
    private widget: WidgetDef<unknown>,
  ) {}

  setWidget(def: WidgetDef<unknown>): void {
    this.widget = def;
  }

  onPointerDown(state: PointerState): void {
    this.start = { x: state.x, y: state.y };
  }

  onPointerMove(): void {
    // Placement happens on pointer up.
  }

  onPointerUp(state: PointerState, ctx: ToolContext): void {
    const start = this.start;
    this.start = null;
    if (!start || Math.hypot(state.x - start.x, state.y - start.y) > DRAG_PX) return;
    insertWidget(this.viewport, this.widget, ctx.camera.screenToWorld(state));
    ctx.switchTool?.('select');
  }

  /** A cancelled gesture (pinch takeover) places nothing. */
  onPointerCancel(): void {
    this.start = null;
  }

  onKeyDown(event: KeyboardEvent, ctx: ToolContext): boolean {
    if (event.key !== 'Escape') return false;
    ctx.switchTool?.('select');
    return true;
  }
}
