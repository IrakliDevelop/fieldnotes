import type { Point } from '../core/types';
import { createFrame } from '../elements/frame-element';
import type { PointerState, Tool, ToolContext } from './types';

const MIN_WIDTH = 80;
const MIN_HEIGHT = 48;
const FRAME_COLOR = '#64748b';

/** Draws an empty frame around a dragged rectangle. */
export class FrameTool implements Tool {
  readonly name = 'frame';
  private start: Point | null = null;
  private end: Point | null = null;
  private layerId: string | undefined;
  private shiftKey = false;

  onPointerDown(state: PointerState, ctx: ToolContext): void {
    const layerId = ctx.activeLayerId;
    if (!layerId || ctx.isLayerLocked?.(layerId)) return;
    this.start = ctx.camera.screenToWorld({ x: state.x, y: state.y });
    this.end = this.start;
    this.layerId = layerId;
    this.shiftKey = state.shiftKey;
  }

  onPointerMove(state: PointerState, ctx: ToolContext): void {
    if (!this.start) return;
    this.end = ctx.camera.screenToWorld({ x: state.x, y: state.y });
    this.shiftKey = state.shiftKey;
    ctx.requestOverlayRender();
  }

  onPointerUp(state: PointerState, ctx: ToolContext): void {
    if (!this.start || !this.layerId) return;
    this.end = ctx.camera.screenToWorld({ x: state.x, y: state.y });
    this.shiftKey = state.shiftKey;
    const layerId = this.layerId;
    const rect = this.rect();
    this.reset();
    if (!rect || ctx.isLayerLocked?.(layerId)) return;

    const frame = createFrame({ ...rect, layerId });
    ctx.store.add(frame);
    ctx.requestRender();
    ctx.switchTool?.('select');
    ctx.setSelection?.([frame.id]);
  }

  onPointerCancel(_state: PointerState, ctx: ToolContext): void {
    if (!this.start) return;
    this.reset();
    ctx.requestOverlayRender();
  }

  onDeactivate(ctx: ToolContext): void {
    if (!this.start) return;
    this.reset();
    ctx.requestOverlayRender();
  }

  onKeyDown(event: KeyboardEvent, ctx: ToolContext): boolean {
    if (event.key !== 'Escape' || !this.start) return false;
    this.reset();
    ctx.requestOverlayRender();
    return true;
  }

  renderOverlay(ctx: CanvasRenderingContext2D): void {
    const rect = this.rect();
    if (!rect) return;
    ctx.save();
    ctx.strokeStyle = FRAME_COLOR;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(rect.position.x, rect.position.y, rect.size.w, rect.size.h);
    ctx.restore();
  }

  private rect(): { position: Point; size: { w: number; h: number } } | null {
    if (!this.start || !this.end) return null;
    const dx = this.end.x - this.start.x;
    const dy = this.end.y - this.start.y;
    if (dx === 0 && dy === 0) return null;
    if (this.shiftKey) {
      const side = Math.max(Math.abs(dx), Math.abs(dy), MIN_WIDTH);
      return {
        position: {
          x: dx < 0 ? this.start.x - side : this.start.x,
          y: dy < 0 ? this.start.y - side : this.start.y,
        },
        size: { w: side, h: side },
      };
    }
    const width = Math.max(Math.abs(dx), MIN_WIDTH);
    const height = Math.max(Math.abs(dy), MIN_HEIGHT);
    return {
      position: {
        x: dx < 0 ? this.start.x - width : this.start.x,
        y: dy < 0 ? this.start.y - height : this.start.y,
      },
      size: { w: width, h: height },
    };
  }

  private reset(): void {
    this.start = null;
    this.end = null;
    this.layerId = undefined;
    this.shiftKey = false;
  }
}
