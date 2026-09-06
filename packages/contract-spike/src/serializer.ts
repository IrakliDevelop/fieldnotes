import type { ElementRegistry } from './element-registry';
import type {
  CanvasState,
  CanvasStateV3,
  CanvasStateV4,
  FogStateV1,
  PersistedPluginState,
  RuntimeElement,
  WireElement,
} from './types';

export function serializeRuntimeToWire(
  elements: RuntimeElement[],
  registry: ElementRegistry,
): WireElement[] {
  return elements.map((el) => {
    if (el.type !== 'extension') return el;
    const adapter = registry.getAdapter(el.extensionType);
    if (!adapter) {
      throw new Error(`No adapter registered for extension type "${el.extensionType}"`);
    }
    const legacyFields = adapter.encodeLegacy(el);
    const legacyType = adapter.legacyTypes[0];
    if (!legacyType) {
      throw new Error(`No legacy type for extension type "${el.extensionType}"`);
    }
    return { ...el, ...legacyFields, type: legacyType } as WireElement;
  });
}

export function parseWireToRuntime(
  wireElements: WireElement[],
  registry: ElementRegistry,
): RuntimeElement[] {
  return wireElements.map((el) => {
    if (el.type === 'extension') return el;
    if (el.type === 'grid' || el.type === 'template') {
      const adapter = registry.getAdapterByLegacyType(el.type);
      if (!adapter) {
        throw new Error(`No adapter for legacy type "${el.type}"`);
      }
      const record = el as unknown as Record<string, unknown>;
      const { type: _type, ...fields } = record;
      void _type;
      return adapter.decodeLegacy(fields);
    }
    return el;
  });
}

export function migrateV3toV4(state: CanvasStateV3): CanvasStateV4 {
  const extensions: Record<string, PersistedPluginState> = {};

  if (state.fog) {
    extensions['fog'] = {
      version: 1,
      data: structuredClone(state.fog) as FogStateV1,
    };
  }

  const v4: CanvasStateV4 = {
    version: 4,
    camera: { ...state.camera },
    elements: state.elements,
    extensions,
  };

  return v4;
}

export function migrateState(state: CanvasState): CanvasStateV4 {
  if (state.version === 4) return state;
  return migrateV3toV4(state);
}

export function roundTrip(elements: RuntimeElement[], registry: ElementRegistry): RuntimeElement[] {
  const wire = serializeRuntimeToWire(elements, registry);
  return parseWireToRuntime(wire, registry);
}
