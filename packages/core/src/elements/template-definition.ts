import type { Bounds } from '../core/types';
import type {
  ElementTypeDefinition,
  ExtensionElementEnvelope,
  TemplateElement,
  TemplateRenderStyle,
  TemplateShape,
} from './types';

function isEnum(value: unknown, allowed: readonly string[]): boolean {
  return typeof value === 'string' && allowed.includes(value);
}

function isFiniteNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

function isString(value: unknown): boolean {
  return typeof value === 'string';
}

function isOptional(value: unknown, check: (v: unknown) => boolean): boolean {
  return value === undefined || check(value);
}

const TEMPLATE_SHAPES: readonly TemplateShape[] = ['circle', 'cone', 'line', 'square', 'rectangle'];

const RENDER_STYLES: readonly TemplateRenderStyle[] = ['cells', 'geometric'];

export const templateElementTypeDefinition: ElementTypeDefinition<TemplateElement> = {
  type: 'vtt:template',
  legacyTypes: ['template'],

  decodeLegacy(raw: Record<string, unknown>): TemplateElement {
    const el: TemplateElement = {
      id: raw['id'] as string,
      type: 'template',
      position: raw['position'] as { x: number; y: number },
      zIndex: raw['zIndex'] as number,
      locked: raw['locked'] as boolean,
      layerId: raw['layerId'] as string,
      templateShape: raw['templateShape'] as TemplateShape,
      radius: raw['radius'] as number,
      angle: raw['angle'] as number,
      fillColor: raw['fillColor'] as string,
      strokeColor: raw['strokeColor'] as string,
      strokeWidth: raw['strokeWidth'] as number,
      opacity: raw['opacity'] as number,
    };
    if (raw['width'] !== undefined) el.width = raw['width'] as number;
    if (raw['feetPerCell'] !== undefined) el.feetPerCell = raw['feetPerCell'] as number;
    if (raw['radiusFeet'] !== undefined) el.radiusFeet = raw['radiusFeet'] as number;
    if (raw['renderStyle'] !== undefined)
      el.renderStyle = raw['renderStyle'] as TemplateRenderStyle;
    return el;
  },

  encodeLegacy(el: TemplateElement): Record<string, unknown> {
    const result: Record<string, unknown> = {
      id: el.id,
      type: 'template',
      position: el.position,
      zIndex: el.zIndex,
      locked: el.locked,
      layerId: el.layerId,
      templateShape: el.templateShape,
      radius: el.radius,
      angle: el.angle,
      fillColor: el.fillColor,
      strokeColor: el.strokeColor,
      strokeWidth: el.strokeWidth,
      opacity: el.opacity,
    };
    if (el.width !== undefined) result['width'] = el.width;
    if (el.feetPerCell !== undefined) result['feetPerCell'] = el.feetPerCell;
    if (el.radiusFeet !== undefined) result['radiusFeet'] = el.radiusFeet;
    if (el.renderStyle !== undefined) result['renderStyle'] = el.renderStyle;
    return result;
  },

  validateData(data: Record<string, unknown>): boolean {
    return (
      isEnum(data['templateShape'], TEMPLATE_SHAPES) &&
      isFiniteNumber(data['radius']) &&
      isFiniteNumber(data['angle']) &&
      isOptional(data['width'], isFiniteNumber) &&
      isString(data['fillColor']) &&
      isString(data['strokeColor']) &&
      isFiniteNumber(data['strokeWidth']) &&
      isFiniteNumber(data['opacity']) &&
      isOptional(data['feetPerCell'], isFiniteNumber) &&
      isOptional(data['radiusFeet'], isFiniteNumber) &&
      isOptional(data['renderStyle'], (v) => isEnum(v, RENDER_STYLES))
    );
  },

  unwrap(el: ExtensionElementEnvelope): TemplateElement {
    const tmpl: TemplateElement = {
      id: el.id,
      type: 'template',
      position: el.position,
      zIndex: el.zIndex,
      locked: el.locked,
      layerId: el.layerId,
      groupId: el.groupId,
      rotation: el.rotation,
      templateShape: el.data['templateShape'] as TemplateShape,
      radius: el.data['radius'] as number,
      angle: el.data['angle'] as number,
      fillColor: el.data['fillColor'] as string,
      strokeColor: el.data['strokeColor'] as string,
      strokeWidth: el.data['strokeWidth'] as number,
      opacity: el.data['opacity'] as number,
    };
    if (el.data['width'] !== undefined) tmpl.width = el.data['width'] as number;
    if (el.data['feetPerCell'] !== undefined) tmpl.feetPerCell = el.data['feetPerCell'] as number;
    if (el.data['radiusFeet'] !== undefined) tmpl.radiusFeet = el.data['radiusFeet'] as number;
    if (el.data['renderStyle'] !== undefined)
      tmpl.renderStyle = el.data['renderStyle'] as TemplateRenderStyle;
    return tmpl;
  },

  wrap(el: TemplateElement): ExtensionElementEnvelope {
    const data: Record<string, unknown> = {
      templateShape: el.templateShape,
      radius: el.radius,
      angle: el.angle,
      fillColor: el.fillColor,
      strokeColor: el.strokeColor,
      strokeWidth: el.strokeWidth,
      opacity: el.opacity,
    };
    if (el.width !== undefined) data['width'] = el.width;
    if (el.feetPerCell !== undefined) data['feetPerCell'] = el.feetPerCell;
    if (el.radiusFeet !== undefined) data['radiusFeet'] = el.radiusFeet;
    if (el.renderStyle !== undefined) data['renderStyle'] = el.renderStyle;

    return {
      id: el.id,
      type: 'extension',
      extensionType: 'vtt:template',
      position: el.position,
      zIndex: el.zIndex,
      locked: el.locked,
      layerId: el.layerId,
      groupId: el.groupId,
      rotation: el.rotation,
      data,
    };
  },

  bounds(el: TemplateElement): Bounds | null {
    return getTemplateBounds(el);
  },

  renderMode: 'canvas',
};

