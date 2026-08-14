import { describe, expect, it, vi } from 'vitest';
import { ElementStore } from '../elements/element-store';
import { createImage, createStroke } from '../elements/element-factory';
import { computeElementRects, elementRectsEqual, ElementRectTracker } from './element-rect-tracker';
import type { CanvasElement } from '../elements/types';

function storeWith(...elements: CanvasElement[]): ElementStore {
  const store = new ElementStore();
  for (const el of elements) store.add(el);
  return store;
}

function image(id: string, x: number, y: number): CanvasElement {
  return {
    ...createImage({ position: { x, y }, size: { w: 40, h: 40 }, src: 'a.png', layerId: 'l1' }),
    id,
  };
}

describe('computeElementRects', () => {
  it('returns one rect per matched element, echoing the key', () => {
    const store = storeWith(image('a', 10, 20), image('b', 50, 60));
    const rects = computeElementRects(store, (el) => (el.id === 'a' ? 'key-a' : null));
    expect(rects).toEqual([{ id: 'a', key: 'key-a', x: 10, y: 20, w: 40, h: 40, rotation: 0 }]);
  });

  it('reports rotation in radians, defaulting to 0', () => {
    const rotated = { ...image('a', 0, 0), rotation: 1.5 };
    const rects = computeElementRects(storeWith(rotated), () => 'k');
    expect(rects[0]?.rotation).toBe(1.5);
  });

  it('tracks unsized elements via getElementBounds', () => {
    const stroke = createStroke({
      points: [
        { x: 0, y: 0, pressure: 0.5 },
        { x: 30, y: 40, pressure: 0.5 },
      ],
      color: '#000',
      width: 2,
      layerId: 'l1',
    });
    const rects = computeElementRects(storeWith(stroke), () => 'stroke-key');
    expect(rects).toHaveLength(1);
    expect(rects[0]?.w).toBeGreaterThan(0);
    expect(rects[0]?.h).toBeGreaterThan(0);
  });

  it('treats a throwing match as unmatched and reports it', () => {
    const onError = vi.fn();
    const boom = new Error('bad match');
    const rects = computeElementRects(
      storeWith(image('a', 0, 0)),
      () => {
        throw boom;
      },
      onError,
    );
    expect(rects).toEqual([]);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBe(boom);
  });

  it('treats a non-string, non-null match result as unmatched', () => {
    const rects = computeElementRects(storeWith(image('a', 0, 0)), () => 42 as unknown as string);
    expect(rects).toEqual([]);
  });
});

describe('elementRectsEqual', () => {
  const base = { id: 'a', key: 'k', x: 0, y: 0, w: 1, h: 1, rotation: 0 };

  it('is true for field-identical snapshots in different arrays', () => {
    expect(elementRectsEqual([{ ...base }], [{ ...base }])).toBe(true);
  });

  it('is false when only the key differs', () => {
    expect(elementRectsEqual([{ ...base }], [{ ...base, key: 'other' }])).toBe(false);
  });

  it('is false when only the position differs', () => {
    expect(elementRectsEqual([{ ...base }], [{ ...base, x: 2 }])).toBe(false);
  });

  it('is false for different lengths', () => {
    expect(elementRectsEqual([{ ...base }], [])).toBe(false);
  });
});

function manualFrames() {
  const queue = new Map<number, () => void>();
  let next = 1;
  return {
    scheduler: {
      requestFrame: (cb: () => void) => {
        const id = next++;
        queue.set(id, cb);
        return id;
      },
      cancelFrame: (id: number) => {
        queue.delete(id);
      },
    },
    flush() {
      const pending = [...queue.entries()];
      queue.clear();
      for (const [, cb] of pending) cb();
    },
    get pendingCount() {
      return queue.size;
    },
  };
}

