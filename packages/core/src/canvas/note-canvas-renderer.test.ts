// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import type { NoteElement } from '../elements/types';
import { renderNoteOnCanvas, renderStyledRuns } from './note-canvas-renderer';
import type { StyledRun } from '../elements/note-sanitizer';

function makeNote(overrides: Partial<NoteElement> = {}): NoteElement {
  return {
    id: 'note-1',
    type: 'note',
    position: { x: 10, y: 20 },
    size: { w: 200, h: 100 },
    text: '',
    backgroundColor: '#ffeb3b',
    textColor: '#000000',
    zIndex: 0,
    locked: false,
    layerId: 'default',
    ...overrides,
  };
}

function makeMockCtx(): CanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arcTo: vi.fn(),
    fill: vi.fn(),
    fillText: vi.fn(),
    fillRect: vi.fn(),
    measureText: vi.fn().mockReturnValue({ width: 10 }),
    fillStyle: '',
    font: '',
    textBaseline: '',
  } as unknown as CanvasRenderingContext2D;
}

describe('renderNoteOnCanvas', () => {
  it('renders background rectangle', () => {
    const ctx = makeMockCtx();
    const note = makeNote();

    renderNoteOnCanvas(ctx, note);

    expect(ctx.save).toHaveBeenCalled();
    expect(ctx.beginPath).toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalled();
    expect(ctx.restore).toHaveBeenCalled();
  });

  it('uses note backgroundColor for the fill', () => {
    const ctx = makeMockCtx();
    const fillStyles: string[] = [];
    Object.defineProperty(ctx, 'fillStyle', {
      set(v: string) {
        fillStyles.push(v);
      },
      get() {
        return fillStyles[fillStyles.length - 1] ?? '';
      },
    });

    const note = makeNote({ backgroundColor: '#ff5722' });
    renderNoteOnCanvas(ctx, note);

    expect(fillStyles[0]).toBe('#ff5722');
  });

  it('renders text when note has text content', () => {
    const ctx = makeMockCtx();
    const note = makeNote({ text: 'Hello world' });

    renderNoteOnCanvas(ctx, note);

    expect(ctx.fillText).toHaveBeenCalled();
  });

  it('skips text rendering when note text is empty', () => {
    const ctx = makeMockCtx();
    const note = makeNote({ text: '' });

    renderNoteOnCanvas(ctx, note);

    expect(ctx.fillText).not.toHaveBeenCalled();
  });

  it('uses note textColor for text fill', () => {
    const ctx = makeMockCtx();
    const fillStyles: string[] = [];
    Object.defineProperty(ctx, 'fillStyle', {
      set(v: string) {
        fillStyles.push(v);
      },
      get() {
        return fillStyles[fillStyles.length - 1] ?? '';
      },
    });

    const note = makeNote({ text: 'Hello', textColor: '#ff0000' });
    renderNoteOnCanvas(ctx, note);

    expect(fillStyles).toContain('#ff0000');
  });

  it('handles note with HTML bold content', () => {
    const ctx = makeMockCtx();
    const fonts: string[] = [];
    Object.defineProperty(ctx, 'font', {
      set(v: string) {
        fonts.push(v);
      },
      get() {
        return fonts[fonts.length - 1] ?? '';
      },
    });

    const note = makeNote({ text: '<b>Bold</b> text' });
    renderNoteOnCanvas(ctx, note);

    expect(ctx.fillText).toHaveBeenCalled();
    const hasBoldFont = fonts.some((f) => f.includes('bold'));
    expect(hasBoldFont).toBe(true);
    const hasNormalFont = fonts.some((f) => f.includes('normal normal'));
    expect(hasNormalFont).toBe(true);
  });

  it('draws underline decoration for underlined text', () => {
    const ctx = makeMockCtx();
    const note = makeNote({ text: '<u>Underlined</u>' });

    renderNoteOnCanvas(ctx, note);

    expect(ctx.fillRect).toHaveBeenCalled();
  });

  it('draws strikethrough decoration for struck text', () => {
    const ctx = makeMockCtx();
    const note = makeNote({ text: '<s>Struck</s>' });

    renderNoteOnCanvas(ctx, note);

    expect(ctx.fillRect).toHaveBeenCalled();
  });

  it('calls save and restore exactly once', () => {
    const ctx = makeMockCtx();
    const note = makeNote({ text: 'Some text' });

    renderNoteOnCanvas(ctx, note);

    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
  });

  it('renders note text left-aligned at the baseline positions (default opts)', () => {
    // Deterministic measureText: width = chars * 10, space = 10.
    const { ctx, fillText } = recordingCtx();
    // pad = 8 → startX = 10 + 8 = 18, startY = 20 + 8 = 28.
    const note = makeNote({ text: 'aa bb', position: { x: 10, y: 20 } });

    renderNoteOnCanvas(ctx, note);

    expect(fillText).toEqual([
      { text: 'aa', x: 18, y: 28 },
      { text: 'bb', x: 48, y: 28 }, // 18 + 20 (aa) + 10 (space)
    ]);
  });
});

interface FillTextRec {
  text: string;
  x: number;
  y: number;
}
interface FillRectRec {
  x: number;
  y: number;
  w: number;
  h: number;
}

function recordingCtx() {
  const fillText: FillTextRec[] = [];
  const fillRect: FillRectRec[] = [];
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arcTo: vi.fn(),
    fill: vi.fn(),
    fillStyle: '',
    font: '',
    textBaseline: '',
    measureText: (s: string) => ({ width: s.length * 10 }),
    fillText: (text: string, x: number, y: number) => {
      fillText.push({ text, x, y });
    },
    fillRect: (x: number, y: number, w: number, h: number) => {
      fillRect.push({ x, y, w, h });
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fillText, fillRect };
}