function getTemplateBounds(el: TemplateElement): Bounds {
  const { x: cx, y: cy } = el.position;
  const r = el.radius;

  switch (el.templateShape) {
    case 'circle':
      return { x: cx - r, y: cy - r, w: 2 * r, h: 2 * r };

    case 'square':
      return { x: cx - r / 2, y: cy - r / 2, w: r, h: r };

    case 'cone': {
      const halfAngle = Math.atan(0.5);
      const tipX = cx;
      const tipY = cy;
      const leftX = cx + r * Math.cos(el.angle - halfAngle);
      const leftY = cy + r * Math.sin(el.angle - halfAngle);
      const rightX = cx + r * Math.cos(el.angle + halfAngle);
      const rightY = cy + r * Math.sin(el.angle + halfAngle);
      const farX = cx + r * Math.cos(el.angle);
      const farY = cy + r * Math.sin(el.angle);

      const xs = [tipX, leftX, rightX, farX];
      const ys = [tipY, leftY, rightY, farY];

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      for (let i = 0; i < xs.length; i++) {
        const px = xs[i];
        const py = ys[i];
        if (px === undefined || py === undefined) continue;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }

      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }

    case 'line': {
      const halfW = r / 12;
      const cos = Math.cos(el.angle);
      const sin = Math.sin(el.angle);
      const perpX = -sin * halfW;
      const perpY = cos * halfW;

      const x0 = cx + perpX;
      const y0 = cy + perpY;
      const x1 = cx + r * cos + perpX;
      const y1 = cy + r * sin + perpY;
      const x2 = cx + r * cos - perpX;
      const y2 = cy + r * sin - perpY;
      const x3 = cx - perpX;
      const y3 = cy - perpY;

      return {
        x: Math.min(x0, x1, x2, x3),
        y: Math.min(y0, y1, y2, y3),
        w: Math.max(x0, x1, x2, x3) - Math.min(x0, x1, x2, x3),
        h: Math.max(y0, y1, y2, y3) - Math.min(y0, y1, y2, y3),
      };
    }

    case 'rectangle': {
      const halfW = (el.width ?? 0) / 2;
      const cos = Math.cos(el.angle);
      const sin = Math.sin(el.angle);
      const perpX = -sin * halfW;
      const perpY = cos * halfW;
      const x0 = cx + perpX;
      const y0 = cy + perpY;
      const x1 = cx + r * cos + perpX;
      const y1 = cy + r * sin + perpY;
      const x2 = cx + r * cos - perpX;
      const y2 = cy + r * sin - perpY;
      const x3 = cx - perpX;
      const y3 = cy - perpY;
      const minX = Math.min(x0, x1, x2, x3);
      const minY = Math.min(y0, y1, y2, y3);
      return {
        x: minX,
        y: minY,
        w: Math.max(x0, x1, x2, x3) - minX,
        h: Math.max(y0, y1, y2, y3) - minY,
      };
    }
  }
}
