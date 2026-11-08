export function jsonEqual(a: unknown, b: unknown, skip?: ReadonlySet<string>): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const entries: [string, unknown][] = Object.entries(a).filter(
    ([key, value]) => !skip?.has(key) && (Array.isArray(a) || value !== undefined),
  );
  const other = new Map<string, unknown>(
    Object.entries(b).filter(
      ([key, value]) => !skip?.has(key) && (Array.isArray(b) || value !== undefined),
    ),
  );
  return (
    entries.length === other.size &&
    entries.every(([key, value]) => other.has(key) && jsonEqual(value, other.get(key)))
  );
}
