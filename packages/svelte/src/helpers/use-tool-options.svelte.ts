import { get, writable } from 'svelte/store';
import type { Readable } from 'svelte/store';
import { createToolOptionsSource } from '@fieldnotes/core';
import { useViewport } from '../context.js';
import { fromSource } from './from-source.svelte.js';

/**
 * `[options, setOptions]` for the named tool — updates when the tool's options change.
 * `options` is `null` if the tool is not registered or does not expose options.
 * A getter `toolName` is tracked: the store resubscribes to the new tool.
 */
export function useToolOptions<T extends Record<string, unknown>>(
  toolName: string | (() => string),
): [Readable<T | null>, (partial: Partial<T>) => void] {
  const viewport = useViewport();
  let getName: () => string;
  let input: Readable<string> | undefined;
  if (typeof toolName === 'string') {
    getName = () => toolName;
  } else {
    const name = writable(toolName());
    $effect.pre(() => name.set(toolName()));
    getName = () => get(name);
    input = name;
  }
  const options = fromSource(createToolOptionsSource<T>(viewport, getName), input);
  const setOptions = (partial: Partial<T>) => {
    viewport.toolManager.getTool(getName())?.setOptions?.(partial as Record<string, unknown>);
  };
  return [options, setOptions];
}
