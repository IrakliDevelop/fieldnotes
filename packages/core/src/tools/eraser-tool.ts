import type { Bounds, Point } from '../core/types';
import type { Tool, ToolContext, PointerState } from './types';
import type { StrokeElement } from '../elements/types';
import { hitTestStroke } from '../elements/stroke-hit';
import { createStroke } from '../elements/element-factory';
import { erasePoints } from '../elements/stroke-erase';

export interface EraserToolOptions {
  radius?: number;
  mode?: 'partial' | 'stroke';
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
  private radius: number;
  private cursor: string;
  private mode: 'partial' | 'stroke';

  constructor(options: EraserToolOptions = {}) {
    this.radius = options.radius ?? DEFAULT_RADIUS;
    this.cursor = makeEraserCursor(this.radius);
    this.mode = options.mode ?? 'partial';
  }

  getOptions(): EraserToolOptions {
    return { radius: this.radius, mode: this.mode };
  }

  setOptions(options: EraserToolOptions): void {
    if (options.mode !== undefined) this.mode = options.mode;
    if (options.radius !== undefined) {
      this.radius = options.radius;
      this.cursor = makeEraserCursor(this.radius); // applied on next activate
    }
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
    const queryBounds: Bounds = {
      x: world.x - this.radius,
      y: world.y - this.radius,
      w: this.radius * 2,
      h: this.radius * 2,
    };
    const candidates = ctx.store.queryRect(queryBounds);
    let erased = false;

    for (const el of candidates) {
      if (el.type !== 'stroke') continue;
      if (ctx.isLayerVisible && !ctx.isLayerVisible(el.layerId)) continue;
      if (ctx.isLayerLocked && ctx.isLayerLocked(el.layerId)) continue;
      if (!this.strokeIntersects(el, world)) continue;
      if (this.mode === 'stroke') {
        ctx.store.remove(el.id);
        erased = true;
        continue;
      }
      const localEraser = { x: world.x - el.position.x, y: world.y - el.position.y };
      const runs = erasePoints(el.points, localEraser, this.radius);
      if (runs === null) continue;
      ctx.store.remove(el.id);
      for (const run of runs) {
        ctx.store.add(
          createStroke({
            points: run,
            color: el.color,
            width: el.width,
            opacity: el.opacity,
            layerId: el.layerId,
            zIndex: el.zIndex,
            position: el.position,
          }),
        );
      }
      erased = true;
    }

    if (erased) ctx.requestRender();
  }

  private strokeIntersects(stroke: StrokeElement, point: Point): boolean {
    return hitTestStroke(stroke, point, this.radius);
  }
}
