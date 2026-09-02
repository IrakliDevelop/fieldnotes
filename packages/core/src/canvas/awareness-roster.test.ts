import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PeerRoster } from './awareness-roster';
import type { Peer, PeerLeaveReason } from './awareness-roster';

const frame = (id: string, extra: Record<string, unknown> = {}) => ({
  kind: 'awareness',
  id,
  ...extra,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('PeerRoster rows', () => {
  it('creates a row from a valid frame and rejects invalid payloads', () => {
    const roster = new PeerRoster();
    expect(roster.apply('c1', { kind: 'ping', x: 1, y: 2 })).toBe(false);
    expect(roster.getPeers()).toEqual([]);
    expect(
      roster.apply(
        'c1',
        frame('ada', { name: 'Ada', cursor: { x: 1, y: 2 }, selection: ['e1'], tool: 'select' }),
      ),
    ).toBe(true);
    expect(roster.getPeers()).toEqual([
      {
        from: 'c1',
        id: 'ada',
        name: 'Ada',
        cursor: { x: 1, y: 2 },
        selection: ['e1'],
        tool: 'select',
      },
    ]);
    expect(roster.getPeer('c1')?.name).toBe('Ada');
  });

  it('replaces the row on every frame (full-snapshot semantics): absent fields become none', () => {
    const roster = new PeerRoster();
    roster.apply('c1', frame('ada', { cursor: { x: 1, y: 2 }, tool: 'select', selection: ['e1'] }));
    roster.apply('c1', frame('ada', { tool: 'pencil' }));
    expect(roster.getPeer('c1')).toEqual({
      from: 'c1',
      id: 'ada',
      cursor: null,
      selection: [],
      tool: 'pencil',
    });
  });

  it('keeps the same getPeers() reference and stays silent when a frame equals the stored row', () => {
    const roster = new PeerRoster();
    const change = vi.fn();
    roster.onChange(change);
    roster.apply(
      'c1',
      frame('ada', {
        name: 'Ada',
        cursor: { x: 1, y: 2 },
        selection: ['e1', 'e2'],
        tool: 'select',
      }),
    );
    const first = roster.getPeers();
    expect(change).toHaveBeenCalledTimes(1);
    roster.apply(
      'c1',
      frame('ada', {
        name: 'Ada',
        cursor: { x: 1, y: 2 },
        selection: ['e1', 'e2'],
        tool: 'select',
      }),
    );
    expect(roster.getPeers()).toBe(first);
    expect(change).toHaveBeenCalledTimes(1);
    // A cursor-only change produces a new snapshot but preserves the selection reference.
    roster.apply(
      'c1',
      frame('ada', {
        name: 'Ada',
        cursor: { x: 3, y: 4 },
        selection: ['e1', 'e2'],
        tool: 'select',
      }),
    );
    const second = roster.getPeers();
    expect(second).not.toBe(first);
    expect(second[0]?.selection).toBe(first[0]?.selection);
    expect(change).toHaveBeenCalledTimes(2);
  });

  it('removes on cleared, remove(), and stale with the matching reason', () => {
    const roster = new PeerRoster({ staleMs: 1000 });
    const leaves: [string, PeerLeaveReason][] = [];
    roster.onLeave((peer: Peer, reason) => leaves.push([peer.from, reason]));
    roster.apply('a', frame('ada'));
    roster.apply('b', frame('bob'));
    roster.apply('c', frame('cy'));
    roster.apply('a', frame('ada', { cleared: true }));
    roster.remove('b');
    vi.advanceTimersByTime(1000);
    expect(leaves).toEqual([
      ['a', 'cleared'],
      ['b', 'left'],
      ['c', 'stale'],
    ]);
    expect(roster.getPeers()).toEqual([]);
  });

  it('remove() of an unknown sender is a no-op and emits nothing', () => {
    const roster = new PeerRoster();
    const leave = vi.fn();
    const change = vi.fn();
    roster.onLeave(leave);
    roster.onChange(change);
    roster.remove('ghost');
    expect(leave).not.toHaveBeenCalled();
    expect(change).not.toHaveBeenCalled();
  });
});

describe('PeerRoster discovery budget', () => {
  it('fires onDiscover once per sender, on the first valid frame, after the row exists', () => {
    const roster = new PeerRoster();
    const seen: string[] = [];
    roster.onDiscover((from) => seen.push(`${from}:${roster.getPeer(from)?.id ?? 'none'}`));
    roster.apply('c1', frame('ada'));
    roster.apply('c1', frame('ada', { cursor: { x: 1, y: 1 } }));
    roster.apply('c1', frame('ada', { cursor: { x: 2, y: 2 } }));
    expect(seen).toEqual(['c1:ada']);
    // An invalid frame never discovers.
    roster.apply('c2', { kind: 'awareness' });
    expect(seen).toEqual(['c1:ada']);
  });

  it('is NOT reset by a client-authored cleared frame: full → cleared → full ×10 discovers once', () => {
    const roster = new PeerRoster({ staleMs: 45_000 });
    const discover = vi.fn();
    const leave = vi.fn();
    roster.onDiscover(discover);
    roster.onLeave(leave);
    for (let i = 0; i < 10; i++) {
      roster.apply('hostile', frame('h', { cursor: { x: i, y: i } }));
      roster.apply('hostile', frame('h', { cleared: true }));
    }
    roster.apply('hostile', frame('h'));
    expect(discover).toHaveBeenCalledTimes(1);
    expect(leave).toHaveBeenCalledTimes(10);
    expect(roster.getPeer('hostile')?.id).toBe('h');
  });

  it('is reset by a server-authored remove(): a frame after presence-leave discovers again', () => {
    const roster = new PeerRoster();
    const discover = vi.fn();
    roster.onDiscover(discover);
    roster.apply('c1', frame('ada'));
    roster.remove('c1');
    roster.apply('c1', frame('ada'));
    expect(discover).toHaveBeenCalledTimes(2);
  });

  it('is reset by staleMs of total silence, even when only a cleared frame was ever seen', () => {
    const roster = new PeerRoster({ staleMs: 1000 });
    const discover = vi.fn();
    roster.onDiscover(discover);
    roster.apply('c1', frame('ada', { cleared: true }));
    expect(discover).toHaveBeenCalledTimes(1);
    expect(roster.getPeers()).toEqual([]);
    vi.advanceTimersByTime(999);
    roster.apply('c1', frame('ada', { cleared: true }));
    expect(discover).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    roster.apply('c1', frame('ada'));
    expect(discover).toHaveBeenCalledTimes(2);
  });

  it('cleared frames keep the budget alive: silence is measured from the last valid frame of any kind', () => {
    const roster = new PeerRoster({ staleMs: 1000 });
    const discover = vi.fn();
    roster.onDiscover(discover);
    roster.apply('c1', frame('ada'));
    vi.advanceTimersByTime(900);
    roster.apply('c1', frame('ada', { cleared: true }));
    vi.advanceTimersByTime(900);
    roster.apply('c1', frame('ada'));
    expect(discover).toHaveBeenCalledTimes(1);
  });
});

describe('PeerRoster stale timer', () => {
  it('re-arms on activity and never fires early', () => {
    const roster = new PeerRoster({ staleMs: 1000 });
    const leave = vi.fn();
    roster.onLeave(leave);
    roster.apply('c1', frame('ada'));
    vi.advanceTimersByTime(800);
    roster.apply('c1', frame('ada', { cursor: { x: 1, y: 1 } }));
    vi.advanceTimersByTime(800);
    expect(leave).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(leave).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('expires each sender on its own deadline with one timer at a time', () => {
    const roster = new PeerRoster({ staleMs: 1000 });
    const leaves: string[] = [];
    roster.onLeave((peer) => leaves.push(peer.from));
    roster.apply('a', frame('a'));
    vi.advanceTimersByTime(500);
    roster.apply('b', frame('b'));
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(500);
    expect(leaves).toEqual(['a']);
    vi.advanceTimersByTime(500);
    expect(leaves).toEqual(['a', 'b']);
  });

  it('staleMs: 0 disables expiry', () => {
    const roster = new PeerRoster({ staleMs: 0 });
    roster.apply('a', frame('a'));
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10 * 60_000);
    expect(roster.getPeers()).toHaveLength(1);
  });
});

describe('PeerRoster dispose', () => {
  it('drops rows, timers, and listeners; apply/remove after dispose are inert', () => {
    const roster = new PeerRoster({ staleMs: 1000 });
    const change = vi.fn();
    roster.onChange(change);
    roster.apply('a', frame('a'));
    roster.dispose();
    expect(roster.disposed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(roster.getPeers()).toEqual([]);
    expect(roster.apply('b', frame('b'))).toBe(false);
    roster.remove('a');
    expect(change).toHaveBeenCalledTimes(1);
    roster.dispose();
  });

  it('a throwing listener does not break the roster or starve other listeners', () => {
    const roster = new PeerRoster();
    const after = vi.fn();
    roster.onChange(() => {
      throw new Error('boom');
    });
    roster.onChange(after);
    expect(roster.apply('a', frame('a'))).toBe(true);
    expect(after).toHaveBeenCalledTimes(1);
  });
});
