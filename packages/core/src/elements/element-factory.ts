import type { Point, Size, StrokePoint } from '../core/types';
import type {
  Binding,
  StrokeElement,
  NoteElement,
  ArrowElement,
  ArrowFixedSegment,
  ArrowStrokeStyle,
  ImageElement,
  HtmlElement,
  TextElement,
  ShapeElement,
  ShapeKind,
} from './types';
import { MAX_ARROW_FIXED_SEGMENTS } from './types';
import { createId } from './create-id';
import { getArrowControlPoint } from './arrow-geometry';
import { sanitizeNoteHtml } from './note-sanitizer';

export const DEFAULT_NOTE_FONT_SIZE = 18;

interface BaseDefaults {
  position?: Point;
  index?: string;
  version?: number;
  locked?: boolean;
  layerId?: string;
  parentId?: string;
}

function addParent<T extends { parentId?: string }>(element: T, parentId: string | undefined): T {
  if (parentId !== undefined) element.parentId = parentId;
  return element;
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
  /** @deprecated Migrated to a bound `TextElement` on load. */
  label?: string;
  strokeStyle?: ArrowStrokeStyle;
  routing?: 'bezier' | 'elbow';
  fixedSegments?: readonly ArrowFixedSegment[];
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
  transient?: boolean;
  rotation?: number;
}

interface TextInput extends BaseDefaults {
  position: Point;
  size?: Size;
  text?: string;
  fontSize?: number;
  color?: string;
  textAlign?: 'left' | 'center' | 'right';
  wrap?: boolean;
  autoResize?: boolean;
  containerId?: string;
}

export function createStroke(input: StrokeInput): StrokeElement {
  const result: StrokeElement = {
    id: createId('stroke'),
    type: 'stroke',
    position: input.position ?? { x: 0, y: 0 },
    index: input.index ?? '',
    version: input.version ?? 1,
    locked: input.locked ?? false,
    layerId: input.layerId ?? '',
    points: input.points,
    color: input.color ?? '#000000',
    width: input.width ?? 2,
    opacity: input.opacity ?? 1,
  };
  if (input.blendMode) result.blendMode = input.blendMode;
  return addParent(result, input.parentId);
}

export function createNote(input: NoteInput): NoteElement {
  return addParent<NoteElement>(
    {
      id: createId('note'),
      type: 'note',
      position: input.position,
      index: input.index ?? '',
      version: input.version ?? 1,
      locked: input.locked ?? false,
      layerId: input.layerId ?? '',
      size: input.size ?? { w: 200, h: 100 },
      text: sanitizeNoteHtml(input.text ?? ''),
      backgroundColor: input.backgroundColor ?? '#ffeb3b',
      textColor: input.textColor ?? '#000000',
      fontSize: input.fontSize ?? DEFAULT_NOTE_FONT_SIZE,
    },
    input.parentId,
  );
}

export function createArrow(input: ArrowInput): ArrowElement {
  if (input.routing !== undefined && input.routing !== 'bezier' && input.routing !== 'elbow') {
    throw new TypeError('Invalid arrow routing');
  }
  const fixedSegments = input.fixedSegments;
  if (fixedSegments !== undefined) {
    if (!Array.isArray(fixedSegments) || fixedSegments.length > MAX_ARROW_FIXED_SEGMENTS) {
      throw new TypeError('Invalid arrow fixed segments');
    }
    for (const segment of fixedSegments) {
      if (!isArrowFixedSegment(segment)) throw new TypeError('Invalid arrow fixed segments');
    }
  }
  const bend = input.bend ?? 0;
  const result: ArrowElement = {
    id: createId('arrow'),
    type: 'arrow',
    position: input.position ?? { x: 0, y: 0 },
    index: input.index ?? '',
    version: input.version ?? 1,
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
  if (input.routing !== undefined) result.routing = input.routing;
  if (input.fixedSegments !== undefined) result.fixedSegments = input.fixedSegments;
  return addParent(result, input.parentId);
}

function isArrowFixedSegment(value: unknown): value is ArrowFixedSegment {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const axis = Reflect.get(value, 'axis');
  const coordinate = Reflect.get(value, 'value');
  return (axis === 'x' || axis === 'y') && Number.isFinite(coordinate);
}

export function createImage(input: ImageInput): ImageElement {
  return addParent<ImageElement>(
    {
      id: createId('image'),
      type: 'image',
      position: input.position,
      index: input.index ?? '',
      version: input.version ?? 1,
      locked: input.locked ?? false,
      layerId: input.layerId ?? '',
      size: input.size,
      src: input.src,
    },
    input.parentId,
  );
}

export function createHtmlElement(input: HtmlInput): HtmlElement {
  const el: HtmlElement = {
    id: createId('html'),
    type: 'html',
    position: input.position,
    index: input.index ?? '',
    version: input.version ?? 1,
    locked: input.locked ?? false,
    layerId: input.layerId ?? '',
    size: input.size,
  };
  if (input.domId) el.domId = input.domId;
  if (input.interactive) el.interactive = input.interactive;
  if (input.htmlType) el.htmlType = input.htmlType;
  if (input.data) el.data = input.data;
  if (input.transient) el.transient = input.transient;
  if (input.rotation !== undefined) el.rotation = input.rotation;
  return addParent(el, input.parentId);
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

export function createShape(
  input: ShapeInput & { shape?: 'rectangle' },
): ShapeElement & { readonly shape: 'rectangle' };
export function createShape<T extends ShapeKind>(
  input: ShapeInput & { shape: T },
): ShapeElement & { readonly shape: T };
export function createShape(input: ShapeInput): ShapeElement;
export function createShape(input: ShapeInput): ShapeElement {
  const result: ShapeElement = {
    id: createId('shape'),
    type: 'shape',
    position: input.position,
    index: input.index ?? '',
    version: input.version ?? 1,
    locked: input.locked ?? false,
    layerId: input.layerId ?? '',
    shape: input.shape ?? 'rectangle',
    size: input.size,
    strokeColor: input.strokeColor ?? '#000000',
    strokeWidth: input.strokeWidth ?? 2,
    fillColor: input.fillColor ?? 'none',
  };
  if (input.flip) result.flip = input.flip;
  return addParent(result, input.parentId);
}

export function createText(input: TextInput): TextElement {
  const result: TextElement = {
    id: createId('text'),
    type: 'text',
    position: input.position,
    index: input.index ?? '',
    version: input.version ?? 1,
    locked: input.locked ?? false,
    layerId: input.layerId ?? '',
    size: input.size ?? { w: 200, h: 28 },
    text: sanitizeNoteHtml(input.text ?? ''),
    fontSize: input.fontSize ?? 16,
    color: input.color ?? '#1a1a1a',
    textAlign: input.textAlign ?? 'left',
  };
  if (input.wrap !== undefined) result.wrap = input.wrap;
  if (input.autoResize !== undefined) result.autoResize = input.autoResize;
  if (input.containerId !== undefined) result.containerId = input.containerId;
  return addParent(result, input.parentId);
}
