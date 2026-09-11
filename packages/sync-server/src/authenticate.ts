import type { IncomingMessage } from 'http';
import { readBearerSubprotocol } from '@fieldnotes/sync';

export interface AuthInfo {
  req: IncomingMessage; // the raw WS upgrade request — read a token from req.url query or req.headers
  room: string;
  /**
   * Bearer token resolved by `readBearerToken(req)`: a `fieldnotes-bearer.<token>`
   * `Sec-WebSocket-Protocol` entry, else an `Authorization: Bearer` header, else the
   * `token` URL query parameter (legacy; URLs land in proxy logs). `undefined` when
   * none is present.
   */
  token?: string;
}

export interface AuthResult {
  userId: string;
  role?: string; // captured now; enforced in a later release (D2/D3)
}

export type Authenticate = (info: AuthInfo) => AuthResult | null | Promise<AuthResult | null>;

/**
 * Resolves the bearer token of an upgrade request, preferring channels that stay
 * out of access logs: `Sec-WebSocket-Protocol` bearer entry, then
 * `Authorization: Bearer`, then the `token` query parameter.
 */
export function readBearerToken(req: IncomingMessage): string | undefined {
  const fromProtocol = readBearerSubprotocol(headerValue(req.headers['sec-websocket-protocol']));
  if (fromProtocol) return fromProtocol;
  const authorization = headerValue(req.headers['authorization']);
  if (authorization) {
    const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
    if (match?.[1]) return match[1];
  }
  const query = new URL(req.url ?? '', 'http://localhost').searchParams.get('token');
  return query || undefined;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(',') : value;
}
