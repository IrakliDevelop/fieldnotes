import { afterEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createShape } from '@fieldnotes/core';
import type { ReactNode } from 'react';
import { ViewportContext } from '../context';
import { createTestViewport, destroyTestViewports } from '../test-utils/create-test-viewport';
import { useLoad } from './use-load';

describe('useLoad', () => {
  afterEach(destroyTestViewports);

  it('loads a state object and a JSON string', () => {
    const viewport = createTestViewport();
    const layerId = viewport.layerManager.activeLayerId;
    viewport.store.add(createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 }, layerId }));
    const oneElement = viewport.exportState();
    viewport.store.add(createShape({ position: { x: 20, y: 0 }, size: { w: 10, h: 10 }, layerId }));
    const twoElements = viewport.exportState();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ViewportContext.Provider value={viewport}>{children}</ViewportContext.Provider>
    );
    const { result } = renderHook(useLoad, { wrapper });

    result.current(oneElement);
    expect(viewport.store.count).toBe(1);
    result.current(JSON.stringify(twoElements));
    expect(viewport.store.count).toBe(2);
  });
});