describe('ElementRectTracker', () => {
  it('computes its snapshot synchronously in the constructor', () => {
    const frames = manualFrames();
    const store = storeWith(image('a', 5, 5));
    const tracker = new ElementRectTracker(
      { store },
      { match: () => 'k', frames: frames.scheduler },
    );
    // No frame has run: a deferred initial computation would return [] here.
    expect(frames.pendingCount).toBe(0);
    expect(tracker.getRects()).toEqual([
      { id: 'a', key: 'k', x: 5, y: 5, w: 40, h: 40, rotation: 0 },
    ]);
    tracker.dispose();
  });

  it('emits once per frame however many mutations landed', () => {
    const frames = manualFrames();
    const store = storeWith();
    const tracker = new ElementRectTracker(
      { store },
      { match: () => 'k', frames: frames.scheduler },
    );
    const listener = vi.fn();
    tracker.onChange(listener);

    store.add(image('a', 0, 0));
    store.add(image('b', 10, 10));
    store.add(image('c', 20, 20));
    expect(listener).not.toHaveBeenCalled();
    frames.flush();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toHaveLength(3);
    tracker.dispose();
  });

  it('uses the constructor snapshot as the change baseline, so a dirty frame that changes nothing is silent', () => {
    const frames = manualFrames();
    const store = storeWith(image('a', 0, 0));
    const tracker = new ElementRectTracker(
      { store },
      { match: (el) => (el.id === 'a' ? 'k' : null), frames: frames.scheduler },
    );
    const listener = vi.fn();
    tracker.onChange(listener);

    // Force a dirty frame that cannot change the matched rects: add an element
    // the matcher rejects. Merely flushing here would exercise nothing, because
    // construction schedules no frame.
    store.add(image('ignored', 99, 99));
    expect(frames.pendingCount).toBe(1);
    frames.flush();

    expect(listener).not.toHaveBeenCalled();
    tracker.dispose();
  });

  it('never subscribes to a camera it is handed, and a pan does no work', () => {
    const frames = manualFrames();
    const store = storeWith(image('a', 0, 0));
    // A camera-shaped collaborator on the host. The tracker must ignore it
    // entirely: asserting "nothing was scheduled" without one would pass
    // vacuously, because nothing in the test ever moves a camera.
    const cameraListeners: (() => void)[] = [];
    const camera = {
      onChange: vi.fn((listener: () => void) => {
        cameraListeners.push(listener);
        return () => {
          // Unreachable in this test: the tracker never subscribes.
        };
      }),
    };
    const match = vi.fn(() => 'k');
    const tracker = new ElementRectTracker(
      { store, camera } as unknown as { store: typeof store },
      { match, frames: frames.scheduler },
    );
    const listener = vi.fn();
    tracker.onChange(listener);

    // 1. It never even subscribed.
    expect(camera.onChange).not.toHaveBeenCalled();

    // 2. Firing every camera listener that DOES exist (none, unless the
    //    implementation regressed) schedules no frame and re-runs no matcher.
    const matchCallsBefore = match.mock.calls.length;
    for (const fire of cameraListeners) fire();
    expect(frames.pendingCount).toBe(0);
    frames.flush();
    expect(match.mock.calls.length).toBe(matchCallsBefore);
    expect(listener).not.toHaveBeenCalled();
    tracker.dispose();
  });

  it('emits when only the key changes, at identical geometry', () => {
    const frames = manualFrames();
    const store = storeWith(image('a', 0, 0));
    let key = 'first';
    const tracker = new ElementRectTracker(
      { store },
      { match: () => key, frames: frames.scheduler },
    );
    const listener = vi.fn();
    tracker.onChange(listener);

    key = 'second';
    tracker.setMatch(() => key);
    frames.flush();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0][0]?.key).toBe('second');
    tracker.dispose();
  });

  it('rescans on setMatch even when handed the identical function reference', () => {
    const frames = manualFrames();
    const store = storeWith(image('a', 0, 0));
    let key: string | null = 'first';
    const stable = () => key;
    const tracker = new ElementRectTracker({ store }, { match: stable, frames: frames.scheduler });
    const listener = vi.fn();
    tracker.onChange(listener);

    key = 'second';
    tracker.setMatch(stable);
    frames.flush();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0][0]?.key).toBe('second');
    tracker.dispose();
  });

  it('drops an element whose match starts returning null', () => {
    const frames = manualFrames();
    const store = storeWith(image('a', 0, 0));
    let key: string | null = 'k';
    const stable = () => key;
    const tracker = new ElementRectTracker({ store }, { match: stable, frames: frames.scheduler });
    const listener = vi.fn();
    tracker.onChange(listener);

    key = null;
    tracker.setMatch(stable);
    frames.flush();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toEqual([]);
    tracker.dispose();
  });

  it('reconciles a store clear, which emits no per-element remove events', () => {
    const frames = manualFrames();
    const store = storeWith(image('a', 0, 0), image('b', 10, 10));
    const tracker = new ElementRectTracker(
      { store },
      { match: () => 'k', frames: frames.scheduler },
    );
    const listener = vi.fn();
    tracker.onChange(listener);

    store.clear();
    frames.flush();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(tracker.getRects()).toEqual([]);
    tracker.dispose();
  });

  it('isolates a throwing listener from its siblings', () => {
    const frames = manualFrames();
    const store = storeWith();
    const tracker = new ElementRectTracker(
      { store },
      { match: () => 'k', frames: frames.scheduler },
    );
    const second = vi.fn();
    tracker.onChange(() => {
      throw new Error('listener boom');
    });
    tracker.onChange(second);

    store.add(image('a', 0, 0));
    expect(() => frames.flush()).not.toThrow();
    expect(second).toHaveBeenCalledTimes(1);
    tracker.dispose();
  });

  it('keeps the same array reference between emissions', () => {
    const frames = manualFrames();
    const store = storeWith(image('a', 0, 0));
    const tracker = new ElementRectTracker(
      { store },
      { match: () => 'k', frames: frames.scheduler },
    );
    const first = tracker.getRects();
    expect(tracker.getRects()).toBe(first);
    tracker.dispose();
  });

  it('dispose is idempotent, cancels the pending frame and detaches listeners', () => {
    const frames = manualFrames();
    const store = storeWith();
    const tracker = new ElementRectTracker(
      { store },
      { match: () => 'k', frames: frames.scheduler },
    );
    const listener = vi.fn();
    tracker.onChange(listener);

    store.add(image('a', 0, 0));
    expect(frames.pendingCount).toBe(1);
    tracker.dispose();
    expect(frames.pendingCount).toBe(0);

    expect(() => tracker.dispose()).not.toThrow();
    store.add(image('b', 0, 0));
    frames.flush();
    expect(listener).not.toHaveBeenCalled();
  });
});
