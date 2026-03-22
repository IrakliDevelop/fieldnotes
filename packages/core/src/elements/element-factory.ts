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
} from './types';
import { createId } from './create-id';

interface BaseDefaults {
  position?: Point;
  zIndex?: number;
  locked?: boolean;
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
    size: input.size ?? { w: 200, h: 100 },
    text: input.text ?? '',
    backgroundColor: input.backgroundColor ?? '#ffeb3b',
    textColor: input.textColor ?? '#000000',
  };
}

export function createArrow(input: ArrowInput): ArrowElement {
  const result: ArrowElement = {
    id: createId('arrow'),
    type: 'arrow',
    position: input.position ?? { x: 0, y: 0 },
    zIndex: input.zIndex ?? 0,
    locked: input.locked ?? false,
    from: input.from,
    to: input.to,
    bend: input.bend ?? 0,
    color: input.color ?? '#000000',
    width: input.width ?? 2,
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
    size: input.size,
    src: input.src,
  };
}

export function createHtmlElement(input: HtmlInput): HtmlElement {
  return {
    id: createId('html'),
    type: 'html',
    position: input.position,
    zIndex: input.zIndex ?? 0,
    locked: input.locked ?? false,
    size: input.size,
  };
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
    shape: input.shape ?? 'rectangle',
    size: input.size,
    strokeColor: input.strokeColor ?? '#000000',
    strokeWidth: input.strokeWidth ?? 2,
    fillColor: input.fillColor ?? 'none',
  };
}

export function createText(input: TextInput): TextElement {
  return {
    id: createId('text'),
    type: 'text',
    position: input.position,
    zIndex: input.zIndex ?? 0,
    locked: input.locked ?? false,
    size: input.size ?? { w: 200, h: 28 },
    text: input.text ?? '',
    fontSize: input.fontSize ?? 16,
    color: input.color ?? '#1a1a1a',
    textAlign: input.textAlign ?? 'left',
  };
}
