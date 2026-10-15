import type { AuthContext } from './auth-context';

export interface FrameAuthorizationContext {
  readonly connectionId: string;
  readonly room: string;
  readonly userId?: string;
  readonly role?: string;
  readonly authContext?: AuthContext;
  readonly expiresAt?: number;
  readonly direction: 'inbound' | 'outbound';
  readonly message: string;
  readonly deadlineAt: number;
  readonly signal: AbortSignal;
}

export type AuthorizeFrame = (context: FrameAuthorizationContext) => boolean | Promise<boolean>;

export interface FramePolicy {
  readonly authorize?: AuthorizeFrame;
}
