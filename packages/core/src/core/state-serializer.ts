import type { CanvasElement } from '../elements/types';
import type { Point } from './types';
import type { Layer } from '../layers/types';
import { sanitizeNoteHtml } from '../elements/note-sanitizer';
import type { ElementRegistry } from '../elements/element-registry';
import { getDefaultElementRegistry } from '../elements/default-registry';
import type { PersistedPluginState } from './plugin-state-manager';

export interface CanvasState {
  version: 4;
  camera: {
    position: Point;
    zoom: number;
  };
  elements: CanvasElement[];
  layers?: Layer[];
  activeLayerId?: string;
  extensions?: Record<string, PersistedPluginState>;
}

interface LegacyCanvasState extends Omit<CanvasState, 'version' | 'elements'> {
  version: 1 | 2 | 3;
  elements: unknown[];
  fog?: unknown;
}

export type ImportableCanvasState = CanvasState | LegacyCanvasState;

export const CANVAS_STATE_VERSION = 4;
const CORE_ELEMENT_TYPES = ['stroke', 'note', 'arrow', 'image', 'html', 'text', 'shape'] as const;
const ELEMENT_TYPES = [...CORE_ELEMENT_TYPES, 'extension'] as const;

export function exportState(
  elements: CanvasElement[],
  camera: { position: Point; zoom: number },
  layers: Layer[] = [],
  activeLayerId?: string,
  registry?: ElementRegistry,
  extensions?: Record<string, PersistedPluginState>,
): CanvasState {
  void registry;
  const state: CanvasState = {
    version: CANVAS_STATE_VERSION,
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
  if (extensions && Object.keys(extensions).length > 0) {
    state.extensions = structuredClone(extensions);
  }
  return state;
}

export function parseState(json: string, registry?: ElementRegistry): CanvasState {
  const data: unknown = JSON.parse(json);
  const reg = registry ?? getDefaultElementRegistry();
  validateState(data, reg);
  return migrateState(data, reg);
}

/**
 * Upgrades an importable state to the v4 extension-only persistence model.
 * The input is mutated only after callers have cloned or parsed it.
 */
export function migrateState(
  state: ImportableCanvasState,
  registry: ElementRegistry = getDefaultElementRegistry(),
): CanvasState {
  if (state.version === CANVAS_STATE_VERSION) return state;
  const legacy = state as LegacyCanvasState;
  convertLegacyToEnvelopes(legacy.elements, registry);
  if (Object.hasOwn(legacy, 'fog')) {
    legacy.extensions ??= {};
    legacy.extensions['fog'] ??= {
      version: 1,
      data: structuredClone(legacy.fog),
    };
    delete legacy.fog;
  }
  (legacy as { version: number }).version = CANVAS_STATE_VERSION;
  return legacy as unknown as CanvasState;
}

export function convertLegacyToEnvelopes(elements: unknown[], registry: ElementRegistry): void {
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (!isRecord(el) || !isString(el['type'])) continue;
    const legacyType = el['type'];
    if (legacyType === 'extension' || isEnum(legacyType, CORE_ELEMENT_TYPES)) continue;
    const adapter = registry.getAdapterByLegacyType(legacyType);
    if (!adapter) {
      throw new Error(
        `Cannot migrate legacy element type "${legacyType}" without a registered adapter`,
      );
    }
    elements[i] = adapter.decodeLegacy(structuredClone(el));
  }
}

function validateState(
  data: unknown,
  registry: ElementRegistry,
): asserts data is ImportableCanvasState {
  if (!isRecord(data)) {
    throw new Error('Invalid state: expected an object');
  }

  const obj = data;

  if (!Number.isInteger(obj['version']) || (obj['version'] as number) < 1) {
    throw new Error('Invalid state: missing or invalid version');
  }
  if ((obj['version'] as number) > CANVAS_STATE_VERSION) {
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
  const version = obj['version'] as number;
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
    validateElement(el, version, registry);
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

  if (obj['extensions'] !== undefined) {
    validateExtensions(obj['extensions']);
  }
  if (obj['fog'] !== undefined && obj['fog'] !== null && !isRecord(obj['fog'])) {
    throw new Error('Invalid state: fog must be an object or null');
  }
}

function validateExtensions(value: unknown): asserts value is Record<string, PersistedPluginState> {
  if (!isRecord(value)) {
    throw new Error('Invalid state: extensions must be an object');
  }
  for (const [name, entry] of Object.entries(value)) {
    if (!isRecord(entry)) {
      throw new Error(`Invalid state: extensions.${name} must be an object`);
    }
    if (!Number.isInteger(entry['version']) || (entry['version'] as number) < 1) {
      throw new Error(`Invalid state: extensions.${name}.version must be a positive integer`);
    }
  }
}

function validateElement(
  el: unknown,
  version: number,
  registry: ElementRegistry,
): asserts el is CanvasElement {
  if (!isRecord(el)) {
    throw new Error('Invalid element: expected an object');
  }

  if (typeof el['id'] !== 'string' || el['id'].length === 0) {
    throw new Error('Invalid element: missing id');
  }
  if (!isString(el['type'])) {
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

  if (isEnum(el['type'], ELEMENT_TYPES)) {
    const valid = validateTypeFields(el, el['type']);
    if (!valid) throw new Error(`Invalid element "${el['id']}": malformed ${el['type']} data`);
    return;
  }

  const adapter =
    version < CANVAS_STATE_VERSION ? registry.getAdapterByLegacyType(el['type']) : undefined;
  if (!adapter) {
    if (version < CANVAS_STATE_VERSION) {
      throw new Error(
        `Cannot migrate legacy element type "${el['type']}" without a registered adapter`,
      );
    }
    throw new Error(`Invalid element: unknown type "${el['type']}"`);
  }
  let envelope;
  try {
    envelope = adapter.decodeLegacy(structuredClone(el));
  } catch {
    throw new Error(`Invalid element "${el['id']}": malformed ${el['type']} data`);
  }
  if (!adapter.validateEnvelope(envelope)) {
    throw new Error(`Invalid element "${el['id']}": malformed ${el['type']} data`);
  }
}

function validateTypeFields(
  el: Record<string, unknown>,
  type: (typeof ELEMENT_TYPES)[number],
): boolean {
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
    case 'extension':
      return isString(el['extensionType']) && isRecord(el['data']);
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
