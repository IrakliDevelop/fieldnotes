import type { CanvasElement } from '@fieldnotes/core';
import type {
  AllowImageSrc,
  Authenticate,
  Authorize,
  AuthorizeLayer,
  CanRead,
  CanReadLayer,
  ResolveAudience,
  ResolvePresenceAudience,
} from '@fieldnotes/sync-server';
import {
  getMovementVisibility,
  MEASURE_PRESENCE_KIND,
  MOVEMENT_PRESENCE_KIND,
  PATH_PRESENCE_KIND,
} from '@fieldnotes/vtt';

export type Role = 'dm' | 'player';
export const DM_AUDIENCE = 'dm';
export const DM_SECRET_LAYER_ID = 'dm-secret';

// A real app issues tokens from its own login and never ships them to the browser.
export const DEMO_TOKENS: Record<string, { name: string; role: Role }> = {
  'demo-dm-token': { name: 'DM', role: 'dm' },
  'demo-player-1-token': { name: 'Player 1', role: 'player' },
  'demo-player-2-token': { name: 'Player 2', role: 'player' },
};

// D1 — identity and role come only from the bearer token; the query string carries just the room.
export const authenticate: Authenticate = ({ token }) => {
  if (token === undefined || !Object.hasOwn(DEMO_TOKENS, token)) return null;
  const entry = DEMO_TOKENS[token];
  return entry ? { userId: entry.name, role: entry.role } : null;
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

// Server-side audience, never the client's tag. DM edits derive it fresh so Reveal works; a player edit
// keeps the stored audience so a player cannot un-hide an element the DM hid.
export const resolveAudience: ResolveAudience = ({ role, element, currentElement }) => {
  if (element.layerId === DM_SECRET_LAYER_ID || getMovementVisibility(element) === 'dm') {
    return DM_AUDIENCE;
  }
  return role === 'dm' ? undefined : currentElement?.audience;
};

export const canReadLayer: CanReadLayer = ({ role, layer }) =>
  layer.id !== DM_SECRET_LAYER_ID || role === 'dm';

export const authorizeLayer: AuthorizeLayer = ({ role, op }) => {
  const id = op.kind === 'layer-upsert' ? op.layer.id : op.id;
  return id !== DM_SECRET_LAYER_ID || role === 'dm';
};

const DM_ONLY_LANES = new Set([MEASURE_PRESENCE_KIND, PATH_PRESENCE_KIND, MOVEMENT_PRESENCE_KIND]);

// Cursors and every player frame reach everyone; the DM's measure, path and movement overlays stay DM-only.
export const resolvePresenceAudience: ResolvePresenceAudience = ({ role, lane }) =>
  role === 'dm' && DM_ONLY_LANES.has(lane) ? DM_AUDIENCE : undefined;

// A remote URL would make every viewer's browser fetch it and expose their IP; this demo has no upload host.
export const allowImageSrc: AllowImageSrc = ({ src }) => src.startsWith('data:image/');

// Client-side — stamp 'dm' on DM-only movement records and the DM's secret-layer elements; else shared.
export function makeResolveAudience(
  dmSecretLayerId: string | null,
): (el: CanvasElement) => string | undefined {
  return (el) => {
    if (getMovementVisibility(el) === 'dm') return DM_AUDIENCE;
    return dmSecretLayerId !== null && el.layerId === dmSecretLayerId ? DM_AUDIENCE : undefined;
  };
}
