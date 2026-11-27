import type { ElementStore } from '../elements/element-store';
import type { LayerManager } from '../layers/layer-manager';
import { parseElementLink } from '../elements/link';
import { getElementRect } from '../elements/element-rect';
import {
  assertRenderCapabilities,
  fitExportScale,
  nonNegativeOption,
  paintExport,
  positiveOption,
  prepareExport,
  withAssetWarning,
} from './export-image';
import type { ExportImageOptions, PreparedExport } from './export-image';
import { isExportSource } from './export-viewport';
import type { ExportSource } from './export-viewport';
import { deflate, pdfNumber, pdfString, PdfWriter } from './pdf-writer';
import { defaultExportBackground, resolveTheme } from './theme';
import { parseColor } from './theme-color';

/** Page size in PDF points (1/72 in). */
export type PdfPageSize = 'a4' | 'letter' | { readonly width: number; readonly height: number };

/** Options for raster PDF export. */
export interface ExportPdfOptions extends Omit<
  ExportImageOptions,
  | 'frameId'
  | 'region'
  | 'scale'
  | 'scaleMode'
  | 'format'
  | 'quality'
  | 'embedScene'
  | 'onSceneOmitted'
> {
  /** One page per root frame, in this order. Omitted: one page for the whole board. */
  frameIds?: readonly string[];
  /** Default 'a4'. A4 is 595.28 × 841.89 pt, Letter 612 × 792 pt. */
  pageSize?: PdfPageSize;
  /** Default 'auto': landscape when the page content is wider than tall. */
  orientation?: 'portrait' | 'landscape' | 'auto';
  /** Page margin in points. Default 36. */
  margin?: number;
  /** Raster density of each page in pixels per inch. Default 144. */
  dpi?: number;
  /** Default true; false omits link annotations. */
  links?: boolean;
}

const PAGE_SIZES = { a4: { width: 595.28, height: 841.89 }, letter: { width: 612, height: 792 } };

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Page {
  prepared: PreparedExport;
  frameId: string | undefined;
  width: number;
  height: number;
  scale: number;
  x: number;
  y: number;
}

function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  return right > x && bottom > y ? { x, y, w: right - x, h: bottom - y } : null;
}

function pageSize(size: PdfPageSize | undefined): { width: number; height: number } {
  if (size === undefined || size === 'a4') return PAGE_SIZES.a4;
  if (size === 'letter') return PAGE_SIZES.letter;
  return {
    width: positiveOption(size.width, 0, 'pageSize.width'),
    height: positiveOption(size.height, 0, 'pageSize.height'),
  };
}

function rgb(data: Uint8ClampedArray): Uint8Array {
  const output = new Uint8Array((data.length / 4) * 3);
  for (let source = 0, target = 0; source < data.length; source += 4, target += 3) {
    const alpha = data[source + 3] ?? 0;
    output[target] = Math.round(((data[source] ?? 0) * alpha + 255 * (255 - alpha)) / 255);
    output[target + 1] = Math.round(((data[source + 1] ?? 0) * alpha + 255 * (255 - alpha)) / 255);
    output[target + 2] = Math.round(((data[source + 2] ?? 0) * alpha + 255 * (255 - alpha)) / 255);
  }
  return output;
}

function annotations(
  page: Page,
  pages: readonly Page[],
  pageIds: readonly number[],
  writer: PdfWriter,
): string[] {
  const result: string[] = [];
  for (const element of page.prepared.paintable) {
    if (!element.link) continue;
    const rect = getElementRect(element, page.prepared.registry);
    const clip = page.prepared.clips.get(element.id);
    if (clip === undefined) continue;
    const withinPage = rect && intersect(rect, page.prepared.bounds);
    const clipped = withinPage && (clip === null ? withinPage : intersect(withinPage, clip));
    if (!clipped) continue;
    const x1 = page.x + (clipped.x - page.prepared.bounds.x) * page.scale;
    const x2 = x1 + clipped.w * page.scale;
    const y2 = page.height - (page.y + (clipped.y - page.prepared.bounds.y) * page.scale);
    const y1 = y2 - clipped.h * page.scale;
    const target = parseElementLink(element.link);
    let action: string | null = null;
    if (target) {
      const framePageIndex = pages.findIndex((candidate) => candidate.frameId === target);
      const targetIndex =
        framePageIndex >= 0
          ? framePageIndex
          : pages.findIndex((candidate) =>
              candidate.prepared.paintable.some(
                (candidateElement) => candidateElement.id === target,
              ),
            );
      if (targetIndex >= 0) action = `/Dest [${pageIds[targetIndex]} 0 R /Fit]`;
    } else {
      try {
        const url = new URL(element.link);
        if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:') {
          action = `/A << /S /URI /URI ${pdfString(url.href)} >>`;
        }
      } catch {
        // Existing element links are validated at creation; unsupported legacy links are skipped.
      }
    }
    if (action) {
      const id = writer.addObject(
        `<< /Type /Annot /Subtype /Link /Rect [${pdfNumber(x1)} ${pdfNumber(y1)} ${pdfNumber(x2)} ${pdfNumber(y2)}] /Border [0 0 0] ${action} >>`,
      );
      result.push(`${id} 0 R`);
    }
  }
  return result;
}

