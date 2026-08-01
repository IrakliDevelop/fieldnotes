import type { CanvasElement, GridElement } from '../elements/types';
import type { ElementStore } from '../elements/element-store';
import { ElementRenderer } from '../elements/element-renderer';
import { getArrowBounds } from '../elements/arrow-geometry';
import { getElementBounds } from '../elements/element-bounds';
import { renderSquareGrid, renderHexGrid } from '../elements/grid-renderer';
import { withRotation } from '../elements/rotate-canvas';
import { rotatedAABB } from '../core/geometry';
import type { LayerManager } from '../layers/layer-manager';
import { renderNoteOnCanvas } from './note-canvas-renderer';
import { renderTextOnCanvas } from './text-canvas-renderer';

export interface ExportImageOptions extends ExportResourceOptions {
  scale?: number;
  padding?: number;
  background?: string;
  filter?: (element: CanvasElement) => boolean;
}

export type ExportAssetErrorReason = 'load' | 'timeout' | 'encode';

export interface ExportAssetError {
  elementId: string;
  src: string;
  reason: ExportAssetErrorReason;
  cause?: unknown;
}

export interface ExportResourceOptions {
  /** Maximum wait for each image asset. Defaults to 10 seconds. */
  imageTimeoutMs?: number;
  /** Maximum width or height of any allocated export canvas. Defaults to 16,384. */
  maxDimension?: number;
  /** Maximum pixel count of any allocated export canvas. Defaults to 67,108,864. */
  maxPixels?: number;
  /** Called when an image cannot be loaded or embedded. The export continues. */
  onAssetError?: (error: ExportAssetError) => void;
}

const DEFAULT_IMAGE_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_DIMENSION = 16_384;
const DEFAULT_MAX_PIXELS = 67_108_864;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const center = (b: Rect): { x: number; y: number } => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

function getStrokeBounds(el: CanvasElement): Rect | null {
  if (el.type !== 'stroke') return null;
  if (el.points.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const p of el.points) {
    const px = el.position.x + p.x;
    const py = el.position.y + p.y;
    minX = Math.min(minX, px);
    minY = Math.min(minY, py);
    maxX = Math.max(maxX, px);
    maxY = Math.max(maxY, py);
  }

  const pad = el.width / 2;
  return {
    x: minX - pad,
    y: minY - pad,
    w: maxX - minX + el.width,
    h: maxY - minY + el.width,
  };
}

function getElementRect(el: CanvasElement): Rect | null {
  switch (el.type) {
    case 'stroke': {
      const r = getStrokeBounds(el);
      return r ? rotatedAABB(r, el.rotation ?? 0) : r;
    }
    case 'arrow': {
      const b = getArrowBounds(el.from, el.to, el.bend);
      const pad = el.width / 2 + 14;
      return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
    }
    case 'grid':
      return null;
    case 'template': {
      const bounds = getElementBounds(el);
      if (!bounds) return null;
      return bounds;
    }
    case 'note':
    case 'image':
    case 'html':
    case 'text':
    case 'shape':
      if ('size' in el) {
        return rotatedAABB(
          { x: el.position.x, y: el.position.y, w: el.size.w, h: el.size.h },
          el.rotation ?? 0,
        );
      }
      return null;
    default:
      return null;
  }
}

function computeBounds(
  elements: CanvasElement[],
  padding: number,
): { x: number; y: number; w: number; h: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let found = false;

  for (const el of elements) {
    const rect = getElementRect(el);
    if (!rect) continue;
    found = true;
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.w);
    maxY = Math.max(maxY, rect.y + rect.h);
  }

  if (!found) return null;

  return {
    x: minX - padding,
    y: minY - padding,
    w: maxX - minX + padding * 2,
    h: maxY - minY + padding * 2,
  };
}

function renderGridForBounds(
  ctx: CanvasRenderingContext2D,
  grid: GridElement,
  bounds: { x: number; y: number; w: number; h: number },
): void {
  const visibleBounds = {
    minX: bounds.x,
    minY: bounds.y,
    maxX: bounds.x + bounds.w,
    maxY: bounds.y + bounds.h,
  };

  if (grid.gridType === 'hex') {
    renderHexGrid(
      ctx,
      visibleBounds,
      grid.cellSize,
      grid.hexOrientation,
      grid.strokeColor,
      grid.strokeWidth,
      grid.opacity,
    );
  } else {
    renderSquareGrid(
      ctx,
      visibleBounds,
      grid.cellSize,
      grid.strokeColor,
      grid.strokeWidth,
      grid.opacity,
    );
  }
}

function positiveOption(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved <= 0) {
    throw new RangeError(`${name} must be a finite number greater than 0`);
  }
  return resolved;
}

function nonNegativeOption(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved < 0) {
    throw new RangeError(`${name} must be a finite number greater than or equal to 0`);
  }
  return resolved;
}

function assertExportSize(
  width: number,
  height: number,
  options: Pick<ExportResourceOptions, 'maxDimension' | 'maxPixels'>,
): void {
  const maxDimension = positiveOption(options.maxDimension, DEFAULT_MAX_DIMENSION, 'maxDimension');
  const maxPixels = positiveOption(options.maxPixels, DEFAULT_MAX_PIXELS, 'maxPixels');
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new RangeError('Export dimensions must be finite numbers greater than 0');
  }
  if (width > maxDimension || height > maxDimension) {
    throw new RangeError(
      `Export dimensions ${width}x${height} exceed the maximum dimension of ${maxDimension}`,
    );
  }
  if (width * height > maxPixels) {
    throw new RangeError(
      `Export size ${width}x${height} exceeds the maximum of ${maxPixels} pixels`,
    );
  }
}

