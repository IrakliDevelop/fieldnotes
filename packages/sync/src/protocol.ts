import type { CanvasElement, ElementType, Layer } from '@fieldnotes/core';

export type SyncElement = CanvasElement & { audience?: string };

/**
 * Revision of the optional layer-definition sync addition (the `layer-upsert`
 * and `layer-remove` op kinds plus the snapshot `layers` field). Peers that
 * predate it reject the new op kinds in `isValidEnvelope` and ignore the extra
 * snapshot field, so mixed rooms degrade to today's element-only behavior.
 */
export const LAYER_SYNC_PROTOCOL_VERSION = 1;

/**
 * A versioned layer definition (or its tombstone, when `definition` is
 * absent). `version` is a per-layer monotonic edit counter and `editor` is the
 * stable client id of the last editor; together they totally order edits:
 * higher version wins, equal versions resolve by lexicographic editor. The
 * ordering is explicit and deterministic — never wall-clock or arrival-order.
 */
export interface LayerRecord {
  id: string;
  version: number;
  editor: string;
  definition?: Layer;
}

/** Whether record `a` is strictly newer than `b` under the layer ordering. */
export function isNewerLayerRecord(a: LayerRecord, b: LayerRecord): boolean {
  if (a.version !== b.version) return a.version > b.version;
  return a.editor > b.editor;
}

export type SyncOp =
  | { kind: 'upsert'; element: CanvasElement }
  | { kind: 'remove'; id: string }
  | { kind: 'clear' }
  | { kind: 'request-snapshot' }
  | { kind: 'snapshot'; to: string; elements: CanvasElement[]; layers?: LayerRecord[] }
  | { kind: 'presence'; data: unknown }
  | { kind: 'presence-leave' }
  | { kind: 'layer-upsert'; layer: Layer; version: number; editor: string }
  | { kind: 'layer-remove'; id: string; version: number; editor: string };

export interface SyncEnvelope {
  from: string;
  op: SyncOp;
}

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
] as const;
// Compile-time exhaustiveness: errors if a core ElementType is missing from the allowlist above.
type _ExhaustiveCheck = ElementType extends (typeof ELEMENT_TYPES)[number] ? true : never;
const _elementTypesCoverAll: _ExhaustiveCheck = true;
void _elementTypesCoverAll;

export function isValidElement(el: unknown): el is CanvasElement {
  if (!isRecord(el)) return false;
  if (
    typeof el['id'] !== 'string' ||
    !(ELEMENT_TYPES as readonly unknown[]).includes(el['type']) ||
    !isPoint(el['position']) ||
    !isFiniteNumber(el['zIndex']) ||
    typeof el['locked'] !== 'boolean' ||
    typeof el['layerId'] !== 'string' ||
    !isOptional(el['groupId'], isString) ||
    !isOptional(el['rotation'], isFiniteNumber)
  ) {
    return false;
  }

  switch (el['type']) {
    case 'stroke':
      return (
        Array.isArray(el['points']) &&
        el['points'].every(isStrokePoint) &&
        typeof el['color'] === 'string' &&
        isFiniteNumber(el['width']) &&
        isFiniteNumber(el['opacity']) &&
        isOptionalEnum(el['blendMode'], ['multiply'])
      );
    case 'note':
      return (
        isSize(el['size']) &&
        typeof el['text'] === 'string' &&
        typeof el['backgroundColor'] === 'string' &&
        typeof el['textColor'] === 'string' &&
        isOptional(el['fontSize'], isFiniteNumber)
      );
    case 'arrow':
      return (
        isPoint(el['from']) &&
        isPoint(el['to']) &&
        isFiniteNumber(el['bend']) &&
        typeof el['color'] === 'string' &&
        isFiniteNumber(el['width']) &&
        isOptional(el['fromBinding'], isBinding) &&
        isOptional(el['toBinding'], isBinding) &&
        isOptional(el['cachedControlPoint'], isPoint) &&
        isOptional(el['label'], isString) &&
        isOptionalEnum(el['strokeStyle'], ['solid', 'dashed', 'dotted'])
      );
    case 'image':
      return isSize(el['size']) && typeof el['src'] === 'string';
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
        typeof el['text'] === 'string' &&
        isFiniteNumber(el['fontSize']) &&
        typeof el['color'] === 'string' &&
        isEnum(el['textAlign'], ['left', 'center', 'right'])
      );
    case 'shape':
      return (
        isEnum(el['shape'], ['rectangle', 'ellipse', 'line']) &&
        isSize(el['size']) &&
        typeof el['strokeColor'] === 'string' &&
        isFiniteNumber(el['strokeWidth']) &&
        typeof el['fillColor'] === 'string' &&
        isOptional(el['flip'], isBoolean)
      );
    case 'grid':
      return (
        isEnum(el['gridType'], ['square', 'hex']) &&
        isEnum(el['hexOrientation'], ['pointy', 'flat']) &&
        isFiniteNumber(el['cellSize']) &&
        typeof el['strokeColor'] === 'string' &&
        isFiniteNumber(el['strokeWidth']) &&
        isFiniteNumber(el['opacity'])
      );
    case 'template':
      return (
        isEnum(el['templateShape'], ['circle', 'cone', 'line', 'square', 'rectangle']) &&
        isFiniteNumber(el['radius']) &&
        isFiniteNumber(el['angle']) &&
        isOptional(el['width'], isFiniteNumber) &&
        typeof el['fillColor'] === 'string' &&
        typeof el['strokeColor'] === 'string' &&
        isFiniteNumber(el['strokeWidth']) &&
        isFiniteNumber(el['opacity']) &&
        isOptional(el['feetPerCell'], isFiniteNumber) &&
        isOptional(el['radiusFeet'], isFiniteNumber) &&
        isOptionalEnum(el['renderStyle'], ['cells', 'geometric'])
      );
    default:
      return false;
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
  return isPoint(value) && isFiniteNumber((value as Record<string, unknown>)['pressure']);
}

