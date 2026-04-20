import type { Point, Size, StrokePoint } from '../core/types';
import type {
  Binding,
  StrokeElement,
  NoteElement,
  ArrowElement,
  ImageElement,
  HtmlElement,
  TextElement,
  ShapeElement,
  ShapeKind,
  GridElement,
  HexOrientation,
  TemplateElement,
  TemplateShape,
} from './types';
import { createId } from './create-id';
import { getArrowControlPoint } from './arrow-geometry';

interface BaseDefaults {
  position?: Point;
  zIndex?: number;
  locked?: boolean;
  layerId?: string;
}

interface StrokeInput extends BaseDefaults {
  points: StrokePoint[];
  color?: string;
  width?: number;
  opacity?: number;
}

interface NoteInput extends BaseDefaults {
  position: Point;
  size?: Size;
  text?: string;
  backgroundColor?: string;
  textColor?: string;
  fontSize?: number;
}

interface ArrowInput extends BaseDefaults {
  from: Point;
  to: Point;
  bend?: number;
  color?: string;
  width?: number;
  fromBinding?: Binding;
  toBinding?: Binding;
}

interface ImageInput extends BaseDefaults {
  position: Point;
  size: Size;
  src: string;
}

interface HtmlInput extends BaseDefaults {
  position: Point;
  size: Size;
  domId?: string;
}

interface TextInput extends BaseDefaults {
  position: Point;
  size?: Size;
  text?: string;
  fontSize?: number;
  color?: string;
  textAlign?: 'left' | 'center' | 'right';
}

export function createStroke(input: StrokeInput): StrokeElement {
  return {
    id: createId('stroke'),
    type: 'stroke',
    position: input.position ?? { x: 0, y: 0 },
    zIndex: input.zIndex ?? 0,
    locked: input.locked ?? false,
    layerId: input.layerId ?? '',
    points: input.points,
    color: input.color ?? '#000000',
    width: input.width ?? 2,
    opacity: input.opacity ?? 1,
  };
}

export function createNote(input: NoteInput): NoteElement {
  return {
    id: createId('note'),
    type: 'note',
    position: input.position,
    zIndex: input.zIndex ?? 0,
    locked: input.locked ?? false,
    layerId: input.layerId ?? '',
    size: input.size ?? { w: 200, h: 100 },
    text: input.text ?? '',
    backgroundColor: input.backgroundColor ?? '#ffeb3b',
    textColor: input.textColor ?? '#000000',
    fontSize: input.fontSize ?? 14,
  };
}

export function createArrow(input: ArrowInput): ArrowElement {
  const bend = input.bend ?? 0;
  const result: ArrowElement = {
    id: createId('arrow'),
    type: 'arrow',
    position: input.position ?? { x: 0, y: 0 },
    zIndex: input.zIndex ?? 0,
    locked: input.locked ?? false,
    layerId: input.layerId ?? '',
    from: input.from,
    to: input.to,
    bend,
    color: input.color ?? '#000000',
    width: input.width ?? 2,
    cachedControlPoint: getArrowControlPoint(input.from, input.to, bend),
  };
  if (input.fromBinding) result.fromBinding = input.fromBinding;
  if (input.toBinding) result.toBinding = input.toBinding;
  return result;
}

export function createImage(input: ImageInput): ImageElement {
  return {
    id: createId('image'),
    type: 'image',
    position: input.position,
    zIndex: input.zIndex ?? 0,
    locked: input.locked ?? false,
    layerId: input.layerId ?? '',
    size: input.size,
    src: input.src,
  };
}

export function createHtmlElement(input: HtmlInput): HtmlElement {
  const el: HtmlElement = {
    id: createId('html'),
    type: 'html',
    position: input.position,
    zIndex: input.zIndex ?? 0,
    locked: input.locked ?? false,
    layerId: input.layerId ?? '',
    size: input.size,
  };
  if (input.domId) el.domId = input.domId;
  return el;
}

interface ShapeInput extends BaseDefaults {
  position: Point;
  size: Size;
  shape?: ShapeKind;
  strokeColor?: string;
  strokeWidth?: number;
  fillColor?: string;
}

export function createShape(input: ShapeInput): ShapeElement {
  return {
    id: createId('shape'),
    type: 'shape',
    position: input.position,
    zIndex: input.zIndex ?? 0,
    locked: input.locked ?? false,
    layerId: input.layerId ?? '',
    shape: input.shape ?? 'rectangle',
    size: input.size,
    strokeColor: input.strokeColor ?? '#000000',
    strokeWidth: input.strokeWidth ?? 2,
    fillColor: input.fillColor ?? 'none',
  };
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

export function createText(input: TextInput): TextElement {
  return {
    id: createId('text'),
    type: 'text',
    position: input.position,
    zIndex: input.zIndex ?? 0,
    locked: input.locked ?? false,
    layerId: input.layerId ?? '',
    size: input.size ?? { w: 200, h: 28 },
    text: input.text ?? '',
    fontSize: input.fontSize ?? 16,
    color: input.color ?? '#1a1a1a',
    textAlign: input.textAlign ?? 'left',
  };
}

interface TemplateInput extends BaseDefaults {
  position: Point;
  templateShape: TemplateShape;
  radius: number;
  angle?: number;
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  opacity?: number;
  feetPerCell?: number;
  radiusFeet?: number;
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
  };
}
