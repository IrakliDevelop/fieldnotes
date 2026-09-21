import type { LegacyCanvasState, LegacyStateMigrator } from '@fieldnotes/core';
import { validateFogState } from './tile-codec';

/**
 * Migrates a legacy top-level `fog` field into `extensions.fog`.
 * Only structurally-valid payloads are carried forward; malformed data
 * (strings, arrays, partial objects, missing required fields) is discarded
 * so it cannot reach the fog plugin and crash on load.
 */
export const fogLegacyMigrator: LegacyStateMigrator = (legacy: LegacyCanvasState) => {
  if (!Object.hasOwn(legacy, 'fog')) return;

  const fog = legacy['fog'];
  try {
    validateFogState(fog);
    legacy.extensions ??= {};
    legacy.extensions['fog'] ??= {
      version: 1,
      data: structuredClone(fog),
    };
  } catch {
    // Invalid legacy payloads are discarded so load can continue safely.
  } finally {
    delete legacy['fog'];
  }
};
