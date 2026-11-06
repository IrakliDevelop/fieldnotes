import type { NoteElement } from '../elements/types';
import { DEFAULT_NOTE_FONT_SIZE } from '../elements/element-factory';
import { parseStyledRuns } from '../elements/note-sanitizer';
import type { StyledRun } from '../elements/note-sanitizer';
import { layoutStyledRuns } from '../elements/text-layout';

export { parseStyledRuns };
export type { StyledRun };

export function renderNoteOnCanvas(ctx: CanvasRenderingContext2D, note: NoteElement): void {
  const { x, y } = note.position;
  const { w, h } = note.size;
  const r = 4;
  const pad = 8;
  const baseFontSize = note.fontSize ?? DEFAULT_NOTE_FONT_SIZE;

  ctx.save();
  ctx.fillStyle = note.backgroundColor;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
  ctx.fill();

  if (note.text) {
    ctx.fillStyle = note.textColor;
    const runs = parseStyledRuns(note.text, baseFontSize);
    renderStyledRuns(ctx, runs, x + pad, y + pad, w - pad * 2);
  }

  ctx.restore();
}

export function renderStyledRuns(
  ctx: CanvasRenderingContext2D,
  runs: StyledRun[],
  startX: number,
  startY: number,
  maxWidth: number,
  opts: { align?: 'left' | 'center' | 'right'; lineHeight?: number; wrap?: boolean } = {},
): void {
  const align = opts.align ?? 'left';
  const lhMul = opts.lineHeight ?? 1.3;
  ctx.textBaseline = 'top';

  const layout = layoutStyledRuns(
    (value, font) => {
      ctx.font = font;
      return ctx.measureText(value).width;
    },
    runs,
    opts.wrap === false ? Infinity : maxWidth,
    lhMul,
  );

  // PASS 2 — draw each line at its alignment offset. For align 'left' the
  // offset is 0, so the absolute x equals the original streaming cursorX.
  for (const line of layout.lines) {
    const offset =
      align === 'center'
        ? (maxWidth - line.width) / 2
        : align === 'right'
          ? maxWidth - line.width
          : 0;
    for (const fragment of line.fragments) {
      ctx.font = fragment.font;
      const fx = startX + offset + fragment.x;
      ctx.fillText(fragment.text, fx, startY + line.y);

      if (fragment.underline) {
        ctx.fillRect(fx, startY + line.y + fragment.fontSize + 1, fragment.width, 1);
      }

      if (fragment.strikethrough) {
        ctx.fillRect(fx, startY + line.y + fragment.fontSize * 0.55, fragment.width, 1);
      }
    }
  }
}
