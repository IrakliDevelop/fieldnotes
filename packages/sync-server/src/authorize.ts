import type { LayerRecord, WireSyncElement, WireSyncOp } from '@fieldnotes/sync';

export type OwnedElement = WireSyncElement;

export interface AuthorizeContext {
  userId?: string;
  role?: string;
  room: string;
  op: WireSyncOp;
  currentElement?: OwnedElement;
}

export type Authorize = (ctx: AuthorizeContext) => boolean | Promise<boolean>;

export interface AuthorizeLayerContext {
  userId?: string;
  role?: string;
  room: string;
  op: Extract<WireSyncOp, { kind: 'layer-upsert' | 'layer-remove' }>;
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

export interface OwnerReadContext {
  userId?: string;
  role?: string;
  room: string;
}

/**
 * Decides whether a viewer may see the server-stamped `ownerId` on elements it
 * receives (live ops, snapshots and corrections). Without a hook `ownerId` is
 * stripped from every outbound frame; it stays in the backend for `authorize`.
 */
export type CanReadOwnerId = (ctx: OwnerReadContext) => boolean;
