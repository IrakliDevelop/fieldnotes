import type { Point } from '../core/types';

export interface CameraOptions {
  minZoom?: number;
  maxZoom?: number;
}

const DEFAULT_MIN_ZOOM = 0.1;
const DEFAULT_MAX_ZOOM = 10;

export class Camera {
  private x = 0;
  private y = 0;
  private z = 1;
  private readonly minZoom: number;
  private readonly maxZoom: number;
  private changeListeners = new Set<() => void>();

  constructor(options: CameraOptions = {}) {
    this.minZoom = options.minZoom ?? DEFAULT_MIN_ZOOM;
    this.maxZoom = options.maxZoom ?? DEFAULT_MAX_ZOOM;
  }

  get position(): Point {
    return { x: this.x, y: this.y };
  }

  get zoom(): number {
    return this.z;
  }

  pan(dx: number, dy: number): void {
    this.x += dx;
    this.y += dy;
    this.notifyChange();
  }

  moveTo(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.notifyChange();
  }

  setZoom(level: number): void {
    this.z = Math.min(this.maxZoom, Math.max(this.minZoom, level));
    this.notifyChange();
  }

  zoomAt(level: number, screenPoint: Point): void {
    const before = this.screenToWorld(screenPoint);
    this.z = Math.min(this.maxZoom, Math.max(this.minZoom, level));
    const after = this.screenToWorld(screenPoint);
    this.x += (after.x - before.x) * this.z;
    this.y += (after.y - before.y) * this.z;
    this.notifyChange();
  }

  screenToWorld(screen: Point): Point {
    return {
      x: (screen.x - this.x) / this.z,
      y: (screen.y - this.y) / this.z,
    };
  }

  worldToScreen(world: Point): Point {
    return {
      x: world.x * this.z + this.x,
      y: world.y * this.z + this.y,
    };
  }

  toCSSTransform(): string {
    return `translate3d(${this.x}px, ${this.y}px, 0) scale(${this.z})`;
  }

  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  private notifyChange(): void {
    this.changeListeners.forEach((fn) => fn());
  }
}
