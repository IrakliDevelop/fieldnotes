import { layoutStyledRuns } from './text-layout';
import { parseStyledRuns } from './note-sanitizer';
import type { StyledRun } from './note-sanitizer';

/** Measures one text fragment using its CSS canvas font string. */
export type TextMeasurer = (text: string, font: string) => number;

const CACHE_SIZE = 512;
export const TEXT_PADDING = 2;
const LINE_HEIGHT = 1.4;
const BASE_FONT_SENTINEL = -1;
let textMeasurer: TextMeasurer | null = null;
let canvasContext: CanvasRenderingContext2D | null | undefined;
const parsedRuns = new Map<string, StyledRun[]>();
const sizes = new Map<string, { w: number; h: number }>();

/** Sets the text measurer used by core text sizing; `null` restores the browser fallback. */
export function setTextMeasurer(measure: TextMeasurer | null): void {
  textMeasurer = measure;
  parsedRuns.clear();
  sizes.clear();
}

/** Measures an HTML text element's border box without requiring a viewport. */
export function measureText(
  html: string,
  fontSize: number,
  maxWidth: number | null,
): { w: number; h: number } {
  const key = `${fontSize}\u0000${maxWidth}\u0000${html}`;
  const cached = sizes.get(key);
  if (cached) return { ...cached };
  const runs = getRuns(html, fontSize);
  const contentWidth = maxWidth === null ? Infinity : Math.max(0, maxWidth - TEXT_PADDING * 2);
  const layout = layoutStyledRuns(measure, runs, contentWidth, LINE_HEIGHT);
  const size = {
    w: maxWidth === null ? layout.width + TEXT_PADDING * 2 : maxWidth,
    h: (runs.length ? layout.height : fontSize * LINE_HEIGHT) + TEXT_PADDING * 2,
  };
  cache(sizes, key, size);
  return { ...size };
}

function getRuns(html: string, fontSize: number): StyledRun[] {
  const cached = parsedRuns.get(html);
  if (cached) return withBaseFontSize(cached, fontSize);
  const runs =
    typeof DOMParser === 'undefined'
      ? [
          {
            text: html,
            bold: false,
            italic: false,
            underline: false,
            strikethrough: false,
            fontSize: BASE_FONT_SENTINEL,
          },
        ]
      : parseStyledRuns(html, BASE_FONT_SENTINEL);
  cache(parsedRuns, html, runs);
  return withBaseFontSize(runs, fontSize);
}

function withBaseFontSize(runs: StyledRun[], fontSize: number): StyledRun[] {
  return runs.map((run) => (run.fontSize === BASE_FONT_SENTINEL ? { ...run, fontSize } : run));
}

function measure(text: string, font: string): number {
  if (textMeasurer) return textMeasurer(text, font);
  if (canvasContext === undefined) {
    try {
      canvasContext = document.createElement('canvas').getContext('2d');
    } catch {
      canvasContext = null;
    }
  }
  if (canvasContext) {
    canvasContext.font = font;
    return canvasContext.measureText(text).width;
  }
  const fontSize = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1]) || 16;
  return text.length * fontSize * 0.6;
}

function cache<T>(map: Map<string, T>, key: string, value: T): void {
  map.set(key, value);
  if (map.size > CACHE_SIZE) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
}
