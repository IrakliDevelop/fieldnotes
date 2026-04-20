import type { Point, Size, StrokePoint } from '../core/types';

interface BaseElement {
  id: string;
  type: string;
  position: Point;
  zIndex: number;
  locked: boolean;
  layerId: string;
}

export interface StrokeElement extends BaseElement {
  type: 'stroke';
  points: StrokePoint[];
  color: string;
  width: number;
  opacity: number;
}

export interface NoteElement extends BaseElement {
  type: 'note';
  size: Size;
  text: string;
  backgroundColor: string;
  textColor: string;
  fontSize?: number;
}

export interface Binding {
  elementId: string;
}

export interface ArrowElement extends BaseElement {
  type: 'arrow';
  from: Point;
  to: Point;
  bend: number;
  color: string;
  width: number;
  fromBinding?: Binding;
  toBinding?: Binding;
  /** Derived from from/to/bend. Redundant in serialized state — safe to omit. */
  cachedControlPoint?: Point;
}

export interface ImageElement extends BaseElement {
  type: 'image';
  size: Size;
  src: string;
}

export interface HtmlElement extends BaseElement {
  type: 'html';
  size: Size;
  domId?: string;
}

export interface TextElement extends BaseElement {
  type: 'text';
  size: Size;
  text: string;
  fontSize: number;
  color: string;
  textAlign: 'left' | 'center' | 'right';
}

export type ShapeKind = 'rectangle' | 'ellipse';

export interface ShapeElement extends BaseElement {
  type: 'shape';
  shape: ShapeKind;
  size: Size;
  strokeColor: string;
  strokeWidth: number;
  fillColor: string;
}

export type HexOrientation = 'pointy' | 'flat';

export interface GridElement extends BaseElement {
  type: 'grid';
  gridType: 'square' | 'hex';
  hexOrientation: HexOrientation;
  cellSize: number;
  strokeColor: string;
  strokeWidth: number;
  opacity: number;
}

export type TemplateShape = 'circle' | 'cone' | 'line' | 'square';

export interface TemplateElement extends BaseElement {
  type: 'template';
  templateShape: TemplateShape;
  radius: number;
  angle: number;
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
  opacity: number;
  feetPerCell?: number;
  radiusFeet?: number;
}

export type CanvasElement =
  | StrokeElement
  | NoteElement
  | ArrowElement
  | ImageElement
  | HtmlElement
  | TextElement
  | ShapeElement
  | GridElement
  | TemplateElement;

export type ElementType = CanvasElement['type'];