function validateExportResourceOptions(options: ExportResourceOptions): void {
  positiveOption(options.imageTimeoutMs, DEFAULT_IMAGE_TIMEOUT_MS, 'imageTimeoutMs');
  positiveOption(options.maxDimension, DEFAULT_MAX_DIMENSION, 'maxDimension');
  positiveOption(options.maxPixels, DEFAULT_MAX_PIXELS, 'maxPixels');
}

function loadImages(
  elements: CanvasElement[],
  options: Pick<ExportResourceOptions, 'imageTimeoutMs' | 'onAssetError'> = {},
): Promise<Map<string, HTMLImageElement>> {
  const imageElements = elements.filter(
    (el): el is CanvasElement & { src: string } => el.type === 'image' && 'src' in el,
  );

  const cache = new Map<string, HTMLImageElement>();
  if (imageElements.length === 0) return Promise.resolve(cache);

  const timeoutMs = positiveOption(
    options.imageTimeoutMs,
    DEFAULT_IMAGE_TIMEOUT_MS,
    'imageTimeoutMs',
  );

  return new Promise((resolve) => {
    let remaining = imageElements.length;
    const done = () => {
      remaining--;
      if (remaining <= 0) resolve(cache);
    };

    for (const el of imageElements) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        img.onload = null;
        img.onerror = null;
        options.onAssetError?.({ elementId: el.id, src: el.src, reason: 'timeout' });
        done();
      }, timeoutMs);
      const settle = (): boolean => {
        if (settled) return false;
        settled = true;
        clearTimeout(timer);
        img.onload = null;
        img.onerror = null;
        return true;
      };
      img.onload = () => {
        if (!settle()) return;
        cache.set(el.id, img);
        done();
      };
      img.onerror = (cause) => {
        if (!settle()) return;
        options.onAssetError?.({ elementId: el.id, src: el.src, reason: 'load', cause });
        done();
      };
      img.src = el.src;
    }
  });
}

export async function exportImage(
  store: ElementStore,
  options: ExportImageOptions = {},
  layerManager?: LayerManager,
): Promise<Blob | null> {
  const scale = positiveOption(options.scale, 2, 'scale');
  const padding = nonNegativeOption(options.padding, 0, 'padding');
  validateExportResourceOptions(options);
  const background = options.background ?? '#ffffff';
  const filter = options.filter;

  const allElements = store.getAll();
  let visibleElements = layerManager
    ? allElements.filter((el) => layerManager.isLayerVisible(el.layerId))
    : allElements;

  if (filter) {
    visibleElements = visibleElements.filter(filter);
  }

  const bounds = computeBounds(visibleElements, padding);
  if (!bounds) return null;

  const width = Math.ceil(bounds.w * scale);
  const height = Math.ceil(bounds.h * scale);
  assertExportSize(width, height, options);
  const imageCache = await loadImages(visibleElements, options);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.scale(scale, scale);
  ctx.translate(-bounds.x, -bounds.y);

  ctx.fillStyle = background;
  ctx.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);

  const renderer = new ElementRenderer();
  renderer.setStore(store);

  const grids: GridElement[] = [];
  const renderElement = (target: CanvasRenderingContext2D, el: CanvasElement): void => {
    if (el.type === 'note') {
      const b = getElementBounds(el);
      withRotation(target, el, b ? center(b) : el.position, () => renderNoteOnCanvas(target, el));
      return;
    }

    if (el.type === 'text') {
      const b = getElementBounds(el);
      withRotation(target, el, b ? center(b) : el.position, () => renderTextOnCanvas(target, el));
      return;
    }

    if (el.type === 'html') {
      return;
    }

    if (el.type === 'image') {
      const img = imageCache.get(el.id);
      if (img) {
        const b = getElementBounds(el);
        withRotation(target, el, b ? center(b) : el.position, () =>
          target.drawImage(img, el.position.x, el.position.y, el.size.w, el.size.h),
        );
      }
      return;
    }

    renderer.renderCanvasElement(target, el);
  };

  const layerGroups = new Map<string, CanvasElement[]>();
  for (const el of visibleElements) {
    if (el.type === 'grid') {
      grids.push(el);
      continue;
    }
    const group = layerGroups.get(el.layerId) ?? [];
    group.push(el);
    layerGroups.set(el.layerId, group);
  }

  for (const [layerId, elements] of layerGroups) {
    const opacity = layerManager?.getLayer?.(layerId)?.opacity ?? 1;
    if (opacity === 1) {
      for (const el of elements) renderElement(ctx, el);
      continue;
    }

    const layerCanvas = document.createElement('canvas');
    layerCanvas.width = canvas.width;
    layerCanvas.height = canvas.height;
    const layerCtx = layerCanvas.getContext('2d');
    if (!layerCtx) continue;
    layerCtx.scale(scale, scale);
    layerCtx.translate(-bounds.x, -bounds.y);
    for (const el of elements) renderElement(layerCtx, el);

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = opacity;
    ctx.drawImage(layerCanvas, 0, 0);
    ctx.restore();
  }

  for (const grid of grids) {
    ctx.save();
    ctx.globalAlpha = layerManager?.getLayer?.(grid.layerId)?.opacity ?? 1;
    renderGridForBounds(ctx, grid, bounds);
    ctx.restore();
  }

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}

export {
  assertExportSize,
  computeBounds,
  getElementRect,
  loadImages,
  nonNegativeOption,
  positiveOption,
  validateExportResourceOptions,
};
