// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import type { NoteElement } from '../elements/types';
import { renderNoteOnCanvas } from './note-canvas-renderer';

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
});
