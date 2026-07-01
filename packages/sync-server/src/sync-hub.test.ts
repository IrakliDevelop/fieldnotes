import { describe, it, expect, beforeEach } from 'vitest';
import { createShape } from '@fieldnotes/core';
import type { CanvasElement } from '@fieldnotes/core';
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
  createShape({ position: { x: 1, y: 2 }, size: { width: 10, height: 20 } });

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

    expect(B.sent).toEqual([msg]); // forwarded raw to same-room peer
    expect(A.sent).toEqual([]); // not echoed to sender
    expect(C.sent).toEqual([]); // cross-room isolated
  });

  it('applies forwarded ops to the backend (snapshot reflects it)', async () => {
    const el = sampleEl();
    const upsertMsg = envelope('clientA', { kind: 'upsert', element: el });
    await hub.handleMessage('A', upsertMsg);
    await hub.handleMessage('B', envelope('clientB', { kind: 'request-snapshot' }));

    // B received the forwarded upsert, then its own snapshot reply.
    expect(B.sent[0]).toBe(upsertMsg);
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
    expect(B.sent).toEqual([removeMsg]);

    const clearMsg = envelope('clientA', { kind: 'clear' });
    await hub.handleMessage('A', clearMsg);
    expect(B.sent).toEqual([removeMsg, clearMsg]);
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

      expect(b.sent).toContain(msg);
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

      expect(a2.sent).toEqual([msg]); // exactly once (local forward only)
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
  });
});
