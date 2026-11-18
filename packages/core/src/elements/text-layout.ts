import type { StyledRun } from './note-sanitizer';

let fontFamily: string | null = null;

export function textFontFamily(): string {
  return fontFamily ?? 'system-ui, sans-serif';
}

export function textFontFamilySetting(): string | null {
  return fontFamily;
}

export function setFontFamily(family: string | null): void {
  fontFamily = family;
}

export interface LineFragment {
  text: string;
  font: string;
  x: number;
  width: number;
  fontSize: number;
  underline: boolean;
  strikethrough: boolean;
  trailingSpace: boolean;
}

export interface LaidOutLine {
  y: number;
  width: number;
  fragments: LineFragment[];
}

export function lineOffset(
  line: LaidOutLine,
  align: 'left' | 'center' | 'right',
  contentWidth: number,
): number {
  if (align === 'center') return (contentWidth - line.width) / 2;
  if (align === 'right') return contentWidth - line.width;
  return 0;
}

export function buildFontString(run: StyledRun): string {
  const style = run.italic ? 'italic' : 'normal';
  const weight = run.bold ? 'bold' : 'normal';
  return `${style} ${weight} ${run.fontSize}px ${textFontFamily()}`;
}

export function layoutStyledRuns(
  measure: (text: string, font: string) => number,
  runs: StyledRun[],
  maxWidth: number,
  lineHeight: number,
): { lines: LaidOutLine[]; width: number; height: number } {
  const lines: LaidOutLine[] = [];
  let cursorX = 0;
  let lineY = 0;
  let currentLineHeight = 0;
  let fragments: LineFragment[] = [];

  const finalizeLine = (): void => {
    const last = fragments[fragments.length - 1];
    lines.push({ y: lineY, width: last ? last.x + last.width : 0, fragments });
  };
  const breakLine = (runLineHeight: number): void => {
    finalizeLine();
    lineY += currentLineHeight;
    currentLineHeight = runLineHeight;
    fragments = [];
    cursorX = 0;
  };

  for (const run of runs) {
    const font = buildFontString(run);
    const runLineHeight = run.fontSize * lineHeight;
    currentLineHeight = Math.max(currentLineHeight, runLineHeight);
    for (const word of run.text.split(/(\n| )/)) {
      if (word === '\n') {
        breakLine(runLineHeight);
        continue;
      }
      if (word === ' ') {
        const width = measure(' ', font);
        if (cursorX + width > maxWidth && cursorX > 0) breakLine(runLineHeight);
        else {
          cursorX += width;
          const last = fragments[fragments.length - 1];
          if (last) last.trailingSpace = true;
        }
        continue;
      }
      if (!word) continue;
      const width = measure(word, font);
      if (cursorX + width > maxWidth && cursorX > 0) breakLine(runLineHeight);
      fragments.push({
        text: word,
        font,
        x: cursorX,
        width,
        fontSize: run.fontSize,
        underline: run.underline,
        strikethrough: run.strikethrough,
        trailingSpace: false,
      });
      cursorX += width;
    }
  }
  finalizeLine();
  return {
    lines,
    width: Math.max(0, ...lines.map((line) => line.width)),
    height: lineY + currentLineHeight,
  };
}
