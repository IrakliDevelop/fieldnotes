import type { CanvasElement } from '../elements/types';
import type { Point } from './types';

export interface CanvasState {
  version: number;
  camera: {
    position: Point;
    zoom: number;
  };
  elements: CanvasElement[];
}

const CURRENT_VERSION = 1;

export function exportState(
  elements: CanvasElement[],
  camera: { position: Point; zoom: number },
): CanvasState {
  return {
    version: CURRENT_VERSION,
    camera: {
      position: { ...camera.position },
      zoom: camera.zoom,
    },
    elements: elements.map((el) => structuredClone(el)),
  };
}

export function parseState(json: string): CanvasState {
  const data: unknown = JSON.parse(json);
  validateState(data);
  return data;
}

function validateState(data: unknown): asserts data is CanvasState {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid state: expected an object');
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj['version'] !== 'number') {
    throw new Error('Invalid state: missing or invalid version');
  }

  if (!obj['camera'] || typeof obj['camera'] !== 'object') {
    throw new Error('Invalid state: missing camera');
  }

  const cam = obj['camera'] as Record<string, unknown>;
  if (!cam['position'] || typeof cam['position'] !== 'object') {
    throw new Error('Invalid state: missing camera.position');
  }

  const pos = cam['position'] as Record<string, unknown>;
  if (typeof pos['x'] !== 'number' || typeof pos['y'] !== 'number') {
    throw new Error('Invalid state: camera.position must have x and y numbers');
  }

  if (typeof cam['zoom'] !== 'number') {
    throw new Error('Invalid state: missing camera.zoom');
  }

  if (!Array.isArray(obj['elements'])) {
    throw new Error('Invalid state: elements must be an array');
  }

  for (const el of obj['elements'] as unknown[]) {
    validateElement(el);
    migrateElement(el as unknown as Record<string, unknown>);
  }

  cleanBindings(obj['elements'] as Record<string, unknown>[]);
}

const VALID_TYPES = new Set(['stroke', 'note', 'arrow', 'image', 'html', 'text']);

function validateElement(el: unknown): asserts el is CanvasElement {
  if (!el || typeof el !== 'object') {
    throw new Error('Invalid element: expected an object');
  }

  const obj = el as Record<string, unknown>;

  if (typeof obj['id'] !== 'string') {
    throw new Error('Invalid element: missing id');
  }

  if (typeof obj['type'] !== 'string' || !VALID_TYPES.has(obj['type'])) {
    throw new Error(`Invalid element: unknown type "${String(obj['type'])}"`);
  }

  if (typeof obj['zIndex'] !== 'number') {
    throw new Error('Invalid element: missing zIndex');
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

function migrateElement(obj: Record<string, unknown>): void {
  if (obj['type'] === 'arrow' && typeof obj['bend'] !== 'number') {
    obj['bend'] = 0;
  }

  if (obj['type'] === 'stroke' && Array.isArray(obj['points'])) {
    for (const pt of obj['points'] as Record<string, unknown>[]) {
      if (typeof pt['pressure'] !== 'number') {
        pt['pressure'] = 0.5;
      }
    }
  }
}
