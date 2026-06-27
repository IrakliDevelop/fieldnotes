import type { NoteElement } from '../elements/types';
import { DEFAULT_NOTE_FONT_SIZE } from '../elements/element-factory';
import { parseStyledRuns } from '../elements/note-sanitizer';
import type { StyledRun } from '../elements/note-sanitizer';

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

function buildFontString(run: StyledRun): string {
  const style = run.italic ? 'italic' : 'normal';
  const weight = run.bold ? 'bold' : 'normal';
  return `${style} ${weight} ${run.fontSize}px system-ui, sans-serif`;
}

interface LineFragment {
  text: string;
  font: string;
  x: number;
  width: number;
  fontSize: number;
  underline: boolean;
  strikethrough: boolean;
}

interface LaidOutLine {
  y: number;
  width: number;
  fragments: LineFragment[];
}

export function renderStyledRuns(
  ctx: CanvasRenderingContext2D,
  runs: StyledRun[],
  startX: number,
  startY: number,
  maxWidth: number,
  opts: { align?: 'left' | 'center' | 'right'; lineHeight?: number } = {},
): void {
  const align = opts.align ?? 'left';
  const lhMul = opts.lineHeight ?? 1.3;
  ctx.textBaseline = 'top';

  // PASS 1 — lay runs out into lines (no drawing). Wrap behaviour mirrors the
  // original single-pass renderer exactly so wrap points are alignment-agnostic.
  const lines: LaidOutLine[] = [];
  let cursorX = startX;
  let lineY = startY;
  let lineHeight = 0;
  let fragments: LineFragment[] = [];

  const finalizeLine = (): void => {
    const last = fragments[fragments.length - 1];
    const width = last ? last.x + last.width : 0;
    lines.push({ y: lineY, width, fragments });
  };

  const breakLine = (runLineHeight: number): void => {
    finalizeLine();
    lineY += lineHeight;
    lineHeight = runLineHeight;
    fragments = [];
    cursorX = startX;
  };

  for (const run of runs) {
    const font = buildFontString(run);
    ctx.font = font;
    const runLineHeight = run.fontSize * lhMul;
    lineHeight = Math.max(lineHeight, runLineHeight);

    const words = run.text.split(/(\n| )/);
    for (const word of words) {
      if (word === '\n') {
        breakLine(runLineHeight);
        continue;
      }
      if (word === ' ') {
        const spaceWidth = ctx.measureText(' ').width;
        if (cursorX + spaceWidth > startX + maxWidth && cursorX > startX) {
          breakLine(runLineHeight);
        } else {
          cursorX += spaceWidth;
        }
        continue;
      }
      if (!word) continue;

      const metrics = ctx.measureText(word);
      if (cursorX + metrics.width > startX + maxWidth && cursorX > startX) {
        breakLine(runLineHeight);
      }

      fragments.push({
        text: word,
        font,
        x: cursorX - startX,
        width: metrics.width,
        fontSize: run.fontSize,
        underline: run.underline,
        strikethrough: run.strikethrough,
      });
      cursorX += metrics.width;
    }
  }
  finalizeLine();

  // PASS 2 — draw each line at its alignment offset. For align 'left' the
  // offset is 0, so the absolute x equals the original streaming cursorX.
  for (const line of lines) {
    const offset =
      align === 'center'
        ? (maxWidth - line.width) / 2
        : align === 'right'
          ? maxWidth - line.width
          : 0;
    for (const fragment of line.fragments) {
      ctx.font = fragment.font;
      const fx = startX + offset + fragment.x;
      ctx.fillText(fragment.text, fx, line.y);

      if (fragment.underline) {
        ctx.fillRect(fx, line.y + fragment.fontSize + 1, fragment.width, 1);
      }

      if (fragment.strikethrough) {
        ctx.fillRect(fx, line.y + fragment.fontSize * 0.55, fragment.width, 1);
      }
    }
  }
}
