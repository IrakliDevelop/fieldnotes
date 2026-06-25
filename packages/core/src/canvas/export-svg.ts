import type {
  CanvasElement,
  StrokeElement,
  ShapeElement,
  ArrowElement,
  ImageElement,
  TextElement,
  NoteElement,
  GridElement,
  TemplateElement,
} from '../elements/types';
import type { ElementStore } from '../elements/element-store';
import type { LayerManager } from '../layers/layer-manager';
import { getStrokeRenderData } from '../elements/stroke-cache';
import { lineEndpoints } from '../elements/shape-geometry';
import { getArrowControlPoint, getArrowMidpoint } from '../elements/arrow-geometry';
import { getArrowRenderGeometry } from '../elements/arrow-render-cache';
import { getSquareGridLines, getHexVertices, getHexCenters } from '../elements/grid-renderer';
import {
  getHexCellsInRadius,
  getHexCellsInCone,
  getHexCellsInLine,
  getHexCellsInSquare,
} from '../elements/hex-fill';
import { getElementBounds } from '../elements/element-bounds';
import { renderNoteOnCanvas } from './note-canvas-renderer';
import { loadImages, computeBounds } from './export-image';

export interface ExportSvgOptions {
  padding?: number;
  background?: string;
  filter?: (el: CanvasElement) => boolean;
  rasterScale?: number;
}

interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

const ARROWHEAD_LENGTH = 12;
const ARROWHEAD_ANGLE = Math.PI / 6;
const ARROW_LABEL_FONT_SIZE = 14;

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const n = (v: number): string => (Number.isFinite(v) ? `${Math.round(v * 1000) / 1000}` : '0');

