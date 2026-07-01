import type { IncomingMessage } from 'http';

export interface AuthInfo {
  req: IncomingMessage; // the raw WS upgrade request — read a token from req.url query or req.headers
  room: string;
}

export interface AuthResult {
  userId: string;
  role?: string; // captured now; enforced in a later release (D2/D3)
}

export type Authenticate = (info: AuthInfo) => AuthResult | null | Promise<AuthResult | null>;