function makeRun(text: string, overrides: Partial<StyledRun> = {}): StyledRun {
  return {
    text,
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    fontSize: 16,
    ...overrides,
  };
}

describe('renderStyledRuns alignment & line-height', () => {
  it('LEFT REGRESSION: streams words at the original left positions (no drift)', () => {
    const { ctx, fillText } = recordingCtx();
    // startX = 0, wide maxWidth so nothing wraps. 'aa'=20, space=10, 'bb'=20, 'cc'=20.
    renderStyledRuns(ctx, [makeRun('aa bb cc')], 0, 0, 1000);

    expect(fillText).toEqual([
      { text: 'aa', x: 0, y: 0 },
      { text: 'bb', x: 30, y: 0 }, // 20 + 10
      { text: 'cc', x: 60, y: 0 }, // 30 + 20 + 10
    ]);
  });

  it('LEFT REGRESSION: explicit \\n break uses default line-height 1.3', () => {
    const { ctx, fillText } = recordingCtx();
    renderStyledRuns(ctx, [makeRun('aa\nbb')], 0, 0, 1000);

    expect(fillText).toEqual([
      { text: 'aa', x: 0, y: 0 },
      { text: 'bb', x: 0, y: 16 * 1.3 }, // 20.8
    ]);
  });

  it('CENTER: offsets each line by (maxWidth - lineWidth) / 2 (single line)', () => {
    const { ctx, fillText } = recordingCtx();
    // lineWidth = last fragment x+width = 60 + 20 = 80. offset = (1000-80)/2 = 460.
    renderStyledRuns(ctx, [makeRun('aa bb cc')], 0, 0, 1000, { align: 'center' });

    expect(fillText).toEqual([
      { text: 'aa', x: 460, y: 0 },
      { text: 'bb', x: 490, y: 0 },
      { text: 'cc', x: 520, y: 0 },
    ]);
  });

  it('CENTER: aligns each wrapped line independently', () => {
    const { ctx, fillText } = recordingCtx();
    // maxWidth 70: line0 = ['aaa','bbb'] (width 70), line1 = ['ccc'] (width 30).
    renderStyledRuns(ctx, [makeRun('aaa bbb ccc')], 0, 0, 70, { align: 'center' });

    expect(fillText).toEqual([
      { text: 'aaa', x: (70 - 70) / 2 + 0, y: 0 },
      { text: 'bbb', x: (70 - 70) / 2 + 40, y: 0 },
      { text: 'ccc', x: (70 - 30) / 2 + 0, y: 16 * 1.3 },
    ]);
  });

  it('RIGHT: offsets each line by (maxWidth - lineWidth)', () => {
    const { ctx, fillText } = recordingCtx();
    // lineWidth = 80. offset = 1000 - 80 = 920.
    renderStyledRuns(ctx, [makeRun('aa bb cc')], 0, 0, 1000, { align: 'right' });

    expect(fillText).toEqual([
      { text: 'aa', x: 920, y: 0 },
      { text: 'bb', x: 950, y: 0 },
      { text: 'cc', x: 980, y: 0 },
    ]);
  });

  it('WRAP UNCHANGED: same words land on the same lines across alignments', () => {
    const linesByAlign = (align: 'left' | 'center' | 'right') => {
      const { ctx, fillText } = recordingCtx();
      renderStyledRuns(ctx, [makeRun('aaa bbb ccc')], 0, 0, 70, { align });
      const byY = new Map<number, string[]>();
      for (const c of fillText) {
        const arr = byY.get(c.y) ?? [];
        arr.push(c.text);
        byY.set(c.y, arr);
      }
      return [...byY.entries()].sort((a, b) => a[0] - b[0]).map(([, w]) => w);
    };

    const expected = [['aaa', 'bbb'], ['ccc']];
    expect(linesByAlign('left')).toEqual(expected);
    expect(linesByAlign('center')).toEqual(expected);
    expect(linesByAlign('right')).toEqual(expected);
  });

  it('UNDERLINE/STRIKETHROUGH: decoration rects sit at the aligned fragment x', () => {
    const { ctx, fillText, fillRect } = recordingCtx();
    // single word 'aa', width 20. lineWidth 20, offset center = (1000-20)/2 = 490.
    renderStyledRuns(ctx, [makeRun('aa', { underline: true, strikethrough: true })], 0, 0, 1000, {
      align: 'center',
    });

    expect(fillText).toEqual([{ text: 'aa', x: 490, y: 0 }]);
    expect(fillRect).toEqual([
      { x: 490, y: 16 + 1, w: 20, h: 1 }, // underline
      { x: 490, y: 16 * 0.55, w: 20, h: 1 }, // strikethrough
    ]);
  });

  it('LINE-HEIGHT: opts.lineHeight controls the vertical advance between lines', () => {
    const def = recordingCtx();
    renderStyledRuns(def.ctx, [makeRun('aa\nbb')], 0, 0, 1000);
    expect(def.fillText[1]?.y).toBeCloseTo(16 * 1.3);

    const wide = recordingCtx();
    renderStyledRuns(wide.ctx, [makeRun('aa\nbb')], 0, 0, 1000, { lineHeight: 1.4 });
    expect(wide.fillText[1]?.y).toBeCloseTo(16 * 1.4);
  });
});
