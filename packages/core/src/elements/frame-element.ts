import type { Bounds, Point, Size } from '../core/types';
import { createId } from './create-id';
import type { ElementTypeDefinition, ExtensionElementEnvelope } from './types';

/** The built-in extension type used for board frames. */
export const FRAME_ELEMENT_TYPE = 'core:frame';

const HEADER_HEIGHT = 24;
const MIN_WIDTH = 80;
const MIN_HEIGHT = 48;
const BORDER_HIT_WIDTH = 6;

/** Serializable frame-specific fields. */
export interface FrameData extends Record<string, unknown> {
  title: string;
  color: string;
}

/** Stored extension envelope for a frame. */
export interface FrameElement extends Omit<
  ExtensionElementEnvelope,
  'extensionType' | 'data' | 'size'
> {
  readonly extensionType: typeof FRAME_ELEMENT_TYPE;
  readonly size: Size;
  readonly data: FrameData;
}

/** Options accepted when creating a frame. */
export interface CreateFrameOptions {
  readonly position: Point;
  readonly size: Size;
  readonly title?: string;
  readonly color?: string;
  readonly layerId?: string;
  readonly index?: string;
  readonly version?: number;
  readonly locked?: boolean;
}

function isFinitePoint(point: unknown): point is Point {
  return (
    isRecord(point) &&
    typeof point.x === 'number' &&
    typeof point.y === 'number' &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y)
  );
}

function isFiniteSize(size: unknown): size is Size {
  return (
    isRecord(size) &&
    typeof size.w === 'number' &&
    typeof size.h === 'number' &&
    Number.isFinite(size.w) &&
    Number.isFinite(size.h)
  );
}

function hasFrameData(data: Record<string, unknown>): data is FrameData {
  return typeof data.title === 'string' && typeof data.color === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&apos;';
    }
  });
}

function cornerAt(el: FrameElement, id: string, zoom: number): Point | null {
  const pad = 4 / zoom;
  switch (id) {
    case 'nw':
      return { x: el.position.x - pad, y: el.position.y - pad };
    case 'ne':
      return { x: el.position.x + el.size.w + pad, y: el.position.y - pad };
    case 'sw':
      return { x: el.position.x - pad, y: el.position.y + el.size.h + pad };
    case 'se':
      return { x: el.position.x + el.size.w + pad, y: el.position.y + el.size.h + pad };
    default:
      return null;
  }
}

/** Creates a frame with safe geometry and default metadata. */
export function createFrame(options: CreateFrameOptions): FrameElement {
  if (!isFinitePoint(options.position) || !isFiniteSize(options.size)) {
    throw new Error('Frame position and size must be finite');
  }
  if (options.size.w < MIN_WIDTH || options.size.h < MIN_HEIGHT) {
    throw new Error(`Frame size must be at least ${MIN_WIDTH} x ${MIN_HEIGHT}`);
  }
  return {
    id: createId('frame'),
    type: 'extension',
    extensionType: FRAME_ELEMENT_TYPE,
    position: options.position,
    size: options.size,
    index: options.index ?? '',
    version: options.version ?? 1,
    locked: options.locked ?? false,
    layerId: options.layerId ?? '',
    dataVersion: 1,
    data: { title: options.title ?? 'Frame', color: options.color ?? '#64748b' },
  };
}

/** Returns whether a stored value is a complete, valid frame envelope. */
export function isFrameElement(value: unknown): value is FrameElement {
  if (!isRecord(value)) return false;
  const el = value;
  return (
    typeof el.id === 'string' &&
    el.type === 'extension' &&
    el.extensionType === FRAME_ELEMENT_TYPE &&
    isFinitePoint(el.position) &&
    isFiniteSize(el.size) &&
    el.size.w >= MIN_WIDTH &&
    el.size.h >= MIN_HEIGHT &&
    el.rotation === undefined &&
    el.parentId === undefined &&
    typeof el.index === 'string' &&
    typeof el.version === 'number' &&
    Number.isFinite(el.version) &&
    typeof el.locked === 'boolean' &&
    typeof el.layerId === 'string' &&
    isRecord(el.data) &&
    hasFrameData(el.data)
  );
}

