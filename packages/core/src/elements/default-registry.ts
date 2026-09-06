import { ElementRegistry } from './element-registry';
import { gridElementTypeDefinition } from './grid-definition';
import { templateElementTypeDefinition } from './template-definition';

let defaultRegistry: ElementRegistry | null = null;

export function getDefaultElementRegistry(): ElementRegistry {
  if (!defaultRegistry) {
    defaultRegistry = new ElementRegistry();
    defaultRegistry.register(gridElementTypeDefinition);
    defaultRegistry.register(templateElementTypeDefinition);
  }
  return defaultRegistry;
}

export function setDefaultElementRegistry(registry: ElementRegistry): void {
  defaultRegistry = registry;
}
