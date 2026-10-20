import { toValue } from 'vue';
import type { MaybeRefOrGetter, ShallowRef } from 'vue';
import { createToolOptionsSource } from '@fieldnotes/core';
import { useViewport } from './use-viewport';
import { useSource } from './use-source';

/**
 * `[options, setOptions]` for the named tool — updates when the tool's options change.
 * `options` is `null` if the tool is not registered or does not expose options.
 * A ref or getter `toolName` is followed: the composable resubscribes to the new tool.
 */
export function useToolOptions<T extends Record<string, unknown>>(
  toolName: MaybeRefOrGetter<string>,
): [Readonly<ShallowRef<T | null>>, (partial: Partial<T>) => void] {
  const viewport = useViewport();
  const name = () => toValue(toolName);
  const options = useSource(createToolOptionsSource<T>(viewport, name), name);
  const setOptions = (partial: Partial<T>) => {
    viewport.toolManager.getTool(name())?.setOptions?.(partial as Record<string, unknown>);
  };
  return [options, setOptions];
}
