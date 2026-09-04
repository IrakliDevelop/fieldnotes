import type { SyncOp, LayerRecord, FogSnapshot } from '@fieldnotes/sync';
import type { CanvasElement } from '@fieldnotes/core';

export type OwnedElement = CanvasElement & { ownerId?: string; audience?: string };

export interface AuthorizeContext {
  userId?: string;
  role?: string;
  room: string;
  op: SyncOp;
  currentElement?: OwnedElement;
}

export type Authorize = (ctx: AuthorizeContext) => boolean | Promise<boolean>;

export interface AuthorizeLayerContext {
  userId?: string;
  role?: string;
  room: string;
  op: Extract<SyncOp, { kind: 'layer-upsert' | 'layer-remove' }>;
  /** The hub's current record for the target layer, tombstones included. */
  currentRecord?: LayerRecord;
}

/**
 * Authorizes layer-definition edits. Without a hook every room member may
 * edit layer definitions. A denied edit is answered with an authoritative
 * hub correction to the sender only, so the sender's local ledger converges
 * back to the room state.
 */
export type AuthorizeLayer = (ctx: AuthorizeLayerContext) => boolean | Promise<boolean>;

export interface ReadContext {
  userId?: string;
  role?: string;
  room: string;
  audience: string | undefined;
}

export type CanRead = (ctx: ReadContext) => boolean;

export interface AuthorizeFogContext {
  userId?: string;
  role?: string;
  room: string;
  op: Extract<SyncOp, { kind: 'fog-meta' | 'fog-patch' }>;
  current: FogSnapshot | undefined;
}

export type AuthorizeFog = (ctx: AuthorizeFogContext) => boolean | Promise<boolean>;
