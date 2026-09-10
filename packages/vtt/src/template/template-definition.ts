import type { Bounds, CanvasElement } from '@fieldnotes/core';
import type {
  ElementTypeDefinition,
  ExtensionElementEnvelope,
  ExtensionInteractionContext,
  Point,
} from '@fieldnotes/core';
import type { TemplateElement, TemplateRenderStyle, TemplateShape } from '../elements/types';
import { renderTemplate, emitTemplateSvg } from './template-renderer';

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
const HANDLE_SIZE = 8;
const HANDLE_HIT_PADDING = 4;
const AIM_HANDLE_OFFSET = 24;
const MIN_TEMPLATE_SIZE = 20;

function normalizeAngle(angle: number): number {
  const full = Math.PI * 2;
  const normalized = ((((angle + Math.PI) % full) + full) % full) - Math.PI;
  return normalized === -Math.PI ? Math.PI : normalized;
}

function rotatePoint(point: Point, center: Point, angle: number): Point {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
}

/** World-units per grid cell, independent of whether snapping is on. */
function gridUnit(context: ExtensionInteractionContext): number | null {
  const size = context.snap.size;
  if (size === undefined || size <= 0) return null;
  return context.snap.mode === 'hex' ? Math.sqrt(3) * size : size;
}

function snapUnit(context: ExtensionInteractionContext): number | null {
  return context.snap.enabled ? gridUnit(context) : null;
}

function snapLength(value: number, context: ExtensionInteractionContext): number {
  const unit = snapUnit(context);
  return unit ? Math.max(unit, Math.round(value / unit) * unit) : value;
}

function hitRadius(point: Point, target: Point, radius: number): boolean {
  const dx = point.x - target.x;
  const dy = point.y - target.y;
  return dx * dx + dy * dy <= radius * radius;
}

