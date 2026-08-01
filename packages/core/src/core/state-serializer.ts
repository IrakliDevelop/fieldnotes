import type { CanvasElement } from '../elements/types';
import type { Point } from './types';
import type { Layer } from '../layers/types';
import { sanitizeNoteHtml } from '../elements/note-sanitizer';

export interface CanvasState {
  version: number;
  camera: {
    position: Point;
    zoom: number;
  };
  elements: CanvasElement[];
  layers?: Layer[];
  activeLayerId?: string;
}

const CURRENT_VERSION = 2;
const ELEMENT_TYPES = [
  'stroke',
  'note',
  'arrow',
  'image',
  'html',
  'text',
  'shape',
  'grid',
  'template',
] as const satisfies readonly CanvasElement['type'][];
type _ElementTypesAreExhaustive = CanvasElement['type'] extends (typeof ELEMENT_TYPES)[number]
  ? true
  : never;
const _elementTypesAreExhaustive: _ElementTypesAreExhaustive = true;
void _elementTypesAreExhaustive;

export function exportState(
  elements: CanvasElement[],
  camera: { position: Point; zoom: number },
  layers: Layer[] = [],
  activeLayerId?: string,
): CanvasState {
  const state: CanvasState = {
    version: CURRENT_VERSION,
    camera: {
      position: { ...camera.position },
      zoom: camera.zoom,
    },
    elements: elements.map((el) => {
      const clone = structuredClone(el);
      if (clone.type === 'arrow') {
        delete clone.cachedControlPoint;
      }
      return clone;
    }),
    layers: layers.map((l) => ({ ...l })),
  };
  if (activeLayerId) state.activeLayerId = activeLayerId;
  return state;
}

export function parseState(json: string): CanvasState {
  const data: unknown = JSON.parse(json);
  validateState(data);
  return data;
}

function validateState(data: unknown): asserts data is CanvasState {
  if (!isRecord(data)) {
    throw new Error('Invalid state: expected an object');
  }

  const obj = data;

  if (!Number.isInteger(obj['version']) || (obj['version'] as number) < 1) {
    throw new Error('Invalid state: missing or invalid version');
  }
  if ((obj['version'] as number) > CURRENT_VERSION) {
    throw new Error(`Invalid state: unsupported version ${String(obj['version'])}`);
  }

  if (!isRecord(obj['camera'])) {
    throw new Error('Invalid state: missing camera');
  }

  const cam = obj['camera'];
  if (!isRecord(cam['position'])) {
    throw new Error('Invalid state: missing camera.position');
  }

  if (!isPoint(cam['position'])) {
    throw new Error('Invalid state: camera.position must have finite x and y numbers');
  }

  if (!isFiniteNumber(cam['zoom']) || cam['zoom'] <= 0) {
    throw new Error('Invalid state: camera.zoom must be a positive finite number');
  }

  if (!Array.isArray(obj['elements'])) {
    throw new Error('Invalid state: elements must be an array');
  }
  if (obj['layers'] !== undefined && !Array.isArray(obj['layers'])) {
    throw new Error('Invalid state: layers must be an array');
  }

  const elements = obj['elements'] as unknown[];
  const hasLayers = Array.isArray(obj['layers']) && obj['layers'].length > 0;
  for (const el of elements) {
    if (!isRecord(el)) throw new Error('Invalid element: expected an object');
    migrateElement(el, !hasLayers);
  }

  if (!hasLayers) {
    obj['layers'] = [
      {
        id: 'default-layer',
        name: 'Layer 1',
        visible: true,
        locked: false,
        order: 0,
        opacity: 1.0,
      },
    ];
  }

  const layers = obj['layers'] as unknown[];
  const layerIds = new Set<string>();
  for (const layer of layers) {
    validateLayer(layer);
    if (layerIds.has(layer.id)) throw new Error(`Invalid state: duplicate layer id "${layer.id}"`);
    layerIds.add(layer.id);
  }

  const elementIds = new Set<string>();
  for (const el of elements) {
    validateElement(el);
    if (elementIds.has(el.id)) throw new Error(`Invalid state: duplicate element id "${el.id}"`);
    elementIds.add(el.id);
    if (!layerIds.has(el.layerId)) {
      throw new Error(`Invalid element "${el.id}": unknown layerId "${el.layerId}"`);
    }
  }

  if (obj['activeLayerId'] !== undefined) {
    if (typeof obj['activeLayerId'] !== 'string' || !layerIds.has(obj['activeLayerId'])) {
      throw new Error('Invalid state: activeLayerId must reference an existing layer');
    }
  }

  cleanBindings(elements as Record<string, unknown>[]);
}

