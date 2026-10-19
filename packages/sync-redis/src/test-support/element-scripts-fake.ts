import { ELEMENT_MIGRATE_SCRIPT, ELEMENT_WRITE_SCRIPT } from '../element-scripts';

type Store = Map<string, Map<string, string>>;

function decode(raw: string | undefined): Record<string, unknown> | undefined {
  if (raw === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function hash(store: Store, key: string): Map<string, string> {
  let fields = store.get(key);
  if (!fields) {
    fields = new Map();
    store.set(key, fields);
  }
  return fields;
}

function write(store: Store, [elementsKey, tombstonesKey]: string[], argv: string[]): unknown {
  if (!elementsKey || !tombstonesKey) throw new Error('element write takes two keys');
  const [mode = '', id = '', expectedRaw = '', payload = ''] = argv;
  if (mode === 'clear') {
    const expected = JSON.parse(argv[1] ?? '') as Record<string, number>;
    const pairs = argv.slice(2);
    const ids = pairs.filter((_, i) => i % 2 === 0);
    if (
      ids.length !== Object.keys(expected).length ||
      pairs.length % 2 !== 0 ||
      new Set(ids).size !== ids.length ||
      ids.some((tombstoneId) => !Object.hasOwn(expected, tombstoneId))
    ) {
      throw new Error('clear tombstones must match the expected ids');
    }
    let elements = 0;
    for (const [field, raw] of store.get(elementsKey) ?? []) {
      const element = decode(raw);
      if (!element) continue;
      elements++;
      if (expected[field] !== element['version']) return [0, 'element', raw];
    }
    if (elements !== ids.length) return [0];
    store.delete(elementsKey);
    for (let i = 0; i < pairs.length; i += 2) {
      hash(store, tombstonesKey).set(pairs[i] ?? '', pairs[i + 1] ?? '');
    }
    return [1];
  }
  let kind = 'element';
  let raw = store.get(elementsKey)?.get(id);
  let current = decode(raw);
  if (!current) {
    kind = 'tombstone';
    raw = store.get(tombstonesKey)?.get(id);
    current = decode(raw);
  }
  const expected = expectedRaw === '' ? undefined : Number(expectedRaw);
  if (current?.['version'] !== expected) return current ? [0, kind, raw] : [0];
  const [target, other] =
    mode === 'upsert' ? [elementsKey, tombstonesKey] : [tombstonesKey, elementsKey];
  hash(store, target).set(id, payload);
  store.get(other)?.delete(id);
  return [1];
}

function migrate(store: Store, [elementsKey]: string[], argv: string[]): unknown {
  if (!elementsKey) throw new Error('element migration takes one key');
  const fields = store.get(elementsKey);
  for (let i = 0; i < argv.length; i += 2) {
    const element = decode(fields?.get(argv[i] ?? ''));
    if (element && element['index'] === undefined) fields?.set(argv[i] ?? '', argv[i + 1] ?? '');
  }
  return 1;
}

/** Runs the TypeScript twin of an element Lua script over a fake store; undefined for other scripts. */
export function emulateElementScript(
  store: Store,
  script: string,
  options: { keys: string[]; arguments: string[] },
): unknown {
  if (script === ELEMENT_WRITE_SCRIPT) return write(store, options.keys, options.arguments);
  if (script === ELEMENT_MIGRATE_SCRIPT) return migrate(store, options.keys, options.arguments);
  return undefined;
}
