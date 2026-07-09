// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderTemplateFeetLabel } from './template-measure';

function mockCtx(): CanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    fillText: vi.fn(),
    roundRect: vi.fn(),
    setLineDash: vi.fn(),
    measureText: vi.fn(() => ({ width: 30 })),
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: '',
    textBaseline: '',
  } as unknown as CanvasRenderingContext2D;
}

describe('renderTemplateFeetLabel', () => {
  it('draws "N ft" and a measure line when feet > 0', () => {
    const ctx = mockCtx();
    renderTemplateFeetLabel(ctx, {
      position: { x: 0, y: 0 },
      radius: 100,
      angle: 0,
      templateShape: 'cone',
      feet: 15,
      color: '#FF5722',
    });
    expect(ctx.fillText).toHaveBeenCalledWith('15 ft', expect.any(Number), expect.any(Number));
    expect(ctx.moveTo).toHaveBeenCalledWith(0, 0);
  });

  it('is a no-op when feet <= 0', () => {
    const ctx = mockCtx();
    renderTemplateFeetLabel(ctx, {
      position: { x: 0, y: 0 },
      radius: 100,
      angle: 0,
      templateShape: 'cone',
      feet: 0,
      color: '#FF5722',
    });
    expect(ctx.fillText).not.toHaveBeenCalled();
    expect(ctx.moveTo).not.toHaveBeenCalled();
  });

  it('runs the measure line along angle for cone/line', () => {
    const ctx = mockCtx();
    renderTemplateFeetLabel(ctx, {
      position: { x: 0, y: 0 },
      radius: 100,
      angle: Math.PI / 2,
      templateShape: 'line',
      feet: 20,
      color: '#000',
    });
    const end = (ctx.lineTo as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(end[0]).toBeCloseTo(0, 3);
    expect(end[1]).toBeCloseTo(100, 3);
  });

  it('runs a horizontal half-length line for square and full for circle', () => {
    const sq = mockCtx();
    renderTemplateFeetLabel(sq, {
      position: { x: 0, y: 0 },
      radius: 100,
      angle: 1,
      templateShape: 'square',
      feet: 20,
      color: '#000',
    });
    expect((sq.lineTo as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([50, 0]);

    const ci = mockCtx();
    renderTemplateFeetLabel(ci, {
      position: { x: 0, y: 0 },
      radius: 100,
      angle: 1,
      templateShape: 'circle',
      feet: 20,
      color: '#000',
    });
    expect((ci.lineTo as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([100, 0]);
  });
});
