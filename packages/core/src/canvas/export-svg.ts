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
  HtmlElement,
} from '../elements/types';
import type { ElementStore } from '../elements/element-store';
import type { LayerManager } from '../layers/layer-manager';
import { getStrokeRenderData } from '../elements/stroke-cache';
import { lineEndpoints } from '../elements/shape-geometry';
import { getArrowControlPoint, getArrowMidpoint } from '../elements/arrow-geometry';
import { getArrowRenderGeometry } from '../elements/arrow-render-cache';
import { getVisualEndpoints, getArrowDashPattern } from '../elements/renderers/arrow-renderer';
import { getSquareGridLines, getHexVertices, getHexCenters } from '../elements/grid-renderer';
import {
  getHexCellsInRadius,
  getHexCellsInCone,
  getHexCellsInLine,
  getHexCellsInSquare,
  getHexCellsInRectangle,
} from '../elements/hex-fill';
import { getElementBounds } from '../elements/element-bounds';
import { renderNoteOnCanvas } from './note-canvas-renderer';
import { renderTextOnCanvas } from './text-canvas-renderer';
import {
  assertExportSize,
  loadImages,
  computeBounds,
  nonNegativeOption,
  positiveOption,
  validateExportResourceOptions,
} from './export-image';
import type { ExportResourceOptions } from './export-image';
import { renderHtmlElements, validateHtmlExportOptions } from './html-export';
import type { HtmlExportOptions } from './html-export';
import { resolveHtmlRouting, HtmlPainterMissingError } from './html-painter-registry';
import type { HtmlPainterRegistry } from './html-painter-registry';
import { paintHtmlElement } from './html-paint';
import type { HtmlPaintDiagnostic } from './html-paint-diagnostics';

