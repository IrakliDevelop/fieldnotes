import { createSyncServer } from '@fieldnotes/sync-server';
import { authenticate, authorize, canRead } from './policies';

const PORT = 8787;

// Default MemoryHubBackend (no persistence) — a demo. Production: add a Redis backend + a real authenticate.
const { close } = createSyncServer({ port: PORT, authenticate, authorize, canRead });

console.log(`live-play relay listening on ws://localhost:${PORT}  (?name=…&role=dm|player&room=…)`);

process.on('SIGINT', () => {
  void close().then(() => process.exit(0));
});
