import type { ElementRegistry } from '@fieldnotes/core';
import { getDefaultElementRegistry, registerLegacyStateMigrator } from '@fieldnotes/core';
import { gridElementTypeDefinition } from './grid/grid-definition';
import { templateElementTypeDefinition } from './template/template-definition';
import { fogLegacyMigrator } from './fog/fog-legacy-migrator';

let fogMigratorRegistered = false;

/**
 * Register VTT element types (grid, template) in the given element registry.
 * If no registry is provided, the default global registry is used.
 *
 * Also registers the VTT fog legacy state migrator so that persisted v1–v3
 * canvas state with a top-level `fog` field is migrated into `extensions.fog`.
 *
 * Call this once at application startup before loading any persisted state
 * that may contain grid or template elements.
 */
export function registerVttElementTypes(registry?: ElementRegistry): void {
  const reg = registry ?? getDefaultElementRegistry();
  reg.register(gridElementTypeDefinition);
  reg.register(templateElementTypeDefinition);
  if (!fogMigratorRegistered) {
    registerLegacyStateMigrator(fogLegacyMigrator);
    fogMigratorRegistered = true;
  }
}
