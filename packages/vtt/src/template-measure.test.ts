// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { renderTemplateFeetLabel } from './template/template-measure';

function mockCtx(scale?: number): CanvasRenderingContext2D {
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
    ...(scale === undefined ? {} : { getTransform: () => ({ a: scale, b: 0, c: 0, d: scale }) }),
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
    if (!end) throw new Error('lineTo was never called');
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

  const cone = {
    position: { x: 0, y: 0 },
    angle: 0,
    templateShape: 'cone',
    color: '#000',
  } as const;

  it('template label keeps 14 CSS px at zoom 0.25 when the template is large on screen', () => {
    vi.stubGlobal('devicePixelRatio', 1);
    const ctx = mockCtx(0.25);
    renderTemplateFeetLabel(ctx, { ...cone, radius: 400, feet: 15 });

    expect(ctx.font).toBe('bold 56px sans-serif');
    expect(ctx.lineWidth).toBe(6);
    expect(ctx.setLineDash).toHaveBeenCalledWith([16, 16]);
    expect(ctx.roundRect).toHaveBeenCalledWith(161, -116, 78, 88, 16);
    expect(ctx.fillStyle).toBe('#FFFFFF');
    expect(ctx.fillText).toHaveBeenCalledWith('15 ft', 200, -72);
  });

  it.each([
    { radius: 80, zoom: 1, font: 'bold 12px sans-serif' },
    { radius: 80, zoom: 2, font: 'bold 7px sans-serif' },
    { radius: 24, zoom: 1, font: 'bold 10px sans-serif' },
    { radius: 64, zoom: 0.25, font: 'bold 40px sans-serif' },
  ])(
    'template label font is max(10, min(14, 0.15 × on-screen radius)) CSS px: r=$radius at zoom $zoom → $font',
    ({ radius, zoom, font }) => {
      vi.stubGlobal('devicePixelRatio', 1);
      const ctx = mockCtx(zoom);
      renderTemplateFeetLabel(ctx, { ...cone, radius, feet: 5 });

      expect(ctx.font).toBe(font);
      expect(ctx.fillText).toHaveBeenCalledWith('5 ft', radius / 2, expect.any(Number));
    },
  );

  it('no template label when the on-screen radius is below 16 CSS px', () => {
    vi.stubGlobal('devicePixelRatio', 1);
    const ctx = mockCtx(0.25);
    renderTemplateFeetLabel(ctx, { ...cone, radius: 60, feet: 15 });

    expect(ctx.fillText).not.toHaveBeenCalled();
    expect(ctx.roundRect).not.toHaveBeenCalled();
  });

  it('a minimap-like transform draws no label for a 30 ft template', () => {
    vi.stubGlobal('devicePixelRatio', 2);
    const ctx = mockCtx(2 * 0.05);
    renderTemplateFeetLabel(ctx, { ...cone, radius: 12, feet: 30 });

    expect(ctx.fillText).not.toHaveBeenCalled();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
