import type { MarginViewport } from './margin-viewport';

/** `base` caches a whole layer; `under`/`over` cache the parts below and above its live elements. */
export type LayerCachePart = 'base' | 'under' | 'over';

interface Entry {
  canvas?: HTMLCanvasElement | OffscreenCanvas;
  dirty: boolean;
}

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
  private canvases = new Map<string, Map<LayerCachePart, Entry>>();

  constructor(private readonly viewport: MarginViewport) {}

  isDirty(layerId: string, part: LayerCachePart = 'base'): boolean {
    return this.canvases.get(layerId)?.get(part)?.dirty !== false;
  }

  markDirty(layerId: string): void {
    const parts = this.canvases.get(layerId);
    if (!parts) return;
    for (const entry of parts.values()) entry.dirty = true;
  }

  markClean(layerId: string, part: LayerCachePart = 'base'): void {
    const parts = this.partsOf(layerId);
    const entry = parts.get(part);
    if (entry) entry.dirty = false;
    else parts.set(part, { dirty: false });
    // A whole-layer raster supersedes the split parts; free them so memory does not stay doubled.
    if (part === 'base') {
      parts.delete('under');
      parts.delete('over');
    }
  }

  markAllDirty(): void {
    for (const id of this.canvases.keys()) this.markDirty(id);
  }

  getCanvas(layerId: string, part: LayerCachePart = 'base'): HTMLCanvasElement | OffscreenCanvas {
    const parts = this.partsOf(layerId);
    const entry = parts.get(part);
    if (entry?.canvas) return entry.canvas;
    const canvas = createOffscreenCanvas(
      this.viewport.physicalWidth(),
      this.viewport.physicalHeight(),
    );
    parts.set(part, { canvas, dirty: true });
    return canvas;
  }

  getContext(
    layerId: string,
    part: LayerCachePart = 'base',
  ): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null {
    const canvas = this.getCanvas(layerId, part);
    return canvas.getContext('2d') as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
  }

  resize(): void {
    const w = this.viewport.physicalWidth();
    const h = this.viewport.physicalHeight();
    for (const parts of this.canvases.values()) {
      for (const entry of parts.values()) {
        if (!entry.canvas) continue;
        entry.canvas.width = w;
        entry.canvas.height = h;
        entry.dirty = true;
      }
    }
  }

  retain(keep: (layerId: string) => boolean): void {
    for (const id of this.canvases.keys()) {
      if (!keep(id)) this.canvases.delete(id);
    }
  }

  clear(): void {
    this.canvases.clear();
  }

  private partsOf(layerId: string): Map<LayerCachePart, Entry> {
    let parts = this.canvases.get(layerId);
    if (!parts) {
      parts = new Map();
      this.canvases.set(layerId, parts);
    }
    return parts;
  }
}
