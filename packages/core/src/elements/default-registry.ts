import { ElementRegistry } from './element-registry';

let defaultRegistry: ElementRegistry | null = null;

/**
 * Returns the default element registry, creating it if needed.
 *
 * Domain element types are not registered by default. Consumers install their
 * definitions before importing state that contains the corresponding legacy types.
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
