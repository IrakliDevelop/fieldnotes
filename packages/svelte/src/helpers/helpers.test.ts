import { describe, it, expect, expectTypeOf, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import type { Viewport } from '@fieldnotes/core';
import { useHistory, useLayers, useSelectionOps } from '../index.js';
import type { UseHistoryResult, UseLayersResult, UseSelectionOpsResult } from '../index.js';
import CanvasAllHelpers from '../test-fixtures/CanvasAllHelpers.svelte';
import { countOpenListeners } from '../test-fixtures/count-listeners';

afterEach(() => {
  vi.restoreAllMocks();
});

function mountCanvas(helpers: boolean) {
  let viewport: Viewport | undefined;
  const rendered = render(CanvasAllHelpers, {
    props: {
      helpers,
      onready: (vp: Viewport) => {
        viewport = vp;
      },
    },
  });
  if (!viewport) throw new Error('canvas not ready');
  return { ...rendered, viewport };
}

describe('helpers under FieldNotesCanvas', () => {
  it('render live $store values', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
    const { viewport } = mountCanvas(true);
    expect(screen.getByTestId('camera').textContent).toBe('0,0,1');
    expect(screen.getByTestId('tool').textContent).toBe('select');
    viewport.camera.pan(10, 20);
    flushSync();
    expect(screen.getByTestId('camera').textContent).toBe('10,20,1');
  });

  it('release every viewport listener when the whole canvas unmounts', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
    const open = countOpenListeners();

    const baseline = mountCanvas(false);
    const baselineMounted = open();
    baseline.unmount();
    const baselineAfter = open();

    const withHelpers = mountCanvas(true);
    // camera 1, elements 1+1, selection 1, tool 1, pencil options 1, style 2, details 2,
    // history 1, layers 1, ops 2, rects 1.
    expect(open() - baselineAfter - baselineMounted).toBe(15);
    expect(() => withHelpers.unmount()).not.toThrow();
    expect(open()).toBe(baselineAfter * 2);
  });
});

describe('exported helper result types', () => {
  it('name the return types of useHistory, useLayers and useSelectionOps', () => {
    expectTypeOf(useHistory).returns.toEqualTypeOf<UseHistoryResult>();
    expectTypeOf(useLayers).returns.toEqualTypeOf<UseLayersResult>();
    expectTypeOf(useSelectionOps).returns.toEqualTypeOf<UseSelectionOpsResult>();
  });
});
