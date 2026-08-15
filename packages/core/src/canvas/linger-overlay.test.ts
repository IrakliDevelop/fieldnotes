import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LingerOverlay } from './linger-overlay';
import { makeHost } from './__test-utils__/overlay-host';

interface Entry {
  readonly label: string;
}

function setNow(overlay: LingerOverlay<Entry>, value: number): void {
  vi.spyOn(overlay as unknown as { now: () => number }, 'now').mockReturnValue(value);
}

describe('LingerOverlay', () => {
  let rafCallbacks: FrameRequestCallback[];
  beforeEach(() => {
    vi.useFakeTimers();
    rafCallbacks = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      rafCallbacks[id - 1] = () => undefined;
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('set registers an entry the renderer draws at full alpha', () => {
    const { host, getRenderer, requestRender } = makeHost();
    const drawn: { entry: Entry; alpha: number }[] = [];
    const overlay = new LingerOverlay<Entry>(host, {}, (_ctx, entry, alpha) => {
      drawn.push({ entry, alpha });
    });

    overlay.set('a', { label: 'first' });
    expect(overlay.activeSenderCount).toBe(1);
    expect(requestRender).toHaveBeenCalled();

    getRenderer()?.({} as unknown as CanvasRenderingContext2D);
    expect(drawn).toEqual([{ entry: { label: 'first' }, alpha: 1 }]);

    // A second set replaces the entry rather than adding a sender.
    overlay.set('a', { label: 'second' });
    drawn.length = 0;
    getRenderer()?.({} as unknown as CanvasRenderingContext2D);
    expect(overlay.activeSenderCount).toBe(1);
    expect(drawn).toEqual([{ entry: { label: 'second' }, alpha: 1 }]);
  });

  it('linger holds, fades, then deletes the entry and stops animating', () => {
    const { host, getRenderer } = makeHost();
    const alphas: number[] = [];
    const overlay = new LingerOverlay<Entry>(
      host,
      { holdMs: 1000, fadeMs: 200 },
      (_c, _e, alpha) => {
        alphas.push(alpha);
      },
    );

    setNow(overlay, 500);
    overlay.set('a', { label: 'x' });
    overlay.linger('a');
    expect(overlay.activeSenderCount).toBe(1);

    setNow(overlay, 500 + 1000 + 100); // halfway through the fade
    rafCallbacks.splice(0).forEach((cb) => cb(0));
    expect(overlay.activeSenderCount).toBe(1);
    getRenderer()?.({} as unknown as CanvasRenderingContext2D);
    expect(alphas).toEqual([0.5]);

    setNow(overlay, 500 + 1000 + 200); // hold + fade elapsed
    rafCallbacks.splice(0).forEach((cb) => cb(0));
    expect(overlay.activeSenderCount).toBe(0);
    expect(rafCallbacks).toHaveLength(0); // render loop stopped

    alphas.length = 0;
    getRenderer()?.({} as unknown as CanvasRenderingContext2D);
    expect(alphas).toEqual([]);
  });

  it('set arms a fresh maxAge timer that lingers the stale entry', () => {
    const { host, requestRender } = makeHost();
    const overlay = new LingerOverlay<Entry>(host, { maxAgeMs: 5000 }, () => undefined);

    setNow(overlay, 0);
    overlay.set('a', { label: 'x' });
    vi.advanceTimersByTime(4000);
    overlay.set('a', { label: 'y' }); // resets the expiry timer
    requestRender.mockClear();
    vi.advanceTimersByTime(4000); // 8s total, only 4s since the update
    expect(rafCallbacks).toHaveLength(0); // not lingering yet

    vi.advanceTimersByTime(1000);
    expect(requestRender).toHaveBeenCalled(); // linger started by the timer
    setNow(overlay, 9000 + 1500 + 400);
    rafCallbacks.splice(0).forEach((cb) => cb(0));
    expect(overlay.activeSenderCount).toBe(0);
  });

  it('remove, clear, and dispose are idempotent and dispose renders once', () => {
    const { host, getRenderer, unregister, requestRender } = makeHost();
    const overlay = new LingerOverlay<Entry>(host, {}, () => undefined);

    overlay.set('a', { label: 'x' });
    overlay.set('b', { label: 'y' });
    overlay.remove('a');
    expect(overlay.activeSenderCount).toBe(1);
    requestRender.mockClear();
    overlay.remove('a'); // unknown sender: no render, no throw
    expect(requestRender).not.toHaveBeenCalled();

    overlay.clear();
    expect(overlay.activeSenderCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0); // expiry timers cancelled
    requestRender.mockClear();
    overlay.clear(); // already empty
    expect(requestRender).not.toHaveBeenCalled();

    overlay.set('c', { label: 'z' });
    requestRender.mockClear();
    overlay.dispose();
    expect(overlay.disposed).toBe(true);
    expect(requestRender).toHaveBeenCalledTimes(1); // final erase render
    expect(unregister).toHaveBeenCalledTimes(1);
    expect(overlay.activeSenderCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(getRenderer()).toBeNull();

    overlay.dispose();
    expect(requestRender).toHaveBeenCalledTimes(1); // not called again
    expect(unregister).toHaveBeenCalledTimes(1);

    overlay.set('d', { label: 'w' }); // disposed overlay accepts nothing
    expect(overlay.activeSenderCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
