import type { ElementTypeDefinition, ExtensionElementEnvelope, GridElement } from './types';

function isEnum(value: unknown, allowed: readonly string[]): boolean {
  return typeof value === 'string' && allowed.includes(value);
}

function isFiniteNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

function isString(value: unknown): boolean {
  return typeof value === 'string';
}

export const gridElementTypeDefinition: ElementTypeDefinition<GridElement> = {
  type: 'vtt:grid',
  legacyTypes: ['grid'],

  decodeLegacy(raw: Record<string, unknown>): GridElement {
    return {
      id: raw['id'] as string,
      type: 'grid',
      position: raw['position'] as { x: number; y: number },
      zIndex: raw['zIndex'] as number,
      locked: raw['locked'] as boolean,
      layerId: raw['layerId'] as string,
      gridType: raw['gridType'] as 'square' | 'hex',
      hexOrientation: raw['hexOrientation'] as 'pointy' | 'flat',
      cellSize: raw['cellSize'] as number,
      strokeColor: raw['strokeColor'] as string,
      strokeWidth: raw['strokeWidth'] as number,
      opacity: raw['opacity'] as number,
    };
  },

  encodeLegacy(el: GridElement): Record<string, unknown> {
    return {
      id: el.id,
      type: 'grid',
      position: el.position,
      zIndex: el.zIndex,
      locked: el.locked,
      layerId: el.layerId,
      gridType: el.gridType,
      hexOrientation: el.hexOrientation,
      cellSize: el.cellSize,
      strokeColor: el.strokeColor,
      strokeWidth: el.strokeWidth,
      opacity: el.opacity,
    };
  },

  validateData(data: Record<string, unknown>): boolean {
    return (
      isEnum(data['gridType'], ['square', 'hex']) &&
      isEnum(data['hexOrientation'], ['pointy', 'flat']) &&
      isFiniteNumber(data['cellSize']) &&
      isString(data['strokeColor']) &&
      isFiniteNumber(data['strokeWidth']) &&
      isFiniteNumber(data['opacity'])
    );
  },

  unwrap(el: ExtensionElementEnvelope): GridElement {
    return {
      id: el.id,
      type: 'grid',
      position: el.position,
      zIndex: el.zIndex,
      locked: el.locked,
      layerId: el.layerId,
      groupId: el.groupId,
      rotation: el.rotation,
      gridType: el.data['gridType'] as 'square' | 'hex',
      hexOrientation: el.data['hexOrientation'] as 'pointy' | 'flat',
      cellSize: el.data['cellSize'] as number,
      strokeColor: el.data['strokeColor'] as string,
      strokeWidth: el.data['strokeWidth'] as number,
      opacity: el.data['opacity'] as number,
    };
  },

  wrap(el: GridElement): ExtensionElementEnvelope {
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
  },

  bounds(): null {
    return null;
  },

  renderMode: 'canvas',
};
