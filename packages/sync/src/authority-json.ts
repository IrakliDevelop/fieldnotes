/** Internal bounded JSON facilities shared with the future checkpoint codec. */

export interface JsonBudgets {
  readonly bytes: number;
  readonly depth: number;
  readonly nodes: number;
}

const encoder = new TextEncoder();

function wellFormedString(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function validParsedJson(value: unknown): boolean {
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return wellFormedString(value);
  if (Array.isArray(value)) return value.every(validParsedJson);
  if (typeof value !== 'object') return false;
  for (const key of Object.keys(value)) {
    if (!wellFormedString(key) || !validParsedJson((value as Record<string, unknown>)[key]))
      return false;
  }
  return true;
}

/** Counts lexical JSON nodes before JSON.parse; JSON.parse still owns syntax validation. */
export function parseBoundedJson(message: string, limits: JsonBudgets): unknown | null {
  if (typeof message !== 'string' || message.length > limits.bytes) return null;
  let depth = 0;
  let nodes = 0;
  for (let i = 0; i < message.length; i += 1) {
    const char = message[i];
    if (char === '"') {
      nodes += 1;
      i += 1;
      while (i < message.length) {
        if (message[i] === '\\') {
          i += 2;
        } else if (message[i] === '"') {
          break;
        } else {
          i += 1;
        }
      }
    } else if (char === '{' || char === '[') {
      depth += 1;
      nodes += 1;
    } else if (char === '}' || char === ']') {
      depth -= 1;
    } else if (char === '-' || (char !== undefined && /[0-9tfn]/.test(char))) {
      nodes += 1;
      while (i + 1 < message.length && /[0-9eE.+\-a-z]/.test(message[i + 1] ?? '')) i += 1;
    }
    if (depth > limits.depth || nodes > limits.nodes) return null;
  }
  if (encoder.encode(message).length > limits.bytes) return null;
  try {
    const value: unknown = JSON.parse(message);
    return validParsedJson(value) ? value : null;
  } catch {
    return null;
  }
}

export function freezeJson(value: unknown): void {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeJson(child);
    Object.freeze(value);
  }
}

/**
 * Descriptor-safe canonical writer. Output and retained enumerable keys are budgeted.
 * JavaScript has no bounded iterator for hidden/symbol own keys: the final exact
 * Reflect.ownKeys check may allocate their full inventory, and Proxy traps are
 * outside this application-level allocation guarantee.
 */
export function serializeBoundedJson(value: unknown, limits: JsonBudgets): string {
  const parts: string[] = [];
  const seen = new Set<object>();
  let bytes = 0;
  let nodes = 0;
  const append = (part: string): void => {
    bytes += encoder.encode(part).length;
    if (bytes > limits.bytes) throw new RangeError('JSON byte limit exceeded');
    parts.push(part);
  };
  const count = (): void => {
    nodes += 1;
    if (nodes > limits.nodes) throw new RangeError('JSON resource limit exceeded');
  };
  const quote = (str: string): string => {
    if (str.length > limits.bytes - bytes) throw new RangeError('JSON byte limit exceeded');
    if (!wellFormedString(str)) throw new TypeError('Invalid JSON string');
    return JSON.stringify(str);
  };
  const write = (item: unknown, depth: number): void => {
    count();
    if (item === null) {
      append('null');
      return;
    }
    if (typeof item === 'string') {
      append(quote(item));
      return;
    }
    if (typeof item === 'number' && Number.isFinite(item)) {
      append(JSON.stringify(item));
      return;
    }
    if (typeof item === 'boolean') {
      append(item ? 'true' : 'false');
      return;
    }
    if (typeof item !== 'object') throw new TypeError('Invalid JSON value');
    if (depth > limits.depth) throw new RangeError('JSON depth limit exceeded');
    if (seen.has(item)) throw new TypeError('Cyclic JSON value');
    seen.add(item);
    if (Array.isArray(item)) {
      const lengthDescriptor = Object.getOwnPropertyDescriptor(item, 'length');
      if (
        !lengthDescriptor ||
        !('value' in lengthDescriptor) ||
        !Number.isSafeInteger(lengthDescriptor.value) ||
        lengthDescriptor.value < 0
      ) {
        throw new TypeError('Invalid JSON array');
      }
      const length = lengthDescriptor.value as number;
      const minimumBytes = length === 0 ? 2 : length * 2 + 1;
      if (length > limits.nodes - nodes || minimumBytes > limits.bytes - bytes) {
        throw new RangeError('JSON resource limit exceeded');
      }
      let enumerated = 0;
      for (const key in item) {
        if (!Object.hasOwn(item, key)) continue;
        if (enumerated >= length || key !== String(enumerated)) {
          throw new TypeError('Invalid JSON array');
        }
        enumerated += 1;
      }
      if (enumerated !== length) throw new TypeError('Invalid JSON array');
      if (
        Object.getPrototypeOf(item) !== Array.prototype ||
        Reflect.ownKeys(item).length !== length + 1
      ) {
        throw new TypeError('Invalid JSON array');
      }
      append('[');
      for (let i = 0; i < length; i += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(i));
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor))
          throw new TypeError('Invalid JSON array');
        if (i > 0) append(',');
        write(descriptor.value, depth + 1);
      }
      append(']');
    } else {
      const prototype: unknown = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError('Invalid JSON object');
      }
      const keys: string[] = [];
      let minimumBytes = 2;
      if (minimumBytes > limits.bytes - bytes) throw new RangeError('JSON byte limit exceeded');
      for (const key in item) {
        if (!Object.hasOwn(item, key)) continue;
        if (key.length > limits.bytes - bytes) throw new RangeError('JSON byte limit exceeded');
        minimumBytes += encoder.encode(key).length + 4 + (keys.length > 0 ? 1 : 0);
        if ((keys.length + 1) * 2 > limits.nodes - nodes || minimumBytes > limits.bytes - bytes) {
          throw new RangeError('JSON resource limit exceeded');
        }
        keys.push(key);
      }
      if (Reflect.ownKeys(item).length !== keys.length) throw new TypeError('Invalid JSON object');
      keys.sort();
      append('{');
      for (let i = 0; i < keys.length; i += 1) {
        const key = keys[i] as string;
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor?.enumerable || !('value' in descriptor))
          throw new TypeError('Invalid JSON object');
        count(); // property key
        if (i > 0) append(',');
        append(quote(key));
        append(':');
        write(descriptor.value, depth + 1);
      }
      append('}');
    }
    seen.delete(item);
  };
  write(value, 1);
  return parts.join('');
}
