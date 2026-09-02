import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createShape } from '@fieldnotes/core';
import type { CanvasElement, Layer } from '@fieldnotes/core';
import type { SyncOp } from '@fieldnotes/sync';
import { SyncHub } from './sync-hub';
import type { Connection } from './sync-hub';
import type { HubBackend } from './hub-backend';
import { MemoryHubBackend } from './memory-hub-backend';
import type { Authorize, OwnedElement } from './authorize';
import { InMemoryHubFanout } from './hub-fanout';

interface FakeConn extends Connection {
  sent: string[];
}

function makeConn(id: string, room: string): FakeConn {
  const sent: string[] = [];
  return { id, room, sent, send: (m) => sent.push(m) };
}

function envelope(from: string, op: SyncOp): string {
  return JSON.stringify({ from, op });
}

const sampleEl = (): CanvasElement =>
  createShape({ position: { x: 1, y: 2 }, size: { w: 10, h: 20 } });

describe('SyncHub', () => {
  let hub: SyncHub;
  let A: FakeConn;
  let B: FakeConn;
  let C: FakeConn;

  beforeEach(() => {
    hub = new SyncHub();
    A = makeConn('A', 'R');
    B = makeConn('B', 'R');
    C = makeConn('C', 'R2');
    hub.addConnection(A);
    hub.addConnection(B);
    hub.addConnection(C);
  });

  it('forwards an upsert to other room members but not the sender or cross-room', async () => {
    const el = sampleEl();
    const msg = envelope('clientA', { kind: 'upsert', element: el });
    await hub.handleMessage('A', msg);

    expect(JSON.parse(B.sent[0] ?? '')).toEqual({
      from: 'A',
      op: { kind: 'upsert', element: el },
    });
    expect(A.sent).toEqual([]); // not echoed to sender
    expect(C.sent).toEqual([]); // cross-room isolated
  });

  it('applies forwarded ops to the backend (snapshot reflects it)', async () => {
    const el = sampleEl();
    const upsertMsg = envelope('clientA', { kind: 'upsert', element: el });
    await hub.handleMessage('A', upsertMsg);
    await hub.handleMessage('B', envelope('clientB', { kind: 'request-snapshot' }));

    // B received the forwarded upsert, then its own snapshot reply.
    expect(JSON.parse(B.sent[0] ?? '')).toEqual({
      from: 'A',
      op: { kind: 'upsert', element: el },
    });
    const reply = JSON.parse(B.sent[1] ?? '');
    expect(reply).toEqual({ from: 'hub', op: { kind: 'snapshot', to: 'clientB', elements: [el] } });
  });

  it('answers request-snapshot only to the requester, addressed via to', async () => {
    await hub.handleMessage('B', envelope('clientB', { kind: 'request-snapshot' }));
    expect(A.sent).toEqual([]);
    expect(C.sent).toEqual([]);
    const reply = JSON.parse(B.sent[0] ?? '');
    expect(reply.from).toBe('hub');
    expect(reply.op.kind).toBe('snapshot');
    expect(reply.op.to).toBe('clientB');
    expect(reply.op.elements).toEqual([]);
  });

  it('forwards remove and clear to peers', async () => {
    const removeMsg = envelope('clientA', { kind: 'remove', id: 'x' });
    await hub.handleMessage('A', removeMsg);
    expect(JSON.parse(B.sent[0] ?? '')).toEqual({ from: 'A', op: { kind: 'remove', id: 'x' } });

    const clearMsg = envelope('clientA', { kind: 'clear' });
    await hub.handleMessage('A', clearMsg);
    expect(JSON.parse(B.sent[1] ?? '')).toEqual({ from: 'A', op: { kind: 'clear' } });
  });

  it('replaces a forged sender on relayed data operations', async () => {
    const el = sampleEl();
    await hub.handleMessage('A', envelope('B', { kind: 'upsert', element: el }));

    expect(JSON.parse(B.sent[0] ?? '')).toEqual({
      from: 'A',
      op: { kind: 'upsert', element: el },
    });
  });

  it('drops malformed messages and client-sent snapshots', async () => {
    await hub.handleMessage('A', 'not json');
    await hub.handleMessage('A', JSON.stringify({ nope: true }));
    await hub.handleMessage(
      'A',
      envelope('clientA', { kind: 'snapshot', to: 'clientB', elements: [] }),
    );

    expect(A.sent).toEqual([]);
    expect(B.sent).toEqual([]);
    expect(C.sent).toEqual([]);
  });

  it('drops envelopes deeper than the configured JSON limit', async () => {
    const hub = new SyncHub({ maxJsonDepth: 1 });
    const a = makeConn('A', 'R');
    const b = makeConn('B', 'R');
    hub.addConnection(a);
    hub.addConnection(b);

    await hub.handleMessage('A', JSON.stringify({ from: 'A', op: { kind: 'clear' } }));

    expect(b.sent).toEqual([]);
  });

  it('does not persist or broadcast a structurally malformed upsert', async () => {
    const malformed = { ...sampleEl(), size: { w: 'wide', h: 20 } };
    await hub.handleMessage(
      'A',
      JSON.stringify({ from: 'clientA', op: { kind: 'upsert', element: malformed } }),
    );
    await hub.handleMessage('A', envelope('clientA', { kind: 'request-snapshot' }));

    expect(B.sent).toEqual([]);
    expect(JSON.parse(A.sent[0] ?? '').op.elements).toEqual([]);
  });

  it('ignores messages from unknown connections', async () => {
    await hub.handleMessage('ghost', envelope('ghost', { kind: 'clear' }));
    expect(A.sent).toEqual([]);
    expect(B.sent).toEqual([]);
  });

  it('does not forward to a removed connection', async () => {
    hub.removeConnection('B');
    const msg = envelope('clientA', { kind: 'remove', id: 'x' });
    await hub.handleMessage('A', msg);
    expect(B.sent).toEqual([]);
  });

  it('drops room state when the last member of a room leaves', async () => {
    // A + B in room R, C in R2 → two live rooms.
    expect(hub.roomCount()).toBe(2);
    hub.removeConnection('A');
    expect(hub.roomCount()).toBe(2); // B still in R, R2 still has C
    hub.removeConnection('B');
    expect(hub.roomCount()).toBe(1); // R emptied and dropped, only R2 remains
  });

  describe('per-room serial queue', () => {
    class DeferredBackend implements HubBackend {
      calls: string[] = [];
      resolvers: (() => void)[] = [];

      private gate(label: string): Promise<void> {
        this.calls.push(label);
        return new Promise<void>((res) => this.resolvers.push(res));
      }

      async snapshot(room: string): Promise<CanvasElement[]> {
        await this.gate(`snapshot:${room}`);
        return [];
      }

      async apply(room: string, op: SyncOp): Promise<void> {
        await this.gate(`apply:${room}:${op.kind}`);
      }
    }

    const flush = () => new Promise<void>((r) => setTimeout(r, 0));

    it('serializes same-room messages and never blocks a different room', async () => {
      const backend = new DeferredBackend();
      const h = new SyncHub({ backend });
      h.addConnection(makeConn('A', 'R'));
      h.addConnection(makeConn('B', 'R'));
      h.addConnection(makeConn('C', 'R2'));

      // Fire two same-room messages and one cross-room message; do NOT await.
      void h.handleMessage('B', envelope('clientB', { kind: 'request-snapshot' }));
      void h.handleMessage('A', envelope('clientA', { kind: 'remove', id: 'x' }));
      void h.handleMessage('C', envelope('clientC', { kind: 'remove', id: 'y' }));
      await flush();

      // Room R's snapshot started; the second R message is queued behind it.
      // Room R2 was NOT blocked by room R.
      expect(backend.calls).toContain('snapshot:R');
      expect(backend.calls).toContain('apply:R2:remove');
      expect(backend.calls).not.toContain('apply:R:remove');

      // Resolve the first R op; only now does the queued R op run.
      backend.resolvers[0]?.();
      await flush();
      expect(backend.calls).toContain('apply:R:remove');
    });
  });

  describe('cross-instance fanout', () => {
    const upsert = (clientId: string, id: string): string =>
      JSON.stringify({
        from: clientId,
        op: { kind: 'upsert', element: { ...sampleEl(), id } },
      });

    it('forwards an origin instance data op to local conns of another instance', async () => {
      const bus = new InMemoryHubFanout();
      const hubA = new SyncHub({ instanceId: 'A', fanout: bus });
      const hubB = new SyncHub({ instanceId: 'B', fanout: bus });
      const a = makeConn('a', 'R');
      const b = makeConn('b', 'R');
      hubA.addConnection(a);
      hubB.addConnection(b);

      const msg = upsert('ca', 'e1');
      await hubA.handleMessage('a', msg);

      expect(JSON.parse(b.sent[0] ?? '')).toMatchObject({ from: 'a', op: { kind: 'upsert' } });
    });

    it('does not double-forward to the origin instance own conns', async () => {
      const bus = new InMemoryHubFanout();
      const hubA = new SyncHub({ instanceId: 'A', fanout: bus });
      new SyncHub({ instanceId: 'B', fanout: bus });
      const a = makeConn('a', 'R');
      const a2 = makeConn('a2', 'R');
      hubA.addConnection(a);
      hubA.addConnection(a2);

      const msg = upsert('ca', 'e1');
      await hubA.handleMessage('a', msg);

      expect(a2.sent).toHaveLength(1); // exactly once (local forward only)
      expect(JSON.parse(a2.sent[0] ?? '')).toMatchObject({ from: 'a', op: { kind: 'upsert' } });
      expect(a.sent).toEqual([]); // never echoed to sender
    });

    it('does not fan out a request-snapshot', async () => {
      const bus = new InMemoryHubFanout();
      const hubA = new SyncHub({ instanceId: 'A', fanout: bus });
      const hubB = new SyncHub({ instanceId: 'B', fanout: bus });
      const a = makeConn('a', 'R');
      const b = makeConn('b', 'R');
      hubA.addConnection(a);
      hubB.addConnection(b);

      await hubA.handleMessage('a', envelope('ca', { kind: 'request-snapshot' }));

      expect(b.sent).toEqual([]);
    });

    it('surfaces publication failure, withholds local delivery, and keeps the room queue usable', async () => {
      const error = new Error('fanout unavailable');
      let publishCount = 0;
      const fanout = {
        publish: vi.fn(() => {
          publishCount += 1;
          if (publishCount === 1) return Promise.reject(error);
          return Promise.resolve();
        }),
        subscribe: () => () => undefined,
      };
      const backend = new MemoryHubBackend();
      const origin = makeConn('a', 'R');
      const localPeer = makeConn('b', 'R');
      const h = new SyncHub({ backend, fanout, instanceId: 'A' });
      h.addConnection(origin);
      h.addConnection(localPeer);

      await expect(h.handleMessage('a', upsert('ca', 'e1'))).rejects.toBe(error);
      expect((await backend.snapshot('R')).map((element) => element.id)).toEqual(['e1']);
      expect(localPeer.sent).toEqual([]);

      await expect(h.handleMessage('a', upsert('ca', 'e2'))).resolves.toBeUndefined();
      expect(localPeer.sent).toHaveLength(1);
      expect(JSON.parse(localPeer.sent[0] ?? '').op.element.id).toBe('e2');
    });

    it('isolates rooms across instances', async () => {
      const bus = new InMemoryHubFanout();
      const hubA = new SyncHub({ instanceId: 'A', fanout: bus });
      const hubB = new SyncHub({ instanceId: 'B', fanout: bus });
      const a = makeConn('a', 'R');
      const b = makeConn('b', 'R2');
      hubA.addConnection(a);
      hubB.addConnection(b);

      await hubA.handleMessage('a', upsert('ca', 'e1'));

      expect(b.sent).toEqual([]);
    });

    it('does not leak a dm element to a player on another instance (headline)', async () => {
      const canRead = ({
        role,
        audience,
      }: {
        role?: string;
        audience: string | undefined;
      }): boolean => audience !== 'dm' || role === 'dm';
      const bus = new InMemoryHubFanout();
      const hubA = new SyncHub({ instanceId: 'A', fanout: bus, canRead });
      const hubB = new SyncHub({ instanceId: 'B', fanout: bus, canRead });
      const dm: FakeConn = { ...makeConn('dm', 'R'), role: 'dm' };
      const player: FakeConn = { ...makeConn('pl', 'R'), role: 'player' };
      hubA.addConnection(dm);
      hubB.addConnection(player);

      const secret = JSON.stringify({
        from: 'cdm',
        op: { kind: 'upsert', element: { ...sampleEl(), id: 'secret', audience: 'dm' } },
      });
      const open = JSON.stringify({
        from: 'cdm',
        op: { kind: 'upsert', element: { ...sampleEl(), id: 'open', audience: 'shared' } },
      });
      await hubA.handleMessage('dm', secret);
      await hubA.handleMessage('dm', open);

      expect(player.sent.map((m) => JSON.parse(m).op.element?.id)).toEqual(['open']);
    });

    it('delivers a cross-instance synthetic remove when an element goes shared → dm', async () => {
      const canRead = ({
        role,
        audience,
      }: {
        role?: string;
        audience: string | undefined;
      }): boolean => audience !== 'dm' || role === 'dm';
      const bus = new InMemoryHubFanout();
      const hubA = new SyncHub({ instanceId: 'A', fanout: bus, canRead });
      const hubB = new SyncHub({ instanceId: 'B', fanout: bus, canRead });
      const dm: FakeConn = { ...makeConn('dm', 'R'), role: 'dm' };
      const player: FakeConn = { ...makeConn('pl', 'R'), role: 'player' };
      hubA.addConnection(dm);
      hubB.addConnection(player);

      const shared = JSON.stringify({
        from: 'cdm',
        op: { kind: 'upsert', element: { ...sampleEl(), id: 'e1', audience: 'shared' } },
      });
      const hidden = JSON.stringify({
        from: 'cdm',
        op: { kind: 'upsert', element: { ...sampleEl(), id: 'e1', audience: 'dm' } },
      });
      await hubA.handleMessage('dm', shared);
      player.sent.length = 0;
      await hubA.handleMessage('dm', hidden);

      expect(player.sent.length).toBe(1);
      const env = JSON.parse(player.sent[0] as string) as {
        from: string;
        op: { kind: string; id: string };
      };
      expect(env.from).toBe('hub');
      expect(env.op).toEqual({ kind: 'remove', id: 'e1' });
    });

    it('close() unsubscribes the hub from the shared bus', async () => {
      const bus = new InMemoryHubFanout();
      const hubA = new SyncHub({ instanceId: 'A', fanout: bus });
      const hubB = new SyncHub({ instanceId: 'B', fanout: bus });
      const a = makeConn('a', 'R');
      const b = makeConn('b', 'R');
      hubA.addConnection(a);
      hubB.addConnection(b);

      hubA.close();
      await hubB.handleMessage('b', upsert('cb', 'e2'));

      expect(a.sent).toEqual([]); // hubA no longer receives fanout after close
    });
  });

  describe('write authorization', () => {
    const el = (id: string): CanvasElement => ({ ...sampleEl(), id });

    const roleConn = (id: string, room: string, userId: string, role: string): FakeConn => {
      const sent: string[] = [];
      return { id, room, userId, role, sent, send: (m) => sent.push(m) };
    };

    const policy: Authorize = ({ role, op, currentElement, userId }) => {
      if (role === 'dm') return true;
      if (role === 'display') return false;
      if (role === 'player') {
        if (op.kind === 'clear') return false;
        if (op.kind === 'upsert') return !currentElement || currentElement.ownerId === userId;
        if (op.kind === 'remove') return currentElement?.ownerId === userId;
        return false;
      }
      return false;
    };

    it('default (no authorize) forwards an upsert WITHOUT an ownerId', async () => {
      const h = new SyncHub();
      const p = roleConn('p', 'R', 'player1', 'player');
      const obs = roleConn('obs', 'R', 'dm1', 'dm');
      h.addConnection(p);
      h.addConnection(obs);
      await h.handleMessage('p', envelope('cp', { kind: 'upsert', element: el('e1') }));
      const fwd = JSON.parse(obs.sent[0] ?? '');
      expect(fwd.op.element.ownerId).toBeUndefined();
    });

    it('allows a player upsert of a NEW element and stamps ownerId = userId', async () => {
      const backend = new MemoryHubBackend();
      const hub = new SyncHub({ authorize: policy, backend });
      const p = roleConn('p', 'R', 'player1', 'player');
      const obs = roleConn('obs', 'R', 'dm1', 'dm');
      hub.addConnection(p);
      hub.addConnection(obs);

      await hub.handleMessage('p', envelope('cp', { kind: 'upsert', element: el('e1') }));

      const fwd = JSON.parse(obs.sent[0] ?? '');
      expect(fwd.op.element.ownerId).toBe('player1');
      const stored = (await backend.get('R', 'e1')) as OwnedElement | undefined;
      expect(stored?.ownerId).toBe('player1');
    });

    it('drops a player upsert of an EXISTING dm-owned element', async () => {
      const backend = new MemoryHubBackend();
      const hub = new SyncHub({ authorize: policy, backend });
      const dm = roleConn('dm', 'R', 'dm1', 'dm');
      const p = roleConn('p', 'R', 'player1', 'player');
      const obs = roleConn('obs', 'R', 'o', 'dm');
      hub.addConnection(dm);
      hub.addConnection(p);
      hub.addConnection(obs);

      await hub.handleMessage('dm', envelope('cdm', { kind: 'upsert', element: el('X') }));
      obs.sent.length = 0;

      await hub.handleMessage('p', envelope('cp', { kind: 'upsert', element: el('X') }));

      const stored = (await backend.get('R', 'X')) as OwnedElement | undefined;
      expect(stored?.ownerId).toBe('dm1');
      expect(obs.sent).toEqual([]);
    });

    it('drops a player remove of a dm-owned element', async () => {
      const backend = new MemoryHubBackend();
      const hub = new SyncHub({ authorize: policy, backend });
      const dm = roleConn('dm', 'R', 'dm1', 'dm');
      const p = roleConn('p', 'R', 'player1', 'player');
      const obs = roleConn('obs', 'R', 'o', 'dm');
      hub.addConnection(dm);
      hub.addConnection(p);
      hub.addConnection(obs);

      await hub.handleMessage('dm', envelope('cdm', { kind: 'upsert', element: el('X') }));
      obs.sent.length = 0;

      await hub.handleMessage('p', envelope('cp', { kind: 'remove', id: 'X' }));

      expect(await backend.get('R', 'X')).toBeDefined();
      expect(obs.sent).toEqual([]);
    });

    it('drops a player clear', async () => {
      const backend = new MemoryHubBackend();
      const hub = new SyncHub({ authorize: policy, backend });
      const dm = roleConn('dm', 'R', 'dm1', 'dm');
      const p = roleConn('p', 'R', 'player1', 'player');
      const obs = roleConn('obs', 'R', 'o', 'dm');
      hub.addConnection(dm);
      hub.addConnection(p);
      hub.addConnection(obs);

      await hub.handleMessage('dm', envelope('cdm', { kind: 'upsert', element: el('X') }));
      obs.sent.length = 0;

      await hub.handleMessage('p', envelope('cp', { kind: 'clear' }));

      expect(await backend.get('R', 'X')).toBeDefined();
      expect(obs.sent).toEqual([]);
    });

    it('drops a display data op', async () => {
      const backend = new MemoryHubBackend();
      const hub = new SyncHub({ authorize: policy, backend });
      const d = roleConn('d', 'R', 'disp1', 'display');
      const obs = roleConn('obs', 'R', 'o', 'dm');
      hub.addConnection(d);
      hub.addConnection(obs);

      await hub.handleMessage('d', envelope('cd', { kind: 'upsert', element: el('e1') }));

      expect(await backend.get('R', 'e1')).toBeUndefined();
      expect(obs.sent).toEqual([]);
    });

    it('allows dm upsert, remove and clear', async () => {
      const backend = new MemoryHubBackend();
      const hub = new SyncHub({ authorize: policy, backend });
      const dm = roleConn('dm', 'R', 'dm1', 'dm');
      const obs = roleConn('obs', 'R', 'o', 'dm');
      hub.addConnection(dm);
      hub.addConnection(obs);

      await hub.handleMessage('dm', envelope('cdm', { kind: 'upsert', element: el('X') }));
      const fwd = JSON.parse(obs.sent[0] ?? '');
      expect(fwd.op.element.ownerId).toBe('dm1');

      await hub.handleMessage('dm', envelope('cdm', { kind: 'remove', id: 'X' }));
      expect(await backend.get('R', 'X')).toBeUndefined();

      await hub.handleMessage('dm', envelope('cdm', { kind: 'upsert', element: el('Y') }));
      await hub.handleMessage('dm', envelope('cdm', { kind: 'clear' }));
      expect(await backend.snapshot('R')).toEqual([]);
    });

    it('is forge-proof: server stamps ownerId, ignoring a client-supplied ownerId', async () => {
      const backend = new MemoryHubBackend();
      const hub = new SyncHub({ authorize: policy, backend });
      const p = roleConn('p', 'R', 'player1', 'player');
      const obs = roleConn('obs', 'R', 'o', 'dm');
      hub.addConnection(p);
      hub.addConnection(obs);

      const forgedNew: OwnedElement = { ...sampleEl(), id: 'f', ownerId: 'dm' };
      await hub.handleMessage('p', envelope('cp', { kind: 'upsert', element: forgedNew }));
      const fwdNew = JSON.parse(obs.sent[0] ?? '');
      expect(fwdNew.op.element.ownerId).toBe('player1');
      expect(((await backend.get('R', 'f')) as OwnedElement | undefined)?.ownerId).toBe('player1');

      const forgedOwn: OwnedElement = { ...sampleEl(), id: 'f', ownerId: 'zzz' };
      await hub.handleMessage('p', envelope('cp', { kind: 'upsert', element: forgedOwn }));
      expect(((await backend.get('R', 'f')) as OwnedElement | undefined)?.ownerId).toBe('player1');
    });

    it('passes currentElement (undefined for new, stored for existing) to the policy', async () => {
      const seen: (OwnedElement | undefined)[] = [];
      const capture: Authorize = ({ currentElement }) => {
        seen.push(currentElement);
        return true;
      };
      const backend = new MemoryHubBackend();
      const hub = new SyncHub({ authorize: capture, backend });
      const p = roleConn('p', 'R', 'u', 'player');
      hub.addConnection(p);

      await hub.handleMessage('p', envelope('cp', { kind: 'upsert', element: el('e1') }));
      await hub.handleMessage('p', envelope('cp', { kind: 'upsert', element: el('e1') }));

      expect(seen[0]).toBeUndefined();
      expect(seen[1]?.id).toBe('e1');
      expect(seen[1]?.ownerId).toBe('u');
    });

    it('drops the op when an async policy rejects it', async () => {
      const backend = new MemoryHubBackend();
      const hub = new SyncHub({ authorize: async () => false, backend });
      const p = roleConn('p', 'R', 'u', 'player');
      const obs = roleConn('obs', 'R', 'o', 'dm');
      hub.addConnection(p);
      hub.addConnection(obs);

      await hub.handleMessage('p', envelope('cp', { kind: 'upsert', element: el('e1') }));

      expect(await backend.get('R', 'e1')).toBeUndefined();
      expect(obs.sent).toEqual([]);
    });

    describe('denied-op correction', () => {
      const lastCorrection = (conn: FakeConn): { from: string; op: SyncOp } | undefined => {
        const raw = conn.sent[conn.sent.length - 1];
        return raw !== undefined ? JSON.parse(raw) : undefined;
      };

      it('denied upsert of a NEW element → sends the sender a remove', async () => {
        const backend = new MemoryHubBackend();
        const hub = new SyncHub({ authorize: policy, backend });
        const d = roleConn('d', 'R', 'disp1', 'display');
        const peer = roleConn('peer', 'R', 'o', 'dm');
        hub.addConnection(d);
        hub.addConnection(peer);

        const E = el('E');
        await hub.handleMessage('d', envelope('cd', { kind: 'upsert', element: E }));

        expect(lastCorrection(d)).toEqual({ from: 'hub', op: { kind: 'remove', id: 'E' } });
        expect(peer.sent).toEqual([]);
        expect(await backend.get('R', 'E')).toBeUndefined();
      });

      it('denied upsert of an EXISTING element → sends the sender the canonical upsert', async () => {
        const backend = new MemoryHubBackend();
        const hub = new SyncHub({ authorize: policy, backend });
        const dm = roleConn('dm', 'R', 'dm1', 'dm');
        const p = roleConn('p', 'R', 'player1', 'player');
        const peer = roleConn('peer', 'R', 'o', 'dm');
        hub.addConnection(dm);
        hub.addConnection(p);
        hub.addConnection(peer);

        await hub.handleMessage('dm', envelope('cdm', { kind: 'upsert', element: el('X') }));
        const canonical = (await backend.get('R', 'X')) as OwnedElement;
        peer.sent.length = 0;

        const changed = { ...el('X'), position: { x: 999, y: 999 } };
        await hub.handleMessage('p', envelope('cp', { kind: 'upsert', element: changed }));

        expect(lastCorrection(p)).toEqual({
          from: 'hub',
          op: { kind: 'upsert', element: canonical },
        });
        expect(canonical.ownerId).toBe('dm1');
        expect(await backend.get('R', 'X')).toEqual(canonical);
        expect(peer.sent).toEqual([]);
      });

      it('denied remove of an EXISTING element → sends the sender the canonical upsert', async () => {
        const backend = new MemoryHubBackend();
        const hub = new SyncHub({ authorize: policy, backend });
        const dm = roleConn('dm', 'R', 'dm1', 'dm');
        const p = roleConn('p', 'R', 'player1', 'player');
        hub.addConnection(dm);
        hub.addConnection(p);

        await hub.handleMessage('dm', envelope('cdm', { kind: 'upsert', element: el('X') }));
        const canonical = (await backend.get('R', 'X')) as OwnedElement;

        await hub.handleMessage('p', envelope('cp', { kind: 'remove', id: 'X' }));

        expect(lastCorrection(p)).toEqual({
          from: 'hub',
          op: { kind: 'upsert', element: canonical },
        });
        expect(await backend.get('R', 'X')).toEqual(canonical);
      });

      it('denied remove of a NON-EXISTENT element → sends nothing', async () => {
        const backend = new MemoryHubBackend();
        const hub = new SyncHub({ authorize: policy, backend });
        const p = roleConn('p', 'R', 'player1', 'player');
        hub.addConnection(p);

        await hub.handleMessage('p', envelope('cp', { kind: 'remove', id: 'ghost' }));

        expect(p.sent).toEqual([]);
      });

      it('denied clear → sends the sender a canonical snapshot addressed to it', async () => {
        const backend = new MemoryHubBackend();
        const hub = new SyncHub({ authorize: policy, backend });
        const dm = roleConn('dm', 'R', 'dm1', 'dm');
        const p = roleConn('p', 'R', 'player1', 'player');
        hub.addConnection(dm);
        hub.addConnection(p);

        await hub.handleMessage('dm', envelope('cdm', { kind: 'upsert', element: el('X') }));
        await hub.handleMessage('dm', envelope('cdm', { kind: 'upsert', element: el('Y') }));
        const canonical = await backend.snapshot('R');

        await hub.handleMessage('p', envelope('cp-clr', { kind: 'clear' }));

        expect(lastCorrection(p)).toEqual({
          from: 'hub',
          op: { kind: 'snapshot', to: 'cp-clr', elements: canonical },
        });
        expect(await backend.snapshot('R')).toEqual(canonical);
      });

      it('an ALLOWED op sends the sender no hub correction', async () => {
        const backend = new MemoryHubBackend();
        const hub = new SyncHub({ authorize: policy, backend });
        const dm = roleConn('dm', 'R', 'dm1', 'dm');
        const peer = roleConn('peer', 'R', 'o', 'dm');
        hub.addConnection(dm);
        hub.addConnection(peer);

        await hub.handleMessage('dm', envelope('cdm', { kind: 'upsert', element: el('X') }));

        expect(dm.sent).toEqual([]);
      });

      it('a hub with NO authorize never sends a correction on a data op', async () => {
        const backend = new MemoryHubBackend();
        const hub = new SyncHub({ backend });
        const p = roleConn('p', 'R', 'player1', 'player');
        hub.addConnection(p);

        await hub.handleMessage('p', envelope('cp', { kind: 'remove', id: 'ghost' }));

        expect(p.sent).toEqual([]);
      });
    });
  });
});

