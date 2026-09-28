/** JSON claims admitted by the server; never serialized into sync envelopes. */
export type AuthContextValue =
  | null
  | boolean
  | number
  | string
  | readonly AuthContextValue[]
  | { readonly [key: string]: AuthContextValue };

export type AuthContext = Readonly<Record<string, AuthContextValue>>;

const MAX_BYTES = 16 * 1024;
const MAX_DEPTH = 16;
const MAX_ENTRIES = 1024;

/** Copies untrusted claims without reading properties or invoking toJSON/getters. */
export function snapshotAuthContext(value: unknown): AuthContext | undefined {
  if (value === undefined) return undefined;
  const ancestors = new Set<object>();
  let entries = 0;
  let encodedBytes = 0;
  const consume = (size: number) => {
    encodedBytes += size;
    if (encodedBytes > MAX_BYTES) throw new TypeError('invalid authentication context');
  };
  const consumeString = (text: string) => {
    if (encodedBytes + Buffer.byteLength(text, 'utf8') > MAX_BYTES) {
      throw new TypeError('invalid authentication context');
    }
    consume(Buffer.byteLength(JSON.stringify(text), 'utf8'));
  };
  const copy = (item: unknown, depth: number): AuthContextValue => {
    if (++entries > MAX_ENTRIES || depth > MAX_DEPTH) {
      throw new TypeError('invalid authentication context');
    }
    if (item === null) {
      consume(4);
      return null;
    }
    if (typeof item === 'boolean') {
      consume(item ? 4 : 5);
      return item;
    }
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new TypeError('invalid authentication context');
      consume(Buffer.byteLength(JSON.stringify(item), 'utf8'));
      return item;
    }
    if (typeof item === 'string') {
      consumeString(item);
      return item;
    }
    if (typeof item !== 'object' || ancestors.has(item)) {
      throw new TypeError('invalid authentication context');
    }
    const isArray = Array.isArray(item);
    const proto: unknown = Object.getPrototypeOf(item);
    if (isArray ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) {
      throw new TypeError('invalid authentication context');
    }
    ancestors.add(item);
    const names = Reflect.ownKeys(item);
    if (names.length > MAX_ENTRIES - entries + (isArray ? 1 : 0)) {
      throw new TypeError('invalid authentication context');
    }
    const descriptors = Object.getOwnPropertyDescriptors(item);
    consume(
      2 + (isArray ? Math.max(0, (item as unknown[]).length - 1) : Math.max(0, names.length - 1)),
    );
    const result: AuthContextValue[] | Record<string, AuthContextValue> = isArray
      ? []
      : (Object.create(null) as Record<string, AuthContextValue>);
    if (isArray) {
      const length = (item as unknown[]).length;
      if (length > MAX_ENTRIES - entries || names.length !== length + 1) {
        throw new TypeError('invalid authentication context');
      }
      for (let index = 0; index < length; index++) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !('value' in descriptor))
          throw new TypeError('invalid authentication context');
        (result as AuthContextValue[]).push(copy(descriptor.value, depth + 1));
      }
    } else {
      for (const name of names) {
        if (typeof name !== 'string') throw new TypeError('invalid authentication context');
        const descriptor = descriptors[name];
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
          throw new TypeError('invalid authentication context');
        }
        consumeString(name);
        consume(1); // colon
        (result as Record<string, AuthContextValue>)[name] = copy(descriptor.value, depth + 1);
      }
    }
    ancestors.delete(item);
    return Object.freeze(result);
  };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('invalid authentication context');
  }
  const snapshot = copy(value, 1) as AuthContext;
  if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > MAX_BYTES) {
    throw new TypeError('invalid authentication context');
  }
  return snapshot;
}

export function validateExpiresAt(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError('invalid authentication expiration');
  }
  return value;
}
