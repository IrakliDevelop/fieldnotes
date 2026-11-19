import type {
  CanvasElement,
  StrokeElement,
  ShapeElement,
  ArrowElement,
  ImageElement,
  TextElement,
  NoteElement,
  HtmlElement,
} from '../elements/types';
import type { ElementStore } from '../elements/element-store';
import type { LayerManager } from '../layers/layer-manager';
import { getStrokeRenderData } from '../elements/stroke-cache';
import { lineEndpoints } from '../elements/shape-geometry';
import { getArrowCurve, getArrowEndTangent, getArrowLabelAnchor } from '../elements/arrow-geometry';
import { getArrowDashPattern } from '../elements/renderers/arrow-renderer';
import { getElementBounds } from '../elements/element-bounds';
import { getDefaultElementRegistry } from '../elements/default-registry';
import {
  assertExportSize,
  assertRenderCapabilities,
  loadImages,
  getElementRect,
  nonNegativeOption,
  positiveOption,
  validateExportResourceOptions,
  resolveExportBounds,
  withAssetWarning,
} from './export-image';
import type { ExportResourceOptions } from './export-image';
import { renderHtmlElements, validateHtmlExportOptions } from './html-export';
import type { HtmlExportOptions } from './html-export';
import { resolveHtmlRouting, HtmlPainterMissingError } from './html-painter-registry';
import type { HtmlPainterRegistry } from './html-painter-registry';
import { paintHtmlElement } from './html-paint';
import type { HtmlPaintDiagnostic } from './html-paint-diagnostics';
import type { ElementRegistry } from '../elements/element-registry';
import type { RenderHooks } from './render-hooks';
import { resolveFrameExport } from './frame-export';
import { buildSceneEnvelope, serializeSceneEnvelope } from './scene-embed';
import type { SceneEmbedOptions } from './scene-embed';
import { getBoundText } from '../elements/bound-text';
import { getElbowRoute } from '../elements/elbow-cache';
import { parseStyledRuns } from '../elements/note-sanitizer';
import type { StyledRun } from '../elements/note-sanitizer';
import { layoutStyledRuns, lineOffset, textFontFamily } from '../elements/text-layout';
import { measureFragment, TEXT_PADDING } from '../elements/text-measure';
import { DEFAULT_NOTE_FONT_SIZE } from '../elements/element-factory';
import { isFrameElement } from '../elements/frame-element';
import { loadFontFaces, selectFaces } from './export-fonts';
import type { ExportFontOptions } from './export-fonts';
import { defaultExportBackground, inkFor, resolveTheme } from './theme';
import type { FixedTheme, ResolvedTheme } from './theme';
import { getBoundTextContainerId } from '../elements/bound-text';

