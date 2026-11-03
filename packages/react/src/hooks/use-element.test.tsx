import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { createShape } from '@fieldnotes/core';
import type { ReactNode } from 'react';
import { ViewportContext } from '../context';
import { createTestViewport, destroyTestViewports } from '../test-utils/create-test-viewport';
import { useElement } from './use-element';

describe('useElement', () => {
  afterEach(destroyTestViewports);

  it('follows its id and ignores unrelated changes', () => {
    const viewport = createTestViewport();
    const layerId = viewport.layerManager.activeLayerId;
    const a = {
      ...createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 }, layerId }),
      id: 'a',
    };
    const b = {
      ...createShape({ position: { x: 20, y: 0 }, size: { w: 10, h: 10 }, layerId }),
      id: 'b',
    };
    viewport.store.add(a);
    viewport.store.add(b);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ViewportContext.Provider value={viewport}>{children}</ViewportContext.Provider>
    );
    let renders = 0;
    const initialProps: { id: string | null } = { id: 'a' };
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => {
        renders++;
        return useElement(id);
      },
      { wrapper, initialProps },
    );
    expect(result.current?.id).toBe('a');
    const initial = renders;
    act(() => viewport.store.update('b', { position: { x: 30, y: 0 } }));
    expect(renders).toBe(initial);
    act(() => viewport.store.update('a', { position: { x: 10, y: 0 } }));
    expect(renders).toBe(initial + 1);
    expect(result.current?.position.x).toBe(10);
    rerender({ id: 'b' });
    expect(result.current?.id).toBe('b');
    rerender({ id: null });
    expect(result.current).toBeNull();
  });
});
