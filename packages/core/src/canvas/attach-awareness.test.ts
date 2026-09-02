// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { attachAwareness } from './attach-awareness';
import type { PresenceChannel, AwarenessViewport } from './attach-awareness';
import type { Viewport } from './viewport';
import { ElementStore } from '../elements/element-store';
import { LayerManager } from '../layers/layer-manager';

// Compile-time pin: `Viewport` must keep satisfying `AwarenessViewport`
// structurally, with no cast required at the call site.
const viewportSatisfies: Viewport extends AwarenessViewport ? true : never = true;
void viewportSatisfies;

/** Two viewports share one in-memory "relay": each send fans out to the other with a stable sender key. */
function makeBus() {
  const ends: {
    key: string;
    presence: Set<(from: string, data: unknown) => void>;
    leave: Set<(from: string) => void>;
  }[] = [];
  const sentBy = new Map<string, unknown[]>();
  function channelFor(key: string): PresenceChannel {
    const end = {
      key,
      presence: new Set<(from: string, data: unknown) => void>(),
      leave: new Set<(from: string) => void>(),
    };
    ends.push(end);
    sentBy.set(key, []);
    return {
      sendPresence: (data) => {
        sentBy.get(key)?.push(data);
        for (const other of ends) if (other !== end) other.presence.forEach((h) => h(key, data));
      },
      onPresence: (h) => {
        end.presence.add(h);
        return () => end.presence.delete(h);
      },
      onPresenceLeave: (h) => {
        end.leave.add(h);
        return () => end.leave.delete(h);
      },
    };
  }
  function leave(key: string): void {
    for (const other of ends) if (other.key !== key) other.leave.forEach((h) => h(key));
  }
  return { channelFor, leave, sentBy };
}

