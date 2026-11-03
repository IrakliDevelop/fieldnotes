import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ViewportContext } from '../context';
import { createTestViewport, destroyTestViewports } from '../test-utils/create-test-viewport';
import { useShortcuts } from './use-shortcuts';

function withViewport(viewport: ReturnType<typeof createTestViewport>) {
  return function ViewportProvider({ children }: { children: ReactNode }) {
    return <ViewportContext.Provider value={viewport}>{children}</ViewportContext.Provider>;
  };
}

describe('useShortcuts', () => {
  afterEach(destroyTestViewports);

  it('updates bindings on rebind, reset, and disable', () => {
    const viewport = createTestViewport();
    const defaultBindings = viewport.shortcuts.getBindings()['edit.undo'];
    if (!defaultBindings) throw new Error('Undo defaults missing');
    const { result } = renderHook(useShortcuts, { wrapper: withViewport(viewport) });

    expect(result.current.bindings['edit.undo']).toEqual(defaultBindings);
    act(() => result.current.rebind('edit.undo', 'mod+u'));
    expect(result.current.bindings['edit.undo']).toEqual(['mod+u']);
    act(() => result.current.reset('edit.undo'));
    expect(result.current.bindings['edit.undo']).toEqual(defaultBindings);
    act(() => result.current.disable('edit.undo'));
    expect(result.current.bindings['edit.undo']).toEqual([]);
  });

  it('keeps its result object while bindings are unchanged', () => {
    const viewport = createTestViewport();
    const { result, rerender } = renderHook(useShortcuts, { wrapper: withViewport(viewport) });
    const before = result.current;

    rerender();

    expect(result.current).toBe(before);
  });
});
