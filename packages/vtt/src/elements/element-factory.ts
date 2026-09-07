import type { Point } from '@fieldnotes/core';
import { createId } from './create-id';
import type {
  GridElement,
  HexOrientation,
  TemplateElement,
  TemplateRenderStyle,
  TemplateShape,
} from './types';

interface BaseDefaults {
  position?: Point;
  zIndex?: number;
  locked?: boolean;
  layerId?: string;
}

interface GridInput extends BaseDefaults {
  gridType?: 'square' | 'hex';
  hexOrientation?: HexOrientation;
  cellSize?: number;
  strokeColor?: string;
  strokeWidth?: number;
  opacity?: number;
}

export function createGrid(input: GridInput): GridElement {
  return {
    id: createId('grid'),
    type: 'grid',
    position: input.position ?? { x: 0, y: 0 },
    zIndex: input.zIndex ?? 0,
    locked: input.locked ?? false,
    layerId: input.layerId ?? '',
    gridType: input.gridType ?? 'square',
    hexOrientation: input.hexOrientation ?? 'pointy',
    cellSize: input.cellSize ?? 40,
    strokeColor: input.strokeColor ?? '#000000',
    strokeWidth: input.strokeWidth ?? 1,
    opacity: input.opacity ?? 1,
  };
}

interface TemplateInput extends BaseDefaults {
  position: Point;
  templateShape: TemplateShape;
  radius: number;
  angle?: number;
  width?: number;
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  opacity?: number;
  feetPerCell?: number;
  radiusFeet?: number;
  renderStyle?: TemplateRenderStyle;
}

export function createTemplate(input: TemplateInput): TemplateElement {
  return {
    id: createId('template'),
    type: 'template',
    position: input.position,
    zIndex: input.zIndex ?? 0,
    locked: input.locked ?? false,
    layerId: input.layerId ?? '',
    templateShape: input.templateShape,
    radius: input.radius,
    angle: input.angle ?? 0,
    fillColor: input.fillColor ?? 'rgba(255, 87, 34, 0.2)',
    strokeColor: input.strokeColor ?? '#FF5722',
    strokeWidth: input.strokeWidth ?? 2,
    opacity: input.opacity ?? 0.6,
    feetPerCell: input.feetPerCell,
    radiusFeet: input.radiusFeet,
    ...(input.renderStyle !== undefined ? { renderStyle: input.renderStyle } : {}),
    ...(input.width !== undefined ? { width: input.width } : {}),
  };
}
