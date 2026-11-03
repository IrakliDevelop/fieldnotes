import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { createShortcutsSource } from '@fieldnotes/core';
import type { ShortcutBindings } from '@fieldnotes/core';
import { useViewport } from './use-viewport';

/** Current shortcut bindings and controls for changing them. */
export interface UseShortcutsResult {
  readonly bindings: Record<string, readonly string[]>;
  rebind(action: string, bindings: string | string[] | null): void;
  disable(action: string): void;
  reset(action?: string): void;
}

/** Reads and changes the current viewport shortcuts. */
export function useShortcuts(): UseShortcutsResult {
  const viewport = useViewport();
  const source = useMemo(() => createShortcutsSource(viewport), [viewport]);
  const bindings = useSyncExternalStore(source.subscribe, source.getSnapshot);
  const rebind = useCallback(
    (action: string, nextBindings: ShortcutBindings[string]) => {
      viewport.shortcuts.rebind(action, nextBindings);
    },
    [viewport],
  );
  const disable = useCallback((action: string) => viewport.shortcuts.disable(action), [viewport]);
  const reset = useCallback((action?: string) => viewport.shortcuts.reset(action), [viewport]);

  return useMemo(() => ({ bindings, rebind, disable, reset }), [bindings, rebind, disable, reset]);
}
