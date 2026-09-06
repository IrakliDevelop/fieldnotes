import type { PluginHandle } from '@fieldnotes/core';
import type { FogManager } from './fog-manager';
import { validateFogState } from './tile-codec';

/**
 * Wraps a FogManager as a PluginHandle so the PluginStateManager can
 * serialize/deserialize fog state through the `extensions.fog` slot.
 *
 * The persisted envelope is `{ version: 1, data: FogStateV1 | null }`.
 */
export function createFogPluginHandle(manager: FogManager): PluginHandle {
  return {
    stateVersion: 1,

    validateState(data: unknown): void {
      if (data === null || data === undefined) return;
      validateFogState(data);
    },

    loadState(data: unknown): void {
      manager.loadState(data == null ? null : (data as never));
    },

    exportState(): unknown {
      return manager.getState();
    },

    dispose(): void {
      // FogManager lifetime is owned by the Viewport.
    },
  };
}
