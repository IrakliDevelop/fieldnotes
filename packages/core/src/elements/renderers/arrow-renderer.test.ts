import { describe, it, expect, vi } from 'vitest';
import { renderArrow, getArrowDashPattern } from './arrow-renderer';
import { createArrow, createShape } from '../element-factory';
import { ElementStore } from '../element-store';
import { getArrowControlPoint, getArrowMidpoint } from '../arrow-geometry';
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

describe('renderArrow bound curve', () => {
  it('draws the trimmed intrinsic quadratic and anchors its label on that curve', () => {
    const store = new ElementStore();
    const from = createShape({
      shape: 'rectangle',
      position: { x: 0, y: 0 },
      size: { w: 100, h: 100 },
    });
    const to = createShape({
      shape: 'rectangle',
      position: { x: 300, y: 0 },
      size: { w: 100, h: 100 },
    });
    const arrow = createArrow({
      from: { x: 50, y: 50 },
      to: { x: 350, y: 50 },
      bend: 60,
      label: 'label',
      fromBinding: { elementId: from.id },
      toBinding: { elementId: to.id },
    });
    arrow.cachedControlPoint = { x: 200, y: -200 };
    store.add(from);
    store.add(to);
    store.add(arrow);

    const ctx = mockCtx();
    renderArrow(ctx, arrow, store, null);

    const move = ctx.moveTo.mock.calls[0];
    const curve = ctx.quadraticCurveTo.mock.calls[0];
    if (!move || !curve) throw new Error('expected quadratic path');
    const [fromX, fromY] = move as [number, number];
    const [controlX, controlY, toX, toY] = curve as [number, number, number, number];
    const drawn = {
      from: { x: fromX, y: fromY },
      control: { x: controlX, y: controlY },
      to: { x: toX, y: toY },
    };

    const intrinsicControl = getArrowControlPoint(arrow.from, arrow.to, arrow.bend);
    const t0 = 1 / 6;
    const t1 = 5 / 6;
    const pointAt = (t: number) => {
      const mt = 1 - t;
      return {
        x: mt * mt * arrow.from.x + 2 * mt * t * intrinsicControl.x + t * t * arrow.to.x,
        y: mt * mt * arrow.from.y + 2 * mt * t * intrinsicControl.y + t * t * arrow.to.y,
      };
    };
    const drawnAt = (s: number) => {
      const mt = 1 - s;
      return {
        x: mt * mt * drawn.from.x + 2 * mt * s * drawn.control.x + s * s * drawn.to.x,
        y: mt * mt * drawn.from.y + 2 * mt * s * drawn.control.y + s * s * drawn.to.y,
      };
    };

    for (const s of [0, 0.5, 1]) {
      const expected = pointAt(t0 + s * (t1 - t0));
      const actual = drawnAt(s);
      expect(actual.x).toBeCloseTo(expected.x, 2);
      expect(actual.y).toBeCloseTo(expected.y, 2);
    }
    expect(drawn.from.x).toBeCloseTo(100, 0);
    expect(drawn.to.x).toBeCloseTo(300, 0);
    expect(getArrowMidpoint(arrow.from, arrow.to, arrow.bend).y).toBeCloseTo(80, 2);
    expect(ctx.fillText).toHaveBeenCalledWith('label', 200, 80);
  });
});
