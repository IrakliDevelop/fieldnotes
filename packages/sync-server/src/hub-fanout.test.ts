import { describe, it, expect, vi } from 'vitest';
import { createCurrentCapabilities, type SyncOp } from '@fieldnotes/sync';
import type { Layer } from '@fieldnotes/core';
import { InMemoryHubFanout } from './hub-fanout';
import { MemoryHubBackend } from './memory-hub-backend';
import { SyncHub, type Connection } from './sync-hub';
import type { CanRead, CanReadLayer, ResolvePresenceAudience } from './authorize';

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
      canReadLayer: () => true,
      instanceId: 'A',
      fanout: bus,
      canRead,
      resolvePresenceAudience,
      presenceThrottleMs: 0,
    });
    const remote = new SyncHub({
      canReadLayer: () => true,
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

describe('layer read filter across instances', () => {
  const canReadLayer: CanReadLayer = ({ role, layer }) =>
    role === 'dm' || layer.name !== 'DM Secret';
  const def = (name: string, id = 'L1'): Layer => ({
    id,
    name,
    visible: true,
    locked: false,
    order: 0,
    opacity: 1,
  });
  const upsert = (version: number, name: string, id = 'L1'): SyncOp => ({
    kind: 'layer-upsert',
    layer: def(name, id),
    version,
    editor: 'dm',
  });
  const frame = (op: SyncOp): string => JSON.stringify({ from: 'dm', op });

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

  function twoHubs() {
    const bus = new InMemoryHubFanout();
    const origin = new SyncHub({ instanceId: 'A', fanout: bus, canReadLayer });
    const remoteBackend = new MemoryHubBackend();
    const remote = new SyncHub({
      instanceId: 'B',
      fanout: bus,
      canReadLayer,
      backend: remoteBackend,
    });
    join(origin, 'dm', 'dm');
    const dm2 = join(remote, 'dm2', 'dm');
    const pl = join(remote, 'pl', 'player');
    const send = (op: SyncOp) => origin.handleMessage('dm', JSON.stringify({ from: 'dm', op }));
    return { bus, remote, remoteBackend, dm2, pl, send };
  }

  it('applies the read table to a player on the receiving instance', async () => {
    const { remote, remoteBackend, dm2, pl, send } = twoHubs();

    await send(upsert(1, 'DM Secret', 'S'));
    expect(dm2).toEqual([frame(upsert(1, 'DM Secret', 'S'))]);
    expect(pl).toEqual([]);

    await send(upsert(1, 'Open'));
    await send(upsert(2, 'DM Secret'));
    await send(upsert(3, 'DM Secret'));
    await send({ kind: 'layer-remove', id: 'S', version: 2, editor: 'dm' });
    await send(upsert(4, 'Open again'));
    expect(pl).toEqual([
      frame(upsert(1, 'Open')),
      frame({ kind: 'layer-remove', id: 'L1', version: 2, editor: 'dm' }),
      frame(upsert(4, 'Open again')),
    ]);
    expect(dm2).toHaveLength(6);

    await vi.waitFor(async () =>
      expect((await remoteBackend.getLayerRecord('R', 'L1'))?.version).toBe(4),
    );
    pl.length = 0;
    await remote.handleMessage(
      'pl',
      JSON.stringify({ from: 'pl', op: { kind: 'request-snapshot' } }),
    );
    expect(pl.join()).not.toContain('DM Secret');
  });

  it('treats a missing prevLayer as unknown and drops a malformed one', () => {
    const { bus, dm2, pl } = twoHubs();
    const publish = (op: SyncOp, extra: Record<string, unknown> = {}): void =>
      bus.publish(JSON.stringify({ o: 'C', room: 'R', from: 'dm', op, ...extra }));

    publish(upsert(1, 'Open'));
    publish(upsert(1, 'DM Secret', 'S'));
    publish({ kind: 'layer-remove', id: 'L1', version: 2, editor: 'dm' });
    publish(upsert(1, 'Bad prev', 'B'), { prevLayer: 7 });
    publish(upsert(1, 'Array prev', 'B2'), { prevLayer: [] });

    expect(pl).toEqual([frame(upsert(1, 'Open'))]);
    expect(dm2).toEqual([frame(upsert(1, 'Open')), frame(upsert(1, 'DM Secret', 'S'))]);
  });

  it('adds prevLayer to the fan-out payload only when canReadLayer is set', async () => {
    const published: string[] = [];
    const fanout = {
      publish: (p: string) => void published.push(p),
      subscribe: () => () => undefined,
    };
    for (const options of [{}, { canReadLayer }]) {
      const hub = new SyncHub({ instanceId: 'A', fanout, ...options });
      join(hub, 'dm', 'dm');
      await hub.handleMessage('dm', JSON.stringify({ from: 'dm', op: upsert(1, 'Open') }));
      await hub.handleMessage('dm', JSON.stringify({ from: 'dm', op: upsert(2, 'Next') }));
      hub.close();
    }
    const base = (op: SyncOp) => ({ o: 'A', room: 'R', from: 'dm', op });
    expect(published).toEqual([
      JSON.stringify(base(upsert(1, 'Open'))),
      JSON.stringify(base(upsert(2, 'Next'))),
      JSON.stringify({ ...base(upsert(1, 'Open')), prevLayer: null }),
      JSON.stringify({ ...base(upsert(2, 'Next')), prevLayer: def('Open') }),
    ]);
  });
});