function isBinding(value: unknown): boolean {
  return isRecord(value) && typeof value['elementId'] === 'string';
}

export function isValidLayerDefinition(layer: unknown): layer is Layer {
  if (!isRecord(layer)) return false;
  return (
    typeof layer['id'] === 'string' &&
    typeof layer['name'] === 'string' &&
    typeof layer['visible'] === 'boolean' &&
    typeof layer['locked'] === 'boolean' &&
    isFiniteNumber(layer['order']) &&
    isFiniteNumber(layer['opacity'])
  );
}

function isValidLayerVersion(version: unknown): version is number {
  return typeof version === 'number' && Number.isSafeInteger(version) && version >= 1;
}

export function isValidLayerRecord(record: unknown): record is LayerRecord {
  if (!isRecord(record)) return false;
  if (
    typeof record['id'] !== 'string' ||
    !isValidLayerVersion(record['version']) ||
    typeof record['editor'] !== 'string'
  ) {
    return false;
  }
  const definition = record['definition'];
  if (definition === undefined) return true;
  return isValidLayerDefinition(definition) && definition.id === record['id'];
}

export function isValidEnvelope(env: unknown): env is SyncEnvelope {
  if (typeof env !== 'object' || env === null) return false;
  const e = env as {
    from?: unknown;
    op?: {
      kind?: unknown;
      id?: unknown;
      to?: unknown;
      elements?: unknown;
      element?: unknown;
      layer?: unknown;
      layers?: unknown;
      version?: unknown;
      editor?: unknown;
    };
  };
  if (typeof e.from !== 'string' || typeof e.op !== 'object' || e.op === null) return false;
  const op = e.op;
  switch (op.kind) {
    case 'upsert':
      return isValidElement(op.element);
    case 'remove':
      return typeof op.id === 'string';
    case 'clear':
    case 'request-snapshot':
    case 'presence':
    case 'presence-leave':
      return true;
    case 'snapshot':
      // SHAPE only; per-element and per-record filtered in the handler
      return (
        typeof op.to === 'string' &&
        Array.isArray(op.elements) &&
        (op.layers === undefined || Array.isArray(op.layers))
      );
    case 'layer-upsert':
      return (
        isValidLayerDefinition(op.layer) &&
        isValidLayerVersion(op.version) &&
        typeof op.editor === 'string'
      );
    case 'layer-remove':
      return (
        typeof op.id === 'string' &&
        isValidLayerVersion(op.version) &&
        typeof op.editor === 'string'
      );
    default:
      return false;
  }
}

export function parseEnvelope(message: string): SyncEnvelope | null {
  try {
    const env: unknown = JSON.parse(message);
    return isValidEnvelope(env) ? env : null;
  } catch {
    return null;
  }
}

export function applyOpToMap(map: Map<string, CanvasElement>, op: SyncOp): void {
  if (op.kind === 'upsert') map.set(op.element.id, op.element);
  else if (op.kind === 'remove') map.delete(op.id);
  else if (op.kind === 'clear') map.clear();
  // non-data ops (request-snapshot/snapshot/presence/presence-leave) are no-ops here
}
