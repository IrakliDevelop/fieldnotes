import type { Size } from '../core/types';
import type { Tool, ToolContext, PointerState } from './types';
import { createNote } from '../elements/element-factory';
import { snapPoint } from '../core/snap';

export interface NoteToolOptions {
  backgroundColor?: string;
  textColor?: string;
  size?: Size;
}

export class NoteTool implements Tool {
  readonly name = 'note';
  private backgroundColor: string;
  private textColor: string;
  private size: Size;

  constructor(options: NoteToolOptions = {}) {
    this.backgroundColor = options.backgroundColor ?? '#ffeb3b';
    this.textColor = options.textColor ?? '#000000';
    this.size = options.size ?? { w: 200, h: 100 };
  }

  setOptions(options: NoteToolOptions): void {
    if (options.backgroundColor !== undefined) this.backgroundColor = options.backgroundColor;
    if (options.textColor !== undefined) this.textColor = options.textColor;
    if (options.size !== undefined) this.size = options.size;
  }

  onPointerDown(_state: PointerState, _ctx: ToolContext): void {
    // Note is placed on pointer up
  }

  onPointerMove(_state: PointerState, _ctx: ToolContext): void {
    // No drag behavior for note placement
  }

  onPointerUp(state: PointerState, ctx: ToolContext): void {
    let world = ctx.camera.screenToWorld({ x: state.x, y: state.y });
    if (ctx.snapToGrid && ctx.gridSize) {
      world = snapPoint(world, ctx.gridSize);
    }
    const note = createNote({
      position: world,
      size: { ...this.size },
      backgroundColor: this.backgroundColor,
      textColor: this.textColor,
      layerId: ctx.activeLayerId ?? '',
    });
    ctx.store.add(note);
    ctx.requestRender();

    ctx.switchTool?.('select');
    ctx.editElement?.(note.id);
  }
}
