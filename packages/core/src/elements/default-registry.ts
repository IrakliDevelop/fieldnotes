import { ElementRegistry } from './element-registry';

let defaultRegistry: ElementRegistry | null = null;

/**
 * Returns the default element registry, creating it if needed.
 *
 * Note: VTT element types (grid, template) are NOT registered by default.
 * Call `registerVttElementTypes()` from `@fieldnotes/vtt` to register them.
 */
export function getDefaultElementRegistry(): ElementRegistry {
  if (!defaultRegistry) {
    defaultRegistry = new ElementRegistry();
  }
  return defaultRegistry;
}

export function setDefaultElementRegistry(registry: ElementRegistry): void {
  defaultRegistry = registry;
}