function elementCenter(el: CanvasElement): { x: number; y: number } | null {
  const b = getElementBounds(el);
  if (!b) return null;
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/** Wrap a fragment in a rotation group matching withRotation (radians → degrees). */
function withRotationSvg(el: CanvasElement, fragment: string): string {
  const angle = el.rotation ?? 0;
  if (!angle || !fragment) return fragment;
  const c = elementCenter(el);
  if (!c) return fragment;
  const deg = (angle * 180) / Math.PI;
  return `<g transform="rotate(${n(deg)} ${n(c.x)} ${n(c.y)})">${fragment}</g>`;
}

// Strokes use variable per-point width on the canvas; SVG <path> takes a single
// stroke-width, so we mirror the canvas width-bucketing: segments are grouped by
// quantized width and each bucket becomes one <path> of bezier sub-paths. This
// reproduces the canvas geometry exactly. We rebuild buckets from segments+widths
// (always populated) rather than the Path2D buckets, which are absent under jsdom.
const WIDTH_QUANTUM = 0.25;

function emitStroke(stroke: StrokeElement): string {
  if (stroke.points.length < 2) return '';
  const data = getStrokeRenderData(stroke);
  const { x: ox, y: oy } = stroke.position;

  const byWidth = new Map<number, string[]>();
  for (let i = 0; i < data.segments.length; i++) {
    const seg = data.segments[i];
    const w = data.widths[i];
    if (!seg || w === undefined) continue;
    const q = Math.max(WIDTH_QUANTUM, Math.round(w / WIDTH_QUANTUM) * WIDTH_QUANTUM);
    let parts = byWidth.get(q);
    if (!parts) {
      parts = [];
      byWidth.set(q, parts);
    }
    parts.push(
      `M${n(ox + seg.start.x)} ${n(oy + seg.start.y)} C${n(ox + seg.cp1.x)} ${n(oy + seg.cp1.y)} ${n(ox + seg.cp2.x)} ${n(oy + seg.cp2.y)} ${n(ox + seg.end.x)} ${n(oy + seg.end.y)}`,
    );
  }

  const blend = stroke.blendMode === 'multiply' ? ' style="mix-blend-mode:multiply"' : '';
  let out = '';
  for (const [width, parts] of byWidth) {
    out += `<path d="${parts.join(' ')}" fill="none" stroke="${esc(stroke.color)}" stroke-width="${n(width)}" stroke-linecap="round" stroke-linejoin="round" opacity="${n(stroke.opacity)}"${blend} />`;
  }
  return out;
}

function emitShape(shape: ShapeElement): string {
  const { x, y } = shape.position;
  const { w, h } = shape.size;
  const fill =
    shape.fillColor !== 'none' && shape.shape !== 'line' ? esc(shape.fillColor) : 'none';
  const stroke = shape.strokeWidth > 0 ? esc(shape.strokeColor) : 'none';
  const sw = shape.strokeWidth > 0 ? ` stroke-width="${n(shape.strokeWidth)}"` : '';

  switch (shape.shape) {
    case 'rectangle':
      return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${fill}" stroke="${stroke}"${sw} />`;
    case 'ellipse':
      return `<ellipse cx="${n(x + w / 2)}" cy="${n(y + h / 2)}" rx="${n(w / 2)}" ry="${n(h / 2)}" fill="${fill}" stroke="${stroke}"${sw} />`;
    case 'line': {
      const [a, b] = lineEndpoints(shape);
      return `<line x1="${n(a.x)}" y1="${n(a.y)}" x2="${n(b.x)}" y2="${n(b.y)}" stroke="${stroke}"${sw} stroke-linecap="round" />`;
    }
  }
}

function emitArrow(arrow: ArrowElement): string {
  const geometry = getArrowRenderGeometry(arrow);
  const from = arrow.from;
  const to = arrow.to;

  let d: string;
  if (arrow.bend !== 0) {
    const cp = geometry.controlPoint ?? getArrowControlPoint(from, to, arrow.bend);
    d = `M${n(from.x)} ${n(from.y)} Q${n(cp.x)} ${n(cp.y)} ${n(to.x)} ${n(to.y)}`;
  } else {
    d = `M${n(from.x)} ${n(from.y)} L${n(to.x)} ${n(to.y)}`;
  }

  const dash = arrow.fromBinding || arrow.toBinding ? ' stroke-dasharray="8 4"' : '';
  let out = `<path d="${d}" fill="none" stroke="${esc(arrow.color)}" stroke-width="${n(arrow.width)}" stroke-linecap="round"${dash} />`;

  // Arrowhead — mirror arrow-renderer's polygon math.
  const angle = geometry.tangentEnd;
  const p1x = to.x - ARROWHEAD_LENGTH * Math.cos(angle - ARROWHEAD_ANGLE);
  const p1y = to.y - ARROWHEAD_LENGTH * Math.sin(angle - ARROWHEAD_ANGLE);
  const p2x = to.x - ARROWHEAD_LENGTH * Math.cos(angle + ARROWHEAD_ANGLE);
  const p2y = to.y - ARROWHEAD_LENGTH * Math.sin(angle + ARROWHEAD_ANGLE);
  out += `<polygon points="${n(to.x)},${n(to.y)} ${n(p1x)},${n(p1y)} ${n(p2x)},${n(p2y)}" fill="${esc(arrow.color)}" />`;

  if (arrow.label && arrow.label.length > 0) {
    const mid = getArrowMidpoint(from, to, arrow.bend);
    const approxW = arrow.label.length * ARROW_LABEL_FONT_SIZE * 0.6;
    const padX = 6;
    const padY = 4;
    const lw = approxW + padX * 2;
    const lh = ARROW_LABEL_FONT_SIZE + padY * 2;
    out += `<rect x="${n(mid.x - lw / 2)}" y="${n(mid.y - lh / 2)}" width="${n(lw)}" height="${n(lh)}" rx="4" fill="rgba(255,255,255,0.9)" />`;
    out += `<text x="${n(mid.x)}" y="${n(mid.y)}" font-family="system-ui, sans-serif" font-size="${ARROW_LABEL_FONT_SIZE}" fill="#1a1a1a" text-anchor="middle" dominant-baseline="central">${esc(arrow.label)}</text>`;
  }

  return out;
}

function emitImage(image: ImageElement, dataUri: string | undefined): string {
  const href = dataUri ?? image.src;
  if (!href) return '';
  const { x, y } = image.position;
  const { w, h } = image.size;
  return `<image href="${esc(href)}" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" />`;
}

function emitText(text: TextElement): string {
  if (!text.text) return '';
  const pad = 2;
  let anchor: 'start' | 'middle' | 'end' = 'start';
  let textX = text.position.x + pad;
  if (text.textAlign === 'center') {
    anchor = 'middle';
    textX = text.position.x + text.size.w / 2;
  } else if (text.textAlign === 'right') {
    anchor = 'end';
    textX = text.position.x + text.size.w - pad;
  }

  const lineHeight = text.fontSize * 1.4;
  const lines = text.text.split('\n');
  let out = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const y = text.position.y + pad + i * lineHeight;
    out += `<text x="${n(textX)}" y="${n(y)}" font-family="system-ui, sans-serif" font-size="${n(text.fontSize)}" fill="${esc(text.color)}" text-anchor="${anchor}" dominant-baseline="text-before-edge">${esc(line)}</text>`;
  }
  return out;
}

