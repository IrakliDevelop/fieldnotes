import { createSyncServer, MemoryHubBackend } from '@fieldnotes/sync-server';
import { withMovementAuthorize } from '@fieldnotes/vtt/server';
import { authenticate, authorize, canRead } from './policies';

const PORT = 8787;

// MemoryHubBackend (no persistence) — a demo. Production: add a Redis backend + a real authenticate.
const backend = new MemoryHubBackend();
// Movement records are judged by their token, so the wrapper reads targets from the same backend.
const { close } = createSyncServer({
  port: PORT,
  backend,
  authenticate,
  authorize: withMovementAuthorize(authorize, {
    getElement: async (room, id) => {
      const r = await backend.getRecord(room, id);
      return r?.kind === 'element' ? r.element : undefined;
    },
  }),
  canRead,
});

console.log(`live-play relay listening on ws://localhost:${PORT}  (?name=…&role=dm|player&room=…)`);

process.on('SIGINT', () => {
  void close().then(() => process.exit(0));
});