function aimKnob(el: TemplateElement, zoom: number): Point | null {
  if (!['cone', 'line', 'rectangle'].includes(el.templateShape)) return null;
  const distance = el.radius + AIM_HANDLE_OFFSET / zoom;
  return {
    x: el.position.x + distance * Math.cos(el.angle),
    y: el.position.y + distance * Math.sin(el.angle),
  };
}

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
      groupId: raw['groupId'] as string | undefined,
      rotation: raw['rotation'] as number | undefined,
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
    if (el.groupId !== undefined) result['groupId'] = el.groupId;
    if (el.rotation !== undefined) result['rotation'] = el.rotation;
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

  hitTest(el: TemplateElement, point): boolean {
    const bounds = getTemplateBounds(el);
    return (
      point.x >= bounds.x &&
      point.x <= bounds.x + bounds.w &&
      point.y >= bounds.y &&
      point.y <= bounds.y + bounds.h
    );
  },

  interaction: {
    hitTestHandle(el, point, context) {
      const hit = (HANDLE_SIZE / 2 + HANDLE_HIT_PADDING) / context.zoom;
      // Length, width, and aim handles are drawn only for a single selection
      // (see renderSelection); an undrawn handle must not capture the pointer.
      const single = context.selectedCount === 1;
      if (el.templateShape === 'rectangle') {
        if (!single) return null;
        const cos = Math.cos(el.angle);
        const sin = Math.sin(el.angle);
        const length = {
          x: el.position.x + el.radius * cos,
          y: el.position.y + el.radius * sin,
        };
        if (hitRadius(point, length, hit)) return { id: 'length', cursor: 'ew-resize' };
        const halfWidth = (el.width ?? 0) / 2;
        const width = {
          x: el.position.x + (el.radius / 2) * cos - halfWidth * sin,
          y: el.position.y + (el.radius / 2) * sin + halfWidth * cos,
        };
        if (hitRadius(point, width, hit)) return { id: 'width', cursor: 'ns-resize' };
      } else {
        const bounds = getTemplateBounds(el);
        const resize = { x: bounds.x + bounds.w, y: bounds.y + bounds.h };
        if (Math.abs(point.x - resize.x) <= hit && Math.abs(point.y - resize.y) <= hit) {
          return { id: 'radius', cursor: 'nwse-resize' };
        }
      }
      const aim = single ? aimKnob(el, context.zoom) : null;
      return aim && hitRadius(point, aim, hit) ? { id: 'aim', cursor: 'grab' } : null;
    },

    updateHandle(el, handleId, point, context) {
      if (handleId === 'aim') {
        let angle = Math.atan2(point.y - el.position.y, point.x - el.position.x);
        if (context.shiftKey) {
          const increment = context.snap.mode === 'hex' ? Math.PI / 3 : Math.PI / 12;
          angle = Math.round(angle / increment) * increment;
        }
        return { ...el, angle: normalizeAngle(angle) };
      }
      if (handleId === 'width') {
        const cos = Math.cos(el.angle);
        const sin = Math.sin(el.angle);
        const perpendicular = Math.abs(
          -(point.x - el.position.x) * sin + (point.y - el.position.y) * cos,
        );
        return {
          ...el,
          width: Math.max(MIN_TEMPLATE_SIZE, snapLength(perpendicular * 2, context)),
        };
      }
      let radius =
        handleId === 'length'
          ? (point.x - el.position.x) * Math.cos(el.angle) +
            (point.y - el.position.y) * Math.sin(el.angle)
          : Math.hypot(point.x - el.position.x, point.y - el.position.y);
      radius = Math.max(MIN_TEMPLATE_SIZE, snapLength(radius, context));
      // Feet track the grid metric even with snapping off; the label must
      // never lag behind the dragged radius.
      const unit = gridUnit(context);
      return {
        ...el,
        radius,
        ...(el.feetPerCell !== undefined && unit
          ? { radiusFeet: (radius / unit) * el.feetPerCell }
          : {}),
      };
    },

    renderSelection(ctx, el, context) {
      const handleSize = HANDLE_SIZE / context.zoom;
      const drawSquare = (point: Point): void => {
        ctx.fillRect(point.x - handleSize / 2, point.y - handleSize / 2, handleSize, handleSize);
        ctx.strokeRect(point.x - handleSize / 2, point.y - handleSize / 2, handleSize, handleSize);
      };
      ctx.setLineDash([]);
      ctx.fillStyle = '#ffffff';
      if (el.templateShape === 'rectangle') {
        if (context.selectedCount === 1) {
          const cos = Math.cos(el.angle);
          const sin = Math.sin(el.angle);
          const halfWidth = (el.width ?? 0) / 2;
          drawSquare({ x: el.position.x + el.radius * cos, y: el.position.y + el.radius * sin });
          drawSquare({
            x: el.position.x + (el.radius / 2) * cos - halfWidth * sin,
            y: el.position.y + (el.radius / 2) * sin + halfWidth * cos,
          });
        }
      } else {
        const bounds = getTemplateBounds(el);
        drawSquare({ x: bounds.x + bounds.w, y: bounds.y + bounds.h });
      }
      const aim = context.selectedCount === 1 ? aimKnob(el, context.zoom) : null;
      if (aim) {
        ctx.beginPath();
        ctx.moveTo(el.position.x, el.position.y);
        ctx.lineTo(aim.x, aim.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(aim.x, aim.y, handleSize / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.setLineDash([4 / context.zoom, 4 / context.zoom]);
    },

    rotate(el, pivot, delta) {
      return {
        ...el,
        position: rotatePoint(el.position, pivot, delta),
        angle: normalizeAngle(el.angle + delta),
      };
    },
  },

  renderMode: 'canvas',

  render(
    ctx: CanvasRenderingContext2D,
    template: TemplateElement,
    allElements: readonly CanvasElement[],
  ): void {
    renderTemplate(ctx, template, allElements);
  },

  emitSvg(template: TemplateElement, allElements: readonly CanvasElement[]): string {
    return emitTemplateSvg(template, allElements);
  },
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
