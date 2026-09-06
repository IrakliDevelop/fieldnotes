import type { GridElement, TemplateElement } from '@fieldnotes/core';
import type { ElementRegistry } from './element-registry';
import type {
  CanvasState,
  CanvasStateV3,
  CanvasStateV4,
  ExtensionElementEnvelope,
  FogStateV1,
  PersistedPluginState,
  RuntimeElement,
  WireElementV3,
  WireElementV4,
} from './types';

export function serializeRuntimeToWireV3(
  elements: RuntimeElement[],
  registry: ElementRegistry,
): WireElementV3[] {
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
    return { ...el, ...legacyFields, type: legacyType } as unknown as WireElementV3;
  });
}

export function parseWireToRuntime(
  wireElements: readonly (WireElementV3 | WireElementV4)[],
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

// ─── Element migration: grid/template → ExtensionElementEnvelope ─────────────

function gridToEnvelope(el: GridElement): ExtensionElementEnvelope {
  return {
    id: el.id,
    type: 'extension',
    extensionType: 'vtt:grid',
    position: el.position,
    zIndex: el.zIndex,
    locked: el.locked,
    layerId: el.layerId,
    groupId: el.groupId,
    rotation: el.rotation,
    data: {
      gridType: el.gridType,
      hexOrientation: el.hexOrientation,
      cellSize: el.cellSize,
      strokeColor: el.strokeColor,
      strokeWidth: el.strokeWidth,
      opacity: el.opacity,
    },
  };
}

function templateToEnvelope(el: TemplateElement): ExtensionElementEnvelope {
  return {
    id: el.id,
    type: 'extension',
    extensionType: 'vtt:template',
    position: el.position,
    zIndex: el.zIndex,
    locked: el.locked,
    layerId: el.layerId,
    groupId: el.groupId,
    rotation: el.rotation,
    data: {
      templateShape: el.templateShape,
      radius: el.radius,
      angle: el.angle,
      width: el.width,
      fillColor: el.fillColor,
      strokeColor: el.strokeColor,
      strokeWidth: el.strokeWidth,
      opacity: el.opacity,
      feetPerCell: el.feetPerCell,
      radiusFeet: el.radiusFeet,
      renderStyle: el.renderStyle,
    },
  };
}

export function migrateElementToV4(el: WireElementV3): WireElementV4 {
  if (el.type === 'grid') return gridToEnvelope(el);
  if (el.type === 'template') return templateToEnvelope(el);
  return el;
}

// ─── State migration ─────────────────────────────────────────────────────────

export function migrateV3toV4(state: CanvasStateV3): CanvasStateV4 {
  const extensions: Record<string, PersistedPluginState> = structuredClone(
    state.extensions ?? {},
  ) as Record<string, PersistedPluginState>;

  if (state.fog && !extensions['fog']) {
    extensions['fog'] = {
      version: 1,
      data: structuredClone(state.fog) as FogStateV1,
    };
  }

  const v4: CanvasStateV4 = {
    version: 4,
    camera: structuredClone(state.camera) as CanvasStateV4['camera'],
    elements: state.elements.map(migrateElementToV4),
    extensions,
  };
  if (state.layers) {
    v4.layers = structuredClone(state.layers) as NonNullable<CanvasStateV4['layers']>;
  }
  if (state.activeLayerId !== undefined) {
    v4.activeLayerId = state.activeLayerId;
  }

  return v4;
}

export function migrateState(state: CanvasState): CanvasStateV4 {
  if (state.version === 4) return state;
  return migrateV3toV4(state);
}

export function roundTrip(elements: RuntimeElement[], registry: ElementRegistry): RuntimeElement[] {
  const wire = serializeRuntimeToWireV3(elements, registry);
  return parseWireToRuntime(wire, registry);
}