function emitNote(note: NoteElement, rasterScale: number): string {
  const { x, y } = note.position;
  const { w, h } = note.size;
  if (typeof document === 'undefined') return emitNotePlaceholder(note);

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(w * rasterScale));
  canvas.height = Math.max(1, Math.ceil(h * rasterScale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return emitNotePlaceholder(note);

  ctx.scale(rasterScale, rasterScale);
  ctx.translate(-x, -y);
  renderNoteOnCanvas(ctx, note);

  let dataUri: string;
  try {
    dataUri = canvas.toDataURL();
  } catch {
    return emitNotePlaceholder(note);
  }
  if (!dataUri || !dataUri.startsWith('data:')) return emitNotePlaceholder(note);

  return `<image href="${esc(dataUri)}" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" />`;
}

function emitNotePlaceholder(note: NoteElement): string {
  const { x, y } = note.position;
  const { w, h } = note.size;
  return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="4" fill="${esc(note.backgroundColor)}" />`;
}

function emitGrid(grid: GridElement, bounds: Bounds): string {
  if (grid.cellSize <= 0) return '';
  const vb = {
    minX: bounds.x,
    minY: bounds.y,
    maxX: bounds.x + bounds.w,
    maxY: bounds.y + bounds.h,
  };
  const stroke = esc(grid.strokeColor);
  const sw = n(grid.strokeWidth);
  const op = n(grid.opacity);

  if (grid.gridType === 'hex') {
    const centers = getHexCenters(vb, grid.cellSize, grid.hexOrientation);
    let d = '';
    for (const c of centers) {
      const verts = getHexVertices(c.x, c.y, grid.cellSize, grid.hexOrientation);
      const first = verts[0];
      if (!first) continue;
      d += `M${n(first.x)} ${n(first.y)}`;
      for (let i = 1; i < verts.length; i++) {
        const v = verts[i];
        if (v) d += `L${n(v.x)} ${n(v.y)}`;
      }
      d += 'Z';
    }
    return `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${sw}" opacity="${op}" />`;
  }

  const { verticals, horizontals } = getSquareGridLines(vb, grid.cellSize);
  let d = '';
  for (const gx of verticals) d += `M${n(gx)} ${n(vb.minY)}L${n(gx)} ${n(vb.maxY)}`;
  for (const gy of horizontals) d += `M${n(vb.minX)} ${n(gy)}L${n(vb.maxX)} ${n(gy)}`;
  return `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${sw}" opacity="${op}" />`;
}

// Geometric template only (square-grid context). Hex-grid templates fill snapped
// hex cells; we approximate by emitting the cell hex outlines.
function emitTemplate(template: TemplateElement, grid: GridElement | undefined): string {
  if (grid && grid.gridType === 'hex') {
    return emitHexTemplate(template, grid);
  }
  return emitGeometricTemplate(template);
}

function emitGeometricTemplate(t: TemplateElement): string {
  const { x: cx, y: cy } = t.position;
  const r = t.radius;
  const fill = esc(t.fillColor);
  const stroke = esc(t.strokeColor);
  const sw = n(t.strokeWidth);
  const op = n(t.opacity);
  const attrs = `fill="${fill}" stroke="${stroke}" stroke-width="${sw}" opacity="${op}"`;

  switch (t.templateShape) {
    case 'circle':
      return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" ${attrs} />`;
    case 'square':
      return `<rect x="${n(cx - r / 2)}" y="${n(cy - r / 2)}" width="${n(r)}" height="${n(r)}" ${attrs} />`;
    case 'cone': {
      const halfAngle = Math.atan(0.5);
      const a0 = t.angle - halfAngle;
      const a1 = t.angle + halfAngle;
      const p0x = cx + r * Math.cos(a0);
      const p0y = cy + r * Math.sin(a0);
      const p1x = cx + r * Math.cos(a1);
      const p1y = cy + r * Math.sin(a1);
      const large = a1 - a0 > Math.PI ? 1 : 0;
      return `<path d="M${n(cx)} ${n(cy)} L${n(p0x)} ${n(p0y)} A${n(r)} ${n(r)} 0 ${large} 1 ${n(p1x)} ${n(p1y)} Z" ${attrs} />`;
    }
    case 'line': {
      const halfW = r / 12;
      const cos = Math.cos(t.angle);
      const sin = Math.sin(t.angle);
      const perpX = -sin * halfW;
      const perpY = cos * halfW;
      const pts = [
        [cx + perpX, cy + perpY],
        [cx + r * cos + perpX, cy + r * sin + perpY],
        [cx + r * cos - perpX, cy + r * sin - perpY],
        [cx - perpX, cy - perpY],
      ]
        .map(([px, py]) => `${n(px ?? 0)},${n(py ?? 0)}`)
        .join(' ');
      return `<polygon points="${pts}" ${attrs} />`;
    }
  }
}

