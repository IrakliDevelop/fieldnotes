import { describe, it, expect, afterEach, vi } from 'vitest';
import { enableAutoUnmount } from '@vue/test-utils';
import { nextTick, ref } from 'vue';
import { createImage } from '@fieldnotes/core';
import type { CanvasElement, ElementRectMatch } from '@fieldnotes/core';
import { useElementRects } from './use-element-rects';
import { mountComposable } from '../test-utils/mount-composable';
import { createTestViewport, destroyTestViewports } from '../test-utils/create-test-viewport';

enableAutoUnmount(afterEach);
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
    const { result, viewport } = mountComposable(() => useElementRects((el) => el.id));
    expect(result.value).toEqual([]);
    viewport.store.add(image('a', 10, viewport.layerManager.activeLayerId));
    await nextFrame();
    expect(result.value.map((r) => r.id)).toEqual(['a']);
  });

  it('includes elements present at setup', () => {
    const viewport = createTestViewport();
    viewport.store.add(image('a', 10, viewport.layerManager.activeLayerId));
    const { result } = mountComposable(() => useElementRects((el) => el.id), viewport);
    expect(result.value.map((r) => r.id)).toEqual(['a']);
  });

  it('follows a match ref with no store mutation', async () => {
    const viewport = createTestViewport();
    viewport.store.add(image('a', 10, viewport.layerManager.activeLayerId));
    viewport.store.add(image('b', 90, viewport.layerManager.activeLayerId));
    const wanted =
      (id: string): ElementRectMatch =>
      (el) =>
        el.id === id ? el.id : null;
    const match = ref(wanted('a'));
    const { result } = mountComposable(() => useElementRects(match), viewport);
    expect(result.value.map((r) => r.id)).toEqual(['a']);

    match.value = wanted('b');
    await nextTick();
    await nextFrame();
    expect(result.value.map((r) => r.id)).toEqual(['b']);
  });

  it('disposes its tracker with the scope, so later mutations do no work', async () => {
    const match = vi.fn((el: CanvasElement) => el.id);
    const { viewport, wrapper } = mountComposable(() => useElementRects(match));
    wrapper.unmount();
    const callsAfterUnmount = match.mock.calls.length;
    viewport.store.add(image('a', 10, viewport.layerManager.activeLayerId));
    await nextFrame();
    expect(match.mock.calls.length).toBe(callsAfterUnmount);
  });
});
