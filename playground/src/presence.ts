import {
  attachAwareness,
  RemoteLaserOverlay,
  RemotePingOverlay,
  toLaserTrailPresence,
  toPingPresence,
} from '@fieldnotes/core';
import type { LaserTool, PingTool, Viewport } from '@fieldnotes/core';
import type { SyncClient } from '@fieldnotes/sync';
import type { Peer } from './scene';

const HEX = /^#[0-9a-f]{3,8}$/i;

/** Publishes this tab's cursor, laser and pings to the room and reports the other peers. */
export function attachPresence(
  viewport: Viewport,
  client: SyncClient,
  opts: {
    identity: { id: string; name: string; color: string; role?: string };
    laser?: LaserTool;
    ping?: PingTool;
    onPeers: (peers: Peer[]) => void;
  },
): () => void {
  const { identity } = opts;
  const awareness = attachAwareness(viewport, client, {
    identity,
    fields: { cursor: true, selection: false, tool: true },
    roster: { staleMs: 8000 },
    heartbeatMs: 3000,
  });
  const remoteLaser = new RemoteLaserOverlay(viewport);
  const remotePing = new RemotePingOverlay(viewport);
  // Peer names and colours are remote input: colours must be hex before they reach a style.
  const reportPeers = (): void =>
    opts.onPeers(
      awareness.roster
        .getPeers()
        .filter((peer) => peer.id !== identity.id)
        .map((peer) => ({
          id: peer.id,
          name: peer.name ?? 'Guest',
          color: peer.color !== undefined && HEX.test(peer.color) ? peer.color : '#71717a',
        })),
    );
  // A page entering the back/forward cache comes back live, so it must stay in the room.
  const onPageHide = (event: PageTransitionEvent): void => {
    if (!event.persisted) awareness.dispose();
  };
  window.addEventListener('pagehide', onPageHide);
  const unsubscribers = [
    awareness.roster.onChange(reportPeers),
    opts.laser?.onTrail((em) => client.sendPresence(toLaserTrailPresence(em))),
    opts.ping?.onPing((em) => client.sendPresence(toPingPresence(em))),
    client.onPresence((from, data) => {
      remoteLaser.apply(from, data);
      remotePing.apply(from, data);
    }),
    client.onPresenceLeave((from) => {
      remoteLaser.remove(from);
      remotePing.remove(from);
    }),
  ];
  awareness.announce();
  // Absent only if Collaborate is clicked before the first board load publishes the hook.
  if (window.__playground) window.__playground.laserSenders = () => remoteLaser.activeSenderCount;
  return () => {
    window.removeEventListener('pagehide', onPageHide);
    for (const unsubscribe of unsubscribers) unsubscribe?.();
    awareness.dispose();
    remoteLaser.dispose();
    remotePing.dispose();
    if (window.__playground) delete window.__playground.laserSenders;
    opts.onPeers([]);
  };
}
