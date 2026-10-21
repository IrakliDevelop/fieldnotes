import type { Tool, ToolContext, PointerState } from '@fieldnotes/core';
import { createNote } from '@fieldnotes/core';

export class StampTool implements Tool {
  readonly name = 'stamp';

  onPointerDown(state: PointerState, ctx: ToolContext): void {
    const world = ctx.camera.screenToWorld({ x: state.x, y: state.y });
    ctx.store.add(
      createNote({
        position: { x: world.x - 50, y: world.y - 25 },
        size: { w: 100, h: 50 },
        text: 'stamp',
        layerId: ctx.activeLayerId ?? '',
      }),
    );
    ctx.requestRender();
  }

  onPointerMove(_state: PointerState, _ctx: ToolContext): void {
    // No action on pointer move
  }
  onPointerUp(_state: PointerState, _ctx: ToolContext): void {
    // No action on pointer up
  }
}