function validateElement(el: unknown): asserts el is CanvasElement {
  if (!isRecord(el)) {
    throw new Error('Invalid element: expected an object');
  }

  if (typeof el['id'] !== 'string' || el['id'].length === 0) {
    throw new Error('Invalid element: missing id');
  }
  if (!isEnum(el['type'], ELEMENT_TYPES)) {
    throw new Error(`Invalid element: unknown type "${String(el['type'])}"`);
  }
  if (!isFiniteNumber(el['zIndex'])) {
    throw new Error(`Invalid element "${el['id']}": missing or invalid zIndex`);
  }
  if (
    !isPoint(el['position']) ||
    typeof el['locked'] !== 'boolean' ||
    typeof el['layerId'] !== 'string' ||
    !isOptional(el['groupId'], isString) ||
    !isOptional(el['rotation'], isFiniteNumber)
  ) {
    throw new Error(`Invalid element "${el['id']}": invalid base fields or geometry`);
  }

  const valid = validateTypeFields(el, el['type']);
  if (!valid) throw new Error(`Invalid element "${el['id']}": malformed ${el['type']} data`);
}

function validateTypeFields(el: Record<string, unknown>, type: CanvasElement['type']): boolean {
  switch (type) {
    case 'stroke':
      return (
        Array.isArray(el['points']) &&
        el['points'].every(isStrokePoint) &&
        isString(el['color']) &&
        isFiniteNumber(el['width']) &&
        isFiniteNumber(el['opacity']) &&
        isOptionalEnum(el['blendMode'], ['multiply'])
      );
    case 'note':
      return (
        isSize(el['size']) &&
        isString(el['text']) &&
        isString(el['backgroundColor']) &&
        isString(el['textColor']) &&
        isOptional(el['fontSize'], isFiniteNumber)
      );
    case 'arrow':
      return (
        isPoint(el['from']) &&
        isPoint(el['to']) &&
        isFiniteNumber(el['bend']) &&
        isString(el['color']) &&
        isFiniteNumber(el['width']) &&
        isOptional(el['fromBinding'], isBinding) &&
        isOptional(el['toBinding'], isBinding) &&
        isOptional(el['cachedControlPoint'], isPoint) &&
        isOptional(el['label'], isString) &&
        isOptionalEnum(el['strokeStyle'], ['solid', 'dashed', 'dotted'])
      );
    case 'image':
      return isSize(el['size']) && isString(el['src']);
    case 'html':
      return (
        isSize(el['size']) &&
        isOptional(el['domId'], isString) &&
        isOptional(el['interactive'], isBoolean) &&
        isOptional(el['htmlType'], isString) &&
        isOptional(el['data'], isRecord)
      );
    case 'text':
      return (
        isSize(el['size']) &&
        isString(el['text']) &&
        isFiniteNumber(el['fontSize']) &&
        isString(el['color']) &&
        isEnum(el['textAlign'], ['left', 'center', 'right'])
      );
    case 'shape':
      return (
        isEnum(el['shape'], ['rectangle', 'ellipse', 'line']) &&
        isSize(el['size']) &&
        isString(el['strokeColor']) &&
        isFiniteNumber(el['strokeWidth']) &&
        isString(el['fillColor']) &&
        isOptional(el['flip'], isBoolean)
      );
    case 'grid':
      return (
        isEnum(el['gridType'], ['square', 'hex']) &&
        isEnum(el['hexOrientation'], ['pointy', 'flat']) &&
        isFiniteNumber(el['cellSize']) &&
        isString(el['strokeColor']) &&
        isFiniteNumber(el['strokeWidth']) &&
        isFiniteNumber(el['opacity'])
      );
    case 'template':
      return (
        isEnum(el['templateShape'], ['circle', 'cone', 'line', 'square', 'rectangle']) &&
        isFiniteNumber(el['radius']) &&
        isFiniteNumber(el['angle']) &&
        isOptional(el['width'], isFiniteNumber) &&
        isString(el['fillColor']) &&
        isString(el['strokeColor']) &&
        isFiniteNumber(el['strokeWidth']) &&
        isFiniteNumber(el['opacity']) &&
        isOptional(el['feetPerCell'], isFiniteNumber) &&
        isOptional(el['radiusFeet'], isFiniteNumber) &&
        isOptionalEnum(el['renderStyle'], ['cells', 'geometric'])
      );
  }
}

