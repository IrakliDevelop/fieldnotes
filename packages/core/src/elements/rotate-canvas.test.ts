import { describe, it, expect, vi } from 'vitest';
import { withRotation } from './rotate-canvas';

const fakeCtx = () =>
  ({
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
  }) as unknown as CanvasRenderingContext2D;

describe('withRotation', () => {
  it('runs draw with no transform when angle is 0', () => {
    const ctx = fakeCtx();
    const draw = vi.fn();
    withRotation(ctx, { rotation: 0 }, { x: 5, y: 5 }, draw);
    expect(draw).toHaveBeenCalledTimes(1);
    expect(ctx.rotate).not.toHaveBeenCalled();
    expect(ctx.save).not.toHaveBeenCalled();
  });

  it('rotates about the center then restores when angle is set', () => {
    const ctx = fakeCtx();
    const calls: string[] = [];
    (ctx.save as ReturnType<typeof vi.fn>).mockImplementation(() => calls.push('save'));
    (ctx.translate as ReturnType<typeof vi.fn>).mockImplementation((x: number, y: number) =>
      calls.push(`translate(${x},${y})`),
    );
    (ctx.rotate as ReturnType<typeof vi.fn>).mockImplementation((a: number) =>
      calls.push(`rotate(${a})`),
    );
    (ctx.restore as ReturnType<typeof vi.fn>).mockImplementation(() => calls.push('restore'));
    withRotation(ctx, { rotation: Math.PI / 2 }, { x: 10, y: 20 }, () => calls.push('draw'));
    expect(calls).toEqual([
      'save',
      'translate(10,20)',
      `rotate(${Math.PI / 2})`,
      'translate(-10,-20)',
      'draw',
      'restore',
    ]);
  });
});
