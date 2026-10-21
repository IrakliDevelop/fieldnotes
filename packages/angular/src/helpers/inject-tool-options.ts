import { isSignal } from '@angular/core';
import type { Signal } from '@angular/core';
import { createToolOptionsSource } from '@fieldnotes/core';
import { injectViewport } from '../inject-viewport';
import { injectSource, requireViewport } from './inject-source';

/**
 * `[options, setOptions]` for the named tool — updates when the tool's options change.
 * `options` is `null` if the tool is not registered or does not expose options.
 * A `Signal` `toolName` is followed: the helper resubscribes to the new tool.
 */
export function injectToolOptions<T extends Record<string, unknown>>(
  toolName: string | Signal<string>,
): [Signal<T | null>, (partial: Partial<T>) => void] {
  const viewport = injectViewport();
  const name = isSignal(toolName) ? toolName : () => toolName;
  const options = injectSource(
    (vp) => createToolOptionsSource<T>(vp, name),
    null,
    isSignal(toolName) ? toolName : undefined,
  );
  const setOptions = (partial: Partial<T>) => {
    const tool = requireViewport(viewport, 'setToolOptions').toolManager.getTool(name());
    tool?.setOptions?.(partial);
  };
  return [options, setOptions];
}