/** Exports the board or selected frames as fitted raster PDF pages. */
export function exportPdf(viewport: ExportSource, options?: ExportPdfOptions): Promise<Blob | null>;
export function exportPdf(
  store: ElementStore,
  options?: ExportPdfOptions,
  layerManager?: LayerManager,
): Promise<Blob | null>;
export async function exportPdf(
  store: ElementStore | ExportSource,
  options: ExportPdfOptions = {},
  layerManager?: LayerManager,
): Promise<Blob | null> {
  if (isExportSource(store)) {
    const defaults = store.exportDefaults();
    return exportPdf(defaults.store, defaults.options(options), defaults.layerManager);
  }
  assertRenderCapabilities(
    options.renderHooks?.imageExport,
    'imageExport',
    options.requiredCapabilities,
  );
  if (
    options.frameIds &&
    (options.frameIds.length === 0 || new Set(options.frameIds).size !== options.frameIds.length)
  )
    throw new RangeError('frameIds must be non-empty and unique');
  const margin = nonNegativeOption(options.margin, 36, 'margin');
  const dpi = positiveOption(options.dpi, 144, 'dpi');
  const orientation = options.orientation ?? 'auto';
  if (!['portrait', 'landscape', 'auto'].includes(orientation))
    throw new RangeError("orientation must be 'portrait', 'landscape', or 'auto'");
  const requestedSize = pageSize(options.pageSize);
  if (requestedSize.width - margin * 2 <= 0 || requestedSize.height - margin * 2 <= 0)
    throw new RangeError('margin must leave a printable area');
  const short = Math.min(requestedSize.width, requestedSize.height);
  const long = Math.max(requestedSize.width, requestedSize.height);
  const reporting = withAssetWarning(options);
  const theme = resolveTheme(options.theme ?? 'light');
  const background = options.background ?? defaultExportBackground(theme);
  const ids = options.frameIds ?? [undefined];
  const prepared = ids.map((frameId) =>
    prepareExport(store, { ...options, frameId, background }, layerManager, theme),
  );
  if (!options.frameIds && !prepared[0]) return null;
  const preparedPages: PreparedExport[] = [];
  for (const item of prepared) {
    if (!item) throw new Error('Unable to prepare PDF page');
    preparedPages.push(item);
  }
  const pages = preparedPages.map((preparedPage, index) => {
    const landscape =
      orientation === 'landscape' ||
      (orientation === 'auto' && preparedPage.bounds.w > preparedPage.bounds.h);
    const width = landscape ? long : short;
    const height = landscape ? short : long;
    const scale = Math.min(
      (width - margin * 2) / preparedPage.bounds.w,
      (height - margin * 2) / preparedPage.bounds.h,
    );
    return {
      prepared: preparedPage,
      frameId: ids[index],
      width,
      height,
      scale,
      x: (width - preparedPage.bounds.w * scale) / 2,
      y: (height - preparedPage.bounds.h * scale) / 2,
    };
  });
  const writer = new PdfWriter();
  const catalogId = writer.reserve();
  const pagesId = writer.reserve();
  const pageIds = pages.map(() => writer.reserve());
  for (const [index, page] of pages.entries()) {
    const pageId = pageIds[index];
    if (pageId === undefined) throw new Error('Missing PDF page object');
    const canvas = await paintExport(
      store,
      page.prepared,
      fitExportScale(page.prepared.bounds, (page.scale * dpi) / 72, options),
      reporting,
      layerManager,
    );
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const pixels = await deflate(rgb(ctx.getImageData(0, 0, canvas.width, canvas.height).data));
    const imageId = writer.addStream(
      `<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8${pixels.filter ? ` /Filter ${pixels.filter}` : ''} >>`,
      pixels.data,
    );
    const parsedBackground = parseColor(background);
    const pageFill =
      theme.base !== 'light' &&
      parsedBackground?.a === 1 &&
      (parsedBackground.r !== 255 || parsedBackground.g !== 255 || parsedBackground.b !== 255)
        ? `q ${pdfNumber(parsedBackground.r / 255)} ${pdfNumber(parsedBackground.g / 255)} ${pdfNumber(parsedBackground.b / 255)} rg 0 0 ${pdfNumber(page.width)} ${pdfNumber(page.height)} re f Q `
        : '';
    const contentId = writer.addStream(
      '<< >>',
      new TextEncoder().encode(
        `${pageFill}q ${pdfNumber(page.prepared.bounds.w * page.scale)} 0 0 ${pdfNumber(page.prepared.bounds.h * page.scale)} ${pdfNumber(page.x)} ${pdfNumber(page.y)} cm /Im0 Do Q`,
      ),
    );
    const annots = options.links === false ? [] : annotations(page, pages, pageIds, writer);
    writer.set(
      pageId,
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pdfNumber(page.width)} ${pdfNumber(page.height)}] /Contents ${contentId} 0 R /Resources << /XObject << /Im0 ${imageId} 0 R >> >>${annots.length ? ` /Annots [${annots.join(' ')}]` : ''} >>`,
    );
  }
  writer.set(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  writer.set(
    pagesId,
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  );
  const infoId = writer.addObject('<< /Producer (Field Notes) >>');
  const bytes = writer.finish(catalogId, infoId);
  const output = new Uint8Array(bytes.byteLength);
  output.set(bytes);
  return new Blob([output], { type: 'application/pdf' });
}