function emitHexTemplate(t: TemplateElement, grid: GridElement): string {
  const cellSize = grid.cellSize;
  const orientation = grid.hexOrientation;
  const snapUnit = Math.sqrt(3) * cellSize;
  const radiusCells = t.radius / snapUnit;
  const center = t.position;

  let cells: { x: number; y: number }[];
  switch (t.templateShape) {
    case 'circle':
      cells = getHexCellsInRadius(center, radiusCells, cellSize, orientation);
      break;
    case 'cone':
      cells = getHexCellsInCone(center, t.angle, radiusCells, cellSize, orientation);
      break;
    case 'line':
      cells = getHexCellsInLine(center, t.angle, radiusCells, cellSize, orientation);
      break;
    case 'square':
      cells = getHexCellsInSquare(center, radiusCells, cellSize, orientation);
      break;
  }

  let d = '';
  for (const cell of cells) {
    const verts = getHexVertices(cell.x, cell.y, cellSize, orientation);
    const first = verts[0];
    if (!first) continue;
    d += `M${n(first.x)} ${n(first.y)}`;
    for (let i = 1; i < verts.length; i++) {
      const v = verts[i];
      if (v) d += `L${n(v.x)} ${n(v.y)}`;
    }
    d += 'Z';
  }
  return `<path d="${d}" fill="${esc(t.fillColor)}" stroke="${esc(t.strokeColor)}" stroke-width="${n(t.strokeWidth)}" opacity="${n(t.opacity)}" />`;
}

export async function exportSvg(
  store: ElementStore,
  options: ExportSvgOptions = {},
  layerManager?: LayerManager,
): Promise<string> {
  const padding = options.padding ?? 0;
  const rasterScale = options.rasterScale ?? 2;
  const filter = options.filter;

  const allElements = store.getAll();
  let visibleElements = layerManager
    ? allElements.filter((el) => layerManager.isLayerVisible(el.layerId))
    : allElements;
  if (filter) visibleElements = visibleElements.filter(filter);

  const bounds = computeBounds(visibleElements, padding);
  if (!bounds) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" viewBox="0 0 0 0"></svg>`;
  }

  // Only remote/blob image srcs need network loading; data: srcs pass through.
  const remoteImages = visibleElements.filter(
    (el) => el.type === 'image' && !el.src.startsWith('data:'),
  );
  const imageCache = await loadImages(remoteImages);
  const imageDataUris = encodeImages(visibleElements, imageCache, rasterScale);

  const grids = visibleElements.filter((el): el is GridElement => el.type === 'grid');
  const firstGrid = grids[0];

  let body = '';
  if (options.background) {
    body += `<rect x="${n(bounds.x)}" y="${n(bounds.y)}" width="${n(bounds.w)}" height="${n(bounds.h)}" fill="${esc(options.background)}" />`;
  }

  for (const el of visibleElements) {
    body += emitElement(el, imageDataUris, rasterScale, firstGrid);
  }
  for (const grid of grids) {
    body += emitGrid(grid, bounds);
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(bounds.w)}" height="${n(bounds.h)}" ` +
    `viewBox="${n(bounds.x)} ${n(bounds.y)} ${n(bounds.w)} ${n(bounds.h)}">${body}</svg>`
  );
}

function emitElement(
  el: CanvasElement,
  imageDataUris: Map<string, string>,
  rasterScale: number,
  firstGrid: GridElement | undefined,
): string {
  switch (el.type) {
    case 'stroke':
      return withRotationSvg(el, emitStroke(el));
    case 'shape':
      return withRotationSvg(el, emitShape(el));
    case 'arrow':
      return emitArrow(el);
    case 'image':
      return withRotationSvg(el, emitImage(el, imageDataUris.get(el.id)));
    case 'text':
      return withRotationSvg(el, emitText(el));
    case 'note':
      return withRotationSvg(el, emitNote(el, rasterScale));
    case 'template':
      return emitTemplate(el, firstGrid);
    case 'grid':
      return '';
    case 'html':
      return '';
    default:
      return '';
  }
}

/** data: srcs pass through; remote/blob srcs are rasterized to data-URIs via the loaded image. */
function encodeImages(
  elements: CanvasElement[],
  imageCache: Map<string, HTMLImageElement>,
  rasterScale: number,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const el of elements) {
    if (el.type !== 'image') continue;
    if (el.src.startsWith('data:')) {
      out.set(el.id, el.src);
      continue;
    }
    const img = imageCache.get(el.id);
    if (!img || typeof document === 'undefined') continue;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(el.size.w * rasterScale));
    canvas.height = Math.max(1, Math.ceil(el.size.h * rasterScale));
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    try {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const uri = canvas.toDataURL();
      if (uri.startsWith('data:')) out.set(el.id, uri);
    } catch {
      // tainted canvas or jsdom — fall back to original src
    }
  }
  return out;
}
