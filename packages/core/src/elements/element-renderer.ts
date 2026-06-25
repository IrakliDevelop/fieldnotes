import type { CanvasElement, ImageElement, GridElement, TemplateElement } from './types';
import { getElementBounds } from './element-bounds';
import { withRotation } from './rotate-canvas';
import { renderStroke } from './renderers/stroke-renderer';
import { renderShape } from './renderers/shape-renderer';
import { renderArrow } from './renderers/arrow-renderer';
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
import {
  getHexCellsInRadius,
  getHexCellsInCone,
  getHexCellsInLine,
  getHexCellsInSquare,
  drawHexPath,
} from './hex-fill';

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
        withRotation(ctx, element, c, () => this.renderImage(ctx, element));
        break;
      }
      case 'grid':
        this.renderGrid(ctx, element);
        break;
      case 'template':
        this.renderTemplate(ctx, element);
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

  private renderTemplate(ctx: CanvasRenderingContext2D, template: TemplateElement): void {
    const grid = this.store?.getElementsByType('grid')[0];
    if (grid && grid.gridType === 'hex') {
      this.renderHexTemplate(ctx, template, grid.cellSize, grid.hexOrientation);
      return;
    }

    this.renderGeometricTemplate(ctx, template);
  }

  private renderGeometricTemplate(ctx: CanvasRenderingContext2D, template: TemplateElement): void {
    const { x: cx, y: cy } = template.position;
    const r = template.radius;

    ctx.save();
    ctx.globalAlpha = template.opacity;
    ctx.fillStyle = template.fillColor;
    ctx.strokeStyle = template.strokeColor;
    ctx.lineWidth = template.strokeWidth;

    switch (template.templateShape) {
      case 'circle':
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        if (template.radiusFeet != null && template.radiusFeet > 0) {
          this.renderRadiusMarker(ctx, cx, cy, r, template.radiusFeet);
        }
        break;

      case 'square':
        ctx.fillRect(cx - r / 2, cy - r / 2, r, r);
        ctx.strokeRect(cx - r / 2, cy - r / 2, r, r);
        break;

      case 'cone': {
        const halfAngle = Math.atan(0.5);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, template.angle - halfAngle, template.angle + halfAngle);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
      }

      case 'line': {
        const halfW = r / 12;
        const cos = Math.cos(template.angle);
        const sin = Math.sin(template.angle);
        const perpX = -sin * halfW;
        const perpY = cos * halfW;

        ctx.beginPath();
        ctx.moveTo(cx + perpX, cy + perpY);
        ctx.lineTo(cx + r * cos + perpX, cy + r * sin + perpY);
        ctx.lineTo(cx + r * cos - perpX, cy + r * sin - perpY);
        ctx.lineTo(cx - perpX, cy - perpY);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
      }
    }

    ctx.restore();
  }

  private renderHexTemplate(
    ctx: CanvasRenderingContext2D,
    template: TemplateElement,
    cellSize: number,
    orientation: HexOrientation,
  ): void {
    const snapUnit = Math.sqrt(3) * cellSize;
    const radiusCells = template.radius / snapUnit;
    const center = template.position;

    let cells: { x: number; y: number }[];
    switch (template.templateShape) {
      case 'circle':
        cells = getHexCellsInRadius(center, radiusCells, cellSize, orientation);
        break;
      case 'cone':
        cells = getHexCellsInCone(center, template.angle, radiusCells, cellSize, orientation);
        break;
      case 'line':
        cells = getHexCellsInLine(center, template.angle, radiusCells, cellSize, orientation);
        break;
      case 'square':
        cells = getHexCellsInSquare(center, radiusCells, cellSize, orientation);
        break;
    }

    ctx.save();
    ctx.globalAlpha = template.opacity;

    ctx.beginPath();
    for (const cell of cells) {
      drawHexPath(ctx, cell.x, cell.y, cellSize, orientation);
    }
    ctx.fillStyle = template.fillColor;
    ctx.fill();

    ctx.beginPath();
    for (const cell of cells) {
      drawHexPath(ctx, cell.x, cell.y, cellSize, orientation);
    }
    ctx.strokeStyle = template.strokeColor;
    ctx.lineWidth = template.strokeWidth;
    ctx.stroke();

    {
      ctx.globalAlpha = Math.min(template.opacity + 0.1, 1);
      ctx.beginPath();
      drawHexPath(ctx, center.x, center.y, cellSize, orientation);
      ctx.fillStyle = template.strokeColor;
      ctx.fill();
      ctx.strokeStyle = template.strokeColor;
      ctx.lineWidth = template.strokeWidth;
      ctx.stroke();
    }

    if (
      template.templateShape === 'circle' &&
      template.radiusFeet != null &&
      template.radiusFeet > 0
    ) {
      const r = template.radius;
      this.renderRadiusMarker(ctx, center.x, center.y, r, template.radiusFeet);
    }

    ctx.restore();
  }

  private renderRadiusMarker(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
    feet: number,
  ): void {
    const markerColor = ctx.strokeStyle as string;

    ctx.save();
    ctx.globalAlpha = 1;

    ctx.beginPath();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = markerColor;
    ctx.lineWidth = 1.5;
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + r, cy);
    ctx.stroke();
    ctx.setLineDash([]);

    const label = `${Math.round(feet)} ft`;
    const fontSize = Math.max(10, Math.min(14, r * 0.15));
    ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const textX = cx + r / 2;
    const textY = cy - 4;

    const metrics = ctx.measureText(label);
    const padX = 4;
    const padY = 2;
    const textW = metrics.width + padX * 2;
    const textH = fontSize + padY * 2;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.beginPath();
    ctx.roundRect(textX - textW / 2, textY - textH, textW, textH, 3);
    ctx.fill();

    ctx.fillStyle = markerColor;
    ctx.fillText(label, textX, textY - padY);

    ctx.restore();
  }

  private renderImage(ctx: CanvasRenderingContext2D, image: ImageElement): void {
    if (this.imageCache.get(image.src) === 'failed') {
      this.renderImagePlaceholder(ctx, image);
      return;
    }
    const img = this.getImage(image.src);
    if (!img) return;
    ctx.drawImage(
      img as CanvasImageSource,
      image.position.x,
      image.position.y,
      image.size.w,
      image.size.h,
    );
  }

  private renderImagePlaceholder(ctx: CanvasRenderingContext2D, image: ImageElement): void {
    const { x, y } = image.position;
    const { w, h } = image.size;
    ctx.save();
    ctx.fillStyle = '#eeeeee';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#bdbdbd';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);

    const glyph = Math.min(24, w / 2, h / 2);
    const cx = x + w / 2;
    const cy = y + h / 2;
    ctx.strokeStyle = '#9e9e9e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, glyph / 2, 0, Math.PI * 2);
    ctx.moveTo(cx - glyph / 2, cy + glyph / 2);
    ctx.lineTo(cx + glyph / 2, cy - glyph / 2);
    ctx.stroke();
    ctx.restore();
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

  private getImage(src: string): ImageBitmap | HTMLImageElement | null {
    const cached = this.imageCache.get(src);
    if (cached) {
      if (cached === 'failed') return null;
      if (cached instanceof HTMLImageElement) return cached.complete ? cached : null;
      return cached;
    }

    const img = new Image();
    img.src = src;
    this.imageCache.set(src, img);
    img.onload = () => {
      this.onImageLoad?.();
      // Decode from already-loaded image in memory, not a re-fetch
      if (typeof createImageBitmap !== 'undefined') {
        createImageBitmap(img)
          .then((bitmap) => {
            this.imageCache.set(src, bitmap);
            this.onImageLoad?.();
          })
          .catch(() => {
            /* keep HTMLImageElement fallback — handles CORS rejection */
          });
      }
    };
    img.onerror = (event) => {
      // failed srcs stay failed for the session; pointing the element at a new src loads fresh
      this.imageCache.set(src, 'failed');
      this.onImageError?.(src, event);
      this.onImageLoad?.();
    };
    return null;
  }
}
