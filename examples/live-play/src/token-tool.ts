import type { Tool, ToolContext, PointerState } from '@fieldnotes/core';
import { createShape } from '@fieldnotes/core';

// Places an owner-colored ellipse "token" at the pointer. Stays active so several can be placed;
// the app's "Select" button switches back to the SelectTool for dragging.
export class TokenTool implements Tool {
  readonly name = 'token';
  constructor(private readonly color: string) {}

  onPointerDown(state: PointerState, ctx: ToolContext): void {
    const world = ctx.camera.screenToWorld({ x: state.x, y: state.y });
    ctx.store.add(
      createShape({
        position: { x: world.x - 20, y: world.y - 20 },
        size: { w: 40, h: 40 },
        shape: 'ellipse',
        fillColor: this.color,
        strokeColor: '#222',
        layerId: ctx.activeLayerId ?? '',
      }),
    );
    ctx.requestRender();
  }
  onPointerMove(_s: PointerState, _c: ToolContext): void {}
  onPointerUp(_s: PointerState, _c: ToolContext): void {}
}
