import type { SyncOp } from '@fieldnotes/sync';
import type { CanvasElement } from '@fieldnotes/core';

export type OwnedElement = CanvasElement & { ownerId?: string };

export interface AuthorizeContext {
  userId?: string;
  role?: string;
  room: string;
  op: SyncOp;
  currentElement?: OwnedElement;
}

export type Authorize = (ctx: AuthorizeContext) => boolean | Promise<boolean>;
