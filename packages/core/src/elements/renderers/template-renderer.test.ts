// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderTemplate } from './template-renderer';
import { createTemplate, createGrid } from '../element-factory';
import type { ElementStore } from '../element-store';
import type { CanvasElement, GridElement, TemplateRenderStyle, TemplateShape } from '../types';

function mockCtx(): CanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 30 })),
    roundRect: vi.fn(),
    setLineDash: vi.fn(),
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: '',
    textBaseline: '',
  } as unknown as CanvasRenderingContext2D;
}

function storeWith(grid: GridElement | null): ElementStore {
  return {
    getElementsByType: (type: string): CanvasElement[] => (type === 'grid' && grid ? [grid] : []),
  } as unknown as ElementStore;
}

function makeTemplate(renderStyle?: TemplateRenderStyle) {
  return createTemplate({
    position: { x: 0, y: 0 },
    templateShape: 'cone',
    radius: 120,
    angle: 0,
    ...(renderStyle !== undefined ? { renderStyle } : {}),
  });
}

const hexGrid = createGrid({ gridType: 'hex', hexOrientation: 'pointy', cellSize: 40 });
const squareGrid = createGrid({ gridType: 'square', cellSize: 40 });

describe('renderTemplate', () => {
  it('renders geometric cone on hex grid when renderStyle is "geometric"', () => {
    const ctx = mockCtx();
    renderTemplate(ctx, makeTemplate('geometric'), storeWith(hexGrid));

    // Geometric cone path: moveTo + arc. Hex-cell path never calls arc.
    expect(ctx.arc).toHaveBeenCalled();
    expect(ctx.moveTo).toHaveBeenCalled();
  });

  it('renders hex-cell cone on hex grid when renderStyle is undefined (default)', () => {
    const ctx = mockCtx();
    renderTemplate(ctx, makeTemplate(undefined), storeWith(hexGrid));

    // Hex-cell path draws hex outlines via lineTo and never uses arc.
    expect(ctx.arc).not.toHaveBeenCalled();
    expect(ctx.lineTo).toHaveBeenCalled();
  });

  it('renders geometric cone on square grid (renderStyle ignored)', () => {
    const ctx = mockCtx();
    renderTemplate(ctx, makeTemplate(undefined), storeWith(squareGrid));

    expect(ctx.arc).toHaveBeenCalled();
  });

  it('renders geometric cone when there is no grid', () => {
    const ctx = mockCtx();
    renderTemplate(ctx, makeTemplate(undefined), storeWith(null));

    expect(ctx.arc).toHaveBeenCalled();
  });

  it('renders geometric on square grid even when renderStyle is "cells"', () => {
    const ctx = mockCtx();
    renderTemplate(ctx, makeTemplate('cells'), storeWith(squareGrid));

    expect(ctx.arc).toHaveBeenCalled();
  });
});

describe('placed template feet readout', () => {
  const placed = (shape: TemplateShape, radiusFeet?: number) =>
    createTemplate({
      position: { x: 0, y: 0 },
      templateShape: shape,
      radius: 120,
      angle: 0,
      feetPerCell: 5,
      radiusFeet,
    });

  it.each(['cone', 'line', 'square'] as TemplateShape[])(
    'renders a feet label for a placed %s with radiusFeet',
    (shape) => {
      const ctx = mockCtx();
      renderTemplate(ctx, placed(shape, 15), storeWith(null));
      expect(ctx.fillText).toHaveBeenCalledWith('15 ft', expect.any(Number), expect.any(Number));
    },
  );

  it('renders no feet label when radiusFeet is absent', () => {
    const ctx = mockCtx();
    renderTemplate(ctx, placed('cone', undefined), storeWith(null));
    expect(ctx.fillText).not.toHaveBeenCalled();
  });
});
