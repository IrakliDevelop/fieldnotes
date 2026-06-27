import { describe, it, expect, vi } from 'vitest';
import { renderArrow, getArrowDashPattern } from './arrow-renderer';
import { createArrow } from '../element-factory';
import type { ArrowElement } from '../types';

function mockCtx() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    setLineDash: vi.fn(),
    measureText: vi.fn().mockReturnValue({ width: 40 }),
    fillText: vi.fn(),
    roundRect: vi.fn(),
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 0,
    lineCap: '',
    font: '',
    textAlign: '',
    textBaseline: '',
  } as unknown as CanvasRenderingContext2D & { setLineDash: ReturnType<typeof vi.fn> };
}

function render(overrides: Partial<ArrowElement>) {
  const arrow: ArrowElement = {
    ...createArrow({ from: { x: 0, y: 0 }, to: { x: 100, y: 0 } }),
    ...overrides,
  };
  const ctx = mockCtx();
  renderArrow(ctx, arrow, null, null);
  return ctx;
}

describe('getArrowDashPattern', () => {
  it('maps dashed → [8, 4]', () => {
    expect(getArrowDashPattern('dashed')).toEqual([8, 4]);
  });
  it('maps dotted → [2, 4]', () => {
    expect(getArrowDashPattern('dotted')).toEqual([2, 4]);
  });
  it('maps solid → []', () => {
    expect(getArrowDashPattern('solid')).toEqual([]);
  });
  it('maps undefined → []', () => {
    expect(getArrowDashPattern(undefined)).toEqual([]);
  });
});

describe('renderArrow — stroke style dashing', () => {
  it('sets [8, 4] dash for a dashed arrow', () => {
    const ctx = render({ strokeStyle: 'dashed' });
    expect(ctx.setLineDash).toHaveBeenCalledWith([8, 4]);
  });

  it('sets [2, 4] dash for a dotted arrow', () => {
    const ctx = render({ strokeStyle: 'dotted' });
    expect(ctx.setLineDash).toHaveBeenCalledWith([2, 4]);
  });

  it('does not dash a solid arrow', () => {
    const ctx = render({ strokeStyle: 'solid' });
    expect(ctx.setLineDash).not.toHaveBeenCalled();
  });

  it('does not dash an arrow with no strokeStyle', () => {
    const ctx = render({});
    expect(ctx.setLineDash).not.toHaveBeenCalled();
  });

  // Decouple regression: pre-change code dashed whenever a binding was present.
  it('renders a BOUND arrow SOLID when it has no strokeStyle', () => {
    const ctx = render({ fromBinding: { elementId: 'note-1' } });
    expect(ctx.setLineDash).not.toHaveBeenCalled();
  });

  it('dashes a bound arrow only when its strokeStyle says so', () => {
    const ctx = render({ fromBinding: { elementId: 'note-1' }, strokeStyle: 'dashed' });
    expect(ctx.setLineDash).toHaveBeenCalledWith([8, 4]);
  });
});
