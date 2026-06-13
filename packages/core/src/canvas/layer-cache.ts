import type { MarginViewport } from './margin-viewport';

function createOffscreenCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export class LayerCache {
  private canvases = new Map<string, HTMLCanvasElement | OffscreenCanvas>();
  private dirtyFlags = new Map<string, boolean>();

  constructor(private readonly viewport: MarginViewport) {}

  isDirty(layerId: string): boolean {
    return this.dirtyFlags.get(layerId) !== false;
  }

  markDirty(layerId: string): void {
    this.dirtyFlags.set(layerId, true);
  }

  markClean(layerId: string): void {
    this.dirtyFlags.set(layerId, false);
  }

  markAllDirty(): void {
    for (const [id] of this.dirtyFlags) {
      this.dirtyFlags.set(id, true);
    }
  }

  getCanvas(layerId: string): HTMLCanvasElement | OffscreenCanvas {
    let canvas = this.canvases.get(layerId);
    if (!canvas) {
      canvas = createOffscreenCanvas(this.viewport.physicalWidth(), this.viewport.physicalHeight());
      this.canvases.set(layerId, canvas);
      this.dirtyFlags.set(layerId, true);
    }
    return canvas;
  }

  getContext(layerId: string): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null {
    const canvas = this.getCanvas(layerId);
    return canvas.getContext('2d') as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
  }

  resize(): void {
    const w = this.viewport.physicalWidth();
    const h = this.viewport.physicalHeight();
    for (const [id, canvas] of this.canvases) {
      canvas.width = w;
      canvas.height = h;
      this.dirtyFlags.set(id, true);
    }
  }

  clear(): void {
    this.canvases.clear();
    this.dirtyFlags.clear();
  }
}
