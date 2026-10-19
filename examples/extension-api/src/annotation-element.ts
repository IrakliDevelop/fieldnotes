import type {
  ElementTypeDefinition,
  ExtensionElementEnvelope,
  BaseElement,
  Bounds,
  Point,
  Size,
} from '@fieldnotes/core';
import { pickBaseFields } from '@fieldnotes/core';

// ─── 1. Define the typed element ──────────────────────────────────────────────
// Extension elements extend BaseElement with domain-specific fields.
// These fields are stored flat on the typed element and packed into `data`
// on the ExtensionElementEnvelope for serialization.

export interface AnnotationElement extends BaseElement {
  type: 'example:annotation';
  label: string;
  color: string;
  // Carried on the envelope (not in `data`) so core draws resize handles for it.
  size: Size;
}

// ─── 2. Define the element type definition ────────────────────────────────────
// This is the full contract core needs to validate, render, serialize, and
// hit-test your element type.

export const annotationDefinition: ElementTypeDefinition<AnnotationElement> = {
  // Namespaced type string — must be unique across all registered extensions.
  type: 'example:annotation',

  // Legacy type names for v3 wire compat. Empty when there is no legacy format.
  legacyTypes: [],

  // ── Validation ────────────────────────────────────────────────────────────
  // Called on deserialization and when receiving envelopes from peers.
  validateData(data: Record<string, unknown>): boolean {
    return typeof data['label'] === 'string' && typeof data['color'] === 'string';
  },

  // ── Envelope ↔ typed conversion ──────────────────────────────────────────
  // wrap: typed element → ExtensionElementEnvelope (for storage/sync).
  // unwrap: ExtensionElementEnvelope → typed element (for rendering/logic).
  wrap(el: AnnotationElement): ExtensionElementEnvelope {
    return {
      // pickBaseFields copies id, position, index, version and the other base fields.
      ...pickBaseFields(el),
      type: 'extension',
      extensionType: 'example:annotation',
      size: el.size,
      data: {
        label: el.label,
        color: el.color,
      },
    };
  },

  unwrap(el: ExtensionElementEnvelope): AnnotationElement {
    return {
      ...pickBaseFields(el),
      type: 'example:annotation',
      label: el.data['label'] as string,
      color: el.data['color'] as string,
      size: el.size ?? { w: 40, h: 40 },
    };
  },

  // ── Geometry ──────────────────────────────────────────────────────────────
  bounds(el: AnnotationElement): Bounds {
    return { ...el.position, w: el.size.w, h: el.size.h };
  },

  hitTest(el: AnnotationElement, point: Point): boolean {
    const { x, y } = el.position;
    return point.x >= x && point.x <= x + el.size.w && point.y >= y && point.y <= y + el.size.h;
  },

  // ── Rendering ─────────────────────────────────────────────────────────────
  render(ctx: CanvasRenderingContext2D, el: AnnotationElement): void {
    const { w, h } = el.size;
    const r = Math.min(w, h) / 2;

    // Draw a filled star centred in the box
    ctx.save();
    ctx.translate(el.position.x + w / 2, el.position.y + h / 2);
    if (el.rotation) ctx.rotate(el.rotation);

    ctx.fillStyle = el.color;
    ctx.beginPath();
    drawStar(ctx, 0, 0, 5, r, r * 0.4);
    ctx.fill();

    // Label sits inside the box (top-left) so bounds, hit test, and handles stay the box.
    ctx.fillStyle = '#333';
    ctx.font = `${LABEL_FONT_SIZE}px system-ui`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(el.label, -w / 2 + LABEL_PAD, -h / 2 + LABEL_PAD, Math.max(0, w - 2 * LABEL_PAD));

    ctx.restore();
  },

  // ── SVG export ────────────────────────────────────────────────────────────
  emitSvg(el: AnnotationElement): string {
    const { w, h } = el.size;
    const r = Math.min(w, h) / 2;
    const x = el.position.x + w / 2;
    const y = el.position.y + h / 2;
    return (
      `<circle cx="${x}" cy="${y}" r="${r}" fill="${escapeXml(el.color)}" />` +
      `<text x="${el.position.x + LABEL_PAD}" y="${el.position.y + LABEL_PAD}" dominant-baseline="hanging" font-size="${LABEL_FONT_SIZE}">${escapeXml(el.label)}</text>`
    );
  },

  // ── Legacy decode (needed when legacyTypes is non-empty for v3→v4 migration) ──
  decodeLegacy: (raw) => raw as unknown as AnnotationElement,
};

const LABEL_FONT_SIZE = 12;
const LABEL_PAD = 4;

// User text goes into SVG markup, so it must not be able to inject elements or attributes.
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ─── Helper: draw a 5-pointed star ─────────────────────────────────────────────

function drawStar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  spikes: number,
  outerRadius: number,
  innerRadius: number,
): void {
  let rot = (Math.PI / 2) * 3;
  const step = Math.PI / spikes;
  ctx.moveTo(cx, cy - outerRadius);
  for (let i = 0; i < spikes; i++) {
    ctx.lineTo(cx + Math.cos(rot) * outerRadius, cy + Math.sin(rot) * outerRadius);
    rot += step;
    ctx.lineTo(cx + Math.cos(rot) * innerRadius, cy + Math.sin(rot) * innerRadius);
    rot += step;
  }
  ctx.lineTo(cx, cy - outerRadius);
  ctx.closePath();
}
