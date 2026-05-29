// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DoubleTapDetector } from './double-tap-detector';

function makePointerEvent(
  type: string,
  opts: Partial<PointerEventInit> & { clientX?: number; clientY?: number } = {},
): PointerEvent {
  return new PointerEvent(type, { bubbles: true, ...opts });
}

describe('DoubleTapDetector', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns false on single tap', () => {
    const detector = new DoubleTapDetector();
    const result = detector.feed(makePointerEvent('pointerup', { clientX: 10, clientY: 10 }));
    expect(result).toBe(false);
  });

  it('returns true on two taps within timeout and distance', () => {
    const detector = new DoubleTapDetector();
    detector.feed(makePointerEvent('pointerup', { clientX: 10, clientY: 10 }));
    vi.advanceTimersByTime(200);
    const result = detector.feed(makePointerEvent('pointerup', { clientX: 12, clientY: 12 }));
    expect(result).toBe(true);
  });

  it('returns false when second tap exceeds timeout', () => {
    const detector = new DoubleTapDetector();
    detector.feed(makePointerEvent('pointerup', { clientX: 10, clientY: 10 }));
    vi.advanceTimersByTime(400);
    const result = detector.feed(makePointerEvent('pointerup', { clientX: 12, clientY: 12 }));
    expect(result).toBe(false);
  });

  it('returns false when second tap exceeds distance', () => {
    const detector = new DoubleTapDetector();
    detector.feed(makePointerEvent('pointerup', { clientX: 10, clientY: 10 }));
    vi.advanceTimersByTime(100);
    const result = detector.feed(makePointerEvent('pointerup', { clientX: 50, clientY: 50 }));
    expect(result).toBe(false);
  });

  it('resets after successful double-tap', () => {
    const detector = new DoubleTapDetector();
    detector.feed(makePointerEvent('pointerup', { clientX: 10, clientY: 10 }));
    detector.feed(makePointerEvent('pointerup', { clientX: 10, clientY: 10 }));
    const third = detector.feed(makePointerEvent('pointerup', { clientX: 10, clientY: 10 }));
    expect(third).toBe(false);
  });

  it('uses custom timeout', () => {
    const detector = new DoubleTapDetector({ timeout: 100 });
    detector.feed(makePointerEvent('pointerup', { clientX: 10, clientY: 10 }));
    vi.advanceTimersByTime(150);
    const result = detector.feed(makePointerEvent('pointerup', { clientX: 10, clientY: 10 }));
    expect(result).toBe(false);
  });

  it('uses custom maxDistance', () => {
    const detector = new DoubleTapDetector({ maxDistance: 5 });
    detector.feed(makePointerEvent('pointerup', { clientX: 10, clientY: 10 }));
    const result = detector.feed(makePointerEvent('pointerup', { clientX: 20, clientY: 10 }));
    expect(result).toBe(false);
  });

  it('reset() clears pending first tap', () => {
    const detector = new DoubleTapDetector();
    detector.feed(makePointerEvent('pointerup', { clientX: 10, clientY: 10 }));
    detector.reset();
    const result = detector.feed(makePointerEvent('pointerup', { clientX: 10, clientY: 10 }));
    expect(result).toBe(false);
  });

  it('treats expired first tap as new first tap', () => {
    const detector = new DoubleTapDetector();
    detector.feed(makePointerEvent('pointerup', { clientX: 10, clientY: 10 }));
    vi.advanceTimersByTime(400);
    detector.feed(makePointerEvent('pointerup', { clientX: 50, clientY: 50 }));
    vi.advanceTimersByTime(100);
    const result = detector.feed(makePointerEvent('pointerup', { clientX: 52, clientY: 52 }));
    expect(result).toBe(true);
  });

  it('treats distance-exceeded tap as new first tap', () => {
    const detector = new DoubleTapDetector();
    detector.feed(makePointerEvent('pointerup', { clientX: 10, clientY: 10 }));
    vi.advanceTimersByTime(100);
    detector.feed(makePointerEvent('pointerup', { clientX: 100, clientY: 100 }));
    vi.advanceTimersByTime(100);
    const result = detector.feed(makePointerEvent('pointerup', { clientX: 102, clientY: 102 }));
    expect(result).toBe(true);
  });
});
