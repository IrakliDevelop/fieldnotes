import type { CanvasElement } from '@fieldnotes/core';
import type { Authenticate, Authorize, CanRead } from '@fieldnotes/sync-server';

export type Role = 'dm' | 'player';
export const DM_AUDIENCE = 'dm';

// D1 — identity from the WS query string (?name=&role=). A real app verifies a token here.
export const authenticate: Authenticate = ({ req }) => {
  const url = new URL(req.url ?? '', 'http://x');
  const name = url.searchParams.get('name');
  const role: Role = url.searchParams.get('role') === 'dm' ? 'dm' : 'player';
  if (!name) return null; // reject nameless joins → ws close 4401
  return { userId: name, role };
};

// D2 — DM edits anything; a player may create new elements and edit only their OWN (ownerId === userId).
export const authorize: Authorize = ({ role, userId, op, currentElement }) => {
  if (role === 'dm') return true;
  if (op.kind === 'clear') return false; // players can't wipe the room
  if (op.kind === 'upsert' && currentElement === undefined) return true; // creating a new element
  return currentElement?.ownerId === userId; // edit/remove only your own
};

// D3 — two-tier read filter: dm-tagged elements reach only the DM.
export const canRead: CanRead = ({ role, audience }) => audience !== DM_AUDIENCE || role === 'dm';

// Client-side — stamp 'dm' on elements the DM placed on the secret layer; everything else shared (undefined).
export function makeResolveAudience(
  dmSecretLayerId: string | null,
): (el: CanvasElement) => string | undefined {
  return (el) =>
    dmSecretLayerId !== null && el.layerId === dmSecretLayerId ? DM_AUDIENCE : undefined;
}
