import type { Bounds, Point, Size, StrokePoint } from '../core/types';

export interface BaseElement {
  id: string;
  type: string;
  position: Point;
  zIndex: number;
  locked: boolean;
  layerId: string;
  /** Optional flat group membership. Elements sharing a groupId select/move/delete as a unit. */
  groupId?: string;
  /** Rotation in radians (clockwise) about the element's center. Absent = 0 (unrotated).
   * Applied to note/text/image/html/shape/stroke; ignored for arrows. Extension
   * element definitions own their rotation semantics. */
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

export type CanvasElement =
  | StrokeElement
  | NoteElement
  | ArrowElement
  | ImageElement
  | HtmlElement
  | TextElement
  | ShapeElement
  | ExtensionElementEnvelope;

export type ElementType = CanvasElement['type'];

// ─── Extension element model (Phase 1 — additive) ────────────────────────────

export interface ExtensionElementEnvelope extends BaseElement {
  readonly type: 'extension';
  readonly extensionType: string;
  readonly data: Record<string, unknown>;
}

export interface ExtensionInteractionHandle {
  readonly id: string;
  readonly cursor: string;
}

export interface ExtensionInteractionContext {
  readonly zoom: number;
  readonly shiftKey: boolean;
  readonly snap: {
    readonly enabled: boolean;
    readonly size?: number;
    readonly mode?: string;
  };
}

export interface ElementInteractionAdapter<T extends BaseElement> {
  hitTestHandle?(
    el: T,
    point: Point,
    context: ExtensionInteractionContext,
  ): ExtensionInteractionHandle | null;
  updateHandle?(el: T, handleId: string, point: Point, context: ExtensionInteractionContext): T;
  renderSelection?(
    ctx: CanvasRenderingContext2D,
    el: T,
    context: { readonly zoom: number; readonly selectedCount: number },
  ): void;
  rotate?(el: T, pivot: Point, delta: number): T;
}

export interface ElementTypeDefinition<T extends BaseElement> {
  readonly type: string;
  readonly legacyTypes: readonly string[];
  decodeLegacy(raw: Record<string, unknown>): T;
  encodeLegacy(el: T): Record<string, unknown>;
  validateData(data: Record<string, unknown>): boolean;
  unwrap(el: ExtensionElementEnvelope): T;
  wrap(el: T): ExtensionElementEnvelope;
  bounds(el: T): Bounds | null;
  hitTest?(el: T, point: Point): boolean;
  interaction?: ElementInteractionAdapter<T>;
  renderMode?: 'canvas' | 'dom' | 'hybrid' | 'none';
  /** When true, the element renders on a separate full-viewport pass with explicit
   *  world bounds rather than inline with layer elements. Used for viewport-filling
   *  elements like grids. */
  fullCanvas?: boolean;
  render?(
    ctx: CanvasRenderingContext2D,
    el: T,
    allElements: readonly CanvasElement[],
    worldBounds?: { minX: number; minY: number; maxX: number; maxY: number },
  ): void;
  emitSvg?(
    el: T,
    allElements: readonly CanvasElement[],
    viewBox: { x: number; y: number; w: number; h: number },
  ): string;
}

export interface ElementTypeAdapter {
  readonly type: string;
  readonly legacyTypes: readonly string[];
  readonly renderMode: 'canvas' | 'dom' | 'hybrid' | 'none';
  readonly fullCanvas: boolean;
  validateEnvelope(el: ExtensionElementEnvelope): boolean;
  decodeLegacy(raw: Record<string, unknown>): ExtensionElementEnvelope;
  encodeLegacy(el: ExtensionElementEnvelope): Record<string, unknown>;
  wrap(el: BaseElement): ExtensionElementEnvelope;
  unwrap(el: ExtensionElementEnvelope): BaseElement;
  bounds(el: ExtensionElementEnvelope): Bounds | null;
  hitTest?(el: ExtensionElementEnvelope, point: Point): boolean;
  hitTestHandle?(
    el: ExtensionElementEnvelope,
    point: Point,
    context: ExtensionInteractionContext,
  ): ExtensionInteractionHandle | null;
  updateHandle?(
    el: ExtensionElementEnvelope,
    handleId: string,
    point: Point,
    context: ExtensionInteractionContext,
  ): ExtensionElementEnvelope;
  renderSelection?(
    ctx: CanvasRenderingContext2D,
    el: ExtensionElementEnvelope,
    context: { readonly zoom: number; readonly selectedCount: number },
  ): void;
  rotate?(el: ExtensionElementEnvelope, pivot: Point, delta: number): ExtensionElementEnvelope;
  render?(
    ctx: CanvasRenderingContext2D,
    el: ExtensionElementEnvelope,
    allElements: readonly CanvasElement[],
    worldBounds?: { minX: number; minY: number; maxX: number; maxY: number },
  ): void;
  emitSvg?(
    el: ExtensionElementEnvelope,
    allElements: readonly CanvasElement[],
    viewBox: { x: number; y: number; w: number; h: number },
  ): string;
}

export interface ElementTypeKey<T extends BaseElement> {
  readonly type: string;
  readonly matches: (envelope: ExtensionElementEnvelope) => boolean;
  readonly validateData: (data: Record<string, unknown>) => boolean;
  readonly unwrap: (envelope: ExtensionElementEnvelope) => T;
  readonly wrap: (el: T) => ExtensionElementEnvelope;
}