/** Built-in behavior for frame envelopes. */
export const frameElementDefinition: ElementTypeDefinition<FrameElement> = {
  type: FRAME_ELEMENT_TYPE,
  legacyTypes: [],
  decodeLegacy: () => {
    throw new Error('Frames do not have a legacy element type');
  },
  validateData: hasFrameData,
  validateElement: isFrameElement,
  unwrap: (el) => {
    if (!isFrameElement(el)) throw new Error('Invalid frame envelope');
    return el;
  },
  wrap: (el) => el,
  bounds: (el): Bounds => ({ ...el.position, ...el.size }),
  clipBounds: (el): Bounds => ({
    x: el.position.x,
    y: el.position.y + HEADER_HEIGHT,
    w: el.size.w,
    h: el.size.h - HEADER_HEIGHT,
  }),
  hitTest: (el, point) => {
    const { x, y } = el.position;
    const { w, h } = el.size;
    if (point.x < x || point.x > x + w || point.y < y || point.y > y + h) return false;
    return (
      point.y <= y + HEADER_HEIGHT ||
      point.x <= x + BORDER_HIT_WIDTH ||
      point.x >= x + w - BORDER_HIT_WIDTH ||
      point.y >= y + h - BORDER_HIT_WIDTH
    );
  },
  interaction: {
    hitTestHandle: (el, point, context) => {
      if (context.selectedCount !== 1) return null;
      const radius = 8 / context.zoom;
      for (const id of ['nw', 'ne', 'sw', 'se']) {
        const corner = cornerAt(el, id, context.zoom);
        if (
          corner &&
          Math.abs(point.x - corner.x) <= radius &&
          Math.abs(point.y - corner.y) <= radius
        ) {
          return { id, cursor: id === 'nw' || id === 'se' ? 'nwse-resize' : 'nesw-resize' };
        }
      }
      return null;
    },
    updateHandle: (el, handleId, point) => {
      const right = el.position.x + el.size.w;
      const bottom = el.position.y + el.size.h;
      switch (handleId) {
        case 'nw': {
          const w = Math.max(MIN_WIDTH, right - point.x);
          const h = Math.max(MIN_HEIGHT, bottom - point.y);
          return { ...el, position: { x: right - w, y: bottom - h }, size: { w, h } };
        }
        case 'ne': {
          const w = Math.max(MIN_WIDTH, point.x - el.position.x);
          const h = Math.max(MIN_HEIGHT, bottom - point.y);
          return { ...el, position: { x: el.position.x, y: bottom - h }, size: { w, h } };
        }
        case 'sw': {
          const w = Math.max(MIN_WIDTH, right - point.x);
          const h = Math.max(MIN_HEIGHT, point.y - el.position.y);
          return { ...el, position: { x: right - w, y: el.position.y }, size: { w, h } };
        }
        case 'se':
          return {
            ...el,
            size: {
              w: Math.max(MIN_WIDTH, point.x - el.position.x),
              h: Math.max(MIN_HEIGHT, point.y - el.position.y),
            },
          };
        default:
          return el;
      }
    },
  },
  render: (ctx, el) => {
    ctx.save();
    ctx.strokeStyle = el.data.color;
    ctx.fillStyle = el.data.color;
    ctx.lineWidth = 1;
    ctx.strokeRect(el.position.x, el.position.y, el.size.w, el.size.h);
    ctx.beginPath();
    ctx.moveTo(el.position.x, el.position.y + HEADER_HEIGHT);
    ctx.lineTo(el.position.x + el.size.w, el.position.y + HEADER_HEIGHT);
    ctx.stroke();
    ctx.font = '14px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(el.data.title, el.position.x + 8, el.position.y + HEADER_HEIGHT / 2);
    ctx.restore();
  },
  emitSvg: (el) => {
    const color = escapeXml(el.data.color);
    const title = escapeXml(el.data.title);
    const { x, y } = el.position;
    const { w, h } = el.size;
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${color}" stroke-width="1"/><path d="M ${x} ${y + HEADER_HEIGHT} H ${x + w}" fill="none" stroke="${color}" stroke-width="1"/><text x="${x + 8}" y="${y + HEADER_HEIGHT / 2}" fill="${color}" dominant-baseline="middle">${title}</text>`;
  },
  dataVersion: 1,
};
