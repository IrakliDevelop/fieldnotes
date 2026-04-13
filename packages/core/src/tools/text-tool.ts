import type { Tool, ToolContext, PointerState } from './types';
import { createText } from '../elements/element-factory';
import { smartSnap } from '../core/snap';

export interface TextToolOptions {
  fontSize?: number;
  color?: string;
  textAlign?: 'left' | 'center' | 'right';
}

export class TextTool implements Tool {
  readonly name = 'text';
  private fontSize: number;
  private color: string;
  private textAlign: 'left' | 'center' | 'right';
  private optionListeners = new Set<() => void>();

  constructor(options: TextToolOptions = {}) {
    this.fontSize = options.fontSize ?? 16;
    this.color = options.color ?? '#1a1a1a';
    this.textAlign = options.textAlign ?? 'left';
  }

  getOptions(): TextToolOptions {
    return { fontSize: this.fontSize, color: this.color, textAlign: this.textAlign };
  }

  onOptionsChange(listener: () => void): () => void {
    this.optionListeners.add(listener);
    return () => this.optionListeners.delete(listener);
  }

  setOptions(options: TextToolOptions): void {
    if (options.fontSize !== undefined) this.fontSize = options.fontSize;
    if (options.color !== undefined) this.color = options.color;
    if (options.textAlign !== undefined) this.textAlign = options.textAlign;
    this.notifyOptionsChange();
  }

  private notifyOptionsChange(): void {
    for (const listener of this.optionListeners) listener();
  }

  onActivate(ctx: ToolContext): void {
    ctx.setCursor?.('text');
  }

  onDeactivate(ctx: ToolContext): void {
    ctx.setCursor?.('default');
  }

  onPointerDown(_state: PointerState, _ctx: ToolContext): void {
    // Text is placed on pointer up
  }

  onPointerMove(_state: PointerState, _ctx: ToolContext): void {
    // No drag behavior for text placement
  }

  onPointerUp(state: PointerState, ctx: ToolContext): void {
    let world = ctx.camera.screenToWorld({ x: state.x, y: state.y });
    world = smartSnap(world, ctx);
    const textEl = createText({
      position: world,
      fontSize: this.fontSize,
      color: this.color,
      textAlign: this.textAlign,
      layerId: ctx.activeLayerId ?? '',
    });
    ctx.store.add(textEl);
    ctx.requestRender();

    ctx.switchTool?.('select');
    ctx.editElement?.(textEl.id);
  }
}
