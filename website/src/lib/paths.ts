const ABSOLUTE_URL = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i;

/** Prefixes a site path with `base`; absolute URLs and `#` anchors pass through unchanged. */
export function withBase(path: string, base: string): string {
  if (path.startsWith('#') || ABSOLUTE_URL.test(path)) return path;
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}
