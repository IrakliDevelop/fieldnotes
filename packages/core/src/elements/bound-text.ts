import type { Bounds } from '../core/types';
import { getArrowLabelAnchor, getArrowMidpoint } from './arrow-geometry';
import { createText } from './element-factory';
import type { ElementStore } from './element-store';
import type { ElementRegistry } from './element-registry';
import { isNoteContentEmpty, sanitizeNoteHtml } from './note-sanitizer';
import { measureText } from './text-measure';
import type { ArrowElement, CanvasElement, ShapeElement, TextElement } from './types';

export const BOUND_TEXT_PADDING = 8;

/** An element which may own one advisory bound text child. */
type BoundTextShape = ShapeElement & { readonly shape: 'rectangle' | 'ellipse' };

export type BoundTextContainer =
  BoundTextShape | ArrowElement | Extract<CanvasElement, { type: 'extension' }>;

/** Options for creating an advisory bound text child. */
export interface CreateBoundTextOptions {
  readonly text?: string;
  readonly fontSize?: number;
  readonly color?: string;
  readonly layerId?: string;
  readonly index?: string;
  readonly version?: number;
}

/** Returns whether an element supports an advisory bound text child. */
export function isBoundTextContainer(
  element: CanvasElement,
  registry: ElementRegistry,
): element is BoundTextContainer {
  if (element.type === 'arrow') return true;
  if (element.type === 'shape') return element.shape === 'rectangle' || element.shape === 'ellipse';
  if (element.type !== 'extension') return false;
  const layout = registry.getAdapter(element.extensionType)?.boundTextLayout?.(element);
  return layout !== null && layout !== undefined;
}

/** Returns the first valid advisory bound text child of a container. */
export function getBoundText(
  container: CanvasElement,
  store: ElementStore,
): TextElement | undefined {
  if (!isBoundTextContainer(container, store.elementRegistry)) return undefined;
  return findBoundText(container, store.getAll());
}

export function findBoundText(
  container: BoundTextContainer,
  elements: readonly CanvasElement[],
): TextElement | undefined {
  return elements
    .filter(
      (element): element is TextElement =>
        element.type === 'text' &&
        element.parentId === container.id &&
        element.containerId === container.id,
    )
    .sort((a, b) => a.index.localeCompare(b.index) || a.id.localeCompare(b.id))[0];
}

function withMinimumWidth(box: Bounds): Bounds {
  if (box.w >= 16) return box;
  return { ...box, x: box.x - (16 - box.w) / 2, w: 16 };
}

function shapeBox(shape: BoundTextShape): Bounds {
  const { x, y } = shape.position;
  if (shape.shape === 'rectangle') {
    return withMinimumWidth({
      x: x + BOUND_TEXT_PADDING,
      y: y + BOUND_TEXT_PADDING,
      w: shape.size.w - BOUND_TEXT_PADDING * 2,
      h: Math.max(0, shape.size.h - BOUND_TEXT_PADDING * 2),
    });
  }
  const factor = Math.SQRT1_2;
  const w = shape.size.w * factor;
  const h = shape.size.h * factor;
  return withMinimumWidth({ x: x + (shape.size.w - w) / 2, y: y + (shape.size.h - h) / 2, w, h });
}

export function getBoundTextBox(
  container: BoundTextContainer,
  registry: ElementRegistry,
  resolveBounds: (id: string) => Bounds | null,
): Bounds {
  if (container.type === 'shape') return shapeBox(container);
  if (container.type === 'arrow') {
    const point = getArrowLabelAnchor(container, resolveBounds);
    return { x: point.x, y: point.y, w: 0, h: 0 };
  }
  const box = registry.getAdapter(container.extensionType)?.boundTextLayout?.(container)?.box;
  return withMinimumWidth(box ?? { x: container.position.x, y: container.position.y, w: 16, h: 0 });
}

export function getBoundTextMinHeight(
  container: BoundTextContainer,
  text: TextElement,
  registry: ElementRegistry,
  candidateWidth: number,
): number {
  const currentWidth = getBoundTextBox(container, registry, () => null).w;
  const height =
    Math.abs(currentWidth - candidateWidth) < 1e-6
      ? text.size.h
      : measureText(text.text, text.fontSize, candidateWidth).h;
  if (container.type === 'shape') {
    return container.shape === 'ellipse' ? height * Math.SQRT2 : height + BOUND_TEXT_PADDING * 2;
  }
  return height;
}

