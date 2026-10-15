import { createHash } from 'node:crypto';

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_NODES = 1_000_000;
const MAX_DEPTH = 64;
const QUOTE_SLICE_UNITS = 8192;
const MALFORMED_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** Application representation counts, excluding VM object headers and native allocator details. */
export interface AuthorityJsonMeasure {
  readonly bytes: number;
  readonly nodes: number;
  readonly writerParts: number;
  readonly stringUnits: number;
  readonly arrayIndexStringUnits: number;
  readonly peakInventoryEntries: number;
  readonly maxDepth: number;
}

/** Mirrors JSON.stringify's string escapes without allocating a quoted copy. */
function quotedUtf8Bytes(value: string, remaining: number): number {
  if (value.length + 2 > remaining) throw new RangeError('Authority JSON byte limit');
  if (MALFORMED_SURROGATE.test(value)) throw new TypeError('Invalid authority JSON string');
  let bytes = 2 + Buffer.byteLength(value, 'utf8');
  if (bytes > remaining) throw new RangeError('Authority JSON byte limit');
  // JSON control escapes are intentional here; this only tests presence and allocates no matches.
  // eslint-disable-next-line no-control-regex
  if (!/["\\\u0000-\u001f]/.test(value)) return bytes;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (
      code === 0x22 ||
      code === 0x5c ||
      code === 8 ||
      code === 9 ||
      code === 10 ||
      code === 12 ||
      code === 13
    )
      bytes += 1;
    else if (code < 0x20) bytes += 5;
    if (bytes > remaining) throw new RangeError('Authority JSON byte limit');
  }
  return bytes;
}

/** A helper frame drops every quoted fragment before the next one is allocated. */
function hashQuotedSlice(
  hash: ReturnType<typeof createHash>,
  value: string,
  start: number,
  end: number,
): void {
  const quoted = JSON.stringify(value.slice(start, end));
  hash.update(quoted.slice(1, -1), 'utf8');
}

function hashQuoted(hash: ReturnType<typeof createHash>, value: string): void {
  hash.update('"', 'utf8');
  for (let start = 0; start < value.length; ) {
    let end = Math.min(value.length, start + QUOTE_SLICE_UNITS);
    if (end < value.length && end > start) {
      const last = value.charCodeAt(end - 1);
      const next = value.charCodeAt(end);
      if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end--;
    }
    hashQuotedSlice(hash, value, start, end);
    start = end;
  }
  hash.update('"', 'utf8');
}

