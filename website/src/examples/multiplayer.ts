import type { Viewport } from '@fieldnotes/core';
import { SyncClient, WebSocketTransport, bearerSubprotocols } from '@fieldnotes/sync';
import { createSyncServer } from '@fieldnotes/sync-server';

export function relay(): () => Promise<void> {
  // #region relay
  const { close } = createSyncServer({ port: 8080 });
  // #endregion relay
  return close;
}

export function connect(viewport: Viewport): void {
  // #region connect
  const transport = new WebSocketTransport('wss://relay.example.com?room=table-1');
  const client = new SyncClient({ store: viewport.store, transport });
  client.start();
  // #endregion connect
}

interface Member {
  id: string;
  gm: boolean;
}

export function serverRules(
  verify: (token: string | undefined, room: string) => Promise<Member | null>,
): () => Promise<void> {
  // #region server-rules
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
  // #endregion server-rules
  return close;
}

export function clientRules(viewport: Viewport, token: string, gmLayerId: string): void {
  // #region client-rules
  const transport = new WebSocketTransport('wss://relay.example.com?room=table-1', {
    protocols: bearerSubprotocols(token),
  });
  const client = new SyncClient({
    store: viewport.store,
    transport,
    resolveAudience: (element) => (element.layerId === gmLayerId ? 'gm' : 'shared'),
  });
  client.start();
  // #endregion client-rules
}
