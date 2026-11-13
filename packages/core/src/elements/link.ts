const MAX_LINK_LENGTH = 2048;
const ELEMENT_LINK_PREFIX = '#fn:element=';
const ALLOWED_PROTOCOLS = ['http:', 'https:', 'mailto:'];

/** True when `link` is an `http(s)`, `mailto` or `#fn:element=<id>` link safe to store and open. */
export function isAllowedLink(link: string): boolean {
  if (link.length > MAX_LINK_LENGTH) return false;
  // Checked on the raw string: `new URL` silently strips tabs and newlines.
  for (let i = 0; i < link.length; i++) {
    const code = link.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return false;
  }
  if (link.startsWith(ELEMENT_LINK_PREFIX)) {
    const id = link.slice(ELEMENT_LINK_PREFIX.length);
    return id !== '' && !/\s/.test(id);
  }
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return false;
  }
  return ALLOWED_PROTOCOLS.includes(url.protocol) && url.username === '' && url.password === '';
}

/** Trims `input` and adds `https://` to a bare domain; returns `null` when the result is not allowed. */
export function normalizeLink(input: string): string | null {
  let link = input.trim();
  if (link.length > MAX_LINK_LENGTH) return null;
  const bareDomain =
    !/^[a-z][a-z0-9+.-]*:/i.test(link) &&
    !link.startsWith('#') &&
    link.includes('.') &&
    !/[\s@]/.test(link);
  if (bareDomain) link = `https://${link}`;
  return isAllowedLink(link) ? link : null;
}

/** True when a pasted line is plainly a link (a scheme or `www.`), not just text with a dot. */
export function isPasteLink(line: string): boolean {
  const trimmed = line.trim();
  return /^(https?:\/\/|mailto:|www\.)/i.test(trimmed) && normalizeLink(trimmed) !== null;
}

/** The internal link that jumps to the element `id`. */
export function elementLink(id: string): string {
  return ELEMENT_LINK_PREFIX + id;
}

/** The element id of an internal link, or `null` when `link` is not one. */
export function parseElementLink(link: string): string | null {
  if (!link.startsWith(ELEMENT_LINK_PREFIX)) return null;
  const id = link.slice(ELEMENT_LINK_PREFIX.length);
  return id === '' ? null : id;
}