function visitAuthorityJson(
  value: unknown,
  hashOutput: boolean,
  maxBytes = MAX_BYTES,
  maxNodes = MAX_NODES,
): {
  readonly measure: AuthorityJsonMeasure;
  readonly hash?: string;
} {
  const hash = hashOutput ? createHash('sha256') : undefined;
  const seen = new Set<object>();
  let bytes = 0;
  let nodes = 0;
  let writerParts = 0;
  let stringUnits = 0;
  let arrayIndexStringUnits = 0;
  let inventoryEntries = 0;
  let peakInventoryEntries = 0;
  let maxDepth = 0;
  const append = (part: string, length = Buffer.byteLength(part, 'utf8')): void => {
    bytes += length;
    if (bytes > maxBytes) throw new RangeError('Authority JSON byte limit');
    writerParts++;
    hash?.update(part, 'utf8');
  };
  const quote = (part: string): void => {
    const length = quotedUtf8Bytes(part, maxBytes - bytes);
    stringUnits += part.length;
    bytes += length;
    writerParts++;
    if (hash) hashQuoted(hash, part);
  };
  const walk = (item: unknown, depth: number): void => {
    if (++nodes > maxNodes) throw new RangeError('Authority JSON resource limit');
    if (item === null) return append('null');
    if (typeof item === 'string') return quote(item);
    if (typeof item === 'boolean') return append(item ? 'true' : 'false');
    if (typeof item === 'number' && Number.isFinite(item)) return append(JSON.stringify(item));
    if (typeof item !== 'object' || seen.has(item))
      throw new TypeError('Invalid authority JSON value');
    if (depth > MAX_DEPTH) throw new RangeError('Authority JSON resource limit');
    maxDepth = Math.max(maxDepth, depth);
    seen.add(item);
    try {
      if (Array.isArray(item)) {
        if (Object.getPrototypeOf(item) !== Array.prototype)
          throw new TypeError('Invalid authority JSON array');
        if (
          item.length > maxNodes - nodes ||
          (item.length === 0 ? 2 : item.length * 2 + 1) > maxBytes - bytes
        )
          throw new RangeError('Authority JSON resource limit');
        // Count ordinary enumerable extras without building a second key inventory.
        let enumerable = 0;
        for (const key in item) {
          if (!Object.hasOwn(item, key)) continue;
          if (++enumerable > item.length) throw new TypeError('Invalid authority JSON array');
        }
        append('[');
        for (let index = 0; index < item.length; index++) {
          const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
          if (!descriptor?.enumerable || !('value' in descriptor))
            throw new TypeError('Invalid authority JSON array');
          if (index) append(',');
          walk(descriptor.value, depth + 1);
        }
        if (inventoryEntries + item.length + 1 > maxNodes + MAX_DEPTH)
          throw new RangeError('Authority JSON inventory limit');
        const ownKeyCount = Reflect.ownKeys(item).length;
        if (ownKeyCount !== item.length + 1) throw new TypeError('Invalid authority JSON array');
        peakInventoryEntries = Math.max(peakInventoryEntries, inventoryEntries + ownKeyCount);
        for (let index = 0; index < item.length; index++)
          arrayIndexStringUnits += String(index).length;
        append(']');
      } else {
        const proto: unknown = Object.getPrototypeOf(item);
        if (proto !== Object.prototype && proto !== null)
          throw new TypeError('Invalid authority JSON object');
        const keys: string[] = [];
        let minimumBytes = 2;
        for (const key in item) {
          if (!Object.hasOwn(item, key)) continue;
          const remaining = maxBytes - bytes;
          const quotedLength = quotedUtf8Bytes(key, remaining);
          minimumBytes += quotedLength + 2 + (keys.length > 0 ? 1 : 0);
          if (
            (keys.length + 1) * 2 > maxNodes - nodes ||
            inventoryEntries + keys.length + 1 > maxNodes + MAX_DEPTH ||
            minimumBytes > remaining
          )
            throw new RangeError('Authority JSON resource limit');
          keys.push(key);
        }
        if (inventoryEntries + 2 * keys.length > maxNodes + MAX_DEPTH)
          throw new RangeError('Authority JSON inventory limit');
        peakInventoryEntries = Math.max(peakInventoryEntries, inventoryEntries + 2 * keys.length);
        if (Reflect.ownKeys(item).length !== keys.length)
          throw new TypeError('Invalid authority JSON object');
        inventoryEntries += keys.length;
        peakInventoryEntries = Math.max(peakInventoryEntries, inventoryEntries);
        try {
          keys.sort();
          append('{');
          for (let index = 0; index < keys.length; index++) {
            const key = keys[index];
            if (key === undefined) throw new TypeError('Invalid authority JSON object');
            const descriptor = Object.getOwnPropertyDescriptor(item, key);
            if (!descriptor?.enumerable || !('value' in descriptor))
              throw new TypeError('Invalid authority JSON object');
            if (++nodes > maxNodes) throw new RangeError('Authority JSON resource limit');
            if (index) append(',');
            quote(key);
            append(':');
            walk(descriptor.value, depth + 1);
          }
          append('}');
        } finally {
          inventoryEntries -= keys.length;
        }
      }
    } finally {
      seen.delete(item);
    }
  };
  walk(value, 1);
  return {
    measure: {
      bytes,
      nodes,
      writerParts,
      stringUnits,
      arrayIndexStringUnits,
      peakInventoryEntries,
      maxDepth,
    },
    ...(hash ? { hash: hash.digest('hex') } : {}),
  };
}

/** Same grammar and limits as the canonical state hash, for complete C2 payload preflight. */
export function measureAuthorityJson(
  value: unknown,
  maxBytes = MAX_BYTES,
  maxNodes = MAX_NODES,
): AuthorityJsonMeasure {
  return visitAuthorityJson(value, false, maxBytes, maxNodes).measure;
}

/** Canonical, bounded complete-visible-state hash. No cursor or internal position is included. */
export function hashAuthorityJson(value: unknown): string {
  const hash = visitAuthorityJson(value, true).hash;
  if (hash === undefined) throw new Error('Authority hash unavailable');
  return hash;
}
