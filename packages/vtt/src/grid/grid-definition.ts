import type {
  CanvasElement,
  ElementTypeDefinition,
  ExtensionElementEnvelope,
} from '@fieldnotes/core';
import type { GridElement } from '../elements/types';
import { renderSquareGrid, renderHexGrid } from './grid-renderer';
import { emitGridSvg } from '../template/template-renderer';

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
      groupId: raw['groupId'] as string | undefined,
      rotation: raw['rotation'] as number | undefined,
      gridType: raw['gridType'] as 'square' | 'hex',
      hexOrientation: raw['hexOrientation'] as 'pointy' | 'flat',
      cellSize: raw['cellSize'] as number,
      strokeColor: raw['strokeColor'] as string,
      strokeWidth: raw['strokeWidth'] as number,
      opacity: raw['opacity'] as number,
    };
  },

  encodeLegacy(el: GridElement): Record<string, unknown> {
    const result: Record<string, unknown> = {
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
    if (el.groupId !== undefined) result['groupId'] = el.groupId;
    if (el.rotation !== undefined) result['rotation'] = el.rotation;
    return result;
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
  fullCanvas: true,

  render(
    ctx: CanvasRenderingContext2D,
    grid: GridElement,
    _allElements: readonly CanvasElement[],
    worldBounds?: { minX: number; minY: number; maxX: number; maxY: number },
  ): void {
    const bounds = worldBounds ?? { minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 };

    if (grid.gridType === 'hex') {
      renderHexGrid(
        ctx,
        bounds,
        grid.cellSize,
        grid.hexOrientation,
        grid.strokeColor,
        grid.strokeWidth,
        grid.opacity,
      );
    } else {
      renderSquareGrid(
        ctx,
        bounds,
        grid.cellSize,
        grid.strokeColor,
        grid.strokeWidth,
        grid.opacity,
      );
    }
  },

  emitSvg(
    grid: GridElement,
    _allElements: readonly CanvasElement[],
    viewBox: { x: number; y: number; w: number; h: number },
  ): string {
    return emitGridSvg(grid, viewBox);
  },
};
