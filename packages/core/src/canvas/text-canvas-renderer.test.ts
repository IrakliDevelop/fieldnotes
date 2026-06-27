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
});
