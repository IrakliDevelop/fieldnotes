import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook } from '@testing-library/react';
import { useElementRects } from './use-element-rects';
import { ViewportContext } from '../context';
import { createTestViewport, destroyTestViewports } from '../test-utils/create-test-viewport';
import { createImage, ElementRectTracker } from '@fieldnotes/core';
import type { CanvasElement } from '@fieldnotes/core';
import type { ReactNode } from 'react';

function image(id: string, x: number, layerId: string): CanvasElement {
  return {
    ...createImage({ position: { x, y: 0 }, size: { w: 40, h: 40 }, src: 'a.png', layerId }),
    id,
  };
}

describe('useElementRects', () => {
  afterEach(() => {
    destroyTestViewports();
    vi.restoreAllMocks();
  });

  it('returns rects for matched elements and updates on store mutation', async () => {
    const vp = createTestViewport();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ViewportContext.Provider value={vp}>{children}</ViewportContext.Provider>
    );
    const { result } = renderHook(() => useElementRects((el) => el.id), { wrapper });
    expect(result.current).toEqual([]);

    await act(async () => {
      vp.store.add(image('a', 10, vp.layerManager.activeLayerId));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });

    expect(result.current.map((r) => r.id)).toEqual(['a']);
  });

  it('sees a mutation that lands between render and subscription', () => {
    const vp = createTestViewport();
    let renderCount = 0;
    function Probe() {
      renderCount++;
      const rects = useElementRects((el) => el.id);
      // Mutate during render, before effects (and therefore before subscribe).
      if (renderCount === 1) {
        vp.store.add(image('late', 10, vp.layerManager.activeLayerId));
      }
      return <span data-testid="ids">{rects.map((r) => r.id).join(',')}</span>;
    }
    const { getByTestId } = render(
      <ViewportContext.Provider value={vp}>
        <Probe />
      </ViewportContext.Provider>,
    );
    expect(getByTestId('ids').textContent).toBe('late');
  });

  it('does not render twice when the handoff finds nothing changed', () => {
    const vp = createTestViewport();
    vp.store.add(image('a', 10, vp.layerManager.activeLayerId));
    let renderCount = 0;
    function Probe() {
      renderCount++;
      useElementRects((el) => el.id);
      return null;
    }
    render(
      <ViewportContext.Provider value={vp}>
        <Probe />
      </ViewportContext.Provider>,
    );
    expect(renderCount).toBe(1);
  });

  it('survives Strict Mode setup -> cleanup -> setup and still updates', async () => {
    const vp = createTestViewport();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ViewportContext.Provider value={vp}>{children}</ViewportContext.Provider>
    );
    // Spy on `getRects`, called exactly once per `subscribe` invocation
    // (use-element-rects.ts:34), to prove the rehearsal actually ran two full
    // setup cycles — without this, a Strict Mode config that silently
    // degrades to a single mount (or a `<StrictMode>` wrapper indirection
    // that doesn't double-invoke effects under this React 19 + RTL setup)
    // would let this test pass for the wrong reason: a single-mount copy of
    // "returns rects ... updates on store mutation" that happens to also
    // assert Strict Mode without exercising it. Spying before `renderHook` is
    // required: the count must include the very first setup cycle.
    const getRectsSpy = vi.spyOn(ElementRectTracker.prototype, 'getRects');

    // `reactStrictMode: true` — NOT a `wrapper: <StrictMode>` indirection, which
    // does not double-invoke effects under React 19 + RTL and would leave this
    // test inert.
    const { result } = renderHook(() => useElementRects((el) => el.id), {
      wrapper,
      reactStrictMode: true,
    });

    // Two setup cycles (setup -> cleanup -> setup), each subscribing its own
    // tracker and calling `getRects` once, must have already happened by the
    // time `renderHook` returns, before any store mutation.
    expect(getRectsSpy.mock.calls.length).toBeGreaterThanOrEqual(2);

    await act(async () => {
      vp.store.add(image('a', 10, vp.layerManager.activeLayerId));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });

    expect(result.current.map((r) => r.id)).toEqual(['a']);
  });

  it('updates when the predicate semantics change with no store mutation', async () => {
    const vp = createTestViewport();
    vp.store.add(image('a', 10, vp.layerManager.activeLayerId));
    vp.store.add(image('b', 90, vp.layerManager.activeLayerId));
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ViewportContext.Provider value={vp}>{children}</ViewportContext.Provider>
    );
    const { result, rerender } = renderHook(
      ({ wanted }: { wanted: string }) =>
        useElementRects((el) => (el.id === wanted ? el.id : null)),
      { wrapper, initialProps: { wanted: 'a' } },
    );
    expect(result.current.map((r) => r.id)).toEqual(['a']);

    // Two hops, not one: `act #1` flushes the props change through render and
    // effects — which is what schedules the tracker's rescan frame via
    // `setMatch` — and only `act #2` awaits that already-scheduled frame. A
    // single `act(async () => { rerender(...); await rAF })` call defers
    // rerender's render+effects to the very end of that call (React 19's
    // `act()` batches nested synchronous work across awaits within one async
    // callback), so a frame scheduled by those effects has no chance to fire
    // before the call returns — the two-hop split is what makes this
    // observable in this environment, not a hook change.
    await act(async () => {
      rerender({ wanted: 'b' });
    });
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });

    expect(result.current.map((r) => r.id)).toEqual(['b']);
  });

  it('disposes its tracker on unmount, so later mutations do no work', async () => {
    const vp = createTestViewport();
    const match = vi.fn((el: CanvasElement) => el.id);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ViewportContext.Provider value={vp}>{children}</ViewportContext.Provider>
    );
    const { unmount } = renderHook(() => useElementRects(match), { wrapper });

    unmount();
    const callsAfterUnmount = match.mock.calls.length;

    await act(async () => {
      vp.store.add(image('a', 10, vp.layerManager.activeLayerId));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });

    // A leaked tracker would still be subscribed and would re-run the matcher
    // over the store on the next frame. Counting matcher invocations is the
    // discriminator; "did not throw" would stay green with the leak intact.
    expect(match.mock.calls.length).toBe(callsAfterUnmount);
  });

  it('does not re-subscribe when the caller passes a new inline predicate every render', () => {
    const vp = createTestViewport();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ViewportContext.Provider value={vp}>{children}</ViewportContext.Provider>
    );
    // `getRects` is called exactly once per `subscribe` invocation
    // (use-element-rects.ts:34), so counting its calls detects a re-subscribe
    // directly.
    const getRectsSpy = vi.spyOn(ElementRectTracker.prototype, 'getRects');

    const { rerender } = renderHook(() => useElementRects((el) => el.type === 'arrow'), {
      wrapper,
    });
    // Mount work (the initial subscribe) is already flushed by the time
    // `renderHook` returns.
    const callsAfterMount = getRectsSpy.mock.calls.length;

    // Re-invokes the render callback above, which constructs a brand-new
    // inline arrow — a fresh closure, never `===` the previous one.
    rerender();

    // `useSyncExternalStore` only re-subscribes (and so only re-calls
    // `getRects`) when `subscribe`'s identity changes. The hook's internal
    // `stableMatch` wrapper is memoized with an empty dep array and must
    // never change identity regardless of what the caller's inline `match`
    // closes over, so a new inline predicate every render must not
    // re-subscribe.
    expect(getRectsSpy.mock.calls.length).toBe(callsAfterMount);
  });
});
