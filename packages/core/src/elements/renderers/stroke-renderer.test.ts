// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_THEME, resolveTheme } from '../../canvas/theme';
import { createStroke } from '../element-factory';
import { renderStroke } from './stroke-renderer';

function context(): CanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    stroke: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    strokeStyle: '',
    lineCap: '',
    lineJoin: '',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D;
}

describe('renderStroke', () => {
  it('uses screen and stored ink for a dark highlighter', () => {
    const ctx = context();
    const stroke = createStroke({
      color: '#ffeb3b',
      blendMode: 'multiply',
      points: [
        { x: 0, y: 0, pressure: 1 },
        { x: 10, y: 0, pressure: 1 },
      ],
    });

    renderStroke(ctx, stroke, resolveTheme('dark'));

    expect(ctx.strokeStyle).toBe('#ffeb3b');
    expect(ctx.globalCompositeOperation).toBe('screen');
  });

  it.each([DEFAULT_THEME, undefined])('keeps multiply and raw ink outside dark mode', (theme) => {
    const ctx = context();
    const stroke = createStroke({
      color: '#ffeb3b',
      blendMode: 'multiply',
      points: [
        { x: 0, y: 0, pressure: 1 },
        { x: 10, y: 0, pressure: 1 },
      ],
    });
    renderStroke(ctx, stroke, theme);
    expect(ctx.strokeStyle).toBe('#ffeb3b');
    expect(ctx.globalCompositeOperation).toBe('multiply');
  });
});
