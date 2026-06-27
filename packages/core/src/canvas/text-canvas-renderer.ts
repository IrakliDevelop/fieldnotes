import type { TextElement } from '../elements/types';
import { parseStyledRuns, renderStyledRuns } from './note-canvas-renderer';

export function renderTextOnCanvas(ctx: CanvasRenderingContext2D, text: TextElement): void {
  const pad = 2; // matches the DOM text padding
  ctx.save();
  ctx.fillStyle = text.color;
  const runs = parseStyledRuns(text.text ?? '', text.fontSize);
  renderStyledRuns(ctx, runs, text.position.x + pad, text.position.y + pad, text.size.w - pad * 2);
  ctx.restore();
}
