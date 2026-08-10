import type { HtmlElement } from '../elements/types';
import type { HtmlPainter } from './html-painter-registry';
import type { HtmlPaintDiagnostic, HtmlRenderTarget } from './html-paint-diagnostics';

export interface PaintHtmlOptions {
  ctx: CanvasRenderingContext2D;
  zoom: number;
  target: HtmlRenderTarget;
  onDiagnostic?: (diagnostic: HtmlPaintDiagnostic) => void;
  /** Default true. Set false when the CALLER applies rotation (svg export wraps the
   *  raster in withRotationSvg, so rotating here would double-apply it). */
  applyRotation?: boolean;
}

/**
 * The single place canvas-routed html elements are drawn. Screen, minimap and
 * export all call this, so the transform math cannot drift between surfaces.
 * Deliberately applies NO layer opacity — each surface owns that boundary
 * (cached layers composite it; the hybrid path sets it per element).
 */
export function paintHtmlElement(
  el: Readonly<HtmlElement>,
  painter: HtmlPainter,
  opts: PaintHtmlOptions,
): void {
  const { ctx, zoom, target, onDiagnostic } = opts;
  const { w, h } = el.size;
  if (!(w > 0) || !(h > 0)) {
    onDiagnostic?.({ kind: 'degenerate-size', elementId: el.id, htmlType: el.htmlType, target });
    return;
  }

  ctx.save();
  try {
    const rotation = opts.applyRotation === false ? 0 : (el.rotation ?? 0);
    if (rotation !== 0) {
      ctx.translate(el.position.x + w / 2, el.position.y + h / 2);
      ctx.rotate(rotation);
      ctx.translate(-w / 2, -h / 2);
    } else {
      ctx.translate(el.position.x, el.position.y);
    }
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();
    painter({ ctx, element: el, size: { w, h }, zoom });
  } catch (error) {
    onDiagnostic?.({
      kind: 'painter-threw',
      elementId: el.id,
      htmlType: el.htmlType,
      target,
      error,
    });
  } finally {
    ctx.restore();
  }
}
