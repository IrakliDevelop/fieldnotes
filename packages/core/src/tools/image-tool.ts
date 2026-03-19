import type { Size } from '../core/types';
import type { Tool, ToolContext, PointerState } from './types';
import { createImage } from '../elements/element-factory';

export interface ImageToolOptions {
  size?: Size;
}

export class ImageTool implements Tool {
  readonly name = 'image';
  private size: Size;
  private src: string | null = null;

  constructor(options: ImageToolOptions = {}) {
    this.size = options.size ?? { w: 300, h: 200 };
  }

  setSrc(src: string): void {
    this.src = src;
  }

  onPointerDown(_state: PointerState, _ctx: ToolContext): void {
    // No action on pointer down — image is placed on pointer up
  }

  onPointerMove(_state: PointerState, _ctx: ToolContext): void {
    // No action on pointer move
  }

  onPointerUp(state: PointerState, ctx: ToolContext): void {
    if (!this.src) return;

    const world = ctx.camera.screenToWorld({ x: state.x, y: state.y });
    const image = createImage({
      position: world,
      size: { ...this.size },
      src: this.src,
    });
    ctx.store.add(image);
    ctx.requestRender();

    this.src = null;
    ctx.switchTool?.('select');
  }
}
