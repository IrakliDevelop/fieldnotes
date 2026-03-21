export interface Point {
  x: number;
  y: number;
}

export interface StrokePoint {
  x: number;
  y: number;
  pressure: number;
}

export interface Size {
  w: number;
  h: number;
}

export type Bounds = Point & Size;
