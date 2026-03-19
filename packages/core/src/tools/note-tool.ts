import type { Size } from '../core/types';
import type { Tool, ToolContext, PointerState } from './types';
import { createNote } from '../elements/element-factory';

export interface NoteToolOptions {
  backgroundColor?: string;
  size?: Size;
}

export class NoteTool implements Tool {
  readonly name = 'note';
  private backgroundColor: string;
  private size: Size;

  constructor(options: NoteToolOptions = {}) {
    this.backgroundColor = options.backgroundColor ?? '#ffeb3b';
    this.size = options.size ?? { w: 200, h: 100 };
  }

  onPointerDown(_state: PointerState, _ctx: ToolContext): void {
    // Note is placed on pointer up
  }

  onPointerMove(_state: PointerState, _ctx: ToolContext): void {
    // No drag behavior for note placement
  }

  onPointerUp(state: PointerState, ctx: ToolContext): void {
    const world = ctx.camera.screenToWorld({ x: state.x, y: state.y });
    const note = createNote({
      position: world,
      size: { ...this.size },
      backgroundColor: this.backgroundColor,
    });
    ctx.store.add(note);
    ctx.requestRender();

    ctx.switchTool?.('select');
    ctx.editElement?.(note.id);
  }
}
