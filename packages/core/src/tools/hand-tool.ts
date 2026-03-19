import type { Tool, ToolContext, PointerState } from './types';

export class HandTool implements Tool {
  readonly name = 'hand';
  private panning = false;
  private lastScreen = { x: 0, y: 0 };

  onActivate(ctx: ToolContext): void {
    ctx.setCursor?.('grab');
  }

  onDeactivate(ctx: ToolContext): void {
    ctx.setCursor?.('default');
  }

  onPointerDown(state: PointerState, ctx: ToolContext): void {
    this.panning = true;
    this.lastScreen = { x: state.x, y: state.y };
    ctx.setCursor?.('grabbing');
  }

  onPointerMove(state: PointerState, ctx: ToolContext): void {
    if (!this.panning) return;
    const dx = state.x - this.lastScreen.x;
    const dy = state.y - this.lastScreen.y;
    this.lastScreen = { x: state.x, y: state.y };
    ctx.camera.pan(dx, dy);
  }

  onPointerUp(_state: PointerState, ctx: ToolContext): void {
    this.panning = false;
    ctx.setCursor?.('grab');
  }
}
