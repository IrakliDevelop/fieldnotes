import type { Point } from '../core/types';
import type { Tool, ToolContext, PointerState } from './types';
import type { StrokeElement } from '../elements/types';

export interface EraserToolOptions {
  radius?: number;
}

const DEFAULT_RADIUS = 20;

function makeEraserCursor(radius: number): string {
  const size = radius * 2;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'><circle cx='${radius}' cy='${radius}' r='${radius - 1}' fill='none' stroke='%23666' stroke-width='1.5'/></svg>`;
  return `url("data:image/svg+xml,${svg}") ${radius} ${radius}, crosshair`;
}

export class EraserTool implements Tool {
  readonly name = 'eraser';
  private erasing = false;
  private readonly radius: number;
  private readonly cursor: string;

  constructor(options: EraserToolOptions = {}) {
    this.radius = options.radius ?? DEFAULT_RADIUS;
    this.cursor = makeEraserCursor(this.radius);
  }

  onActivate(ctx: ToolContext): void {
    ctx.setCursor?.(this.cursor);
  }

  onDeactivate(ctx: ToolContext): void {
    ctx.setCursor?.('default');
  }

  onPointerDown(state: PointerState, ctx: ToolContext): void {
    this.erasing = true;
    this.eraseAt(state, ctx);
  }

  onPointerMove(state: PointerState, ctx: ToolContext): void {
    if (!this.erasing) return;
    this.eraseAt(state, ctx);
  }

  onPointerUp(_state: PointerState, _ctx: ToolContext): void {
    this.erasing = false;
  }

  private eraseAt(state: PointerState, ctx: ToolContext): void {
    const world = ctx.camera.screenToWorld({ x: state.x, y: state.y });
    const strokes = ctx.store.getElementsByType('stroke');
    let erased = false;

    for (const stroke of strokes) {
      if (this.strokeIntersects(stroke, world)) {
        ctx.store.remove(stroke.id);
        erased = true;
      }
    }

    if (erased) ctx.requestRender();
  }

  private strokeIntersects(stroke: StrokeElement, point: Point): boolean {
    const radiusSq = this.radius * this.radius;
    return stroke.points.some((p) => {
      const dx = p.x + stroke.position.x - point.x;
      const dy = p.y + stroke.position.y - point.y;
      return dx * dx + dy * dy <= radiusSq;
    });
  }
}
