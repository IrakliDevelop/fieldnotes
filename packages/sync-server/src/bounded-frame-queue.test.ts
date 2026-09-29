import { describe, expect, it } from 'vitest';
import { FrameBudget } from './bounded-frame-queue';

describe('shared frame budget', () => {
  it('counts exact UTF-8 bytes and active reservations across both directions', () => {
    const budget = new FrameBudget(2, 6, 3, 8);
    const first = budget.reserve('a', 'R', 'é'); // 2 bytes
    const second = budget.reserve('a', 'R', '🔥'); // 4 bytes
    expect(first).toBeTypeOf('function');
    expect(second).toBeTypeOf('function');
    expect(budget.reserve('a', 'R', '')).toBeNull(); // connection count
    expect(budget.reserve('b', 'R', 'é')).toBeTypeOf('function'); // room equality
    expect(budget.reserve('c', 'R', '')).toBeNull(); // room count
    first?.();
    first?.(); // idempotent release
    expect(budget.reserve('a', 'R', 'é')).toBeTypeOf('function');
    expect(budget.reserve('a', 'R', 'x')).toBeNull();
  });

  it('rejects a byte overflow even when count fits, then reuses released capacity', () => {
    const budget = new FrameBudget(4, 4, 4, 4);
    const release = budget.reserve('a', 'R', '🔥');
    expect(release).toBeTypeOf('function');
    expect(budget.reserve('b', 'R', 'x')).toBeNull();
    release?.();
    expect(budget.reserve('b', 'R', 'x')).toBeTypeOf('function');
  });
});
