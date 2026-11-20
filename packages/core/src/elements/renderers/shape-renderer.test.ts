import { describe, expect, it, vi } from 'vitest';
import { resolveTheme } from '../../canvas/theme';
import { createShape } from '../element-factory';
import { renderShape } from './shape-renderer';

function context(): CanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    ellipse: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 0,
  } as unknown as CanvasRenderingContext2D;
}

describe('renderShape', () => {
  it('adapts dark stroke and fill while preserving no-fill shapes', () => {
    const ctx = context();
    renderShape(
      ctx,
      createShape({
        position: { x: 0, y: 0 },
        size: { w: 10, h: 10 },
        strokeColor: '#000000',
        fillColor: '#ffeb3b',
      }),
      resolveTheme('dark'),
    );
    expect(ctx.strokeStyle).toBe('#ededed');
    expect(ctx.fillStyle).toBe('#5c540d');

    const empty = context();
    renderShape(
      empty,
      createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 }, fillColor: 'none' }),
      resolveTheme('dark'),
    );
    expect(empty.fillRect).not.toHaveBeenCalled();
    expect(empty.fill).not.toHaveBeenCalled();
  });
});
