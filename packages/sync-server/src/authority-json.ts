import { createHash } from 'node:crypto';

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_NODES = 1_000_000;
const MAX_DEPTH = 64;
const encoder = new TextEncoder();

function wellFormed(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

/** Canonical, bounded complete-visible-state hash. No cursor or internal position is included. */
export function hashAuthorityJson(value: unknown): string {
  const hash = createHash('sha256');
  const seen = new Set<object>();
  let bytes = 0;
  let nodes = 0;
  const append = (part: string): void => {
    bytes += encoder.encode(part).byteLength;
    if (bytes > MAX_BYTES) throw new RangeError('Authority JSON byte limit');
    hash.update(part, 'utf8');
  };
  const quote = (part: string): string => {
    if (!wellFormed(part)) throw new TypeError('Invalid authority JSON string');
    return JSON.stringify(part);
  };
  const walk = (item: unknown, depth: number): void => {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH)
      throw new RangeError('Authority JSON resource limit');
    if (item === null) return append('null');
    if (typeof item === 'string') return append(quote(item));
    if (typeof item === 'boolean') return append(item ? 'true' : 'false');
    if (typeof item === 'number' && Number.isFinite(item)) return append(JSON.stringify(item));
    if (typeof item !== 'object' || seen.has(item))
      throw new TypeError('Invalid authority JSON value');
    seen.add(item);
    try {
      if (Array.isArray(item)) {
        if (Object.getPrototypeOf(item) !== Array.prototype)
          throw new TypeError('Invalid authority JSON array');
        if (
          item.length > MAX_NODES - nodes ||
          (item.length === 0 ? 2 : item.length * 2 + 1) > MAX_BYTES - bytes
        )
          throw new RangeError('Authority JSON resource limit');
        append('[');
        for (let index = 0; index < item.length; index++) {
          const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
          if (!descriptor?.enumerable || !('value' in descriptor))
            throw new TypeError('Invalid authority JSON array');
          if (index) append(',');
          walk(descriptor.value, depth + 1);
        }
        if (Reflect.ownKeys(item).length !== item.length + 1)
          throw new TypeError('Invalid authority JSON array');
        append(']');
      } else {
        const proto: unknown = Object.getPrototypeOf(item);
        if (proto !== Object.prototype && proto !== null)
          throw new TypeError('Invalid authority JSON object');
        const keys = Reflect.ownKeys(item);
        if (keys.some((key) => typeof key !== 'string') || keys.length > MAX_NODES - nodes)
          throw new RangeError('Authority JSON resource limit');
        const sorted = (keys as string[]).sort();
        append('{');
        for (let index = 0; index < sorted.length; index++) {
          const key = sorted[index];
          if (key === undefined) throw new TypeError('Invalid authority JSON object');
          const descriptor = Object.getOwnPropertyDescriptor(item, key);
          if (!descriptor?.enumerable || !('value' in descriptor))
            throw new TypeError('Invalid authority JSON object');
          if (++nodes > MAX_NODES) throw new RangeError('Authority JSON resource limit');
          if (index) append(',');
          append(quote(key));
          append(':');
          walk(descriptor.value, depth + 1);
        }
        append('}');
      }
    } finally {
      seen.delete(item);
    }
  };
  walk(value, 1);
  return hash.digest('hex');
}
