import type { Point } from './types';

export interface ConstraintOptions {
  mode?: string;
  footprint?: { width: number; height: number };
}

export interface ConstraintInfo {
  type: string;
  [key: string]: unknown;
}

export interface PointConstraintService {
  readonly constrainPoint: (point: Point, options?: ConstraintOptions) => Point;
  readonly getConstraintInfo: () => ConstraintInfo | null;
  readonly hasCapability: (capability: string) => boolean;
}

export interface ConstraintServiceAccess {
  readonly isActive: boolean;
  readonly setActive: (active: boolean) => void;
  readonly constrainPoint: (point: Point, options?: ConstraintOptions) => Point;
  readonly getConstraintInfo: () => ConstraintInfo | null;
  readonly hasCapability: (capability: string) => boolean;
}

export class ConstraintServiceProxy implements ConstraintServiceAccess {
  private _impl: PointConstraintService | null = null;
  private _active = false;

  get isActive(): boolean {
    return this._active;
  }

  setActive(active: boolean): void {
    this._active = active;
  }

  constrainPoint(point: Point, options?: ConstraintOptions): Point {
    if (!this._active || !this._impl) return point;
    return this._impl.constrainPoint(point, options);
  }

  getConstraintInfo(): ConstraintInfo | null {
    if (!this._impl) return null;
    return this._impl.getConstraintInfo();
  }

  hasCapability(capability: string): boolean {
    if (!this._impl) return false;
    return this._impl.hasCapability(capability);
  }

  setImplementation(impl: PointConstraintService | null): void {
    this._impl = impl;
  }
}
