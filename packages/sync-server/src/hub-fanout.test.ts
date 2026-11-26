import { describe, it, expect, vi } from 'vitest';
import { createCurrentCapabilities } from '@fieldnotes/sync';
import { InMemoryHubFanout } from './hub-fanout';
import { SyncHub, type Connection } from './sync-hub';
import type { CanRead, ResolvePresenceAudience } from './authorize';

describe('InMemoryHubFanout', () => {
  it('delivers a published payload to all subscribed handlers', () => {
    const bus = new InMemoryHubFanout();
    const a: string[] = [];
    const b: string[] = [];
    bus.subscribe((p) => a.push(p));
    bus.subscribe((p) => b.push(p));

    bus.publish('hello');

    expect(a).toEqual(['hello']);
    expect(b).toEqual(['hello']);
  });

  it('stops delivery after unsubscribe', () => {
    const bus = new InMemoryHubFanout();
    const got: string[] = [];
    const unsub = bus.subscribe((p) => got.push(p));

    bus.publish('one');
    unsub();
    bus.publish('two');

    expect(got).toEqual(['one']);
  });

  it('a throwing handler does not stop delivery to the others', () => {
    const bus = new InMemoryHubFanout();
    const got: string[] = [];
    bus.subscribe(() => {
      throw new Error('boom');
    });
    bus.subscribe((p) => got.push(p));

    bus.publish('payload');

    expect(got).toEqual(['payload']);
  });
});

describe('presence audience across instances', () => {
  const canRead: CanRead = ({ role, audience }) => audience !== 'dm' || role === 'dm';
  const resolvePresenceAudience: ResolvePresenceAudience = ({ role }) =>
    role === 'dm' ? 'dm' : undefined;

  function join(hub: SyncHub, id: string, role: string): string[] {
    const sent: string[] = [];
    const conn: Connection = { id, room: 'R', role, send: (m) => sent.push(m) };
    hub.addConnection(conn);
    const capabilities = createCurrentCapabilities([]);
    void hub.handleMessage(
      id,
      JSON.stringify({ from: id, op: { kind: 'capabilities', capabilities } }),
    );
    sent.length = 0;
    return sent;
  }

  it('keeps DM presence from a player on another hub, resolving the audience only on the origin', async () => {
    const bus = new InMemoryHubFanout();
    const remoteHook = vi.fn(resolvePresenceAudience);
    const origin = new SyncHub({
      instanceId: 'A',
      fanout: bus,
      canRead,
      resolvePresenceAudience,
      presenceThrottleMs: 0,
    });
    const remote = new SyncHub({
      instanceId: 'B',
      fanout: bus,
      canRead,
      resolvePresenceAudience: remoteHook,
    });
    join(origin, 'dm', 'dm');
    const dm2 = join(remote, 'dm2', 'dm');
    const player = join(remote, 'pl', 'player');

    await origin.handleMessage(
      'dm',
      JSON.stringify({ from: 'dm', op: { kind: 'presence', data: { note: 'dm-secret' } } }),
    );
    origin.broadcastPresence('R', { note: 'hub-secret' }, { audience: 'dm' });

    await vi.waitFor(() => expect(dm2.join()).toContain('hub-secret'));
    expect(dm2.join()).toContain('dm-secret');
    expect(player.join()).not.toContain('dm-secret');
    expect(player.join()).not.toContain('hub-secret');
    expect(remoteHook).not.toHaveBeenCalled();
  });
});
