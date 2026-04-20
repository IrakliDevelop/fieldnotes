import type { NoteElement } from '../elements/types';
import { DEFAULT_NOTE_FONT_SIZE } from '../elements/element-factory';
import { parseStyledRuns } from '../elements/note-sanitizer';
import type { StyledRun } from '../elements/note-sanitizer';

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

function buildFontString(run: StyledRun): string {
  const style = run.italic ? 'italic' : 'normal';
  const weight = run.bold ? 'bold' : 'normal';
  return `${style} ${weight} ${run.fontSize}px system-ui, sans-serif`;
}

function renderStyledRuns(
  ctx: CanvasRenderingContext2D,
  runs: StyledRun[],
  startX: number,
  startY: number,
  maxWidth: number,
): void {
  ctx.textBaseline = 'top';
  let cursorX = startX;
  let cursorY = startY;
  let lineHeight = 0;

  for (const run of runs) {
    ctx.font = buildFontString(run);
    const runLineHeight = run.fontSize * 1.3;
    lineHeight = Math.max(lineHeight, runLineHeight);

    const words = run.text.split(/(\n| )/);
    for (const word of words) {
      if (word === '\n') {
        cursorX = startX;
        cursorY += lineHeight;
        lineHeight = runLineHeight;
        continue;
      }
      if (word === ' ') {
        const spaceWidth = ctx.measureText(' ').width;
        if (cursorX + spaceWidth > startX + maxWidth && cursorX > startX) {
          cursorX = startX;
          cursorY += lineHeight;
          lineHeight = runLineHeight;
        } else {
          cursorX += spaceWidth;
        }
        continue;
      }
      if (!word) continue;

      const metrics = ctx.measureText(word);
      if (cursorX + metrics.width > startX + maxWidth && cursorX > startX) {
        cursorX = startX;
        cursorY += lineHeight;
        lineHeight = runLineHeight;
      }

      ctx.fillText(word, cursorX, cursorY);

      if (run.underline) {
        const underY = cursorY + run.fontSize + 1;
        ctx.fillRect(cursorX, underY, metrics.width, 1);
      }

      if (run.strikethrough) {
        const strikeY = cursorY + run.fontSize * 0.55;
        ctx.fillRect(cursorX, strikeY, metrics.width, 1);
      }

      cursorX += metrics.width;
    }
  }
}