describe('read filtering (canRead)', () => {
  const canRead = ({ role, audience }: { role?: string; audience: string | undefined }): boolean =>
    audience !== 'dm' || role === 'dm';

  const upsertMsg = (from: string, id: string, audience?: string): string =>
    JSON.stringify({
      from,
      op: { kind: 'upsert', element: { ...sampleEl(), id, ...(audience ? { audience } : {}) } },
    });

  function conn(id: string, room: string, role?: string): FakeConn {
    return { ...makeConn(id, room), role };
  }

  it('filters a dm element out of a player snapshot but keeps it for a dm', async () => {
    const hub = new SyncHub({ canRead });
    const dm = conn('dm', 'R', 'dm');
    const player = conn('pl', 'R', 'player');
    hub.addConnection(dm);
    hub.addConnection(player);
    await hub.handleMessage('dm', upsertMsg('cdm', 'shared1', 'shared'));
    await hub.handleMessage('dm', upsertMsg('cdm', 'secret1', 'dm'));
    dm.sent.length = 0;
    player.sent.length = 0;

    await hub.handleMessage('pl', envelope('cpl', { kind: 'request-snapshot' }));
    await hub.handleMessage('dm', envelope('cdm', { kind: 'request-snapshot' }));

    const playerSnap = JSON.parse(player.sent[0] as string) as {
      op: { elements: { id: string }[] };
    };
    const dmSnap = JSON.parse(dm.sent[0] as string) as { op: { elements: { id: string }[] } };
    expect(playerSnap.op.elements.map((e) => e.id)).toEqual(['shared1']);
    expect(dmSnap.op.elements.map((e) => e.id).sort()).toEqual(['secret1', 'shared1']);
  });

  it('filters hidden bytes from every denied-operation correction path', async () => {
    const backend = new MemoryHubBackend();
    const hub = new SyncHub({ authorize: () => false, canRead, backend });
    const player = conn('pl', 'R', 'player');
    hub.addConnection(player);

    const shared = { ...sampleEl(), id: 'shared', audience: 'shared', ownerId: 'dm1' };
    const secret = { ...sampleEl(), id: 'secret', audience: 'dm', ownerId: 'dm1' };
    await backend.apply('R', { kind: 'upsert', element: shared });
    await backend.apply('R', { kind: 'upsert', element: secret });

    await hub.handleMessage(
      'pl',
      envelope('player-upsert', {
        kind: 'upsert',
        element: { ...secret, position: { x: 999, y: 999 } },
      }),
    );
    await hub.handleMessage('pl', envelope('player-remove', { kind: 'remove', id: secret.id }));
    await hub.handleMessage('pl', envelope('player-clear', { kind: 'clear' }));

    expect(player.sent.map((message) => JSON.parse(message))).toEqual([
      { from: 'hub', op: { kind: 'remove', id: secret.id } },
      { from: 'hub', op: { kind: 'remove', id: secret.id } },
      {
        from: 'hub',
        op: { kind: 'snapshot', to: 'player-clear', elements: [shared] },
      },
    ]);
    expect(player.sent.join('')).not.toContain('"audience":"dm"');
    expect(await backend.snapshot('R')).toEqual([shared, secret]);
  });

  it('keeps canonical correction behavior for viewers allowed to read the element', async () => {
    const backend = new MemoryHubBackend();
    const hub = new SyncHub({ authorize: () => false, canRead, backend });
    const dm = conn('dm', 'R', 'dm');
    hub.addConnection(dm);
    const secret = { ...sampleEl(), id: 'secret', audience: 'dm', ownerId: 'dm1' };
    await backend.apply('R', { kind: 'upsert', element: secret });

    await hub.handleMessage('dm', envelope('dm-remove', { kind: 'remove', id: secret.id }));

    expect(JSON.parse(dm.sent[0] ?? '')).toEqual({
      from: 'hub',
      op: { kind: 'upsert', element: secret },
    });
  });

  it('broadcasts a shared upsert to a player', async () => {
    const hub = new SyncHub({ canRead });
    const dm = conn('dm', 'R', 'dm');
    const player = conn('pl', 'R', 'player');
    hub.addConnection(dm);
    hub.addConnection(player);
    await hub.handleMessage('dm', upsertMsg('cdm', 's1', 'shared'));
    expect(player.sent.length).toBe(1);
    expect(JSON.parse(player.sent[0] as string).op.element.id).toBe('s1');
  });

  it('never sends a newly-created dm element to a player — and no spurious remove (P2)', async () => {
    const hub = new SyncHub({ canRead });
    const dm = conn('dm', 'R', 'dm');
    const player = conn('pl', 'R', 'player');
    hub.addConnection(dm);
    hub.addConnection(player);
    await hub.handleMessage('dm', upsertMsg('cdm', 'secret1', 'dm'));
    expect(player.sent).toEqual([]);
  });

  it('sends a synthetic remove when an element goes shared → dm', async () => {
    const hub = new SyncHub({ canRead });
    const dm = conn('dm', 'R', 'dm');
    const player = conn('pl', 'R', 'player');
    hub.addConnection(dm);
    hub.addConnection(player);
    await hub.handleMessage('dm', upsertMsg('cdm', 'e1', 'shared'));
    player.sent.length = 0;
    await hub.handleMessage('dm', upsertMsg('cdm', 'e1', 'dm'));
    expect(player.sent.length).toBe(1);
    const env = JSON.parse(player.sent[0] as string) as {
      from: string;
      op: { kind: string; id: string };
    };
    expect(env.from).toBe('hub');
    expect(env.op).toEqual({ kind: 'remove', id: 'e1' });
  });

  it('sends a normal add when an element goes dm → shared', async () => {
    const hub = new SyncHub({ canRead });
    const dm = conn('dm', 'R', 'dm');
    const player = conn('pl', 'R', 'player');
    hub.addConnection(dm);
    hub.addConnection(player);
    await hub.handleMessage('dm', upsertMsg('cdm', 'e1', 'dm'));
    expect(player.sent).toEqual([]);
    await hub.handleMessage('dm', upsertMsg('cdm', 'e1', 'shared'));
    expect(player.sent.length).toBe(1);
    expect(JSON.parse(player.sent[0] as string).op.element.id).toBe('e1');
  });

  it('filters removes: dm-element remove is hidden, shared-element remove is sent, nonexistent sends nothing', async () => {
    const hub = new SyncHub({ canRead });
    const dm = conn('dm', 'R', 'dm');
    const player = conn('pl', 'R', 'player');
    hub.addConnection(dm);
    hub.addConnection(player);
    await hub.handleMessage('dm', upsertMsg('cdm', 'secret', 'dm'));
    await hub.handleMessage('dm', upsertMsg('cdm', 'open', 'shared'));
    player.sent.length = 0;
    await hub.handleMessage('dm', envelope('cdm', { kind: 'remove', id: 'secret' }));
    await hub.handleMessage('dm', envelope('cdm', { kind: 'remove', id: 'nope' }));
    expect(player.sent).toEqual([]);
    await hub.handleMessage('dm', envelope('cdm', { kind: 'remove', id: 'open' }));
    expect(player.sent.length).toBe(1);
    expect(JSON.parse(player.sent[0] as string).op).toEqual({ kind: 'remove', id: 'open' });
  });

  it('without canRead, every recipient receives the op incl. removes (default unchanged)', async () => {
    const hub = new SyncHub();
    const a = makeConn('a', 'R');
    const b = makeConn('b', 'R');
    hub.addConnection(a);
    hub.addConnection(b);
    await hub.handleMessage('a', upsertMsg('ca', 'e1', 'dm'));
    const env = JSON.parse(b.sent[0] as string) as {
      from: string;
      op: { kind: string; element: { id: string } };
    };
    expect(env.from).toBe('a');
    expect(env.op.element.id).toBe('e1');
    b.sent.length = 0;
    await hub.handleMessage('a', envelope('ca', { kind: 'remove', id: 'e1' }));
    expect(b.sent.length).toBe(1);
    expect(JSON.parse(b.sent[0] as string).op).toEqual({ kind: 'remove', id: 'e1' });
  });

  it('forwards clear to every recipient even with a read filter', async () => {
    const hub = new SyncHub({ canRead });
    const dm = conn('dm', 'R', 'dm');
    const player = conn('pl', 'R', 'player');
    hub.addConnection(dm);
    hub.addConnection(player);
    await hub.handleMessage('dm', upsertMsg('cdm', 's1', 'shared'));
    player.sent.length = 0;
    await hub.handleMessage('dm', envelope('cdm', { kind: 'clear' }));
    expect(player.sent.length).toBe(1);
    expect(JSON.parse(player.sent[0] as string).op).toEqual({ kind: 'clear' });
  });
});

