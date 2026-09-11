/**
 * Bearer authentication over the WebSocket upgrade without putting the token
 * in the URL, where proxies and load balancers log it. A browser `WebSocket`
 * cannot set headers, but it can offer subprotocols, so the client offers the
 * sync subprotocol plus a `fieldnotes-bearer.<token>` entry; the relay reads
 * the token from `Sec-WebSocket-Protocol`, selects `fieldnotes-sync` and never
 * echoes the bearer entry.
 */

export const SYNC_WS_SUBPROTOCOL = 'fieldnotes-sync';
export const BEARER_SUBPROTOCOL_PREFIX = 'fieldnotes-bearer.';

// RFC 6455 §4.1 / RFC 2616 §2.2 `token`: printable ASCII without separators.
const SUBPROTOCOL_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/**
 * Subprotocols to offer for a bearer token. `token` must be a valid
 * `Sec-WebSocket-Protocol` token: base64url and JWT alphabets qualify, base64
 * padding (`=`) does not.
 */
export function bearerSubprotocols(token: string): string[] {
  if (!SUBPROTOCOL_TOKEN.test(token)) {
    throw new TypeError(
      'bearerSubprotocols: token must be a Sec-WebSocket-Protocol token (no spaces, separators or non-ASCII)',
    );
  }
  return [SYNC_WS_SUBPROTOCOL, `${BEARER_SUBPROTOCOL_PREFIX}${token}`];
}

/** Reads the bearer token from a raw `Sec-WebSocket-Protocol` header value, if offered. */
export function readBearerSubprotocol(header: string | undefined): string | undefined {
  if (!header) return undefined;
  for (const entry of header.split(',')) {
    const protocol = entry.trim();
    if (!protocol.startsWith(BEARER_SUBPROTOCOL_PREFIX)) continue;
    const token = protocol.slice(BEARER_SUBPROTOCOL_PREFIX.length);
    return token.length > 0 ? token : undefined;
  }
  return undefined;
}
