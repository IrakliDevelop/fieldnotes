import { describe, it, expect, afterEach, vi } from 'vitest';
import { createImage } from '@fieldnotes/core';
import type { CanvasElement } from '@fieldnotes/core';
import { useElementRects } from './use-element-rects.svelte.js';
import { mountHelper, record } from '../test-fixtures/mount-helper';
import { createTestViewport, destroyTestViewports } from '../test-fixtures/create-test-viewport';

afterEach(destroyTestViewports);

function image(id: string, x: number, layerId: string): CanvasElement {
  return {
    ...createImage({ position: { x, y: 0 }, size: { w: 40, h: 40 }, src: 'a.png', layerId }),
    id,
  };
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

describe('useElementRects', () => {
  it('returns rects for matched elements and updates on store mutation', async () => {
    const { result, viewport } = mountHelper(() => useElementRects((el) => el.id));
    const values = record(result);
    expect(values.at(-1)).toEqual([]);
    viewport.store.add(image('a', 10, viewport.layerManager.activeLayerId));
    await nextFrame();
    expect(values.at(-1)?.map((r) => r.id)).toEqual(['a']);
  });

  it('includes elements present at subscribe time', () => {
    const viewport = createTestViewport();
    viewport.store.add(image('a', 10, viewport.layerManager.activeLayerId));
    const { result } = mountHelper(() => useElementRects((el) => el.id), viewport);
    expect(
      record(result)
        .at(-1)
        ?.map((r) => r.id),
    ).toEqual(['a']);
  });

  it('disposes its tracker when the last subscriber unsubscribes', async () => {
    const match = vi.fn((el: CanvasElement) => el.id);
    const { result, viewport } = mountHelper(() => useElementRects(match));
    const unsubscribe = result.subscribe(() => undefined);
    unsubscribe();
    const callsAfterUnsubscribe = match.mock.calls.length;
    viewport.store.add(image('a', 10, viewport.layerManager.activeLayerId));
    await nextFrame();
    expect(match.mock.calls.length).toBe(callsAfterUnsubscribe);
  });
});
