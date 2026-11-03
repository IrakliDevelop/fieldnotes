import { afterEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createShape } from '@fieldnotes/core';
import type { ReactNode } from 'react';
import { ViewportContext } from '../context';
import { createTestViewport, destroyTestViewports } from '../test-utils/create-test-viewport';
import { useTransaction } from './use-transaction';

describe('useTransaction', () => {
  afterEach(destroyTestViewports);

  it('groups two store writes into one undo step', () => {
    const viewport = createTestViewport();
    const layerId = viewport.layerManager.activeLayerId;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ViewportContext.Provider value={viewport}>{children}</ViewportContext.Provider>
    );
    const { result } = renderHook(useTransaction, { wrapper });

    result.current(() => {
      viewport.store.add(
        createShape({ position: { x: 0, y: 0 }, size: { w: 10, h: 10 }, layerId }),
      );
      viewport.store.add(
        createShape({ position: { x: 20, y: 0 }, size: { w: 10, h: 10 }, layerId }),
      );
    });
    viewport.undo();

    expect(viewport.store.count).toBe(0);
  });
});
