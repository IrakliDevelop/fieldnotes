import type {
  ConstraintInfo,
  ConstraintOptions,
  ConstraintServiceAccess,
  Point,
  PointConstraintService,
} from './types';

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
