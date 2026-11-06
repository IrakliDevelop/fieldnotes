import type { TextElement } from '../elements/types';
import { TEXT_PADDING } from '../elements/text-measure';
import { parseStyledRuns, renderStyledRuns } from './note-canvas-renderer';

export function renderTextOnCanvas(ctx: CanvasRenderingContext2D, text: TextElement): void {
  ctx.save();
  ctx.fillStyle = text.color;
  const runs = parseStyledRuns(text.text ?? '', text.fontSize);
  renderStyledRuns(
    ctx,
    runs,
    text.position.x + TEXT_PADDING,
    text.position.y + TEXT_PADDING,
    Math.max(0, text.size.w - TEXT_PADDING * 2),
    {
      align: text.textAlign,
      lineHeight: 1.4,
      wrap: text.wrap !== false,
    },
  );
  ctx.restore();
}
