export interface Point {
  x: number;
  y: number;
}

export interface Size {
  w: number;
  h: number;
}

export type Bounds = Point & Size;
