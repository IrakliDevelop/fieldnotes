import type { CanvasElement, GridElement } from './types';
import { getElementBounds } from './element-bounds';
import { withRotation } from './rotate-canvas';
import { renderStroke } from './renderers/stroke-renderer';
import { renderShape } from './renderers/shape-renderer';
import { renderArrow } from './renderers/arrow-renderer';
import { renderImage } from './renderers/image-renderer';
import { renderTemplate } from './renderers/template-renderer';
import type { ElementStore } from './element-store';
import {
  renderSquareGrid,
  renderHexGrid,
  createHexGridTile,
  renderHexGridTiled,
} from './grid-renderer';
import type { HexGridTile } from './grid-renderer';
import type { HexOrientation } from './types';
import type { Camera } from '../canvas/camera';

const DOM_ELEMENT_TYPES = new Set(['note', 'html', 'text']);

export class ElementRenderer {
  private store: ElementStore | null = null;
  private imageCache = new Map<string, ImageBitmap | HTMLImageElement | 'failed'>();
  private onImageLoad: (() => void) | null = null;
  private onImageError: ((src: string, cause?: unknown) => void) | null = null;
  private camera: Camera | null = null;
  private canvasSize: { w: number; h: number } | null = null;
  private hexTileCache: HexGridTile | null = null;
  private hexTileCacheKey = '';
  private gridBoundsOverride: { minX: number; minY: number; maxX: number; maxY: number } | null =
    null;
  private labelEditingId: string | null = null;

  setStore(store: ElementStore): void {
    this.store = store;
  }

  setOnImageLoad(callback: () => void): void {
    this.onImageLoad = callback;
  }

  setOnImageError(callback: (src: string, cause?: unknown) => void): void {
    this.onImageError = callback;
  }

  setCamera(camera: Camera): void {
    this.camera = camera;
  }

  setCanvasSize(w: number, h: number): void {
    this.canvasSize = { w, h };
  }

  setGridBoundsOverride(
    bounds: { minX: number; minY: number; maxX: number; maxY: number } | null,
  ): void {
    this.gridBoundsOverride = bounds;
  }

  setLabelEditingId(id: string | null): void {
    this.labelEditingId = id;
  }

  isDomElement(element: CanvasElement): boolean {
    return DOM_ELEMENT_TYPES.has(element.type);
  }

  renderCanvasElement(ctx: CanvasRenderingContext2D, element: CanvasElement): void {
    switch (element.type) {
      case 'stroke': {
        const b = getElementBounds(element);
        const c = b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : element.position;
        withRotation(ctx, element, c, () => renderStroke(ctx, element));
        break;
      }
      case 'arrow':
        renderArrow(ctx, element, this.store, this.labelEditingId);
        break;
      case 'shape': {
        const b = getElementBounds(element);
        const c = b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : element.position;
        withRotation(ctx, element, c, () => renderShape(ctx, element));
        break;
      }
      case 'image': {
        const b = getElementBounds(element);
        const c = b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : element.position;
        withRotation(ctx, element, c, () =>
          renderImage(ctx, element, this.imageCache, this.onImageLoad, this.onImageError),
        );
        break;
      }
      case 'grid':
        this.renderGrid(ctx, element);
        break;
      case 'template':
        renderTemplate(ctx, element, this.store);
        break;
    }
  }

  private renderGrid(ctx: CanvasRenderingContext2D, grid: GridElement): void {
    const canvasSize = this.canvasSize;
    if (!canvasSize) return;

    const cam = this.camera;
    if (!cam) return;

    const bounds =
      this.gridBoundsOverride ??
      (() => {
        const topLeft = cam.screenToWorld({ x: 0, y: 0 });
        const bottomRight = cam.screenToWorld({ x: canvasSize.w, y: canvasSize.h });
        return {
          minX: topLeft.x,
          minY: topLeft.y,
          maxX: bottomRight.x,
          maxY: bottomRight.y,
        };
      })();

    if (grid.gridType === 'hex') {
      const dpr = typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1;
      const scale = cam.zoom * dpr;
      const tile = this.getHexTile(
        grid.cellSize,
        grid.hexOrientation,
        grid.strokeColor,
        grid.strokeWidth,
        grid.opacity,
        scale,
      );
      if (tile) {
        renderHexGridTiled(ctx, bounds, grid.cellSize, tile);
      } else {
        renderHexGrid(
          ctx,
          bounds,
          grid.cellSize,
          grid.hexOrientation,
          grid.strokeColor,
          grid.strokeWidth,
          grid.opacity,
        );
      }
    } else {
      renderSquareGrid(
        ctx,
        bounds,
        grid.cellSize,
        grid.strokeColor,
        grid.strokeWidth,
        grid.opacity,
      );
    }
  }

  private getHexTile(
    cellSize: number,
    orientation: HexOrientation,
    strokeColor: string,
    strokeWidth: number,
    opacity: number,
    scale: number,
  ): HexGridTile | null {
    const key = `${cellSize}:${orientation}:${strokeColor}:${strokeWidth}:${opacity}:${scale}`;
    if (this.hexTileCacheKey === key && this.hexTileCache) {
      return this.hexTileCache;
    }
    const tile = createHexGridTile(cellSize, orientation, strokeColor, strokeWidth, opacity, scale);
    if (tile) {
      this.hexTileCache = tile;
      this.hexTileCacheKey = key;
    }
    return tile;
  }
}