describe('presence (ephemeral)', () => {
  const presenceMsg = (from: string, data: unknown): string =>
    JSON.stringify({ from, op: { kind: 'presence', data } });

  function conn(id: string, room: string, role?: string): FakeConn {
    return { ...makeConn(id, room), role };
  }

  it('broadcasts server-owned presence to every local room member and returns the local count', () => {
    const hub = new SyncHub();
    const a = makeConn('a', 'R');
    const b = makeConn('b', 'R');
    const otherRoom = makeConn('c', 'R2');
    hub.addConnection(a);
    hub.addConnection(b);
    hub.addConnection(otherRoom);

    const sent = hub.broadcastPresence('R', { kind: 'poke', feature: 'initiative' });

    expect(sent).toBe(2);
    expect(a.sent).toEqual(b.sent);
    expect(JSON.parse(a.sent[0] ?? '')).toEqual({
      from: 'hub',
      op: { kind: 'presence', data: { kind: 'poke', feature: 'initiative' } },
    });
    expect(otherRoom.sent).toEqual([]);
  });

  it('fans server-owned presence out to other hub instances without double local delivery', () => {
    const bus = new InMemoryHubFanout();
    const hubA = new SyncHub({ instanceId: 'A', fanout: bus });
    const hubB = new SyncHub({ instanceId: 'B', fanout: bus });
    const local = makeConn('local', 'R');
    const remote = makeConn('remote', 'R');
    hubA.addConnection(local);
    hubB.addConnection(remote);

    const sent = hubA.broadcastPresence('R', { kind: 'poke', feature: 'roster' });

    expect(sent).toBe(1);
    expect(local.sent).toHaveLength(1);
    expect(remote.sent).toEqual(local.sent);
    expect(JSON.parse(remote.sent[0] ?? '')).toEqual({
      from: 'hub',
      op: { kind: 'presence', data: { kind: 'poke', feature: 'roster' } },
    });
  });

  it('publishes to remote instances even when the origin has no local room members', () => {
    const bus = new InMemoryHubFanout();
    const hubA = new SyncHub({ instanceId: 'A', fanout: bus });
    const hubB = new SyncHub({ instanceId: 'B', fanout: bus });
    const remote = makeConn('remote', 'R');
    hubB.addConnection(remote);

    expect(hubA.broadcastPresence('R', { kind: 'poke' })).toBe(0);
    expect(remote.sent).toHaveLength(1);
  });

  it('isolates throwing and disconnected local recipients', () => {
    const hub = new SyncHub();
    const dead: FakeConn = {
      ...makeConn('dead', 'R'),
      send: () => {
        throw new Error('socket closed');
      },
    };
    const alive = makeConn('alive', 'R');
    const disconnected = makeConn('gone', 'R');
    hub.addConnection(dead);
    hub.addConnection(alive);
    hub.addConnection(disconnected);
    hub.removeConnection(disconnected.id);

    expect(hub.broadcastPresence('R', { kind: 'clear' })).toBe(1);
    expect(alive.sent).toHaveLength(1);
    expect(JSON.parse(alive.sent[0] ?? '').op).toEqual({
      kind: 'presence',
      data: { kind: 'clear' },
    });
    expect(disconnected.sent).toEqual([]);
  });

  it('rejects non-serializable data before local delivery or fan-out', () => {
    const publish = vi.fn();
    const hub = new SyncHub({
      fanout: { publish, subscribe: () => () => undefined },
    });
    const recipient = makeConn('recipient', 'R');
    hub.addConnection(recipient);
    const circular: { self?: unknown } = {};
    circular.self = circular;

    expect(() => hub.broadcastPresence('R', circular)).toThrow(TypeError);
    expect(recipient.sent).toEqual([]);
    expect(publish).not.toHaveBeenCalled();
  });

  it('broadcasts presence to every member except the sender', async () => {
    const hub = new SyncHub();
    const a = makeConn('a', 'R');
    const b = makeConn('b', 'R');
    hub.addConnection(a);
    hub.addConnection(b);
    await hub.handleMessage('a', presenceMsg('ca', { x: 1 }));
    expect(a.sent).toEqual([]);
    expect(b.sent).toHaveLength(1);
    expect(JSON.parse(b.sent[0] as string)).toEqual({
      from: 'a',
      op: { kind: 'presence', data: { x: 1 } },
    });
  });

  it('coalesces rapid presence updates and relays the latest state', async () => {
    vi.useFakeTimers();
    try {
      const hub = new SyncHub({ presenceThrottleMs: 50 });
      const a = makeConn('a', 'R');
      const b = makeConn('b', 'R');
      hub.addConnection(a);
      hub.addConnection(b);

      await hub.handleMessage('a', presenceMsg('ca', { x: 1 }));
      await hub.handleMessage('a', presenceMsg('ca', { x: 2 }));
      await hub.handleMessage('a', presenceMsg('ca', { x: 3 }));
      expect(b.sent).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(50);
      expect(b.sent).toHaveLength(2);
      expect(JSON.parse(b.sent[1] as string).op.data).toEqual({ x: 3 });
      hub.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('throttles per payload kind: a rapid awareness stream never swallows a ping or a cleared', async () => {
    vi.useFakeTimers();
    try {
      const hub = new SyncHub({ presenceThrottleMs: 50 });
      const a = makeConn('a', 'R');
      const b = makeConn('b', 'R');
      hub.addConnection(a);
      hub.addConnection(b);

      await hub.handleMessage(
        'a',
        presenceMsg('ca', { kind: 'awareness', id: 'u', cursor: { x: 1, y: 1 } }),
      );
      await hub.handleMessage(
        'a',
        presenceMsg('ca', { kind: 'awareness', id: 'u', cursor: { x: 2, y: 2 } }),
      );
      // A one-shot ping inside the awareness window must go out at once (its own lane).
      await hub.handleMessage('a', presenceMsg('ca', { kind: 'ping', x: 5, y: 5 }));
      // A path clear inside the window must not be replaced by the next cursor frame.
      await hub.handleMessage(
        'a',
        presenceMsg('ca', { kind: 'path', points: [{ x: 0, y: 0 }], segmentColors: [], feet: 0 }),
      );
      await hub.handleMessage('a', presenceMsg('ca', { kind: 'path', cleared: true }));
      await hub.handleMessage(
        'a',
        presenceMsg('ca', { kind: 'awareness', id: 'u', cursor: { x: 3, y: 3 } }),
      );

      const kinds = () =>
        b.sent.map((m) => (JSON.parse(m) as { op: { data: { kind: string } } }).op.data.kind);
      expect(kinds()).toEqual(['awareness', 'ping', 'path']);

      await vi.advanceTimersByTimeAsync(50);
      expect(kinds()).toEqual(['awareness', 'ping', 'path', 'awareness', 'path']);
      const last = JSON.parse(b.sent[4] as string) as { op: { data: unknown } };
      expect(last.op.data).toEqual({ kind: 'path', cleared: true });
      const cursor = JSON.parse(b.sent[3] as string) as { op: { data: { cursor: { x: number } } } };
      expect(cursor.op.data.cursor.x).toBe(3);
      hub.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a newer frame arriving at the throttle-window boundary supersedes the still-pending older frame', async () => {
    vi.useFakeTimers();
    try {
      const hub = new SyncHub({ presenceThrottleMs: 50 });
      const a = makeConn('a', 'R');
      const b = makeConn('b', 'R');
      hub.addConnection(a);
      hub.addConnection(b);

      // Frame A: relayed immediately (first frame in the lane).
      await hub.handleMessage(
        'a',
        presenceMsg('ca', { kind: 'awareness', id: 'u', cursor: { x: 1, y: 1 } }),
      );
      // Frame B, +10ms: within the window, so it becomes pending (timer due at +50).
      await vi.advanceTimersByTimeAsync(10);
      await hub.handleMessage(
        'a',
        presenceMsg('ca', { kind: 'awareness', id: 'u', cursor: { x: 2, y: 2 } }),
      );
      // The clock reaches the window boundary, but the pending timer has not run yet.
      vi.setSystemTime(Date.now() + 40);
      // Frame C (cleared) is processed before the stale timer fires: it takes the
      // immediate path and must drain B rather than letting B fire after it.
      await hub.handleMessage(
        'a',
        presenceMsg('ca', { kind: 'awareness', id: 'u', cleared: true }),
      );
      expect(b.sent.map((m) => (JSON.parse(m) as { op: { data: unknown } }).op.data)).toEqual([
        { kind: 'awareness', id: 'u', cursor: { x: 1, y: 1 } },
        { kind: 'awareness', id: 'u', cleared: true },
      ]);

      await vi.advanceTimersByTimeAsync(100);
      expect(b.sent).toHaveLength(2);
      const last = JSON.parse(b.sent[1] as string) as { op: { data: unknown } };
      expect(last.op.data).toEqual({ kind: 'awareness', id: 'u', cleared: true });
      expect(vi.getTimerCount()).toBe(0);
      hub.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('caps lanes per connection: beyond maxPresenceLanes - 1 named kinds everything shares the fallback lane', async () => {
    vi.useFakeTimers();
    try {
      const hub = new SyncHub({ presenceThrottleMs: 50, maxPresenceLanes: 4 });
      const a = makeConn('a', 'R');
      const b = makeConn('b', 'R');
      hub.addConnection(a);
      hub.addConnection(b);

      for (const kind of ['k1', 'k2', 'k3', 'k4']) {
        await hub.handleMessage('a', presenceMsg('ca', { kind, n: 1 }));
        await hub.handleMessage('a', presenceMsg('ca', { kind, n: 2 }));
      }
      // Non-object payloads always use the fallback lane, which k4 now shares.
      await hub.handleMessage('a', presenceMsg('ca', 'plain'));
      // 3 named lanes + 1 fallback lane each sent their leading frame; nothing else yet.
      expect(b.sent).toHaveLength(4);
      // Pending timers can never exceed the cap.
      expect(vi.getTimerCount()).toBeLessThanOrEqual(4);

      await vi.advanceTimersByTimeAsync(50);
      const payloads = b.sent.map((m) => (JSON.parse(m) as { op: { data: unknown } }).op.data);
      expect(payloads).toHaveLength(8);
      // The fallback lane's trailing frame is the plain string, which replaced k4's second frame.
      expect(payloads.slice(4)).toEqual([
        { kind: 'k1', n: 2 },
        { kind: 'k2', n: 2 },
        { kind: 'k3', n: 2 },
        'plain',
      ]);
      hub.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats an over-long kind as the fallback lane', async () => {
    vi.useFakeTimers();
    try {
      const hub = new SyncHub({ presenceThrottleMs: 50 });
      const a = makeConn('a', 'R');
      const b = makeConn('b', 'R');
      hub.addConnection(a);
      hub.addConnection(b);
      const longKind = 'k'.repeat(65);
      await hub.handleMessage('a', presenceMsg('ca', { kind: longKind, n: 1 }));
      await hub.handleMessage('a', presenceMsg('ca', 'plain'));
      // Same (fallback) lane: the string is queued behind the long-kind frame, not sent at once.
      expect(b.sent).toHaveLength(1);
      hub.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a 64-character kind gets its own lane; 65 characters falls back (boundary)', async () => {
    vi.useFakeTimers();
    try {
      const hub = new SyncHub({ presenceThrottleMs: 50 });
      const a = makeConn('a', 'R');
      const b = makeConn('b', 'R');
      hub.addConnection(a);
      hub.addConnection(b);
      const boundaryKind = 'k'.repeat(64);
      await hub.handleMessage('a', presenceMsg('ca', { kind: boundaryKind, n: 1 }));
      await hub.handleMessage('a', presenceMsg('ca', 'plain'));
      // Distinct lanes: both the named-kind frame and the fallback string relay at once.
      expect(b.sent).toHaveLength(2);
      hub.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('the default lane cap is 16: a 16th named kind and a plain string share the fallback lane', async () => {
    vi.useFakeTimers();
    try {
      const hub = new SyncHub({ presenceThrottleMs: 50 });
      const a = makeConn('a', 'R');
      const b = makeConn('b', 'R');
      hub.addConnection(a);
      hub.addConnection(b);

      const namedKinds = Array.from({ length: 15 }, (_, i) => `kind-${i}`);
      for (const kind of namedKinds) {
        await hub.handleMessage('a', presenceMsg('ca', { kind, n: 1 }));
        await hub.handleMessage('a', presenceMsg('ca', { kind, n: 2 }));
      }
      // The 16th named kind exceeds the 15 dedicated named lanes (cap 16 minus the
      // reserved fallback lane), so it shares the fallback lane with the plain string.
      await hub.handleMessage('a', presenceMsg('ca', { kind: 'kind-15', n: 1 }));
      await hub.handleMessage('a', presenceMsg('ca', { kind: 'kind-15', n: 2 }));
      await hub.handleMessage('a', presenceMsg('ca', 'plain'));

      // 15 named lanes + 1 fallback lane each sent their leading frame.
      expect(b.sent).toHaveLength(16);
      expect(vi.getTimerCount()).toBeLessThanOrEqual(16);

      await vi.advanceTimersByTimeAsync(50);
      const payloads = b.sent.map((m) => (JSON.parse(m) as { op: { data: unknown } }).op.data);
      expect(payloads).toHaveLength(32);
      // The fallback lane's trailing frame is the plain string, which replaced kind-15's
      // second frame.
      expect(payloads[payloads.length - 1]).toBe('plain');
      hub.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears every lane timer when the connection is removed mid-window', async () => {
    vi.useFakeTimers();
    try {
      const hub = new SyncHub({ presenceThrottleMs: 50 });
      const a = makeConn('a', 'R');
      const b = makeConn('b', 'R');
      hub.addConnection(a);
      hub.addConnection(b);
      for (const kind of ['awareness', 'laser', 'ping']) {
        await hub.handleMessage('a', presenceMsg('ca', { kind, n: 1 }));
        await hub.handleMessage('a', presenceMsg('ca', { kind, n: 2 }));
      }
      expect(b.sent).toHaveLength(3);
      hub.removeConnection('a');
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(100);
      // 3 leading frames + the leave; no trailing frames after removal.
      expect(b.sent).toHaveLength(4);
      expect(JSON.parse(b.sent[3] as string)).toEqual({
        from: 'a',
        op: { kind: 'presence-leave' },
      });
      hub.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects a non-positive maxPresenceLanes', () => {
    expect(() => new SyncHub({ maxPresenceLanes: 0 })).toThrow(RangeError);
    expect(() => new SyncHub({ maxPresenceLanes: Number.NaN })).toThrow(RangeError);
  });

  it('uses the connection identity when a client forges another sender', async () => {
    const hub = new SyncHub();
    const attacker = makeConn('attacker', 'R');
    const victim = makeConn('victim', 'R');
    hub.addConnection(attacker);
    hub.addConnection(victim);

    await hub.handleMessage('attacker', presenceMsg('victim', { x: 1 }));

    expect(JSON.parse(victim.sent[0] as string)).toEqual({
      from: 'attacker',
      op: { kind: 'presence', data: { x: 1 } },
    });
    victim.sent.length = 0;
    hub.removeConnection('attacker');
    expect(JSON.parse(victim.sent[0] as string)).toEqual({
      from: 'attacker',
      op: { kind: 'presence-leave' },
    });
  });

  it('never touches the backend (not persisted, off-queue)', async () => {
    let calls = 0;
    const inner = new MemoryHubBackend();
    const backend: HubBackend = {
      snapshot: (r) => {
        calls++;
        return inner.snapshot(r);
      },
      apply: (r, op) => {
        calls++;
        return inner.apply(r, op);
      },
      get: (r, id) => {
        calls++;
        return inner.get(r, id);
      },
    };
    const hub = new SyncHub({ backend });
    const a = makeConn('a', 'R');
    const b = makeConn('b', 'R');
    hub.addConnection(a);
    hub.addConnection(b);
    await hub.handleMessage('a', presenceMsg('ca', { x: 1 }));
    expect(calls).toBe(0);
    expect(b.sent).toHaveLength(1);
  });

  it('is not canRead-filtered — a player receives a dm-role peer presence and vice versa', async () => {
    const canRead = ({
      role,
      audience,
    }: {
      role?: string;
      audience: string | undefined;
    }): boolean => audience !== 'dm' || role === 'dm';
    const hub = new SyncHub({ canRead });
    const dm = conn('dm', 'R', 'dm');
    const player = conn('pl', 'R', 'player');
    hub.addConnection(dm);
    hub.addConnection(player);
    await hub.handleMessage('dm', presenceMsg('cdm', { x: 1 }));
    await hub.handleMessage('pl', presenceMsg('cpl', { x: 2 }));
    expect(player.sent).toHaveLength(1);
    expect(dm.sent).toHaveLength(1);
  });

  it('does NOT relay a client-sent presence-leave (anti-forgery)', async () => {
    const hub = new SyncHub();
    const a = makeConn('a', 'R');
    const b = makeConn('b', 'R');
    hub.addConnection(a);
    hub.addConnection(b);
    await hub.handleMessage('a', JSON.stringify({ from: 'ca', op: { kind: 'presence-leave' } }));
    expect(b.sent).toEqual([]);
  });

  it('emits presence-leave on disconnect for a conn that sent presence; none otherwise', () => {
    const hub = new SyncHub();
    const a = makeConn('a', 'R');
    const b = makeConn('b', 'R');
    const c = makeConn('c', 'R');
    hub.addConnection(a);
    hub.addConnection(b);
    hub.addConnection(c);
    void hub.handleMessage('a', presenceMsg('ca', { x: 1 }));
    b.sent.length = 0;
    hub.removeConnection('a');
    expect(b.sent).toHaveLength(1);
    expect(JSON.parse(b.sent[0] as string)).toEqual({ from: 'a', op: { kind: 'presence-leave' } });
    b.sent.length = 0;
    hub.removeConnection('c');
    expect(b.sent).toEqual([]);
  });

  it('relays presence and leave across instances via a shared fanout', async () => {
    const bus = new InMemoryHubFanout();
    const hubA = new SyncHub({ instanceId: 'A', fanout: bus });
    const hubB = new SyncHub({ instanceId: 'B', fanout: bus });
    const a = makeConn('a', 'R');
    const b = makeConn('b', 'R');
    hubA.addConnection(a);
    hubB.addConnection(b);
    await hubA.handleMessage('a', presenceMsg('ca', { x: 9 }));
    expect(b.sent).toHaveLength(1);
    expect(JSON.parse(b.sent[0] as string)).toEqual({
      from: 'a',
      op: { kind: 'presence', data: { x: 9 } },
    });
    b.sent.length = 0;
    hubA.removeConnection('a');
    expect(b.sent).toHaveLength(1);
    expect(JSON.parse(b.sent[0] as string)).toEqual({ from: 'a', op: { kind: 'presence-leave' } });
  });
});

describe('layer-definition sync', () => {
  function layerDef(overrides: Partial<Layer> = {}): Layer {
    return {
      id: 'layer-x',
      name: 'Layer X',
      visible: true,
      locked: false,
      order: 100,
      opacity: 1,
      ...overrides,
    };
  }

  function layerUpsert(version: number, editor: string, overrides: Partial<Layer> = {}): SyncOp {
    return { kind: 'layer-upsert', layer: layerDef(overrides), version, editor };
  }

  function parsed(conn: FakeConn): { from: string; op: SyncOp }[] {
    return conn.sent.map((m) => JSON.parse(m) as { from: string; op: SyncOp });
  }

  it('stores a layer upsert and relays it to other room members only', async () => {
    const hub = new SyncHub();
    const a = makeConn('A', 'R');
    const b = makeConn('B', 'R');
    const c = makeConn('C', 'R2');
    hub.addConnection(a);
    hub.addConnection(b);
    hub.addConnection(c);

    await hub.handleMessage('A', envelope('clientA', layerUpsert(1, 'clientA')));

    expect(parsed(b)).toEqual([{ from: 'A', op: layerUpsert(1, 'clientA') }]);
    expect(a.sent).toEqual([]);
    expect(c.sent).toEqual([]);

    // A later joiner's snapshot carries the stored record.
    const late = makeConn('L', 'R');
    hub.addConnection(late);
    await hub.handleMessage('L', envelope('clientL', { kind: 'request-snapshot' }));
    const reply = parsed(late)[0];
    expect(reply?.op).toEqual({
      kind: 'snapshot',
      to: 'clientL',
      elements: [],
      layers: [{ id: 'layer-x', version: 1, editor: 'clientA', definition: layerDef() }],
    });
    hub.close();
  });

  it('omits the snapshot layers field for rooms that never used layer sync', async () => {
    const hub = new SyncHub();
    const a = makeConn('A', 'R');
    hub.addConnection(a);
    await hub.handleMessage('A', envelope('clientA', { kind: 'request-snapshot' }));
    const reply = JSON.parse(a.sent[0] ?? '') as { op: Record<string, unknown> };
    expect('layers' in reply.op).toBe(false);
    hub.close();
  });

  it('stores removal tombstones and serves them to late joiners', async () => {
    const hub = new SyncHub();
    const a = makeConn('A', 'R');
    hub.addConnection(a);
    await hub.handleMessage('A', envelope('clientA', layerUpsert(1, 'clientA')));
    await hub.handleMessage(
      'A',
      envelope('clientA', { kind: 'layer-remove', id: 'layer-x', version: 2, editor: 'clientA' }),
    );

    const late = makeConn('L', 'R');
    hub.addConnection(late);
    await hub.handleMessage('L', envelope('clientL', { kind: 'request-snapshot' }));
    const reply = parsed(late)[0];
    expect(reply?.op).toEqual({
      kind: 'snapshot',
      to: 'clientL',
      elements: [],
      layers: [{ id: 'layer-x', version: 2, editor: 'clientA' }],
    });
    hub.close();
  });

  it('answers a stale edit with an authoritative correction to the sender only, without broadcast', async () => {
    const hub = new SyncHub();
    const a = makeConn('A', 'R');
    const b = makeConn('B', 'R');
    hub.addConnection(a);
    hub.addConnection(b);

    await hub.handleMessage(
      'A',
      envelope('clientA', layerUpsert(3, 'clientA', { name: 'current' })),
    );
    b.sent.length = 0;

    await hub.handleMessage('B', envelope('clientB', layerUpsert(2, 'clientB', { name: 'stale' })));

    expect(a.sent).toEqual([]); // no broadcast of the stale edit
    expect(parsed(b)).toEqual([
      { from: 'hub', op: layerUpsert(3, 'clientA', { name: 'current' }) },
    ]);
    hub.close();
  });

  it('resolves an equal-version tie by editor regardless of arrival order', async () => {
    const hub = new SyncHub();
    const a = makeConn('A', 'R');
    const b = makeConn('B', 'R');
    hub.addConnection(a);
    hub.addConnection(b);

    // Higher editor arrives first; the lower one is stale despite arriving second.
    await hub.handleMessage(
      'B',
      envelope('clientB', layerUpsert(2, 'clientB', { name: 'from B' })),
    );
    await hub.handleMessage(
      'A',
      envelope('clientA', layerUpsert(2, 'clientA', { name: 'from A' })),
    );

    const late = makeConn('L', 'R');
    hub.addConnection(late);
    await hub.handleMessage('L', envelope('clientL', { kind: 'request-snapshot' }));
    const reply = parsed(late)[0]?.op;
    if (reply?.kind !== 'snapshot') throw new Error('expected a snapshot reply');
    expect(reply.layers?.[0]?.definition?.name).toBe('from B');
    hub.close();
  });

  it('authorizeLayer denies an edit with a correction and no broadcast or storage', async () => {
    const denials: string[] = [];
    const hub = new SyncHub({
      authorizeLayer: ({ role, op }) => {
        if (role === 'dm') return true;
        denials.push(op.kind);
        return false;
      },
    });
    const dm: FakeConn = { ...makeConn('dm', 'R'), role: 'dm' };
    const player: FakeConn = { ...makeConn('pl', 'R'), role: 'player' };
    hub.addConnection(dm);
    hub.addConnection(player);

    await hub.handleMessage('dm', envelope('dmUser', layerUpsert(1, 'dmUser', { name: 'real' })));
    player.sent.length = 0;

    await hub.handleMessage('pl', envelope('plUser', layerUpsert(2, 'plUser', { name: 'hijack' })));
    expect(denials).toEqual(['layer-upsert']);
    expect(dm.sent).toEqual([]); // denied edit never broadcast
    // The sender is corrected back to the room's record.
    expect(parsed(player)).toEqual([
      { from: 'hub', op: layerUpsert(1, 'dmUser', { name: 'real' }) },
    ]);

    // Denied edit of an unknown layer corrects with a hub tombstone.
    await hub.handleMessage(
      'pl',
      envelope('plUser', {
        kind: 'layer-upsert',
        layer: layerDef({ id: 'layer-new', name: 'sneaky' }),
        version: 1,
        editor: 'plUser',
      }),
    );
    const second = parsed(player)[1];
    expect(second).toEqual({
      from: 'hub',
      op: { kind: 'layer-remove', id: 'layer-new', version: 1, editor: 'hub' },
    });
    hub.close();
  });

  it('uses backend layer persistence when provided', async () => {
    const backend = new MemoryHubBackend();
    const hub = new SyncHub({ backend });
    const a = makeConn('A', 'R');
    hub.addConnection(a);

    await hub.handleMessage('A', envelope('clientA', layerUpsert(1, 'clientA')));
    expect(await backend.layerRecords('R')).toEqual([
      { id: 'layer-x', version: 1, editor: 'clientA', definition: layerDef() },
    ]);
    hub.close();
  });

  it('falls back to hub memory for backends without layer persistence', async () => {
    const minimal: HubBackend = {
      snapshot: async () => [],
      get: async () => undefined,
      apply: async () => undefined,
    };
    const hub = new SyncHub({ backend: minimal });
    const a = makeConn('A', 'R');
    hub.addConnection(a);

    await hub.handleMessage('A', envelope('clientA', layerUpsert(1, 'clientA')));
    const late = makeConn('L', 'R');
    hub.addConnection(late);
    await hub.handleMessage('L', envelope('clientL', { kind: 'request-snapshot' }));
    const reply = JSON.parse(late.sent[0] ?? '') as { op: { layers?: unknown[] } };
    expect(reply.op.layers).toEqual([
      { id: 'layer-x', version: 1, editor: 'clientA', definition: layerDef() },
    ]);
    hub.close();
  });

  it('an element clear does not touch stored layer records', async () => {
    const backend = new MemoryHubBackend();
    const hub = new SyncHub({ backend });
    const a = makeConn('A', 'R');
    hub.addConnection(a);
    await hub.handleMessage('A', envelope('clientA', { kind: 'upsert', element: sampleEl() }));
    await hub.handleMessage('A', envelope('clientA', layerUpsert(1, 'clientA')));

    await hub.handleMessage('A', envelope('clientA', { kind: 'clear' }));
    expect(await backend.snapshot('R')).toEqual([]);
    expect(await backend.layerRecords('R')).toHaveLength(1);
    hub.close();
  });

  it('fans layer ops out across hub instances and converges their ledgers', async () => {
    const fanout = new InMemoryHubFanout();
    const hub1 = new SyncHub({ fanout, instanceId: 'i1' });
    const hub2 = new SyncHub({ fanout, instanceId: 'i2' });
    const a = makeConn('A', 'R');
    const b = makeConn('B', 'R');
    hub1.addConnection(a);
    hub2.addConnection(b);

    await hub1.handleMessage('A', envelope('clientA', layerUpsert(1, 'clientA')));
    expect(parsed(b)).toEqual([{ from: 'A', op: layerUpsert(1, 'clientA') }]);

    // applyFanoutLayerOp persists asynchronously off the queue; let it settle.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // A late joiner on the OTHER instance still receives the record.
    const late = makeConn('L', 'R');
    hub2.addConnection(late);
    await hub2.handleMessage('L', envelope('clientL', { kind: 'request-snapshot' }));
    const reply = JSON.parse(late.sent[0] ?? '') as { op: { layers?: unknown[] } };
    expect(reply.op.layers).toEqual([
      { id: 'layer-x', version: 1, editor: 'clientA', definition: layerDef() },
    ]);
    hub1.close();
    hub2.close();
  });

  it('never carries element bytes on the layer path, even with canRead configured', async () => {
    const hub = new SyncHub({
      canRead: ({ role, audience }) => audience === undefined || role === 'dm',
    });
    const dm: FakeConn = { ...makeConn('dm', 'R'), role: 'dm' };
    const player: FakeConn = { ...makeConn('pl', 'R'), role: 'player' };
    hub.addConnection(dm);
    hub.addConnection(player);

    const secret = { ...sampleEl(), audience: 'dm' } as CanvasElement;
    await hub.handleMessage('dm', envelope('dmUser', { kind: 'upsert', element: secret }));
    await hub.handleMessage(
      'dm',
      envelope('dmUser', layerUpsert(1, 'dmUser', { name: 'Fog prep' })),
    );
    await hub.handleMessage('pl', envelope('plUser', { kind: 'request-snapshot' }));

    // The player received the layer op and a snapshot, none of which contain the secret element.
    expect(player.sent.length).toBeGreaterThan(0);
    for (const frame of player.sent) {
      expect(frame).not.toContain(secret.id);
    }
    const snapshotFrame = player.sent
      .map(
        (m) => JSON.parse(m) as { op: { kind: string; layers?: unknown[]; elements?: unknown[] } },
      )
      .find((e) => e.op.kind === 'snapshot');
    expect(snapshotFrame?.op.elements).toEqual([]);
    expect(snapshotFrame?.op.layers).toHaveLength(1);
    hub.close();
  });

  it('rejects malformed layer ops at the envelope gate', async () => {
    const hub = new SyncHub();
    const a = makeConn('A', 'R');
    const b = makeConn('B', 'R');
    hub.addConnection(a);
    hub.addConnection(b);

    await hub.handleMessage(
      'A',
      JSON.stringify({
        from: 'clientA',
        op: { kind: 'layer-upsert', layer: { id: 'x' }, version: 1, editor: 'clientA' },
      }),
    );
    await hub.handleMessage(
      'A',
      JSON.stringify({
        from: 'clientA',
        op: { kind: 'layer-remove', id: 'layer-x', version: 0, editor: 'clientA' },
      }),
    );
    expect(b.sent).toEqual([]);
    hub.close();
  });
});
