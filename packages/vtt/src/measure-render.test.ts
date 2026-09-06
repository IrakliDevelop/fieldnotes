import { describe, expect, it, vi } from 'vitest';
import { drawMeasurement, formatMeasureLabel } from './measure-render';

function makeCanvasCtx(): CanvasRenderingContext2D {
  // jsdom provides no real 2D context; a recording stub is enough — the
  // pixel-level contract is covered by the measure-share e2e.
  const calls: string[] = [];
  const ctx = {
    calls,
    save: vi.fn(() => calls.push('save')),
    restore: vi.fn(() => calls.push('restore')),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    setLineDash: vi.fn(),
    roundRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 40 })),
    set globalAlpha(v: number) {
      calls.push(`alpha:${v}`);
    },
  } as unknown as CanvasRenderingContext2D & { calls: string[] };
  return ctx;
}

describe('formatMeasureLabel', () => {
  it('rounds feet and appends the unit', () => {
    expect(formatMeasureLabel(29.4)).toBe('29 ft');
    expect(formatMeasureLabel(30)).toBe('30 ft');
    expect(formatMeasureLabel(30.5)).toBe('31 ft');
  });
});

describe('drawMeasurement', () => {
  const model = { start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, feet: 30, color: '#FF5722' };

  it('renders the label text through formatMeasureLabel', () => {
    const ctx = makeCanvasCtx();
    drawMeasurement(ctx, model);
    expect(ctx.fillText).toHaveBeenCalledWith('30 ft', 50, 0);
  });

  it('applies the alpha option and restores state', () => {
    const ctx = makeCanvasCtx() as CanvasRenderingContext2D & { calls: string[] };
    drawMeasurement(ctx, model, { alpha: 0.5 });
    expect(ctx.calls).toContain('alpha:0.5');
    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
  });

  it('strokes with the model color', () => {
    const ctx = makeCanvasCtx();
    drawMeasurement(ctx, { ...model, color: '#00AA00' });
    expect((ctx as unknown as { strokeStyle?: string }).strokeStyle).toBe('#00AA00');
  });
});
