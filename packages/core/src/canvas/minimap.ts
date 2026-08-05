import type { Viewport } from './viewport';
import { MinimapController } from './minimap-controller';

const WIDTH = 200;
const HEIGHT = 140;
const MARGIN = 16;

/**
 * Built-in bottom-right minimap for `ViewportOptions.minimap: true`. Thin DOM
 * wrapper over `MinimapController`, which owns rendering, invalidation, and
 * tap/drag navigation.
 */
export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly controller: MinimapController;

  constructor(container: HTMLElement, viewport: Viewport) {
    const canvas = document.createElement('canvas');
    Object.assign(canvas.style, {
      position: 'absolute',
      right: `${MARGIN}px`,
      bottom: `${MARGIN}px`,
      width: `${WIDTH}px`,
      height: `${HEIGHT}px`,
      background: 'rgba(255,255,255,0.85)',
      border: '1px solid rgba(0,0,0,0.15)',
      borderRadius: '4px',
      zIndex: '10',
    });
    container.appendChild(canvas);
    this.canvas = canvas;
    this.controller = new MinimapController(viewport, canvas, { width: WIDTH, height: HEIGHT });
  }

  scheduleDraw(): void {
    this.controller.requestDraw();
  }

  destroy(): void {
    this.controller.dispose();
    this.canvas.remove();
  }
}
