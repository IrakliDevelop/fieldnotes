import type { Point, Size, StrokePoint } from '../core/types';

interface BaseElement {
  id: string;
  type: string;
  position: Point;
  zIndex: number;
  locked: boolean;
  layerId: string;
  /** Optional flat group membership. Elements sharing a groupId select/move/delete as a unit. */
  groupId?: string;
  /** Rotation in radians (clockwise) about the element's center. Absent = 0 (unrotated).
   * Applied to note/text/image/html/shape/stroke; ignored for arrow/grid/template. */
  rotation?: number;
}

export interface StrokeElement extends BaseElement {
  type: 'stroke';
  points: StrokePoint[];
  color: string;
  width: number;
  opacity: number;
  /** Optional canvas blend mode (e.g. highlighter uses 'multiply'). */
  blendMode?: 'multiply';
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

export type ArrowStrokeStyle = 'solid' | 'dashed' | 'dotted';

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
  /** Optional text rendered at the curve midpoint. */
  label?: string;
  /** Line dash appearance. Absent = solid. Decoupled from binding. */
  strokeStyle?: ArrowStrokeStyle;
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
  interactive?: boolean;
  /** Discriminator matching a renderer registered via `viewport.registerHtmlRenderer`. */
  htmlType?: string;
  /** Serializable payload passed to the registered renderer to rebuild the embed on load. */
  data?: Record<string, unknown>;
}

export interface TextElement extends BaseElement {
  type: 'text';
  size: Size;
  text: string;
  fontSize: number;
  color: string;
  textAlign: 'left' | 'center' | 'right';
}

export type ShapeKind = 'rectangle' | 'ellipse' | 'line';

export interface ShapeElement extends BaseElement {
  type: 'shape';
  shape: ShapeKind;
  size: Size;
  strokeColor: string;
  strokeWidth: number;
  fillColor: string;
  /** Line-only: which bbox diagonal the segment runs along. Absent/false = main diagonal. */
  flip?: boolean;
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

export type TemplateShape = 'circle' | 'cone' | 'line' | 'square' | 'rectangle';

export type TemplateRenderStyle = 'cells' | 'geometric';

export interface TemplateElement extends BaseElement {
  type: 'template';
  templateShape: TemplateShape;
  radius: number;
  angle: number;
  /** Rectangle-only: full perpendicular extent in world units (centered on the aim axis).
   *  Absent for other shapes. Distinct from strokeWidth. */
  width?: number;
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
  opacity: number;
  feetPerCell?: number;
  radiusFeet?: number;
  renderStyle?: TemplateRenderStyle;
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