export function layoutBoundText(
  container: BoundTextContainer,
  text: TextElement,
  options: {
    readonly registry: ElementRegistry;
    readonly resolveBounds: (id: string) => Bounds | null;
    readonly remeasure: (text: string, fontSize: number, width: number | null) => Bounds;
  },
): { text: Partial<TextElement> | null; container: Partial<BoundTextContainer> | null } {
  let current = container;
  let box = getBoundTextBox(current, options.registry, options.resolveBounds);
  let measured: Bounds;
  if (current.type === 'arrow') {
    measured = options.remeasure(text.text, text.fontSize, null);
  } else {
    const currentBox = getBoundTextBox(container, options.registry, options.resolveBounds);
    measured =
      Math.abs(currentBox.w - box.w) < 1e-6
        ? { x: 0, y: 0, w: box.w, h: text.size.h }
        : options.remeasure(text.text, text.fontSize, box.w);
  }
  const width = current.type === 'arrow' ? Math.max(24, measured.w) : box.w;
  const height = measured.h;
  let containerPatch: Partial<BoundTextContainer> | null = null;
  if (!isNoteContentEmpty(text.text) && current.type === 'shape') {
    const minHeight = getBoundTextMinHeight(current, text, options.registry, box.w);
    const delta = Math.max(0, minHeight - current.size.h);
    if (delta > 1e-6) {
      const rotation = current.rotation ?? 0;
      const offsetX = (-Math.sin(rotation) * delta) / 2;
      const offsetY = ((Math.cos(rotation) - 1) * delta) / 2;
      const grownShape = {
        ...current,
        size: { w: current.size.w, h: current.size.h + delta },
        position: { x: current.position.x + offsetX, y: current.position.y + offsetY },
      };
      containerPatch = { size: grownShape.size, position: grownShape.position };
      current = grownShape;
      box = getBoundTextBox(current, options.registry, options.resolveBounds);
    }
  } else if (
    !isNoteContentEmpty(text.text) &&
    current.type === 'extension' &&
    height > box.h + 1e-6
  ) {
    const layout = options.registry.getAdapter(current.extensionType)?.boundTextLayout?.(current);
    const grown = layout?.grow?.(current, height);
    if (grown && grown !== current) {
      const grownBox = getBoundTextBox(grown, options.registry, options.resolveBounds);
      if (grownBox.h >= box.h) {
        containerPatch = grown;
        current = grown;
        box = grownBox;
        if (Math.abs(box.w - width) > 1e-6)
          measured = options.remeasure(text.text, text.fontSize, box.w);
      }
    }
  }
  const nextWidth = current.type === 'arrow' ? width : box.w;
  const nextHeight = current.type === 'arrow' ? height : measured.h;
  const position =
    current.type === 'arrow'
      ? { x: box.x - nextWidth / 2, y: box.y - nextHeight / 2 }
      : { x: box.x + (box.w - nextWidth) / 2, y: box.y + (box.h - nextHeight) / 2 };
  const rotation = current.type === 'shape' && current.rotation ? current.rotation : undefined;
  const textPatch: Partial<TextElement> = {
    position,
    size: { w: nextWidth, h: nextHeight },
    ...(rotation === undefined ? { rotation: undefined } : { rotation }),
  };
  return { text: textPatch, container: containerPatch };
}

/** Creates a text child with an advisory relation to a supported container. */
export function createBoundText(
  container: BoundTextContainer,
  options: CreateBoundTextOptions = {},
): TextElement {
  const arrow = container.type === 'arrow';
  const point = arrow
    ? getArrowMidpoint(container.from, container.to, container.bend)
    : container.type === 'shape'
      ? {
          x: container.position.x + container.size.w / 2,
          y: container.position.y + container.size.h / 2,
        }
      : container.position;
  return createText({
    position: point,
    text: sanitizeNoteHtml(options.text ?? ''),
    fontSize: options.fontSize ?? (arrow ? 14 : 16),
    color: options.color ?? '#1a1a1a',
    layerId: options.layerId ?? container.layerId,
    index: options.index,
    version: options.version,
    parentId: container.id,
    containerId: container.id,
    textAlign: 'center',
    wrap: !arrow,
    autoResize: true,
  });
}
