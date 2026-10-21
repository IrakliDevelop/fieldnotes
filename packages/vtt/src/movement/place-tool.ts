import type { Point, PointerState, Tool, ToolContext } from '@fieldnotes/core';
import { drawLabelPill, worldUnitsPerCssPx } from '../screen-scale';

/** Matches the path and ruler default color. */
const RING_COLOR = '#FF5722';

/** What to draw: the element center, ring radius in world units (null: no limit), and hint. */
export interface PlacementView {
  readonly center: Point;
  readonly radius: number | null;
  readonly hint: string;
}

/** The placement owner; `MovementTracker` supplies it. */
export interface PlaceToolHost {
  view(ctx: ToolContext): PlacementView | null;
  /** Places at `world`, or refuses and stays active when out of range. */
  place(world: Point, ctx: ToolContext): void;
  /** Ends unplaced; `restoreTool` is false when another tool already took over. */
  cancel(restoreTool: boolean): void;
}

/** Picks a host-started placement's destination: a click or tap places, Escape cancels. */
export class PlaceTool implements Tool {
  readonly name = 'vtt-place';
  private ctx: ToolContext | null = null;
  private pointer: Point | null = null;

  constructor(private readonly host: PlaceToolHost) {}

  onActivate(ctx: ToolContext): void {
    this.ctx = ctx;
    this.pointer = null;
  }

  onDeactivate(): void {
    this.ctx = null;
    this.host.cancel(false);
  }

  onPointerDown(state: PointerState, ctx: ToolContext): void {
    this.follow(state, ctx);
  }

  onPointerMove(state: PointerState, ctx: ToolContext): void {
    this.follow(state, ctx);
  }

  onHover(state: PointerState, ctx: ToolContext): void {
    this.follow(state, ctx);
  }

  onPointerUp(state: PointerState, ctx: ToolContext): void {
    this.host.place(this.follow(state, ctx), ctx);
  }

  // A pinch takeover or platform cancel never places.
  onPointerCancel(): void {
    this.pointer = null;
  }

  onKeyDown(event: KeyboardEvent): boolean {
    if (event.key !== 'Escape') return false;
    this.host.cancel(true);
    return true;
  }

  renderOverlay(ctx: CanvasRenderingContext2D): void {
    const view = this.ctx && this.host.view(this.ctx);
    if (!view) return;
    if (view.radius !== null) {
      ctx.strokeStyle = RING_COLOR;
      ctx.lineWidth = 2 * worldUnitsPerCssPx(ctx);
      ctx.beginPath();
      ctx.arc(view.center.x, view.center.y, view.radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Touch has no hover, so before the first tap the hint sits over the element.
    drawLabelPill(ctx, view.hint, this.pointer ?? view.center, {});
  }

  private follow(state: PointerState, ctx: ToolContext): Point {
    this.pointer = ctx.camera.screenToWorld({ x: state.x, y: state.y });
    ctx.requestOverlayRender();
    return this.pointer;
  }
}
