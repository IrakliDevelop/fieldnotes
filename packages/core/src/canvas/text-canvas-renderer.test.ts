// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderTextOnCanvas } from './text-canvas-renderer';
import { createText } from '../elements/element-factory';

interface FillTextCall {
  text: string;
  font: string;
}

function recordingCtx() {
  const fillTextCalls: FillTextCall[] = [];
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    fillStyle: '',
    font: '',
    textBaseline: '',
    measureText: vi.fn().mockReturnValue({ width: 40 }),
    fillRect: vi.fn(),
    fillText: vi.fn(function (this: { font: string }, text: string) {
      fillTextCalls.push({ text, font: this.font });
    }),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fillTextCalls };
}

interface XYCall {
  text: string;
  x: number;
  y: number;
}

function deterministicCtx() {
  const calls: XYCall[] = [];
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    fillStyle: '',
    font: '',
    textBaseline: '',
    measureText: (s: string) => ({ width: s.length * 10 }),
    fillRect: vi.fn(),
    fillText: (text: string, x: number, y: number) => {
      calls.push({ text, x, y });
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

describe('renderTextOnCanvas', () => {
  it('renders rich runs and never draws literal HTML tags', () => {
    const { ctx, fillTextCalls } = recordingCtx();
    const text = createText({
      position: { x: 0, y: 0 },
      size: { w: 400, h: 100 },
      text: 'Line 1<b>bold</b>',
      color: '#222',
    });

    renderTextOnCanvas(ctx, text);

    const drawn = fillTextCalls.map((c) => c.text);
    expect(drawn).toContain('bold');
    for (const word of drawn) {
      expect(word).not.toContain('<b>');
      expect(word).not.toContain('</b>');
    }
  });

  it('sets a bold font for the bold run', () => {
    const { ctx, fillTextCalls } = recordingCtx();
    const text = createText({
      position: { x: 0, y: 0 },
      size: { w: 400, h: 100 },
      text: 'Line 1<b>bold</b>',
      color: '#222',
    });

    renderTextOnCanvas(ctx, text);

    const boldCall = fillTextCalls.find((c) => c.text === 'bold');
    expect(boldCall).toBeDefined();
    expect(boldCall?.font).toContain('bold');
  });

  it('applies the text color as fillStyle', () => {
    const { ctx } = recordingCtx();
    const text = createText({
      position: { x: 0, y: 0 },
      size: { w: 400, h: 100 },
      text: 'hello',
      color: '#abcdef',
    });

    renderTextOnCanvas(ctx, text);

    expect(ctx.fillStyle).toBe('#abcdef');
  });

  it('renders left-aligned text at the original streaming x (pad = 2)', () => {
    const { ctx, calls } = deterministicCtx();
    const text = createText({
      position: { x: 0, y: 0 },
      size: { w: 200, h: 28 },
      text: 'aa',
      textAlign: 'left',
    });

    renderTextOnCanvas(ctx, text);

    expect(calls).toEqual([{ text: 'aa', x: 2, y: 2 }]); // startX = 0 + pad(2)
  });

  it('honors textAlign: center', () => {
    const { ctx, calls } = deterministicCtx();
    const text = createText({
      position: { x: 0, y: 0 },
      size: { w: 200, h: 28 },
      text: 'aa',
      textAlign: 'center',
    });

    renderTextOnCanvas(ctx, text);

    // startX = 2, maxWidth = 200 - 4 = 196, lineWidth = 20 → offset = (196-20)/2 = 88.
    expect(calls).toEqual([{ text: 'aa', x: 2 + 88, y: 2 }]);
  });

  it('honors textAlign: right', () => {
    const { ctx, calls } = deterministicCtx();
    const text = createText({
      position: { x: 0, y: 0 },
      size: { w: 200, h: 28 },
      text: 'aa',
      textAlign: 'right',
    });

    renderTextOnCanvas(ctx, text);

    // offset = 196 - 20 = 176.
    expect(calls).toEqual([{ text: 'aa', x: 2 + 176, y: 2 }]);
  });

  it('uses DOM-matching line-height 1.4 between lines', () => {
    const { ctx, calls } = deterministicCtx();
    const text = createText({
      position: { x: 0, y: 0 },
      size: { w: 200, h: 60 },
      text: 'aa\nbb',
      fontSize: 16,
      textAlign: 'left',
    });

    renderTextOnCanvas(ctx, text);

    expect(calls[0]).toEqual({ text: 'aa', x: 2, y: 2 });
    // line 2 y = startY(2) + fontSize(16) * 1.4 = 2 + 22.4.
    expect(calls[1]?.y).toBeCloseTo(2 + 16 * 1.4);
  });
});
