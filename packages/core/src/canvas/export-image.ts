import type { CanvasElement, NoteElement, TextElement, GridElement } from '../elements/types';
import type { ElementStore } from '../elements/element-store';
import { ElementRenderer } from '../elements/element-renderer';
import { getArrowBounds } from '../elements/arrow-geometry';
import { renderSquareGrid, renderHexGrid } from '../elements/grid-renderer';
import type { LayerManager } from '../layers/layer-manager';

export interface ExportImageOptions {
  scale?: number;
  padding?: number;
  background?: string;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

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
    case 'stroke':
      return getStrokeBounds(el);
    case 'arrow': {
      const b = getArrowBounds(el.from, el.to, el.bend);
      const pad = el.width / 2 + 14;
      return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
    }
    case 'grid':
      return null;
    case 'note':
    case 'image':
    case 'html':
    case 'text':
    case 'shape':
      if ('size' in el) {
        return { x: el.position.x, y: el.position.y, w: el.size.w, h: el.size.h };
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

function renderNoteOnCanvas(ctx: CanvasRenderingContext2D, note: NoteElement): void {
  const { x, y } = note.position;
  const { w, h } = note.size;
  const r = 4;
  const pad = 8;

  ctx.save();
  ctx.fillStyle = note.backgroundColor;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
  ctx.fill();

  if (note.text) {
    ctx.fillStyle = note.textColor;
    ctx.font = '14px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    wrapText(ctx, note.text, x + pad, y + pad, w - pad * 2, 18);
  }

  ctx.restore();
}

function renderTextOnCanvas(ctx: CanvasRenderingContext2D, text: TextElement): void {
  if (!text.text) return;

  ctx.save();
  ctx.fillStyle = text.color;
  ctx.font = `${text.fontSize}px system-ui, sans-serif`;
  ctx.textBaseline = 'top';
  ctx.textAlign = text.textAlign;

  const pad = 2;
  let textX = text.position.x + pad;
  if (text.textAlign === 'center') {
    textX = text.position.x + text.size.w / 2;
  } else if (text.textAlign === 'right') {
    textX = text.position.x + text.size.w - pad;
  }

  const lineHeight = text.fontSize * 1.4;
  const lines = text.text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line !== undefined) {
      ctx.fillText(line, textX, text.position.y + pad + i * lineHeight);
    }
  }

  ctx.restore();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): void {
  const words = text.split(' ');
  let line = '';
  let offsetY = 0;

  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && line) {
      ctx.fillText(line, x, y + offsetY);
      line = word;
      offsetY += lineHeight;
    } else {
      line = testLine;
    }
  }
  if (line) {
    ctx.fillText(line, x, y + offsetY);
  }
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

function loadImages(elements: CanvasElement[]): Promise<Map<string, HTMLImageElement>> {
  const imageElements = elements.filter(
    (el): el is CanvasElement & { src: string } => el.type === 'image' && 'src' in el,
  );

  const cache = new Map<string, HTMLImageElement>();
  if (imageElements.length === 0) return Promise.resolve(cache);

  return new Promise((resolve) => {
    let remaining = imageElements.length;
    const done = () => {
      remaining--;
      if (remaining <= 0) resolve(cache);
    };

    for (const el of imageElements) {
      const img = new Image();
      img.onload = () => {
        cache.set(el.id, img);
        done();
      };
      img.onerror = done;
      img.src = el.src;
    }
  });
}

export async function exportImage(
  store: ElementStore,
  options: ExportImageOptions = {},
  layerManager?: LayerManager,
): Promise<Blob | null> {
  const scale = options.scale ?? 2;
  const padding = options.padding ?? 20;
  const background = options.background ?? '#ffffff';

  const allElements = store.getAll();
  const visibleElements = layerManager
    ? allElements.filter((el) => layerManager.isLayerVisible(el.layerId))
    : allElements;

  const bounds = computeBounds(visibleElements, padding);
  if (!bounds) return null;

  const imageCache = await loadImages(visibleElements);

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(bounds.w * scale);
  canvas.height = Math.ceil(bounds.h * scale);

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.scale(scale, scale);
  ctx.translate(-bounds.x, -bounds.y);

  ctx.fillStyle = background;
  ctx.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);

  const renderer = new ElementRenderer();
  renderer.setStore(store);

  const grids: GridElement[] = [];

  for (const el of visibleElements) {
    if (el.type === 'grid') {
      grids.push(el);
      continue;
    }

    if (el.type === 'note') {
      renderNoteOnCanvas(ctx, el);
      continue;
    }

    if (el.type === 'text') {
      renderTextOnCanvas(ctx, el);
      continue;
    }

    if (el.type === 'html') {
      continue;
    }

    if (el.type === 'image') {
      const img = imageCache.get(el.id);
      if (img) {
        ctx.drawImage(img, el.position.x, el.position.y, el.size.w, el.size.h);
      }
      continue;
    }

    renderer.renderCanvasElement(ctx, el);
  }

  for (const grid of grids) {
    renderGridForBounds(ctx, grid, bounds);
  }

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}

export { computeBounds, getElementRect };
