import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { ViewportContext } from '../context';
import { createTestViewport, destroyTestViewports } from '../test-utils/create-test-viewport';
import { useCanvasSize } from './use-canvas-size';

let callback: ResizeObserverCallback | undefined;
let observer: ResizeObserver | undefined;
class TestResizeObserver implements ResizeObserver {
  static instance: ResizeObserver | undefined;

  constructor(next: ResizeObserverCallback) {
    callback = next;
    TestResizeObserver.instance = this;
    observer = TestResizeObserver.instance;
  }
  observe(_target: Element, _options?: ResizeObserverOptions): void {
    return undefined;
  }
  unobserve(_target: Element): void {
    return undefined;
  }
  disconnect(): void {
    return undefined;
  }
}

describe('useCanvasSize', () => {
  afterEach(() => {
    destroyTestViewports();
    vi.unstubAllGlobals();
    callback = undefined;
    observer = undefined;
  });

  it('reads CSS size and updates on resize', () => {
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    const viewport = createTestViewport();
    const canvas = viewport.domLayer.parentElement?.querySelector('canvas');
    if (!canvas) throw new Error('Viewport canvas missing');
    Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: 320 });
    Object.defineProperty(canvas, 'clientHeight', { configurable: true, value: 240 });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ViewportContext.Provider value={viewport}>{children}</ViewportContext.Provider>
    );
    const { result } = renderHook(useCanvasSize, { wrapper });
    expect(result.current).toEqual({ w: 320, h: 240 });
    Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: 640 });
    const resizeCallback = callback;
    const resizeObserver = observer;
    if (!resizeCallback || !resizeObserver) throw new Error('ResizeObserver missing');
    act(() => resizeCallback([], resizeObserver));
    expect(result.current).toEqual({ w: 640, h: 240 });
  });

  it('returns zero size on the server when the client viewport is nonzero', () => {
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    const viewport = createTestViewport();
    const canvas = viewport.domLayer.parentElement?.querySelector('canvas');
    if (!canvas) throw new Error('Viewport canvas missing');
    Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: 320 });
    Object.defineProperty(canvas, 'clientHeight', { configurable: true, value: 240 });

    function CanvasSize() {
      const { w, h } = useCanvasSize();
      return `${w}×${h}`;
    }

    expect(
      renderToString(
        <ViewportContext.Provider value={viewport}>
          <CanvasSize />
        </ViewportContext.Provider>,
      ),
    ).toBe('0×0');
  });
});
