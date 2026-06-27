import type { Bounds, Point } from '../core/types';
import type { CanvasElement } from '../elements/types';
import { getElementBounds } from '../elements/element-bounds';
import {
  computeMinimapTransform,
  miniToWorld,
  unionBounds,
  worldToMini,
  type MinimapTransform,
} from './minimap-transform';

export interface MinimapDeps {
  container: HTMLElement;
  getElements: () => CanvasElement[];
  getContentBounds: () => Bounds | null;
  getViewportRect: () => Bounds;
  navigateTo: (worldCenter: Point) => void;
  requestFrame: (cb: () => void) => number;
  cancelFrame: (id: number) => void;
}

const WIDTH = 200;
const HEIGHT = 140;
const MARGIN = 16;
const PADDING = 8;
const NEUTRAL = 'rgba(100,116,139,0.6)';
const VIEWPORT_STROKE = '#3b82f6';

function elementColor(el: CanvasElement): string {
  return 'color' in el && typeof el.color === 'string' ? el.color : NEUTRAL;
}

export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private rafId: number | null = null;
  private dragging = false;

  constructor(private readonly deps: MinimapDeps) {
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    Object.assign(canvas.style, {
      position: 'absolute',
      right: `${MARGIN}px`,
      bottom: `${MARGIN}px`,
      width: `${WIDTH}px`,
      height: `${HEIGHT}px`,
      background: 'rgba(255,255,255,0.85)',
      border: '1px solid rgba(0,0,0,0.15)',
      borderRadius: '4px',
      touchAction: 'none',
      cursor: 'pointer',
      zIndex: '10',
    });
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    this.deps.container.appendChild(canvas);
    this.canvas = canvas;
  }

  scheduleDraw(): void {
    if (this.rafId !== null) return;
    this.rafId = this.deps.requestFrame(this.draw);
  }

  destroy(): void {
    if (this.rafId !== null) {
      this.deps.cancelFrame(this.rafId);
      this.rafId = null;
    }
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.remove();
  }

  private currentTransform(): MinimapTransform {
    const viewport = this.deps.getViewportRect();
    const content = this.deps.getContentBounds();
    const mapping = content ? unionBounds(content, viewport) : viewport;
    return computeMinimapTransform(mapping, WIDTH, HEIGHT, PADDING);
  }

  private draw = (): void => {
    this.rafId = null;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const t = this.currentTransform();
    const viewport = this.deps.getViewportRect();
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    for (const el of this.deps.getElements()) {
      const b = getElementBounds(el);
      if (!b) continue;
      const tl = worldToMini(t, { x: b.x, y: b.y });
      ctx.fillStyle = elementColor(el);
      ctx.fillRect(tl.x, tl.y, Math.max(1, b.w * t.scale), Math.max(1, b.h * t.scale));
    }
    const vtl = worldToMini(t, { x: viewport.x, y: viewport.y });
    ctx.strokeStyle = VIEWPORT_STROKE;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(vtl.x, vtl.y, viewport.w * t.scale, viewport.h * t.scale);
  };

  private navigateFromEvent(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const world = miniToWorld(this.currentTransform(), point);
    this.deps.navigateTo(world);
  }

  private onPointerDown = (e: PointerEvent): void => {
    e.stopPropagation();
    e.preventDefault();
    this.dragging = true;
    this.canvas.setPointerCapture?.(e.pointerId);
    this.navigateFromEvent(e);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.dragging) return;
    e.stopPropagation();
    this.navigateFromEvent(e);
  };

  private onPointerUp = (e: PointerEvent): void => {
    this.dragging = false;
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      // already released
    }
  };
}
