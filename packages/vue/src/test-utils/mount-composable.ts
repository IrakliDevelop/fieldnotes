import { defineComponent, h, provide } from 'vue';
import { mount } from '@vue/test-utils';
import type { Viewport } from '@fieldnotes/core';
import { ViewportKey } from '../context';
import { createTestViewport } from './create-test-viewport';

/** Runs `composable` in the setup of a component under a provided Viewport. */
export function mountComposable<T>(composable: () => T, viewport: Viewport = createTestViewport()) {
  const out: { result?: T } = {};
  const Consumer = defineComponent({
    setup() {
      out.result = composable();
      return () => null;
    },
  });
  const wrapper = mount(
    defineComponent({
      setup() {
        provide(ViewportKey, viewport);
        return () => h(Consumer);
      },
    }),
  );
  const { result } = out;
  if (result === undefined) throw new Error('composable did not run');
  return { result, viewport, wrapper };
}
