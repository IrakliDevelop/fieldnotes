import type { CanvasElement, ElementType } from '@fieldnotes/core';

export type SyncElement = CanvasElement & { audience?: string };

export type SyncOp =
  | { kind: 'upsert'; element: CanvasElement }
  | { kind: 'remove'; id: string }
  | { kind: 'clear' }
  | { kind: 'request-snapshot' }
  | { kind: 'snapshot'; to: string; elements: CanvasElement[] }
  | { kind: 'presence'; data: unknown }
  | { kind: 'presence-leave' };

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
  if (typeof el !== 'object' || el === null) return false;
  const e = el as { id?: unknown; type?: unknown };
  return (
    typeof e.id === 'string' && (ELEMENT_TYPES as readonly string[]).includes(e.type as string)
  );
}

export function isValidEnvelope(env: unknown): env is SyncEnvelope {
  if (typeof env !== 'object' || env === null) return false;
  const e = env as {
    from?: unknown;
    op?: { kind?: unknown; id?: unknown; to?: unknown; elements?: unknown; element?: unknown };
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
      return typeof op.to === 'string' && Array.isArray(op.elements); // SHAPE only; per-element filtered in the handler
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
