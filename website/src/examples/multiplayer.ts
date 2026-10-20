import type { Viewport } from '@fieldnotes/core';
import { SyncClient, WebSocketTransport, bearerSubprotocols } from '@fieldnotes/sync';
import { createSyncServer } from '@fieldnotes/sync-server';

// #region relay
export function startRelay(): () => Promise<void> {
  const { close } = createSyncServer({ port: 8080 });
  return close;
}
// #endregion relay

// #region connect
export function joinRoom(viewport: Viewport, room: string): () => void {
  const transport = new WebSocketTransport(`wss://relay.example.com?room=${room}`);
  const client = new SyncClient({ store: viewport.store, transport });
  client.start();
  return () => {
    client.dispose();
    transport.close();
  };
}
// #endregion connect

interface Member {
  id: string;
  gm: boolean;
}

// #region server-rules
export function startTableRelay(
  verify: (token: string | undefined, room: string) => Promise<Member | null>,
): () => Promise<void> {
  const { close } = createSyncServer({
    port: 8080,
    authenticate: async ({ room, token }) => {
      const member = await verify(token, room);
      return member ? { userId: member.id, role: member.gm ? 'gm' : 'player' } : null;
    },
    authorize: ({ role, userId, op, currentElement }) => {
      if (role === 'gm') return true;
      if (op.kind === 'upsert') return !currentElement || currentElement.ownerId === userId;
      if (op.kind === 'remove') return currentElement?.ownerId === userId;
      return false;
    },
    resolveAudience: ({ role, element, currentElement }) =>
      role === 'gm' ? element.audience : (currentElement?.audience ?? 'shared'),
    canRead: ({ role, audience }) => audience !== 'gm' || role === 'gm',
  });
  return close;
}
// #endregion server-rules

// #region client-rules
export function joinTable(
  viewport: Viewport,
  room: string,
  token: string,
  gmLayerId: string,
): SyncClient {
  const transport = new WebSocketTransport(`wss://relay.example.com?room=${room}`, {
    protocols: bearerSubprotocols(token),
  });
  const client = new SyncClient({
    store: viewport.store,
    transport,
    resolveAudience: (element) => (element.layerId === gmLayerId ? 'gm' : 'shared'),
  });
  client.start();
  return client;
}
// #endregion client-rules
