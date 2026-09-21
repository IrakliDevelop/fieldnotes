import type { LegacyCanvasState, LegacyStateMigrator } from '@fieldnotes/core';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Migrates a legacy top-level `fog` field into `extensions.fog`.
 * Only structurally-valid payloads are carried forward; malformed data
 * (strings, arrays, partial objects, missing required fields) is discarded
 * so it cannot reach the fog plugin and crash on load.
 */
export const fogLegacyMigrator: LegacyStateMigrator = (legacy: LegacyCanvasState) => {
  if (!Object.hasOwn(legacy, 'fog')) return;

  const fog = legacy.fog;
  const def = isRecord(fog) ? fog['definition'] : null;
  const tiles = isRecord(fog) ? fog['tiles'] : null;
  const wellFormed =
    isRecord(fog) &&
    isRecord(def) &&
    typeof def['version'] === 'number' &&
    isRecord(def['bounds']) &&
    typeof def['cellSize'] === 'number' &&
    Array.isArray(tiles);

  if (wellFormed) {
    legacy.extensions ??= {};
    legacy.extensions['fog'] ??= {
      version: 1,
      data: structuredClone(fog),
    };
  }

  delete legacy.fog;
};