export interface ExportSvgOptions
  extends ExportResourceOptions, HtmlExportOptions, SceneEmbedOptions, ExportFontOptions {
  frameId?: string;
  padding?: number;
  background?: string;
  /** Theme the export draws with. Direct exports default to light; viewport exports use its theme. */
  theme?: FixedTheme;
  filter?: (el: CanvasElement) => boolean;
  rasterScale?: number;
  htmlPainters?: HtmlPainterRegistry;
  expectedCanvasTypes?: ReadonlySet<string>;
  strictMissingCanvasHtml?: boolean;
  /** Element adapters used for extension bounds, rendering, and SVG emission. */
  elementRegistry?: ElementRegistry;
  /** Per-surface hooks installed by viewport plugins. */
  renderHooks?: RenderHooks;
  /** Render capabilities the export must satisfy, added to the registry's stored requirement. */
  requiredCapabilities?: readonly string[];
  afterElements?: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
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

function xmlText(value: string): string {
  return value.replace(/[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '');
}

function attr(value: string): string {
  return esc(xmlText(value));
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

function emitStroke(stroke: StrokeElement, theme: ResolvedTheme): string {
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

  const blend =
    stroke.blendMode === 'multiply'
      ? ` style="mix-blend-mode:${theme.base === 'dark' ? 'screen' : 'multiply'}"`
      : '';
  let out = '';
  for (const [width, parts] of byWidth) {
    out += `<path d="${parts.join(' ')}" fill="none" stroke="${attr(inkFor(theme, stroke.color, stroke.blendMode))}" stroke-width="${n(width)}" stroke-linecap="round" stroke-linejoin="round" opacity="${n(stroke.opacity)}"${blend} />`;
  }
  return out;
}

function emitShape(shape: ShapeElement, theme: ResolvedTheme): string {
  const { x, y } = shape.position;
  const { w, h } = shape.size;
  const fill =
    shape.fillColor !== 'none' && shape.shape !== 'line'
      ? attr(theme.adapt(shape.fillColor))
      : 'none';
  const stroke = shape.strokeWidth > 0 ? attr(theme.adapt(shape.strokeColor)) : 'none';
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

function emitArrow(
  arrow: ArrowElement,
  store: ElementStore,
  measurer: SvgMeasurer | null,
  used: Set<string>,
  theme: ResolvedTheme,
): string {
  const resolveBounds = (id: string) => {
    const element = store.getById(id);
    return element ? getElementBounds(element) : null;
  };
  const curve = getArrowCurve(arrow, resolveBounds);
  const route = getElbowRoute(store, arrow);
  const { from, to } = curve;

  let d: string;
  if (route) {
    d = route.points
      .map((point, index) => `${index === 0 ? 'M' : 'L'}${n(point.x)} ${n(point.y)}`)
      .join(' ');
  } else if (arrow.bend !== 0) {
    d = `M${n(from.x)} ${n(from.y)} Q${n(curve.control.x)} ${n(curve.control.y)} ${n(to.x)} ${n(to.y)}`;
  } else {
    d = `M${n(from.x)} ${n(from.y)} L${n(to.x)} ${n(to.y)}`;
  }

  const pattern = getArrowDashPattern(arrow.strokeStyle);
  const dash = pattern.length > 0 ? ` stroke-dasharray="${pattern.join(' ')}"` : '';
  let out = `<path d="${d}" fill="none" stroke="${attr(theme.adapt(arrow.color))}" stroke-width="${n(arrow.width)}" stroke-linecap="round"${dash} />`;

  const last = route?.points.at(-1) ?? to;
  const angle = getArrowEndTangent(arrow, curve.t1, route?.points);
  if (angle !== null) {
    const tip = last;
    const p1x = tip.x - ARROWHEAD_LENGTH * Math.cos(angle - ARROWHEAD_ANGLE);
    const p1y = tip.y - ARROWHEAD_LENGTH * Math.sin(angle - ARROWHEAD_ANGLE);
    const p2x = tip.x - ARROWHEAD_LENGTH * Math.cos(angle + ARROWHEAD_ANGLE);
    const p2y = tip.y - ARROWHEAD_LENGTH * Math.sin(angle + ARROWHEAD_ANGLE);
    out += `<polygon points="${n(tip.x)},${n(tip.y)} ${n(p1x)},${n(p1y)} ${n(p2x)},${n(p2y)}" fill="${attr(theme.adapt(arrow.color))}" />`;
  }

  const boundText = getBoundText(arrow, store);
  if (boundText) {
    out += withRotationSvg(
      boundText,
      `<rect x="${n(boundText.position.x - 4)}" y="${n(boundText.position.y - 2)}" width="${n(boundText.size.w + 8)}" height="${n(boundText.size.h + 4)}" rx="4" fill="${attr(theme.tokens.labelPlate)}" />`,
    );
  } else if (arrow.label && arrow.label.length > 0) {
    const mid = getArrowLabelAnchor(arrow, resolveBounds);
    const font = `normal normal ${ARROW_LABEL_FONT_SIZE}px ${textFontFamily()}`;
    const labelWidth = measurer?.width(arrow.label, font) ?? measureFragment(arrow.label, font);
    const padX = 6;
    const padY = 4;
    const lw = labelWidth + padX * 2;
    const lh = ARROW_LABEL_FONT_SIZE + padY * 2;
    out += `<rect x="${n(mid.x - lw / 2)}" y="${n(mid.y - lh / 2)}" width="${n(lw)}" height="${n(lh)}" rx="4" fill="${attr(theme.tokens.labelPlate)}" />`;
    out += `<text x="${n(mid.x)}" y="${n(mid.y)}" font-family="${attr(textFontFamily())}" font-size="${ARROW_LABEL_FONT_SIZE}" fill="${theme.adapt('#1a1a1a')}" text-anchor="middle" dominant-baseline="middle">${attr(arrow.label)}</text>`;
    used.add('normal/normal');
  }

  return out;
}

function emitImage(image: ImageElement | HtmlElement, dataUri: string | undefined): string {
  const href = dataUri ?? ('src' in image ? image.src : '');
  if (!href) return '';
  const { x, y } = image.position;
  const { w, h } = image.size;
  return `<image href="${attr(href)}" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" />`;
}

interface SvgMeasurer {
  width(text: string, font: string): number;
  ascent(font: string): number | null;
}

function createSvgMeasurer(): SvgMeasurer | null {
  if (typeof document === 'undefined') return null;
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return null;
  const ascents = new Map<string, number | null>();
  return {
    width(text, font) {
      ctx.font = font;
      return ctx.measureText(text).width;
    },
    ascent(font) {
      const cached = ascents.get(font);
      if (cached !== undefined) return cached;
      ctx.font = font;
      ctx.textBaseline = 'alphabetic';
      const alphabetic = ctx.measureText(' ').fontBoundingBoxAscent;
      ctx.textBaseline = 'top';
      const top = ctx.measureText(' ').fontBoundingBoxAscent;
      const ascent =
        typeof alphabetic === 'number' &&
        Number.isFinite(alphabetic) &&
        typeof top === 'number' &&
        Number.isFinite(top)
          ? alphabetic - top
          : null;
      ascents.set(font, ascent);
      return ascent;
    },
  };
}

function emitStyledText(
  runs: StyledRun[],
  startX: number,
  startY: number,
  contentWidth: number,
  opts: { align: 'left' | 'center' | 'right'; lineHeight: number; wrap: boolean },
  fill: string,
  measurer: SvgMeasurer | null,
  used: Set<string>,
): string {
  const layout = layoutStyledRuns(
    (value, font) => measurer?.width(value, font) ?? measureFragment(value, font),
    runs,
    opts.wrap ? contentWidth : Infinity,
    opts.lineHeight,
  );
  let out = `<g fill="${attr(fill)}" font-family="${attr(textFontFamily())}" xml:space="preserve">`;
  for (const line of layout.lines) {
    const offset = lineOffset(line, opts.align, contentWidth);
    const first = line.fragments[0];
    const baseline = first ? (measurer?.ascent(first.font) ?? null) : null;
    out += `<text${baseline === null ? ' dominant-baseline="text-before-edge"' : ''}>`;
    let decorations = '';
    for (const fragment of line.fragments) {
      const { bold, italic } = fragment;
      const x = startX + offset + fragment.x;
      const y = startY + line.y + (measurer?.ascent(fragment.font) ?? 0);
      const weight = bold ? ' font-weight="bold"' : '';
      const style = italic ? ' font-style="italic"' : '';
      out += `<tspan x="${n(x)}" y="${n(y)}" font-size="${n(fragment.fontSize)}"${weight}${style}>${attr(fragment.text + (fragment.trailingSpace ? ' ' : ''))}</tspan>`;
      used.add(`${bold ? 'bold' : 'normal'}/${italic ? 'italic' : 'normal'}`);
      if (fragment.underline) {
        decorations += `<rect x="${n(x)}" y="${n(startY + line.y + fragment.fontSize + 1)}" width="${n(fragment.width)}" height="1" />`;
      }
      if (fragment.strikethrough) {
        decorations += `<rect x="${n(x)}" y="${n(startY + line.y + fragment.fontSize * 0.55)}" width="${n(fragment.width)}" height="1" />`;
      }
    }
    out += `</text>${decorations}`;
  }
  return `${out}</g>`;
}

function emitText(
  text: TextElement,
  measurer: SvgMeasurer | null,
  used: Set<string>,
  theme: ResolvedTheme,
  containerFill: string | null,
): string {
  if (!text.text || typeof DOMParser === 'undefined') return '';
  return emitStyledText(
    parseStyledRuns(text.text, text.fontSize),
    text.position.x + TEXT_PADDING,
    text.position.y + TEXT_PADDING,
    Math.max(0, text.size.w - TEXT_PADDING * 2),
    { align: text.textAlign, lineHeight: 1.4, wrap: text.wrap !== false },
    containerFill === null ? theme.adapt(text.color) : theme.adaptOn(text.color, containerFill),
    measurer,
    used,
  );
}

function emitNote(
  note: NoteElement,
  measurer: SvgMeasurer | null,
  used: Set<string>,
  theme: ResolvedTheme,
): string {
  const { x, y } = note.position;
  const { w, h } = note.size;
  const placeholder = emitNotePlaceholder(note, theme);
  if (!note.text || typeof DOMParser === 'undefined') return placeholder;
  return `${placeholder}<svg x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" viewBox="${n(x)} ${n(y)} ${n(w)} ${n(h)}" overflow="hidden">${emitStyledText(
    parseStyledRuns(note.text, note.fontSize ?? DEFAULT_NOTE_FONT_SIZE),
    x + 8,
    y + 8,
    w - 16,
    { align: 'left', lineHeight: 1.3, wrap: true },
    theme.adaptOn(note.textColor, note.backgroundColor),
    measurer,
    used,
  )}</svg>`;
}

function emitNotePlaceholder(note: NoteElement, theme: ResolvedTheme): string {
  const { x, y } = note.position;
  const { w, h } = note.size;
  return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="4" fill="${attr(theme.adapt(note.backgroundColor))}" />`;
}

export async function exportSvg(
  store: ElementStore,
  options: ExportSvgOptions = {},
  layerManager?: LayerManager,
): Promise<string> {
  const reportingOptions = withAssetWarning(options);
  assertRenderCapabilities(
    options.renderHooks?.svgExport,
    'svgExport',
    options.requiredCapabilities,
  );
  const padding = nonNegativeOption(options.padding, 0, 'padding');
  const rasterScale = positiveOption(options.rasterScale, 2, 'rasterScale');
  validateExportResourceOptions(options);
  validateHtmlExportOptions(options);
  const filter = options.filter;
  const registry = options.elementRegistry ?? getDefaultElementRegistry();
  const theme = resolveTheme(options.theme ?? 'light');
  const renderContext = Object.freeze({ theme });
  const measurer = createSvgMeasurer();
  const used = new Set<string>();
  const frameExport = resolveFrameExport(store, options.frameId);
  const rootNumber = frameExport ? (value: number): string => `${value}` : n;

  const allElements = store.getAll();
  let visibleElements = frameExport
    ? allElements.filter((el) => frameExport.descendantIds.has(el.id))
    : allElements;
  if (layerManager)
    visibleElements = visibleElements.filter((el) => layerManager.isLayerVisible(el.layerId));
  if (filter) visibleElements = visibleElements.filter(filter);

  const bounds = resolveExportBounds(frameExport?.region, visibleElements, padding, registry);
  if (!bounds) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" viewBox="0 0 0 0"></svg>`;
  }
  assertExportSize(Math.ceil(bounds.w), Math.ceil(bounds.h), options);

  const ordinaryElements: {
    element: CanvasElement;
    clip: { x: number; y: number; w: number; h: number } | null;
  }[] = [];
  for (const element of visibleElements) {
    if (element.type === 'extension' && registry.getAdapter(element.extensionType)?.fullCanvas) {
      continue;
    }
    const clip = store.getEffectiveClip(element.id);
    if (clip === undefined || (clip !== null && (clip.w <= 0 || clip.h <= 0))) continue;
    if (clip !== null) {
      const rect = getElementRect(element, registry);
      if (
        !rect ||
        Math.max(rect.x, clip.x) >= Math.min(rect.x + rect.w, clip.x + clip.w) ||
        Math.max(rect.y, clip.y) >= Math.min(rect.y + rect.h, clip.y + clip.h)
      )
        continue;
    }
    ordinaryElements.push({ element, clip: clip && { ...clip } });
  }
  const paintableElements = ordinaryElements.map(({ element }) => element);

  const remoteImages = paintableElements.filter(
    (el) => el.type === 'image' && !el.src.startsWith('data:'),
  );
  const imageCache = await loadImages(remoteImages, reportingOptions);
  const imageDataUris = encodeImages(paintableElements, imageCache, rasterScale, reportingOptions);
  const htmlElements = paintableElements.filter((el): el is HtmlElement => el.type === 'html');

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

  const defaultBackground = defaultExportBackground(theme);
  const background =
    options.background ??
    (options.frameId === undefined && defaultBackground !== '#ffffff'
      ? defaultBackground
      : undefined);
  const backgroundSvg = background
    ? `<rect x="${rootNumber(bounds.x)}" y="${rootNumber(bounds.y)}" width="${rootNumber(bounds.w)}" height="${rootNumber(bounds.h)}" fill="${attr(background)}" />`
    : '';

  const fullCanvasSvg: string[] = [];
  const layerBodies = new Map<
    string,
    {
      element: CanvasElement;
      fragment: string;
      clip: { x: number; y: number; w: number; h: number } | null;
    }[]
  >();
  const ordinaryById = new Map(ordinaryElements.map((entry) => [entry.element.id, entry]));
  for (const el of visibleElements) {
    if (el.type === 'extension' && registry.getAdapter(el.extensionType)?.fullCanvas) {
      const adapter = registry.getAdapter(el.extensionType);
      if (adapter?.emitSvg) {
        const viewBox = { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h };
        const emitted = adapter.emitSvg(el, visibleElements, viewBox, renderContext);
        const opacity = layerManager?.getLayer?.(el.layerId)?.opacity ?? 1;
        fullCanvasSvg.push(opacity === 1 ? emitted : `<g opacity="${n(opacity)}">${emitted}</g>`);
      }
      continue;
    }
    const prepared = ordinaryById.get(el.id);
    if (!prepared) continue;
    if (isFrameElement(prepared.element) && prepared.element.data.title) used.add('normal/normal');
    const emitted = emitElement(
      prepared.element,
      imageDataUris,
      htmlDataUris,
      store,
      registry,
      bounds,
      measurer,
      used,
      theme,
      renderContext,
    );
    if (!emitted) continue;
    const entries = layerBodies.get(prepared.element.layerId) ?? [];
    entries.push({ element: prepared.element, fragment: emitted, clip: prepared.clip });
    layerBodies.set(prepared.element.layerId, entries);
  }

  let overlaySvg = '';
  if (options.afterElements && typeof document !== 'undefined') {
    const overlayW = Math.max(1, Math.ceil(bounds.w));
    const overlayH = Math.max(1, Math.ceil(bounds.h));
    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = overlayW;
    overlayCanvas.height = overlayH;
    const overlayCtx = overlayCanvas.getContext('2d');
    if (overlayCtx) {
      overlayCtx.translate(-bounds.x, -bounds.y);
      options.afterElements(overlayCtx, bounds.w, bounds.h);
      try {
        const dataUri = overlayCanvas.toDataURL('image/png');
        if (dataUri.startsWith('data:')) {
          overlaySvg = `<image href="${attr(dataUri)}" x="${n(bounds.x)}" y="${n(bounds.y)}" width="${n(bounds.w)}" height="${n(bounds.h)}" />`;
        }
      } catch {
        // encoding failed — skip overlay in SVG rather than failing the whole export
      }
    }
  }

  const hookSvg: string[] = [];
  if (options.renderHooks) {
    options.renderHooks.svgExport.call('afterElements', {
      appendSvg: (fragment: string) => hookSvg.push(fragment),
      viewBox: bounds,
      rasterScale,
    });
    assertRenderCapabilities(
      options.renderHooks.svgExport,
      'svgExport',
      options.requiredCapabilities,
    );
  }

  const usedIds = new Set<string>();
  const collectIds = (fragment: string): void => {
    const ids = /(?:^|[\x20\t\r\n])id\s*=\s*(['"])(.*?)\1/g;
    for (const match of fragment.matchAll(ids)) usedIds.add(match[2] ?? '');
  };
  for (const entries of layerBodies.values()) {
    for (const { fragment } of entries) collectIds(fragment);
  }
  collectIds(backgroundSvg);
  for (const fragment of fullCanvasSvg) collectIds(fragment);
  collectIds(overlaySvg);
  for (const fragment of hookSvg) collectIds(fragment);

  const clippedEntries = [...layerBodies.values()].flat().filter((entry) => entry.clip !== null);
  let clipPrefix = 'fieldnotes-export-clip';
  for (let suffix = 0; ; suffix++) {
    const candidate = suffix === 0 ? clipPrefix : `${clipPrefix}-${suffix}`;
    if (clippedEntries.every((_, ordinal) => !usedIds.has(`${candidate}-${ordinal}`))) {
      clipPrefix = candidate;
      break;
    }
  }
  const clipDefs: string[] = [];
  let clipOrdinal = 0;
  for (const entries of layerBodies.values()) {
    for (const entry of entries) {
      if (entry.clip === null) continue;
      const id = `${clipPrefix}-${clipOrdinal++}`;
      const { x, y, w, h } = entry.clip;
      clipDefs.push(
        `<clipPath id="${id}"><rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" /></clipPath>`,
      );
      entry.fragment = `<g clip-path="url(#${id})">${entry.fragment}</g>`;
    }
  }

  let body = clipDefs.length > 0 ? `<defs>${clipDefs.join('')}</defs>` : '';
  body += backgroundSvg;
  for (const [layerId, entries] of layerBodies) {
    const emitted = entries.map((entry) => entry.fragment).join('');
    const opacity = layerManager?.getLayer?.(layerId)?.opacity ?? 1;
    const isolate =
      theme.base === 'dark' &&
      entries.some(({ element }) => element.type === 'stroke' && element.blendMode === 'multiply');
    body +=
      opacity === 1 || emitted === ''
        ? isolate
          ? `<g style="isolation:isolate">${emitted}</g>`
          : emitted
        : `<g opacity="${n(opacity)}"${isolate ? ' style="isolation:isolate"' : ''}>${emitted}</g>`;
  }
  for (const svg of fullCanvasSvg) {
    body += svg;
  }

  body += overlaySvg;

  body += hookSvg.join('');

  const sceneJson = options.embedScene
    ? serializeSceneEnvelope(
        buildSceneEnvelope(visibleElements, bounds, layerManager, registry),
        options,
      )
    : null;
  const fontCss = await loadFontFaces(
    selectFaces(options.fonts ?? [], textFontFamily(), used),
    positiveOption(options.imageTimeoutMs, 10_000, 'imageTimeoutMs'),
    options.onFontError,
  );
  const metadata = sceneJson === null ? '' : `<metadata>${attr(sceneJson)}</metadata>`;
  const style = fontCss.length === 0 ? '' : `<style>${attr(fontCss.join(''))}</style>`;
  body = `${metadata}${style}${body}`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${rootNumber(bounds.w)}" height="${rootNumber(bounds.h)}" ` +
    `viewBox="${rootNumber(bounds.x)} ${rootNumber(bounds.y)} ${rootNumber(bounds.w)} ${rootNumber(bounds.h)}">${body}</svg>`
  );
}

function emitElement(
  el: CanvasElement,
  imageDataUris: Map<string, string>,
  htmlDataUris: Map<string, string>,
  store: ElementStore,
  registry: ElementRegistry,
  viewBox: { x: number; y: number; w: number; h: number },
  measurer: SvgMeasurer | null,
  used: Set<string>,
  theme: ResolvedTheme,
  renderContext: { readonly theme: ResolvedTheme },
): string {
  switch (el.type) {
    case 'stroke':
      return withRotationSvg(el, emitStroke(el, theme));
    case 'shape':
      return withRotationSvg(el, emitShape(el, theme));
    case 'arrow':
      return emitArrow(el, store, measurer, used, theme);
    case 'image':
      return withRotationSvg(el, emitImage(el, imageDataUris.get(el.id)));
    case 'text': {
      const container = getBoundTextContainerId(el);
      const parent = container ? store.getById(container) : undefined;
      return withRotationSvg(
        el,
        emitText(
          el,
          measurer,
          used,
          theme,
          parent?.type === 'shape' && parent.fillColor !== 'none' ? parent.fillColor : null,
        ),
      );
    }
    case 'note':
      return withRotationSvg(el, emitNote(el, measurer, used, theme));
    case 'html':
      return withRotationSvg(el, emitImage(el, htmlDataUris.get(el.id)));
    case 'extension': {
      const adapter = registry.getAdapter(el.extensionType);
      if (adapter?.emitSvg) {
        const allElements = store.getAll();
        return adapter.emitSvg(el, allElements, viewBox, renderContext);
      }
      return '';
    }
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
    if (!painter) {
      // Routing was resolved before `await renderHtmlElements(...)`; a painter unregistered
      // inside that window lands here. Reporting it keeps every dropped element accounted
      // for — a silent omission is the one outcome this exporter never produces.
      options.onHtmlError?.({
        elementId: element.id,
        htmlType: element.htmlType,
        reason: 'missing-painter',
      });
      continue;
    }
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
