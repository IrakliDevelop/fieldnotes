import { afterEach, describe, expect, it, vi } from 'vitest';
import { NgZone, signal } from '@angular/core';
import { ElementRectTracker, createImage } from '@fieldnotes/core';
import type { CanvasElement, ElementRectMatch } from '@fieldnotes/core';
import { createTestViewport, destroyTestViewports } from '../test-utils/create-test-viewport';
import { mountHelper } from '../test-utils/mount-helper';
import { injectElementRects } from './inject-element-rects';

afterEach(() => {
  destroyTestViewports();
  vi.restoreAllMocks();
});

function image(id: string, x: number, layerId: string): CanvasElement {
  return {
    ...createImage({ position: { x, y: 0 }, size: { w: 40, h: 40 }, src: 'a.png', layerId }),
    id,
  };
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

const wanted =
  (id: string): ElementRectMatch =>
  (el) =>
    el.id === id ? el.id : null;

describe('injectElementRects', () => {
  it('holds [] before a viewport exists', async () => {
    const { result } = await mountHelper(() => injectElementRects((el) => el.id), null);
    expect(result()).toEqual([]);
  });

  it('returns rects for matched elements and updates on store mutation', async () => {
    const viewport = createTestViewport();
    const { result } = await mountHelper(() => injectElementRects((el) => el.id), viewport);
    expect(result()).toEqual([]);
    viewport.store.add(image('a', 10, viewport.layerManager.activeLayerId));
    await nextFrame();
    expect(result().map((r) => r.id)).toEqual(['a']);
  });

  it('includes elements present at setup', async () => {
    const viewport = createTestViewport();
    viewport.store.add(image('a', 10, viewport.layerManager.activeLayerId));
    const { result } = await mountHelper(() => injectElementRects((el) => el.id), viewport);
    expect(result().map((r) => r.id)).toEqual(['a']);
  });

  it('calls a plain function match only with elements, never as a signal', async () => {
    const viewport = createTestViewport();
    viewport.store.add(image('a', 10, viewport.layerManager.activeLayerId));
    const match = vi.fn((el: CanvasElement) => el.id);
    const { result } = await mountHelper(() => injectElementRects(match), viewport);
    expect(result().map((r) => r.id)).toEqual(['a']);
    expect(match.mock.calls.every((args) => args.length === 1 && args[0]?.id === 'a')).toBe(true);
  });

  it('follows a match signal with no store mutation, without recreating the tracker', async () => {
    const viewport = createTestViewport();
    viewport.store.add(image('a', 10, viewport.layerManager.activeLayerId));
    viewport.store.add(image('b', 90, viewport.layerManager.activeLayerId));
    const setMatch = vi.spyOn(ElementRectTracker.prototype, 'setMatch');
    const dispose = vi.spyOn(ElementRectTracker.prototype, 'dispose');
    const match = signal(wanted('a'));
    const { result, fixture } = await mountHelper(() => injectElementRects(match), viewport);
    expect(result().map((r) => r.id)).toEqual(['a']);
    expect(setMatch).not.toHaveBeenCalled();

    const next = wanted('b');
    match.set(next);
    await fixture.whenStable();
    await nextFrame();
    expect(result().map((r) => r.id)).toEqual(['b']);
    expect(setMatch.mock.calls).toEqual([[next]]);
    expect(dispose).not.toHaveBeenCalled();
  });

  it('disposes its tracker on destroy, cancelling a pending frame, so later mutations do no work', async () => {
    const viewport = createTestViewport();
    const match = vi.fn((el: CanvasElement) => el.id);
    const { fixture } = await mountHelper(() => injectElementRects(match), viewport);
    viewport.store.add(image('a', 10, viewport.layerManager.activeLayerId));
    fixture.destroy();
    const callsAfterDestroy = match.mock.calls.length;
    viewport.store.add(image('b', 90, viewport.layerManager.activeLayerId));
    await nextFrame();
    expect(match.mock.calls.length).toBe(callsAfterDestroy);
  });

  it('rebuilds on a viewport change and goes back to [] on null, dropping the old tracker', async () => {
    const first = createTestViewport();
    first.store.add(image('a', 10, first.layerManager.activeLayerId));
    const match = vi.fn((el: CanvasElement) => el.id);
    const { result, provided, fixture } = await mountHelper(() => injectElementRects(match), first);
    const second = createTestViewport();
    second.store.add(image('b', 90, second.layerManager.activeLayerId));
    provided.set(second);
    await fixture.whenStable();
    expect(result().map((r) => r.id)).toEqual(['b']);

    provided.set(null);
    await fixture.whenStable();
    expect(result()).toEqual([]);
    const calls = match.mock.calls.length;
    first.store.add(image('c', 0, first.layerManager.activeLayerId));
    second.store.add(image('d', 0, second.layerManager.activeLayerId));
    await nextFrame();
    expect(match.mock.calls.length).toBe(calls);
  });

  it.runIf('Zone' in globalThis)('constructs the tracker outside the Angular zone', async () => {
    const viewport = createTestViewport();
    viewport.store.add(image('a', 10, viewport.layerManager.activeLayerId));
    const inZone: boolean[] = [];
    await mountHelper(
      () =>
        injectElementRects((el) => {
          inZone.push(NgZone.isInAngularZone());
          return el.id;
        }),
      viewport,
    );
    expect(inZone).toEqual([false]);
  });
});
