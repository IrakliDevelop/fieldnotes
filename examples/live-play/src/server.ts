import { createSyncServer, MemoryHubBackend } from '@fieldnotes/sync-server';
import { withMovementAuthorize } from '@fieldnotes/vtt/server';
import {
  allowImageSrc,
  authenticate,
  authorize,
  authorizeLayer,
  canRead,
  canReadLayer,
  resolveAudience,
  resolvePresenceAudience,
} from './policies';

const PORT = 8787;

// MemoryHubBackend (no persistence) — a demo. Production: add a Redis backend + a real token issuer.
const backend = new MemoryHubBackend();
const { close } = createSyncServer({
  port: PORT,
  backend,
  // Pages on other origins cannot open a socket with a visitor's browser.
  allowedOrigins: ['http://localhost:5173'],
  // Identity and role come from a server-side token table, never from the URL.
  authenticate,
  // Players edit only their own elements; movement records are judged by their token, read from the backend.
  authorize: withMovementAuthorize(authorize, {
    getElement: async (room, id) => {
      const r = await backend.getRecord(room, id);
      return r?.kind === 'element' ? r.element : undefined;
    },
  }),
  // The server tags secret-layer and DM-only movement elements, so a client cannot hide or reveal by tagging.
  resolveAudience,
  // dm-tagged elements never reach a player's socket.
  canRead,
  // The DM's measure, path and movement overlays stay off players' sockets.
  resolvePresenceAudience,
  // Players never receive the DM secret layer's definition.
  canReadLayer,
  // Only the DM may create, edit or remove the DM secret layer.
  authorizeLayer,
  // Remote image URLs would leak every viewer's IP address.
  allowImageSrc,
});

console.log(
  `live-play relay listening on ws://localhost:${PORT}  (?room=…, token as a subprotocol)`,
);

process.on('SIGINT', () => {
  void close().then(() => process.exit(0));
});
