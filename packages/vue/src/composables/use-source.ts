import { onScopeDispose, shallowRef, watch } from 'vue';
import type { ShallowRef, WatchSource } from 'vue';
import type { ViewportSource } from '@fieldnotes/core';

/** A shallow ref mirroring `source`; resubscribes and re-reads whenever `input` changes. */
export function useSource<T>(
  source: ViewportSource<T>,
  input?: WatchSource,
): Readonly<ShallowRef<T>> {
  const value = shallowRef(source.getSnapshot());
  // shallowRef ignores assigning the same reference, so an unchanged snapshot triggers nothing.
  const read = () => {
    value.value = source.getSnapshot();
  };
  let unsubscribe = source.subscribe(read);
  if (input) {
    watch(input, () => {
      unsubscribe();
      unsubscribe = source.subscribe(read);
      read();
    });
  }
  onScopeDispose(() => unsubscribe());
  return value;
}
