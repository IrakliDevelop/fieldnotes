import type {
  ElementTypeDefinition,
  ExtensionElementEnvelope,
  BaseElement,
  Bounds,
  Point,
} from '@fieldnotes/core';

// ─── 1. Define the typed element ──────────────────────────────────────────────
// Extension elements extend BaseElement with domain-specific fields.
// These fields are stored flat on the typed element and packed into `data`
// on the ExtensionElementEnvelope for serialization.

export interface AnnotationElement extends BaseElement {
  type: 'example:annotation';
  label: string;
  color: string;
  radius: number;
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
    return (
      typeof data['label'] === 'string' &&
      typeof data['color'] === 'string' &&
      typeof data['radius'] === 'number' &&
      Number.isFinite(data['radius'])
    );
  },

  // ── Envelope ↔ typed conversion ──────────────────────────────────────────
  // wrap: typed element → ExtensionElementEnvelope (for storage/sync).
  // unwrap: ExtensionElementEnvelope → typed element (for rendering/logic).
  wrap(el: AnnotationElement): ExtensionElementEnvelope {
    return {
      id: el.id,
      type: 'extension',
      extensionType: 'example:annotation',
      position: el.position,
      zIndex: el.zIndex,
      locked: el.locked,
      layerId: el.layerId,
      groupId: el.groupId,
      rotation: el.rotation,
      data: {
        label: el.label,
        color: el.color,
        radius: el.radius,
      },
    };
  },

  unwrap(el: ExtensionElementEnvelope): AnnotationElement {
    return {
      id: el.id,
      type: 'example:annotation',
      position: el.position,
      zIndex: el.zIndex,
      locked: el.locked,
      layerId: el.layerId,
      groupId: el.groupId,
      rotation: el.rotation,
      label: el.data['label'] as string,
      color: el.data['color'] as string,
      radius: el.data['radius'] as number,
    };
  },

  // ── Geometry ──────────────────────────────────────────────────────────────
  bounds(el: AnnotationElement): Bounds {
    const r = el.radius;
    return {
      x: el.position.x - r,
      y: el.position.y - r,
      w: r * 2,
      h: r * 2,
    };
  },

  hitTest(el: AnnotationElement, point: Point): boolean {
    const dx = point.x - el.position.x;
    const dy = point.y - el.position.y;
    return dx * dx + dy * dy <= el.radius * el.radius;
  },

  // ── Rendering ─────────────────────────────────────────────────────────────
  render(ctx: CanvasRenderingContext2D, el: AnnotationElement): void {
    const { x, y } = el.position;
    const r = el.radius;

    // Draw a filled star
    ctx.save();
    ctx.translate(x, y);
    if (el.rotation) ctx.rotate(el.rotation);

    ctx.fillStyle = el.color;
    ctx.beginPath();
    drawStar(ctx, 0, 0, 5, r, r * 0.4);
    ctx.fill();

    // Draw the label below the star
    ctx.fillStyle = '#333';
    ctx.font = `${Math.max(10, r * 0.6)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(el.label, 0, r + 2);

    ctx.restore();
  },

  // ── SVG export ────────────────────────────────────────────────────────────
  emitSvg(el: AnnotationElement): string {
    const { x, y } = el.position;
    const r = el.radius;
    return (
      `<circle cx="${x}" cy="${y}" r="${r}" fill="${el.color}" />` +
      `<text x="${x}" y="${y + r + 12}" text-anchor="middle" font-size="${Math.max(10, r * 0.6)}">${el.label}</text>`
    );
  },

  // ── Legacy decode (needed when legacyTypes is non-empty for v3→v4 migration) ──
  decodeLegacy: (raw) => raw as unknown as AnnotationElement,
};

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
