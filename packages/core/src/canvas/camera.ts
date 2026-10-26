import { EventBus } from '../core/event-bus';
import type { Bounds, Point } from '../core/types';

export interface CameraOptions {
  minZoom?: number;
  maxZoom?: number;
}

export interface CameraChangeInfo {
  panned: boolean;
  zoomed: boolean;
}

export interface CameraConstraintState {
  readonly position: Point;
  readonly zoom: number;
}

export type CameraConstraint = (
  next: CameraConstraintState,
  previous: CameraConstraintState,
) => CameraConstraintState;

interface ConstraintEntry {
  constraint: CameraConstraint;
}

const DEFAULT_MIN_ZOOM = 0.1;
const DEFAULT_MAX_ZOOM = 10;

export class Camera {
  private x = 0;
  private y = 0;
  private z = 1;
  private readonly minZoom: number;
  private readonly maxZoom: number;
  private readonly bus = new EventBus<{ change: CameraChangeInfo }>();
  private constraints: ConstraintEntry[] = [];

  constructor(options: CameraOptions = {}) {
    this.minZoom = options.minZoom ?? DEFAULT_MIN_ZOOM;
    this.maxZoom = options.maxZoom ?? DEFAULT_MAX_ZOOM;
    if (
      !Number.isFinite(this.minZoom) ||
      !Number.isFinite(this.maxZoom) ||
      this.minZoom <= 0 ||
      this.maxZoom <= 0 ||
      this.minZoom > this.maxZoom
    ) {
      throw new Error('[fieldnotes] Camera zoom bounds must be finite, positive, and ordered');
    }
    this.z = this.clampZoom(this.z);
  }

  get position(): Point {
    return { x: this.x, y: this.y };
  }

  get zoom(): number {
    return this.z;
  }

  pan(dx: number, dy: number): void {
    this.commit({ position: { x: this.x + dx, y: this.y + dy }, zoom: this.z });
  }

  moveTo(x: number, y: number): void {
    this.commit({ position: { x, y }, zoom: this.z });
  }

  setZoom(level: number): void {
    this.commit({ position: this.position, zoom: this.clampZoom(level) });
  }

  zoomAt(level: number, screenPoint: Point): void {
    const before = this.screenToWorld(screenPoint);
    const zoom = this.clampZoom(level);
    const after = {
      x: (screenPoint.x - this.x) / zoom,
      y: (screenPoint.y - this.y) / zoom,
    };
    this.commit({
      position: {
        x: this.x + (after.x - before.x) * zoom,
        y: this.y + (after.y - before.y) * zoom,
      },
      zoom,
    });
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

  getVisibleRect(canvasWidth: number, canvasHeight: number): Bounds {
    const topLeft = this.screenToWorld({ x: 0, y: 0 });
    const bottomRight = this.screenToWorld({ x: canvasWidth, y: canvasHeight });
    return {
      x: topLeft.x,
      y: topLeft.y,
      w: bottomRight.x - topLeft.x,
      h: bottomRight.y - topLeft.y,
    };
  }

  fitToContent(boundingBox: Bounds, canvasWidth: number, canvasHeight: number, padding = 40): void {
    if (boundingBox.w === 0 && boundingBox.h === 0) return;

    const scaleX = canvasWidth / (boundingBox.w + 2 * padding);
    const scaleY = canvasHeight / (boundingBox.h + 2 * padding);
    const zoom = this.clampZoom(Math.min(scaleX, scaleY));
    this.commit({
      position: {
        x: (canvasWidth - boundingBox.w * zoom) / 2 - boundingBox.x * zoom,
        y: (canvasHeight - boundingBox.h * zoom) / 2 - boundingBox.y * zoom,
      },
      zoom,
    });
  }

  toCSSTransform(): string {
    return `translate3d(${this.x}px, ${this.y}px, 0) scale(${this.z})`;
  }

  onChange(listener: (info: CameraChangeInfo) => void): () => void {
    return this.bus.on('change', (info) => listener(info));
  }

  addConstraint(constraint: CameraConstraint): () => void {
    const entry = { constraint };
    this.constraints.push(entry);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const index = this.constraints.indexOf(entry);
      if (index !== -1) this.constraints.splice(index, 1);
    };
  }

  suspendNotifications(): { resume(): void; discard(): void } {
    return this.bus.suspendNotifications(() => ({
      event: 'change',
      data: { panned: true, zoomed: true },
    }));
  }

  private clampZoom(zoom: number): number {
    return Math.min(this.maxZoom, Math.max(this.minZoom, zoom));
  }

  private copyState(state: CameraConstraintState): CameraConstraintState {
    const { x, y } = state.position;
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(state.zoom) ||
      state.zoom <= 0
    ) {
      throw new Error('[fieldnotes] Camera state requires finite position and positive zoom');
    }
    return { position: { x, y }, zoom: state.zoom };
  }

  private commit(candidate: CameraConstraintState): void {
    let next = this.copyState({ ...candidate, zoom: this.clampZoom(candidate.zoom) });
    const previous = this.copyState({ position: { x: this.x, y: this.y }, zoom: this.z });
    for (const { constraint } of [...this.constraints]) {
      next = this.copyState(constraint(this.copyState(next), this.copyState(previous)));
    }
    next = { ...next, zoom: this.clampZoom(next.zoom) };
    if (next.position.x === this.x && next.position.y === this.y && next.zoom === this.z) return;
    const panned = next.position.x !== this.x || next.position.y !== this.y;
    const zoomed = next.zoom !== this.z;
    this.x = next.position.x;
    this.y = next.position.y;
    this.z = next.zoom;
    this.bus.emit('change', { panned, zoomed });
  }
}
