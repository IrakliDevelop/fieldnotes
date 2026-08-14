import { describe, expect, it, vi } from 'vitest';
import { act, render, renderHook } from '@testing-library/react';
import { useElementRects } from './use-element-rects';
import { ViewportContext } from '../context';
import { createTestViewport } from '../test-utils/create-test-viewport';
import { createImage } from '@fieldnotes/core';
import type { CanvasElement } from '@fieldnotes/core';
import type { ReactNode } from 'react';

function image(id: string, x: number, layerId: string): CanvasElement {
  return {
    ...createImage({ position: { x, y: 0 }, size: { w: 40, h: 40 }, src: 'a.png', layerId }),
    id,
  };
}

describe('useElementRects', () => {
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
    // `reactStrictMode: true` — NOT a `wrapper: <StrictMode>` indirection, which
    // does not double-invoke effects under React 19 + RTL and would leave this
    // test inert.
    const { result } = renderHook(() => useElementRects((el) => el.id), {
      wrapper,
      reactStrictMode: true,
    });

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

    await act(async () => {
      rerender({ wanted: 'b' });
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
});
