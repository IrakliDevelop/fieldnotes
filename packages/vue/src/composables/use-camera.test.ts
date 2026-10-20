import { describe, it, expect, afterEach } from 'vitest';
import { enableAutoUnmount } from '@vue/test-utils';
import { useCamera } from './use-camera';
import { mountComposable } from '../test-utils/mount-composable';
import { destroyTestViewports } from '../test-utils/create-test-viewport';

enableAutoUnmount(afterEach);
afterEach(destroyTestViewports);

describe('useCamera', () => {
  it('returns the initial camera state', () => {
    const { result } = mountComposable(() => useCamera());
    expect(result.value).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it('updates when the camera pans and zooms', () => {
    const { result, viewport } = mountComposable(() => useCamera());
    viewport.camera.pan(100, 50);
    expect(result.value).toEqual({ x: 100, y: 50, zoom: 1 });
    viewport.camera.setZoom(2);
    expect(result.value.zoom).toBe(2);
  });

  it('keeps the same reference when a change leaves the camera equal', () => {
    const { result, viewport } = mountComposable(() => useCamera());
    const before = result.value;
    viewport.camera.pan(0, 0);
    expect(result.value).toBe(before);
  });

  it('stops updating once its scope is disposed', () => {
    const { result, viewport, wrapper } = mountComposable(() => useCamera());
    wrapper.unmount();
    viewport.camera.pan(100, 50);
    expect(result.value).toEqual({ x: 0, y: 0, zoom: 1 });
  });
});
