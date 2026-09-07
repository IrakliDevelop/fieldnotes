import type { ElementRegistry } from '@fieldnotes/core';
import { getDefaultElementRegistry } from '@fieldnotes/core';
import { gridElementTypeDefinition } from './grid/grid-definition';
import { templateElementTypeDefinition } from './template/template-definition';

/**
 * Register VTT element types (grid, template) in the given element registry.
 * If no registry is provided, the default global registry is used.
 *
 * Call this once at application startup before loading any persisted state
 * that may contain grid or template elements.
 */
export function registerVttElementTypes(registry?: ElementRegistry): void {
  const reg = registry ?? getDefaultElementRegistry();
  reg.register(gridElementTypeDefinition);
  reg.register(templateElementTypeDefinition);
}
