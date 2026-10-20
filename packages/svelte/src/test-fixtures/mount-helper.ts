import { render } from '@testing-library/svelte';
import type { Readable } from 'svelte/store';
import type { Viewport } from '@fieldnotes/core';
import HelperHost from './HelperHost.svelte';
import { createTestViewport } from './create-test-viewport';

/** Runs `helper` during the init of a component under a provided Viewport. */
export function mountHelper<T>(helper: () => T, viewport: Viewport = createTestViewport()) {
  const out: { result?: T } = {};
  const { unmount } = render(HelperHost, {
    props: {
      viewport,
      run: () => {
        out.result = helper();
      },
    },
  });
  const { result } = out;
  if (result === undefined) throw new Error('helper did not run');
  return { result, viewport, unmount };
}

/** Subscribes to `store` for the rest of the test; returns every emitted value in order. */
export function record<T>(store: Readable<T>): T[] {
  const values: T[] = [];
  store.subscribe((value) => values.push(value));
  return values;
}
