import type { AuthorityMutation } from '@fieldnotes/sync';
import type { AuthorityProposalFrame } from './authority-proposal';
import type { AuthorityExtension, AuthorityIntent, JsonValue } from './authority-types';
import { measureAuthorityJson } from './authority-json';

const INVALID = 'Invalid authority intent';
const UNSUPPORTED = 'Unsupported authority extension';

function wellFormedString(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function copyJson(value: unknown, depth = 1, budget = { nodes: 0 }): JsonValue {
  if (++budget.nodes > 1_000_000) throw new TypeError(INVALID);
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (!wellFormedString(value)) throw new TypeError(INVALID);
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object') throw new TypeError(INVALID);
  if (depth > 64) throw new TypeError(INVALID);
  const proto: unknown = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    if (proto !== Array.prototype) throw new TypeError(INVALID);
    const names = Reflect.ownKeys(value);
    if (names.length !== value.length + 1) throw new TypeError(INVALID);
    const result: JsonValue[] = [];
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor?.enumerable || !('value' in descriptor)) throw new TypeError(INVALID);
      result.push(copyJson(descriptor.value, depth + 1, budget));
    }
    return Object.freeze(result);
  }
  if (proto !== Object.prototype && proto !== null) throw new TypeError(INVALID);
  const result: Record<string, JsonValue> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !wellFormedString(key) || ++budget.nodes > 1_000_000)
      throw new TypeError(INVALID);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor))
      throw new TypeError(INVALID);
    Object.defineProperty(result, key, {
      value: copyJson(descriptor.value, depth + 1, budget),
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return Object.freeze(result);
}

function freezeTree<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}

function extensionIntent(
  mutation: AuthorityMutation,
  extensions: readonly AuthorityExtension[],
): AuthorityIntent {
  if (
    mutation.kind !== 'extension' &&
    mutation.kind !== 'fog-meta' &&
    mutation.kind !== 'fog-patch'
  )
    throw new TypeError(INVALID);
  const extension = extensions.find((item) =>
    mutation.kind === 'extension'
      ? item.extensionKinds.includes(mutation.extensionKind)
      : item.legacyKinds?.includes(mutation.kind),
  );
  if (!extension) throw new TypeError(UNSUPPORTED);
  let prepared: JsonValue | null;
  try {
    prepared = extension.prepare(mutation);
  } catch {
    throw new TypeError(INVALID);
  }
  if (prepared === null) throw new TypeError(UNSUPPORTED);
  let payload: JsonValue;
  try {
    measureAuthorityJson(prepared, 1_048_576, 1_000_000);
    payload = copyJson(prepared);
  } catch {
    throw new TypeError(INVALID);
  }
  return Object.freeze({
    schema: 1,
    kind: 'extension',
    key: extension.requirement.key,
    version: extension.requirement.version,
    payload,
  });
}

/** Inert proposal conversion. The driver must revalidate correspondence and current authority. */
export function prepareAuthorityIntent(
  proposal: AuthorityProposalFrame,
  extensions: readonly AuthorityExtension[] = [],
): AuthorityIntent {
  const mutation = proposal.mutation;
  switch (mutation.kind) {
    case 'upsert': {
      const { ownerId: _untrustedOwnerId, ...element } = structuredClone(mutation.element);
      void _untrustedOwnerId;
      return Object.freeze({ schema: 1, kind: 'element-upsert', element: freezeTree(element) });
    }
    case 'remove':
      return Object.freeze({ schema: 1, kind: 'element-remove', id: mutation.id });
    case 'clear':
      return Object.freeze({ schema: 1, kind: 'elements-clear' });
    case 'layer-upsert':
      return Object.freeze({
        schema: 1,
        kind: 'layer-write',
        record: freezeTree(
          structuredClone({
            id: mutation.layer.id,
            version: mutation.version,
            editor: mutation.editor,
            definition: mutation.layer,
          }),
        ),
      });
    case 'layer-remove':
      return Object.freeze({
        schema: 1,
        kind: 'layer-write',
        record: Object.freeze({
          id: mutation.id,
          version: mutation.version,
          editor: mutation.editor,
        }),
      });
    case 'extension':
    case 'fog-meta':
    case 'fog-patch':
      return extensionIntent(mutation, extensions);
    default:
      throw new TypeError(UNSUPPORTED);
  }
}