function makeViewport(overrides: Partial<AwarenessViewport> = {}): AwarenessViewport {
  const wrapper = document.createElement('div');
  const domLayer = document.createElement('div');
  wrapper.appendChild(domLayer);
  document.body.appendChild(wrapper);
  const store = new ElementStore();
  const layerManager = new LayerManager(store);
  return {
    camera: { zoom: 1, screenToWorld: (p) => p },
    domLayer,
    store,
    layerManager,
    onSelectionChange: () => vi.fn(),
    getSelectedIds: () => [],
    toolManager: { onChange: () => vi.fn(), activeTool: { name: 'select' } },
    registerOverlay: () => vi.fn(),
    requestRender: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('attachAwareness', () => {
  it('B re-announces exactly once when A is discovered; repeated frames, cleared cycles never re-trigger; leave + new key does', () => {
    const bus = makeBus();
    const a = attachAwareness(makeViewport(), bus.channelFor('A'), {
      identity: { id: 'ada' },
      intervalMs: 0,
      heartbeatMs: 0,
    });
    const b = attachAwareness(makeViewport(), bus.channelFor('B'), {
      identity: { id: 'bob' },
      intervalMs: 0,
      heartbeatMs: 0,
    });
    // A goes live → A's frame reaches B → B discovers A → B announces → A discovers B → A announces (once).
    a.announce();
    expect(bus.sentBy.get('B')).toHaveLength(1);
    expect(bus.sentBy.get('A')).toHaveLength(2);
    expect(a.roster.getPeer('B')?.id).toBe('bob');
    expect(b.roster.getPeer('A')?.id).toBe('ada');
    // More frames from A: no further re-announce from B.
    a.announce();
    a.announce();
    expect(bus.sentBy.get('B')).toHaveLength(1);
    // Client-authored cleared cycles from A: B's row flips but B never re-announces.
    a.local?.dispose(); // sends { cleared } under key A: B drops the row but its budget for A stays spent
    expect(b.roster.getPeer('A')).toBeUndefined();
    expect(bus.sentBy.get('B')).toHaveLength(1);
    // Server-authored leave for A, then a fresh socket A3 → B re-announces once more.
    bus.leave('A');
    const a3 = attachAwareness(makeViewport(), bus.channelFor('A3'), {
      identity: { id: 'ada' },
      intervalMs: 0,
      heartbeatMs: 0,
    });
    a3.announce();
    expect(bus.sentBy.get('B')).toHaveLength(2);
    a.dispose();
    a3.dispose();
    b.dispose();
  });

  it('cleared frames cycling under one key never re-announce (roster budget survives cleared)', () => {
    const bus = makeBus();
    const b = attachAwareness(makeViewport(), bus.channelFor('B'), {
      identity: { id: 'bob' },
      intervalMs: 0,
      heartbeatMs: 0,
    });
    const hostile = bus.channelFor('H');
    for (let i = 0; i < 10; i++) {
      hostile.sendPresence({ kind: 'awareness', id: 'h', cursor: { x: i, y: i } });
      hostile.sendPresence({ kind: 'awareness', id: 'h', cleared: true });
    }
    expect(bus.sentBy.get('B')).toHaveLength(1);
    b.dispose();
  });

  it('publish: false never sends but still receives; announce/setFields are no-ops', () => {
    const bus = makeBus();
    const display = attachAwareness(makeViewport(), bus.channelFor('D'), {
      identity: { id: 'tv' },
      publish: false,
    });
    display.announce();
    display.setFields({ cursor: true });
    bus.channelFor('A').sendPresence({ kind: 'awareness', id: 'ada', cursor: { x: 1, y: 1 } });
    expect(bus.sentBy.get('D')).toEqual([]);
    expect(display.local).toBeNull();
    expect(display.roster.getPeer('A')?.id).toBe('ada');
    display.dispose();
    expect(bus.sentBy.get('D')).toEqual([]);
  });

  it('wires overlays per options: cursors on by default, selections off; true enables selections', () => {
    const bus = makeBus();
    const defaults = attachAwareness(makeViewport(), bus.channelFor('A'), {
      identity: { id: 'a' },
    });
    expect(defaults.cursors).not.toBeNull();
    expect(defaults.selections).toBeNull();
    defaults.dispose();
    const custom = attachAwareness(makeViewport(), bus.channelFor('B'), {
      identity: { id: 'b' },
      cursors: false,
      selections: true,
    });
    expect(custom.cursors).toBeNull();
    expect(custom.selections).not.toBeNull();
    custom.dispose();
  });

  it('setFields forwards and merges; presence-leave removes the row', () => {
    const bus = makeBus();
    const a = attachAwareness(makeViewport(), bus.channelFor('A'), {
      identity: { id: 'ada' },
      intervalMs: 0,
      heartbeatMs: 0,
    });
    a.setFields({ cursor: false });
    expect(a.local?.getFields()).toEqual({ cursor: false, selection: false, tool: true });
    bus.channelFor('X').sendPresence({ kind: 'awareness', id: 'x' });
    expect(a.roster.getPeer('X')).toBeDefined();
    bus.leave('X');
    expect(a.roster.getPeer('X')).toBeUndefined();
    a.dispose();
  });

  it('dispose order: cleared frame first, then overlays, then roster, then channel unsubscribes; idempotent', () => {
    const bus = makeBus();
    const order: string[] = [];
    const channel = bus.channelFor('A');
    const wrapped: PresenceChannel = {
      sendPresence: (d) => {
        order.push(`send:${JSON.stringify(d)}`);
        channel.sendPresence(d);
      },
      onPresence: (h) => {
        const off = channel.onPresence(h);
        return () => {
          order.push('unsub:presence');
          off();
        };
      },
      onPresenceLeave: (h) => {
        const off = channel.onPresenceLeave(h);
        return () => {
          order.push('unsub:leave');
          off();
        };
      },
    };
    const a = attachAwareness(makeViewport(), wrapped, {
      identity: { id: 'ada' },
      intervalMs: 0,
      heartbeatMs: 0,
      selections: true,
    });
    const cursorsDispose = vi.spyOn(a.cursors as NonNullable<typeof a.cursors>, 'dispose');
    const selectionsDispose = vi.spyOn(a.selections as NonNullable<typeof a.selections>, 'dispose');
    const rosterDispose = vi.spyOn(a.roster, 'dispose');
    cursorsDispose.mockImplementation(() => order.push('cursors'));
    selectionsDispose.mockImplementation(() => order.push('selections'));
    rosterDispose.mockImplementation(() => order.push('roster'));
    a.dispose();
    a.dispose();
    expect(order).toEqual([
      'send:{"kind":"awareness","id":"ada","cleared":true}',
      'cursors',
      'selections',
      'roster',
      'unsub:presence',
      'unsub:leave',
    ]);
  });

  it('unwinds partial construction when an overlay constructor throws: publisher is disposed (sent its cleared frame), no timers leak', () => {
    const bus = makeBus();
    const boom = new Error('registerOverlay: viewport is being torn down');
    const viewport = makeViewport({
      registerOverlay: () => {
        throw boom;
      },
    });
    expect(() =>
      attachAwareness(viewport, bus.channelFor('A'), {
        identity: { id: 'ada' },
        intervalMs: 0,
        // Non-zero so the LocalAwareness constructor arms a heartbeat timer;
        // `vi.getTimerCount() === 0` below is only a meaningful assertion
        // (rather than vacuously true) if there was a timer to clear.
        heartbeatMs: 1000,
      }),
    ).toThrow(boom);
    expect(vi.getTimerCount()).toBe(0);
    expect(bus.sentBy.get('A')).toEqual([{ kind: 'awareness', id: 'ada', cleared: true }]);
  });

  it('frames arriving after dispose are ignored', () => {
    const bus = makeBus();
    const requestRender = vi.fn();
    const viewport = makeViewport({ requestRender });
    const a = attachAwareness(viewport, bus.channelFor('A'), {
      identity: { id: 'ada' },
      intervalMs: 0,
      heartbeatMs: 0,
    });
    a.dispose();
    requestRender.mockClear();
    bus.channelFor('Z').sendPresence({ kind: 'awareness', id: 'z' });
    expect(a.roster.getPeer('Z')).toBeUndefined();
    expect(requestRender).not.toHaveBeenCalled();
  });
});
