import { describe, it, expect, beforeEach } from 'vitest';
import { createShape } from '@fieldnotes/core';
import type { CanvasElement } from '@fieldnotes/core';
import type { SyncOp } from '@fieldnotes/sync';
import { SyncHub } from './sync-hub';
import type { Connection } from './sync-hub';
import type { HubBackend } from './hub-backend';

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
});