function validateLayer(layer: unknown): asserts layer is Layer {
  if (
    !isRecord(layer) ||
    typeof layer['id'] !== 'string' ||
    layer['id'].length === 0 ||
    typeof layer['name'] !== 'string' ||
    typeof layer['visible'] !== 'boolean' ||
    typeof layer['locked'] !== 'boolean' ||
    !isFiniteNumber(layer['order']) ||
    !isFiniteNumber(layer['opacity']) ||
    layer['opacity'] < 0 ||
    layer['opacity'] > 1
  ) {
    throw new Error('Invalid state: malformed layer');
  }
}

function cleanBindings(elements: Record<string, unknown>[]): void {
  const ids = new Set(elements.map((el) => el['id'] as string));

  for (const el of elements) {
    if (el['type'] !== 'arrow') continue;

    const fromBinding = el['fromBinding'] as Record<string, unknown> | undefined;
    if (fromBinding && !ids.has(fromBinding['elementId'] as string)) {
      el['fromBinding'] = undefined;
    }

    const toBinding = el['toBinding'] as Record<string, unknown> | undefined;
    if (toBinding && !ids.has(toBinding['elementId'] as string)) {
      el['toBinding'] = undefined;
    }
  }
}

function migrateElement(obj: Record<string, unknown>, useDefaultLayer: boolean): void {
  if (obj['layerId'] === undefined || (useDefaultLayer && obj['layerId'] === '')) {
    obj['layerId'] = 'default-layer';
  }

  if (obj['type'] === 'arrow' && obj['bend'] === undefined) {
    obj['bend'] = 0;
  }

  if (obj['type'] === 'stroke' && Array.isArray(obj['points'])) {
    for (const pt of obj['points'] as Record<string, unknown>[]) {
      if (pt['pressure'] === undefined) {
        pt['pressure'] = 0.5;
      }
    }
  }

  if (obj['type'] === 'shape' && obj['shape'] === undefined) {
    obj['shape'] = 'rectangle';
  }

  if (obj['type'] === 'note' && obj['textColor'] === undefined) {
    obj['textColor'] = '#000000';
  }

  if ((obj['type'] === 'note' || obj['type'] === 'text') && typeof obj['text'] === 'string') {
    obj['text'] = sanitizeNoteHtml(obj['text']);
  }
}

type Validator = (value: unknown) => boolean;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isOptional(value: unknown, validate: Validator): boolean {
  return value === undefined || validate(value);
}

function isEnum<const T extends readonly string[]>(value: unknown, values: T): value is T[number] {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

function isOptionalEnum<const T extends readonly string[]>(value: unknown, values: T): boolean {
  return value === undefined || isEnum(value, values);
}

function isPoint(value: unknown): boolean {
  return isRecord(value) && isFiniteNumber(value['x']) && isFiniteNumber(value['y']);
}

function isSize(value: unknown): boolean {
  return isRecord(value) && isFiniteNumber(value['w']) && isFiniteNumber(value['h']);
}

function isStrokePoint(value: unknown): boolean {
  return isRecord(value) && isPoint(value) && isFiniteNumber(value['pressure']);
}

function isBinding(value: unknown): boolean {
  return isRecord(value) && typeof value['elementId'] === 'string';
}
