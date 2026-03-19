import type { Point, Size } from '../core/types';
import type { StrokeElement, NoteElement, ArrowElement, ImageElement, HtmlElement } from './types';
import { createId } from './create-id';

interface BaseDefaults {
  position?: Point;
  zIndex?: number;
  locked?: boolean;
}

interface StrokeInput extends BaseDefaults {
  points: Point[];
  color?: string;
  width?: number;
  opacity?: number;
}

interface NoteInput extends BaseDefaults {
  position: Point;
  size?: Size;
  text?: string;
  backgroundColor?: string;
}

interface ArrowInput extends BaseDefaults {
  from: Point;
  to: Point;
  bend?: number;
  color?: string;
  width?: number;
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
  };
}

export function createArrow(input: ArrowInput): ArrowElement {
  return {
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
