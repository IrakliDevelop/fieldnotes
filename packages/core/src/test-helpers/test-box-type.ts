import type { Size } from '../core/types';
import { ElementRegistry } from '../elements/element-registry';
import type { ExtensionElementEnvelope } from '../elements/types';

/** A registry with the `test:box` extension type: a fixed-size box at the element position. */
export function createTestBoxRegistry(size: Size = { w: 40, h: 20 }): ElementRegistry {
  const registry = new ElementRegistry();
  registry.register<ExtensionElementEnvelope>({
    type: 'test:box',
    legacyTypes: [],
    decodeLegacy: (raw) => raw as unknown as ExtensionElementEnvelope,
    validateData: () => true,
    unwrap: (element) => element,
    wrap: (element) => element,
    bounds: (element) => ({ x: element.position.x, y: element.position.y, ...size }),
    renderMode: 'canvas',
  });
  return registry;
}
