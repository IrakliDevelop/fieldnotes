import type { Point, Size, StrokePoint } from '../core/types';
import type {
  Binding,
  StrokeElement,
  NoteElement,
  ArrowElement,
  ArrowStrokeStyle,
  ImageElement,
  HtmlElement,
  TextElement,
  ShapeElement,
  ShapeKind,
} from './types';
import { createId } from './create-id';
import { getArrowControlPoint } from './arrow-geometry';
import { sanitizeNoteHtml } from './note-sanitizer';

export const DEFAULT_NOTE_FONT_SIZE = 18;

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
  blendMode?: 'multiply';
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
  label?: string;
  strokeStyle?: ArrowStrokeStyle;
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
  interactive?: boolean;
  htmlType?: string;
  data?: Record<string, unknown>;
  rotation?: number;
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
  const result: StrokeElement = {
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
  if (input.blendMode) result.blendMode = input.blendMode;
  return result;
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
    text: sanitizeNoteHtml(input.text ?? ''),
    backgroundColor: input.backgroundColor ?? '#ffeb3b',
    textColor: input.textColor ?? '#000000',
    fontSize: input.fontSize ?? DEFAULT_NOTE_FONT_SIZE,
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
  if (input.label !== undefined) result.label = input.label;
  if (input.strokeStyle !== undefined) result.strokeStyle = input.strokeStyle;
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
  if (input.interactive) el.interactive = input.interactive;
  if (input.htmlType) el.htmlType = input.htmlType;
  if (input.data) el.data = input.data;
  if (input.rotation !== undefined) el.rotation = input.rotation;
  return el;
}

interface ShapeInput extends BaseDefaults {
  position: Point;
  size: Size;
  shape?: ShapeKind;
  strokeColor?: string;
  strokeWidth?: number;
  fillColor?: string;
  flip?: boolean;
}

export function createShape(input: ShapeInput): ShapeElement {
  const result: ShapeElement = {
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
  if (input.flip) result.flip = input.flip;
  return result;
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
    text: sanitizeNoteHtml(input.text ?? ''),
    fontSize: input.fontSize ?? 16,
    color: input.color ?? '#1a1a1a',
    textAlign: input.textAlign ?? 'left',
  };
}