export interface ExportSvgOptions extends ExportResourceOptions, HtmlExportOptions {
  padding?: number;
  background?: string;
  filter?: (el: CanvasElement) => boolean;
  rasterScale?: number;
  /** Registry of canvas-backed html painters, keyed by `htmlType`. When absent (or when
   *  an element's `htmlType` isn't claimed), html elements fall back to the legacy
   *  DOM-raster path (`renderHtml`). */
  htmlPainters?: HtmlPainterRegistry;
  /** `htmlType`s that must route to canvas even before a painter for them is
   *  registered — lets a host declare intent up front (mirrors `HtmlPainterRegistry.expect`). */
  expectedCanvasTypes?: ReadonlySet<string>;
  /**
   * When true, a canvas-routed html element with no active painter throws
   * `HtmlPainterMissingError` instead of reporting `onHtmlError` and continuing.
   * DOM-routed html elements are never affected — a missing `renderHtml` stays
   * a non-fatal `'unsupported'` diagnostic regardless of this flag.
   */
  strictMissingCanvasHtml?: boolean;
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
  const fill = shape.fillColor !== 'none' && shape.shape !== 'line' ? esc(shape.fillColor) : 'none';
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

function emitArrow(arrow: ArrowElement, store: ElementStore): string {
  const geometry = getArrowRenderGeometry(arrow);
  // Bound arrows store from/to at the bound element's CENTER; the canvas renderer
  // snaps them to the element EDGE at draw time. Mirror that for PNG/canvas parity.
  const { visualFrom: from, visualTo: to } = getVisualEndpoints(arrow, geometry, store);

  let d: string;
  if (arrow.bend !== 0) {
    const cp = geometry.controlPoint ?? getArrowControlPoint(from, to, arrow.bend);
    d = `M${n(from.x)} ${n(from.y)} Q${n(cp.x)} ${n(cp.y)} ${n(to.x)} ${n(to.y)}`;
  } else {
    d = `M${n(from.x)} ${n(from.y)} L${n(to.x)} ${n(to.y)}`;
  }

  const pattern = getArrowDashPattern(arrow.strokeStyle);
  const dash = pattern.length > 0 ? ` stroke-dasharray="${pattern.join(' ')}"` : '';
  let out = `<path d="${d}" fill="none" stroke="${esc(arrow.color)}" stroke-width="${n(arrow.width)}" stroke-linecap="round"${dash} />`;

  // Arrowhead — mirror arrow-renderer's polygon math (tip at the visual endpoint).
  const angle = geometry.tangentEnd;
  const p1x = to.x - ARROWHEAD_LENGTH * Math.cos(angle - ARROWHEAD_ANGLE);
  const p1y = to.y - ARROWHEAD_LENGTH * Math.sin(angle - ARROWHEAD_ANGLE);
  const p2x = to.x - ARROWHEAD_LENGTH * Math.cos(angle + ARROWHEAD_ANGLE);
  const p2y = to.y - ARROWHEAD_LENGTH * Math.sin(angle + ARROWHEAD_ANGLE);
  out += `<polygon points="${n(to.x)},${n(to.y)} ${n(p1x)},${n(p1y)} ${n(p2x)},${n(p2y)}" fill="${esc(arrow.color)}" />`;

  if (arrow.label && arrow.label.length > 0) {
    // Canvas renderer places the label at the raw-endpoint midpoint, not the visual one.
    const mid = getArrowMidpoint(arrow.from, arrow.to, arrow.bend);
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

function emitImage(image: ImageElement | HtmlElement, dataUri: string | undefined): string {
  const href = dataUri ?? ('src' in image ? image.src : '');
  if (!href) return '';
  const { x, y } = image.position;
  const { w, h } = image.size;
  return `<image href="${esc(href)}" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" />`;
}

function emitText(
  text: TextElement,
  rasterScale: number,
  resourceOptions: ExportResourceOptions,
): string {
  if (!text.text) return '';
  const { x, y } = text.position;
  const { w, h } = text.size;
  if (typeof document === 'undefined') return '';

  const width = Math.max(1, Math.ceil(w * rasterScale));
  const height = Math.max(1, Math.ceil(h * rasterScale));
  assertExportSize(width, height, resourceOptions);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.scale(rasterScale, rasterScale);
  ctx.translate(-x, -y);
  renderTextOnCanvas(ctx, text);

  let dataUri: string;
  try {
    dataUri = canvas.toDataURL();
  } catch {
    return '';
  }
  if (!dataUri || !dataUri.startsWith('data:')) return '';

  return `<image href="${esc(dataUri)}" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" />`;
}

function emitNote(
  note: NoteElement,
  rasterScale: number,
  resourceOptions: ExportResourceOptions,
): string {
  const { x, y } = note.position;
  const { w, h } = note.size;
  if (typeof document === 'undefined') return emitNotePlaceholder(note);

  const width = Math.max(1, Math.ceil(w * rasterScale));
  const height = Math.max(1, Math.ceil(h * rasterScale));
  assertExportSize(width, height, resourceOptions);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
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
    case 'rectangle': {
      const halfW = (t.width ?? 0) / 2;
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
    case 'rectangle': {
      const widthCells = (t.width ?? 0) / snapUnit;
      cells = getHexCellsInRectangle(
        center,
        t.angle,
        radiusCells,
        widthCells,
        cellSize,
        orientation,
      );
      break;
    }
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
  const padding = nonNegativeOption(options.padding, 0, 'padding');
  const rasterScale = positiveOption(options.rasterScale, 2, 'rasterScale');
  validateExportResourceOptions(options);
  validateHtmlExportOptions(options);
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
  assertExportSize(Math.ceil(bounds.w), Math.ceil(bounds.h), options);

  // Only remote/blob image srcs need network loading; data: srcs pass through.
  const remoteImages = visibleElements.filter(
    (el) => el.type === 'image' && !el.src.startsWith('data:'),
  );
  const imageCache = await loadImages(remoteImages, options);
  const imageDataUris = encodeImages(visibleElements, imageCache, rasterScale, options);
  const htmlElements = visibleElements.filter((el): el is HtmlElement => el.type === 'html');

  // Resolve routing per visible html element before doing any rendering work: canvas-routed
  // elements never reach the DOM-raster path (renderHtmlElements), and 'missing' is either
  // fatal (strictMissingCanvasHtml) or reported once here — it never falls back to DOM.
  const canvasRoutedElements: HtmlElement[] = [];
  const domHtmlElements: HtmlElement[] = [];
  for (const el of htmlElements) {
    const routing = resolveHtmlRouting(
      el,
      options.htmlPainters ?? null,
      options.expectedCanvasTypes,
    );
    if (routing === 'missing') {
      if (options.strictMissingCanvasHtml) {
        throw new HtmlPainterMissingError(el.id, el.htmlType);
      }
      options.onHtmlError?.({ elementId: el.id, htmlType: el.htmlType, reason: 'missing-painter' });
      continue;
    }
    if (routing === 'canvas') {
      canvasRoutedElements.push(el);
    } else {
      domHtmlElements.push(el);
    }
  }
  const htmlSources = await renderHtmlElements(domHtmlElements, options);
  const htmlDataUris = encodeHtmlElements(domHtmlElements, htmlSources, rasterScale, options);
  const canvasHtmlDataUris = rasterizeCanvasRoutedHtml(
    canvasRoutedElements,
    options.htmlPainters,
    rasterScale,
    options,
  );
  for (const [id, uri] of canvasHtmlDataUris) htmlDataUris.set(id, uri);

  const grids = visibleElements.filter((el): el is GridElement => el.type === 'grid');
  const firstGrid = grids[0];

  let body = '';
  if (options.background) {
    body += `<rect x="${n(bounds.x)}" y="${n(bounds.y)}" width="${n(bounds.w)}" height="${n(bounds.h)}" fill="${esc(options.background)}" />`;
  }

  const layerBodies = new Map<string, string>();
  for (const el of visibleElements) {
    const emitted = emitElement(
      el,
      imageDataUris,
      htmlDataUris,
      rasterScale,
      firstGrid,
      store,
      options,
    );
    layerBodies.set(el.layerId, (layerBodies.get(el.layerId) ?? '') + emitted);
  }
  for (const [layerId, emitted] of layerBodies) {
    const opacity = layerManager?.getLayer?.(layerId)?.opacity ?? 1;
    body += opacity === 1 || emitted === '' ? emitted : `<g opacity="${n(opacity)}">${emitted}</g>`;
  }
  for (const grid of grids) {
    const emitted = emitGrid(grid, bounds);
    const opacity = layerManager?.getLayer?.(grid.layerId)?.opacity ?? 1;
    body += opacity === 1 ? emitted : `<g opacity="${n(opacity)}">${emitted}</g>`;
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(bounds.w)}" height="${n(bounds.h)}" ` +
    `viewBox="${n(bounds.x)} ${n(bounds.y)} ${n(bounds.w)} ${n(bounds.h)}">${body}</svg>`
  );
}

function emitElement(
  el: CanvasElement,
  imageDataUris: Map<string, string>,
  htmlDataUris: Map<string, string>,
  rasterScale: number,
  firstGrid: GridElement | undefined,
  store: ElementStore,
  resourceOptions: ExportResourceOptions,
): string {
  switch (el.type) {
    case 'stroke':
      return withRotationSvg(el, emitStroke(el));
    case 'shape':
      return withRotationSvg(el, emitShape(el));
    case 'arrow':
      return emitArrow(el, store);
    case 'image':
      return withRotationSvg(el, emitImage(el, imageDataUris.get(el.id)));
    case 'text':
      return withRotationSvg(el, emitText(el, rasterScale, resourceOptions));
    case 'note':
      return withRotationSvg(el, emitNote(el, rasterScale, resourceOptions));
    case 'template':
      return emitTemplate(el, firstGrid);
    case 'grid':
      return '';
    case 'html':
      return withRotationSvg(el, emitImage(el, htmlDataUris.get(el.id)));
    default:
      return '';
  }
}

/**
 * Rasterizes canvas-routed html elements through the shared `paintHtmlElement` path into
 * their own offscreen canvas, one per element, sized to the element's own w×h (not the
 * export bounds). `emitElement`'s 'html' case then places the resulting data-URI in an
 * `<image>` unchanged, identical to the DOM-raster path.
 */
function rasterizeCanvasRoutedHtml(
  elements: HtmlElement[],
  registry: HtmlPainterRegistry | undefined,
  rasterScale: number,
  options: ExportSvgOptions,
): Map<string, string> {
  const encoded = new Map<string, string>();
  const onDiagnostic = (d: HtmlPaintDiagnostic): void => {
    options.onHtmlError?.({
      elementId: d.elementId,
      htmlType: d.htmlType,
      reason: d.kind,
      cause: d.kind === 'painter-threw' ? d.error : undefined,
    });
  };

  for (const element of elements) {
    const painter = registry?.getActivePainter(element.htmlType ?? '');
    if (!painter) continue; // resolveHtmlRouting only returns 'canvas' when a painter exists
    if (typeof document === 'undefined') {
      options.onHtmlError?.({
        elementId: element.id,
        htmlType: element.htmlType,
        reason: 'encode',
      });
      continue;
    }
    const width = Math.max(1, Math.ceil(element.size.w * rasterScale));
    const height = Math.max(1, Math.ceil(element.size.h * rasterScale));
    assertExportSize(width, height, options);
    const off = document.createElement('canvas');
    off.width = width;
    off.height = height;
    const octx = off.getContext('2d');
    if (!octx) {
      options.onHtmlError?.({
        elementId: element.id,
        htmlType: element.htmlType,
        reason: 'encode',
      });
      continue;
    }
    octx.scale(rasterScale, rasterScale);
    // LOCALIZING TRANSFORM — paintHtmlElement translates by the element's WORLD position,
    // but this offscreen canvas is sized to only the element's own w×h. Without cancelling
    // the world offset here first, the paint lands outside the canvas and the raster comes
    // out fully transparent.
    octx.translate(-element.position.x, -element.position.y);
    paintHtmlElement(element, painter, {
      ctx: octx,
      zoom: rasterScale,
      target: 'export',
      applyRotation: false, // withRotationSvg wraps the emitted <image>; rotating here too would double it
      onDiagnostic,
    });
    try {
      const dataUri = off.toDataURL('image/png');
      if (dataUri.startsWith('data:')) {
        encoded.set(element.id, dataUri);
      } else {
        options.onHtmlError?.({
          elementId: element.id,
          htmlType: element.htmlType,
          reason: 'encode',
        });
      }
    } catch (cause) {
      options.onHtmlError?.({
        elementId: element.id,
        htmlType: element.htmlType,
        reason: 'encode',
        cause,
      });
    }
  }
  return encoded;
}

function encodeHtmlElements(
  elements: HtmlElement[],
  sources: Map<string, CanvasImageSource>,
  rasterScale: number,
  options: ExportSvgOptions,
): Map<string, string> {
  const encoded = new Map<string, string>();
  for (const element of elements) {
    const source = sources.get(element.id);
    if (!source) continue;
    const width = Math.max(1, Math.ceil(element.size.w * rasterScale));
    const height = Math.max(1, Math.ceil(element.size.h * rasterScale));
    assertExportSize(width, height, options);
    if (typeof document === 'undefined') {
      options.onHtmlError?.({
        elementId: element.id,
        htmlType: element.htmlType,
        reason: 'encode',
      });
      continue;
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      options.onHtmlError?.({
        elementId: element.id,
        htmlType: element.htmlType,
        reason: 'encode',
      });
      continue;
    }
    try {
      ctx.drawImage(source, 0, 0, width, height);
      const dataUri = canvas.toDataURL();
      if (dataUri.startsWith('data:')) {
        encoded.set(element.id, dataUri);
      } else {
        options.onHtmlError?.({
          elementId: element.id,
          htmlType: element.htmlType,
          reason: 'encode',
        });
      }
    } catch (cause) {
      options.onHtmlError?.({
        elementId: element.id,
        htmlType: element.htmlType,
        reason: 'encode',
        cause,
      });
    }
  }
  return encoded;
}

/** data: srcs pass through; remote/blob srcs are rasterized to data-URIs via the loaded image. */
function encodeImages(
  elements: CanvasElement[],
  imageCache: Map<string, HTMLImageElement>,
  rasterScale: number,
  resourceOptions: ExportResourceOptions,
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
    const width = Math.max(1, Math.ceil(el.size.w * rasterScale));
    const height = Math.max(1, Math.ceil(el.size.h * rasterScale));
    assertExportSize(width, height, resourceOptions);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      resourceOptions.onAssetError?.({ elementId: el.id, src: el.src, reason: 'encode' });
      continue;
    }
    try {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const uri = canvas.toDataURL();
      if (uri.startsWith('data:')) out.set(el.id, uri);
      else resourceOptions.onAssetError?.({ elementId: el.id, src: el.src, reason: 'encode' });
    } catch (cause) {
      resourceOptions.onAssetError?.({ elementId: el.id, src: el.src, reason: 'encode', cause });
    }
  }
  return out;
}
