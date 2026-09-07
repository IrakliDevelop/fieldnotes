import type { BaseElement, Bounds, Point } from '@fieldnotes/core';

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

export type { Bounds, Point };
