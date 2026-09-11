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

export interface ResolveAudienceContext {
  userId?: string;
  role?: string;
  room: string;
  /** The incoming element as the client sent it, client-asserted `audience` included. */
  element: WireSyncElement;
  /** The hub's stored element for the same id, if any. */
  currentElement?: OwnedElement;
}

/**
 * Decides the authoritative `audience` of an upserted element. The returned
 * value replaces whatever the client asserted (`undefined` clears the field)
 * before `authorize`, storage and relay, so a client can neither hide content
 * by tagging it nor reveal content by retagging it. Without a hook the
 * client's tag passes through and `authorize` must check it.
 */
export type ResolveAudience = (ctx: ResolveAudienceContext) => string | undefined;
