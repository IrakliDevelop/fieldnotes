import { describe, it, expect, afterEach } from 'vitest';
import { render } from '@testing-library/svelte';
import { useCamera } from './use-camera.svelte.js';
import { mountHelper, record } from '../test-fixtures/mount-helper';
import { destroyTestViewports } from '../test-fixtures/create-test-viewport';
import { countOpenListeners } from '../test-fixtures/count-listeners';
import RunHelper from '../test-fixtures/RunHelper.svelte';

afterEach(destroyTestViewports);

describe('useCamera', () => {
  it('returns the initial camera state', () => {
    const { result } = mountHelper(() => useCamera());
    expect(record(result)).toEqual([{ x: 0, y: 0, zoom: 1 }]);
  });

  it('updates when the camera pans and zooms', () => {
    const { result, viewport } = mountHelper(() => useCamera());
    const values = record(result);
    viewport.camera.pan(100, 50);
    expect(values.at(-1)).toEqual({ x: 100, y: 50, zoom: 1 });
    viewport.camera.setZoom(2);
    expect(values.at(-1)?.zoom).toBe(2);
  });

  it('does not notify when a change leaves the snapshot reference unchanged', () => {
    const { result, viewport } = mountHelper(() => useCamera());
    const values = record(result);
    viewport.camera.pan(0, 0);
    expect(values).toHaveLength(1);
  });

  it('releases its viewport listener when the last subscriber unsubscribes', () => {
    const { result } = mountHelper(() => useCamera());
    const open = countOpenListeners();
    const offA = result.subscribe(() => undefined);
    const offB = result.subscribe(() => undefined);
    expect(open()).toBe(1);
    offA();
    expect(open()).toBe(1);
    offB();
    expect(open()).toBe(0);
  });

  it('reads the current camera when subscribed after a change', () => {
    const { result, viewport } = mountHelper(() => useCamera());
    viewport.camera.pan(7, 8);
    expect(record(result)).toEqual([{ x: 7, y: 8, zoom: 1 }]);
  });

  it('throws outside a canvas', () => {
    expect(() => render(RunHelper, { props: { run: () => useCamera() } })).toThrow(
      'useViewport must be used inside <FieldNotesCanvas>',
    );
  });
});
