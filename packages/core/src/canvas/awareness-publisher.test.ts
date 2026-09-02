// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LocalAwareness } from './awareness-publisher';
import type { LocalAwarenessHost } from './awareness-publisher';
import { isAwarenessPresence } from './awareness-presence';
import type { AwarenessPresence } from './awareness-presence';

type PointerInit = PointerEventInit & { clientX?: number; clientY?: number };

function fire(el: HTMLElement, type: string, opts: PointerInit = {}): void {
  el.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      ...opts,
    }),
  );
}

interface FakeHost extends LocalAwarenessHost {
  selection: string[];
  toolName: string | null;
  fireSelection(): void;
  fireTool(name: string): void;
  selectionUnsub: ReturnType<typeof vi.fn>;
  toolUnsub: ReturnType<typeof vi.fn>;
}

function makeHost(): { host: FakeHost; wrapper: HTMLElement } {
  const wrapper = document.createElement('div');
  wrapper.getBoundingClientRect = () =>
    ({
      left: 100,
      top: 50,
      width: 800,
      height: 600,
      right: 900,
      bottom: 650,
      x: 100,
      y: 50,
      toJSON: () => ({}),
    }) as DOMRect;
  const domLayer = document.createElement('div');
  wrapper.appendChild(domLayer);
  document.body.appendChild(wrapper);
  const selectionListeners = new Set<() => void>();
  const toolListeners = new Set<(name: string) => void>();
  const selectionUnsub = vi.fn();
  const toolUnsub = vi.fn();
  const host: FakeHost = {
    selection: [],
    toolName: 'select',
    camera: { screenToWorld: (p) => ({ x: p.x * 2, y: p.y * 2 }) },
    domLayer,
    onSelectionChange: (l) => {
      selectionListeners.add(l);
      return () => {
        selectionListeners.delete(l);
        selectionUnsub();
      };
    },
    getSelectedIds: () => [...host.selection],
    toolManager: {
      onChange: (l) => {
        toolListeners.add(l);
        return () => {
          toolListeners.delete(l);
          toolUnsub();
        };
      },
      get activeTool() {
        return host.toolName === null ? null : { name: host.toolName };
      },
    },
    fireSelection: () => selectionListeners.forEach((l) => l()),
    fireTool: (name) => {
      host.toolName = name;
      toolListeners.forEach((l) => l(name));
    },
    selectionUnsub,
    toolUnsub,
  };
  return { host, wrapper };
}

const identity = { id: 'ada', name: 'Ada', role: 'player' };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('LocalAwareness frames', () => {
  it('sends nothing until announced, then a full snapshot carrying identity, cursor and tool', () => {
    const { host, wrapper } = makeHost();
    const send = vi.fn();
    const local = new LocalAwareness(host, { identity, send });
    expect(send).not.toHaveBeenCalled();
    fire(wrapper, 'pointermove', { clientX: 110, clientY: 70 });
    // Leading-edge: the first frame after idle goes out immediately.
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toEqual({
      kind: 'awareness',
      id: 'ada',
      name: 'Ada',
      role: 'player',
      cursor: { x: 20, y: 40 },
      tool: 'select',
    });
    local.dispose();
  });

  it('coalesces a burst of cursor + selection + tool changes into ONE trailing frame per interval carrying all three', () => {
    const { host, wrapper } = makeHost();
    const send = vi.fn();
    const local = new LocalAwareness(host, {
      identity,
      send,
      fields: { selection: true },
      intervalMs: 50,
    });
    local.announce();
    expect(send).toHaveBeenCalledTimes(1);
    fire(wrapper, 'pointermove', { clientX: 101, clientY: 51 });
    fire(wrapper, 'pointermove', { clientX: 102, clientY: 52 });
    host.selection = ['e1'];
    host.fireSelection();
    host.fireTool('pencil');
    fire(wrapper, 'pointermove', { clientX: 103, clientY: 53 });
    expect(send).toHaveBeenCalledTimes(1);
    // Regression for the "delete `if (this.throttleTimer !== null) return;`"
    // mutation: without the re-entry guard, every change in the burst would
    // arm its own throttle timer. At most two timers may be live here: the
    // one pending throttle timer (coalescing the burst) and the heartbeat
    // timer armed by the leading `announce()` flush (default heartbeatMs).
    expect(vi.getTimerCount()).toBeLessThanOrEqual(2);
    vi.advanceTimersByTime(49);
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[0]).toEqual({
      kind: 'awareness',
      id: 'ada',
      name: 'Ada',
      role: 'player',
      cursor: { x: 6, y: 6 },
      selection: ['e1'],
      tool: 'pencil',
    });
    local.dispose();
  });

  it('pointerleave and pointercancel clear the cursor; non-primary pointers are ignored', () => {
    const { host, wrapper } = makeHost();
    const send = vi.fn();
    const local = new LocalAwareness(host, { identity, send, intervalMs: 0 });
    fire(wrapper, 'pointermove', { clientX: 110, clientY: 70 });
    fire(wrapper, 'pointermove', { clientX: 300, clientY: 300, isPrimary: false, pointerId: 2 });
    expect(send).toHaveBeenCalledTimes(1);
    fire(wrapper, 'pointerleave', { clientX: 110, clientY: 70 });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[0]).not.toHaveProperty('cursor');
    fire(wrapper, 'pointermove', { clientX: 110, clientY: 70 });
    fire(wrapper, 'pointercancel', { clientX: 110, clientY: 70 });
    expect(send).toHaveBeenCalledTimes(4);
    expect(send.mock.calls[3]?.[0]).not.toHaveProperty('cursor');
    local.dispose();
  });

  it('drops a non-finite pointer instead of publishing it on the wire', () => {
    const { host, wrapper } = makeHost();
    host.camera.screenToWorld = () => ({ x: NaN, y: 0 });
    const send = vi.fn();
    const local = new LocalAwareness(host, { identity, send, intervalMs: 0 });
    fire(wrapper, 'pointermove', { clientX: 110, clientY: 70 });
    expect(send).toHaveBeenCalledTimes(1);
    const frame = send.mock.calls[0]?.[0] as AwarenessPresence;
    expect(frame).not.toHaveProperty('cursor');
    expect(isAwarenessPresence(frame)).toBe(true);
    local.dispose();
  });

  it('heartbeat re-sends the full state only while idle, measured from the last send', () => {
    const { host, wrapper } = makeHost();
    const send = vi.fn();
    const local = new LocalAwareness(host, { identity, send, intervalMs: 0, heartbeatMs: 1000 });
    vi.advanceTimersByTime(999);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledTimes(1);
    // Activity at t=1500 resets the heartbeat: the next idle frame is at 2500, not 2000.
    vi.advanceTimersByTime(500);
    fire(wrapper, 'pointermove', { clientX: 110, clientY: 70 });
    expect(send).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(999);
    expect(send).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[2]?.[0]).toMatchObject({ cursor: { x: 20, y: 40 } });
    local.dispose();
  });

  it('heartbeatMs: 0 disables the heartbeat', () => {
    const { host } = makeHost();
    const send = vi.fn();
    const local = new LocalAwareness(host, { identity, send, heartbeatMs: 0 });
    vi.advanceTimersByTime(60_000);
    expect(send).not.toHaveBeenCalled();
    local.dispose();
  });

  it('a non-finite heartbeatMs (Infinity) disables the heartbeat instead of flooding', () => {
    const { host } = makeHost();
    const send = vi.fn();
    const local = new LocalAwareness(host, { identity, send, heartbeatMs: Infinity });
    vi.advanceTimersByTime(60_000);
    expect(send).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    local.dispose();
  });

  it('a non-finite intervalMs (NaN) behaves as 0: each change sends immediately with no timer', () => {
    const { host, wrapper } = makeHost();
    const send = vi.fn();
    const local = new LocalAwareness(host, {
      identity,
      send,
      intervalMs: NaN,
      heartbeatMs: 0,
    });
    fire(wrapper, 'pointermove', { clientX: 110, clientY: 70 });
    fire(wrapper, 'pointermove', { clientX: 120, clientY: 80 });
    expect(send).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    local.dispose();
  });
});

describe('LocalAwareness selection privacy', () => {
  it('never puts selected ids in any outbound frame by default', () => {
    const { host } = makeHost();
    const send = vi.fn();
    const local = new LocalAwareness(host, { identity, send, intervalMs: 0 });
    host.selection = ['secret-1'];
    host.fireSelection();
    local.announce();
    expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(send.mock.calls)).not.toContain('secret-1');
    local.dispose();
  });

  it('applies selectionFilter before send: a filtered id never leaves the client', () => {
    const { host } = makeHost();
    const send = vi.fn();
    const local = new LocalAwareness(host, {
      identity,
      send,
      intervalMs: 0,
      fields: { selection: true },
      selectionFilter: (ids) => ids.filter((id) => !id.startsWith('secret')),
    });
    host.selection = ['secret-1', 'public-1'];
    host.fireSelection();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toMatchObject({ selection: ['public-1'] });
    expect(JSON.stringify(send.mock.calls)).not.toContain('secret-1');
    local.dispose();
  });

  it('fails closed when selectionFilter throws or returns garbage: no selection key, error reported', () => {
    const { host } = makeHost();
    const send = vi.fn();
    const onError = vi.fn();
    let mode: 'throw' | 'garbage' | 'ok' = 'throw';
    const local = new LocalAwareness(host, {
      identity,
      send,
      onError,
      intervalMs: 0,
      fields: { selection: true },
      selectionFilter: (ids) => {
        if (mode === 'throw') throw new Error('filter exploded');
        if (mode === 'garbage') return ['ok', 42 as unknown as string];
        return ids;
      },
    });
    expect(onError).toHaveBeenCalledTimes(1);
    host.selection = ['secret-1'];
    host.fireSelection();
    expect(send.mock.calls[0]?.[0]).not.toHaveProperty('selection');
    expect(onError).toHaveBeenCalledTimes(2);
    mode = 'garbage';
    host.fireSelection();
    expect(send.mock.calls[1]?.[0]).not.toHaveProperty('selection');
    expect(onError).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(send.mock.calls)).not.toContain('secret-1');
    mode = 'ok';
    host.fireSelection();
    expect(send.mock.calls[2]?.[0]).toMatchObject({ selection: ['secret-1'] });
    local.dispose();
  });

  it('selectionFilter is consulted even for an empty selection', () => {
    const { host } = makeHost();
    const send = vi.fn();
    const selectionFilter = vi.fn((ids: readonly string[]) => ids);
    const local = new LocalAwareness(host, {
      identity,
      send,
      fields: { selection: true },
      selectionFilter,
    });
    expect(selectionFilter).toHaveBeenCalledTimes(1);
    expect(selectionFilter).toHaveBeenCalledWith([]);
    local.dispose();
  });

  it('the filter is never consulted while selection publishing is off', () => {
    const { host } = makeHost();
    const send = vi.fn();
    const selectionFilter = vi.fn((ids: readonly string[]) => ids);
    const local = new LocalAwareness(host, {
      identity,
      send,
      intervalMs: 0,
      heartbeatMs: 1000,
      selectionFilter,
    });
    host.selection = ['e1'];
    host.fireSelection();
    local.announce();
    vi.advanceTimersByTime(1000);
    expect(selectionFilter).not.toHaveBeenCalled();
    local.dispose();
  });

  it('caps the published selection at AWARENESS_MAX_SELECTION without failing', () => {
    const { host } = makeHost();
    const send = vi.fn();
    const local = new LocalAwareness(host, {
      identity,
      send,
      intervalMs: 0,
      fields: { selection: true },
    });
    host.selection = Array.from({ length: 300 }, (_, i) => `e${i}`);
    host.fireSelection();
    const frame = send.mock.calls[0]?.[0] as AwarenessPresence;
    expect(frame.selection).toHaveLength(256);
    expect(frame.selection?.[0]).toBe('e0');
    expect(isAwarenessPresence(frame)).toBe(true);
    local.dispose();
  });

  it('validates every filter entry before capping: a bad id past the 256 boundary still fails closed', () => {
    const { host } = makeHost();
    const send = vi.fn();
    const onError = vi.fn();
    const ids = Array.from({ length: 300 }, (_, i) => `e${i}`) as unknown[];
    ids[280] = 42;
    const local = new LocalAwareness(host, {
      identity,
      send,
      onError,
      intervalMs: 0,
      fields: { selection: true },
      selectionFilter: () => ids as readonly string[],
    });
    // The constructor already ran refreshSelection() once against the same
    // bad filter output, so `onError` has already fired by construction time.
    expect(onError).toHaveBeenCalledTimes(1);
    host.selection = ['whatever'];
    host.fireSelection();
    expect(onError).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.at(-1)?.[0]).not.toHaveProperty('selection');
    local.dispose();
  });
});

describe('LocalAwareness selection policy changes', () => {
  it('a policy change before enabling selection is honoured', () => {
    const { host } = makeHost();
    const send = vi.fn();
    const privateIds = new Set<string>();
    const local = new LocalAwareness(host, {
      identity,
      send,
      selectionFilter: (ids) => ids.filter((id) => !privateIds.has(id)),
    });
    host.selection = ['e1'];
    host.fireSelection();
    privateIds.add('e1');
    local.setFields({ selection: true });
    const frame = send.mock.calls.at(-1)?.[0] as AwarenessPresence;
    expect(frame).not.toHaveProperty('selection');
    expect(JSON.stringify(send.mock.calls)).not.toContain('e1');
    local.dispose();
  });

  it('a policy change while enabled takes effect on the next heartbeat without a selection event', () => {
    const { host } = makeHost();
    const send = vi.fn();
    const privateIds = new Set<string>();
    const local = new LocalAwareness(host, {
      identity,
      send,
      fields: { selection: true },
      heartbeatMs: 1000,
      intervalMs: 0,
      selectionFilter: (ids) => ids.filter((id) => !privateIds.has(id)),
    });
    host.selection = ['e1', 'e2'];
    host.fireSelection();
    expect(send.mock.calls.at(-1)?.[0]).toMatchObject({ selection: ['e1', 'e2'] });
    privateIds.add('e2');
    vi.advanceTimersByTime(1000);
    expect(send.mock.calls.at(-1)?.[0]).toMatchObject({ selection: ['e1'] });
    local.dispose();
  });

  it('announce() re-applies the filter', () => {
    const { host } = makeHost();
    const send = vi.fn();
    const privateIds = new Set<string>();
    const local = new LocalAwareness(host, {
      identity,
      send,
      fields: { selection: true },
      heartbeatMs: 1000,
      intervalMs: 0,
      selectionFilter: (ids) => ids.filter((id) => !privateIds.has(id)),
    });
    host.selection = ['e1', 'e2'];
    host.fireSelection();
    expect(send.mock.calls.at(-1)?.[0]).toMatchObject({ selection: ['e1', 'e2'] });
    privateIds.add('e1');
    local.announce();
    const frame = send.mock.calls.at(-1)?.[0] as AwarenessPresence;
    expect(frame).toMatchObject({ selection: ['e2'] });
    expect(JSON.stringify([frame])).not.toContain('"e1"');
    local.dispose();
  });
});

describe('LocalAwareness setFields / setIdentity', () => {
  it('setFields merges partial flags: { cursor: false } keeps tool published and drops only the cursor', () => {
    const { host, wrapper } = makeHost();
    const send = vi.fn();
    const local = new LocalAwareness(host, { identity, send, intervalMs: 0 });
    fire(wrapper, 'pointermove', { clientX: 110, clientY: 70 });
    expect(send.mock.calls[0]?.[0]).toMatchObject({ cursor: { x: 20, y: 40 }, tool: 'select' });
    local.setFields({ cursor: false });
    expect(local.getFields()).toEqual({ cursor: false, selection: false, tool: true });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[0]).not.toHaveProperty('cursor');
    expect(send.mock.calls[1]?.[0]).toMatchObject({ tool: 'select' });
    // Pointer moves while off retain the position but send nothing.
    fire(wrapper, 'pointermove', { clientX: 120, clientY: 80 });
    expect(send).toHaveBeenCalledTimes(2);
    // Re-enabling publishes the retained position without a new pointer event.
    local.setFields({ cursor: true });
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[2]?.[0]).toMatchObject({ cursor: { x: 40, y: 60 } });
    // `undefined` keys are ignored by the merge.
    local.setFields({ cursor: undefined, tool: false });
    expect(local.getFields()).toEqual({ cursor: true, selection: false, tool: false });
    local.dispose();
  });

  it('setIdentity re-announces with the new identity', () => {
    const { host } = makeHost();
    const send = vi.fn();
    const local = new LocalAwareness(host, { identity, send, intervalMs: 0 });
    local.setIdentity({ id: 'ada', name: 'Ada L.', color: '#123456' });
    expect(send.mock.calls[0]?.[0]).toEqual({
      kind: 'awareness',
      id: 'ada',
      name: 'Ada L.',
      color: '#123456',
      tool: 'select',
    });
    local.dispose();
  });
});

describe('LocalAwareness identity and tool bounds', () => {
  it('truncates an over-long name to the 64-char wire cap', () => {
    const { host } = makeHost();
    const send = vi.fn();
    const local = new LocalAwareness(host, {
      identity: { id: 'ada', name: 'x'.repeat(100) },
      send,
      intervalMs: 0,
    });
    local.announce();
    const frame = send.mock.calls.at(-1)?.[0] as AwarenessPresence;
    expect(frame.name).toHaveLength(64);
    expect(isAwarenessPresence(local.getState())).toBe(true);
    local.dispose();
  });

  it('reports a truncated identity field through onError instead of staying silent', () => {
    const { host } = makeHost();
    const send = vi.fn();
    const onError = vi.fn();
    const local = new LocalAwareness(host, {
      identity: { id: 'ada', name: 'x'.repeat(100) },
      send,
      onError,
      intervalMs: 0,
    });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(RangeError);
    local.announce();
    const frame = send.mock.calls.at(-1)?.[0] as AwarenessPresence;
    expect(frame.name).toHaveLength(64);
    local.dispose();
  });

  it('throws a RangeError when id is empty or over 128 characters', () => {
    const { host } = makeHost();
    expect(
      () => new LocalAwareness(host, { identity: { id: 'x'.repeat(129) }, send: vi.fn() }),
    ).toThrow(RangeError);
    expect(() => new LocalAwareness(host, { identity: { id: '' }, send: vi.fn() })).toThrow(
      RangeError,
    );
  });

  it('setIdentity throws a RangeError for an empty id and truncates a 100-char name to 64', () => {
    const { host } = makeHost();
    const send = vi.fn();
    const local = new LocalAwareness(host, { identity, send, intervalMs: 0 });
    expect(() => local.setIdentity({ id: '' })).toThrow(RangeError);
    local.setIdentity({ id: 'ada', name: 'n'.repeat(100) });
    const frame = send.mock.calls.at(-1)?.[0] as AwarenessPresence;
    expect(frame.name).toHaveLength(64);
    local.dispose();
  });

  it('setIdentity truncates role to 32 characters', () => {
    const { host } = makeHost();
    const send = vi.fn();
    const local = new LocalAwareness(host, { identity, send, intervalMs: 0 });
    local.setIdentity({ id: 'ada', role: 'r'.repeat(40) });
    const frame = send.mock.calls.at(-1)?.[0] as AwarenessPresence;
    expect(frame.role).toHaveLength(32);
    expect(isAwarenessPresence(local.getState())).toBe(true);
    local.dispose();
  });

  it('omits an over-long tool name from the frame instead of truncating it', () => {
    const { host } = makeHost();
    const send = vi.fn();
    const local = new LocalAwareness(host, { identity, send, intervalMs: 0 });
    host.fireTool('t'.repeat(65));
    const frame = send.mock.calls.at(-1)?.[0] as AwarenessPresence;
    expect(frame).not.toHaveProperty('tool');
    local.dispose();
  });

  it('an over-long selection id fails the selection closed and still sends the frame', () => {
    const { host } = makeHost();
    const send = vi.fn();
    const onError = vi.fn();
    const local = new LocalAwareness(host, {
      identity,
      send,
      onError,
      intervalMs: 0,
      fields: { selection: true },
    });
    host.selection = ['x'.repeat(129)];
    host.fireSelection();
    expect(onError).toHaveBeenCalledTimes(1);
    const sent = send.mock.calls.at(-1)?.[0] as AwarenessPresence;
    expect(sent).not.toHaveProperty('selection');
    expect(sent).toMatchObject({ id: 'ada', tool: 'select' });
    local.dispose();
  });

  it('every frame is valid by construction', () => {
    const { host } = makeHost();
    const send = vi.fn();
    const local = new LocalAwareness(host, {
      identity: { id: 'ada', name: 'n'.repeat(100), role: 'r'.repeat(40) },
      send,
      intervalMs: 0,
      fields: { selection: true },
    });
    expect(isAwarenessPresence(local.getState())).toBe(true);
    host.fireTool('t'.repeat(65));
    expect(isAwarenessPresence(local.getState())).toBe(true);
    // A 256+ selection with one over-long id well inside the 256 cap
    // boundary: fixed by the fail-closed check in refreshSelection, so the
    // frame either carries no selection or a fully valid one — never an
    // over-long id smuggled through by the length cap alone.
    host.selection = Array.from({ length: 300 }, (_, i) => (i === 200 ? 'x'.repeat(129) : `e${i}`));
    host.fireSelection();
    expect(isAwarenessPresence(local.getState())).toBe(true);
    local.dispose();
  });
});

describe('LocalAwareness lifecycle', () => {
  it('dispose sends exactly one cleared frame, removes listeners and timers, and is idempotent', () => {
    const { host, wrapper } = makeHost();
    const send = vi.fn();
    const removeSpy = vi.spyOn(wrapper, 'removeEventListener');
    const local = new LocalAwareness(host, { identity, send, heartbeatMs: 1000 });
    local.dispose();
    local.dispose();
    expect(local.disposed).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toEqual({ kind: 'awareness', id: 'ada', cleared: true });
    expect(host.selectionUnsub).toHaveBeenCalledTimes(1);
    expect(host.toolUnsub).toHaveBeenCalledTimes(1);
    expect(removeSpy.mock.calls.map((c) => c[0]).sort()).toEqual([
      'pointercancel',
      'pointerleave',
      'pointermove',
    ]);
    expect(vi.getTimerCount()).toBe(0);
    fire(wrapper, 'pointermove', { clientX: 110, clientY: 70 });
    vi.advanceTimersByTime(5000);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('a throwing send is reported and does not break later frames', () => {
    const { host } = makeHost();
    const onError = vi.fn();
    let fail = true;
    const send = vi.fn(() => {
      if (fail) throw new Error('socket closed');
    });
    const local = new LocalAwareness(host, { identity, send, onError, intervalMs: 0 });
    local.announce();
    expect(onError).toHaveBeenCalledTimes(1);
    fail = false;
    host.fireTool('pencil');
    expect(send).toHaveBeenCalledTimes(2);
    local.dispose();
  });

  it('a throwing onError never escapes, even when selectionFilter also throws', () => {
    const { host } = makeHost();
    const send = vi.fn();
    const onError = vi.fn(() => {
      throw new Error('onError itself is broken');
    });
    const selectionFilter = vi.fn(() => {
      throw new Error('filter exploded');
    });
    const local = new LocalAwareness(host, {
      identity,
      send,
      onError,
      intervalMs: 0,
      fields: { selection: true },
      selectionFilter,
    });
    host.selection = ['secret-1'];
    expect(() => host.fireSelection()).not.toThrow();
    expect(onError).toHaveBeenCalled();
    host.fireTool('pencil');
    expect(send).toHaveBeenCalled();
    expect(send.mock.calls.at(-1)?.[0]).toMatchObject({ tool: 'pencil' });
    local.dispose();
  });

  it('dispose after a pending trailing frame sends cleared, never the stale cursor', () => {
    const { host, wrapper } = makeHost();
    const send = vi.fn();
    const local = new LocalAwareness(host, { identity, send, intervalMs: 50, heartbeatMs: 0 });
    fire(wrapper, 'pointermove', { clientX: 110, clientY: 70 });
    expect(send).toHaveBeenCalledTimes(1); // leading frame
    vi.advanceTimersByTime(10);
    fire(wrapper, 'pointermove', { clientX: 120, clientY: 80 });
    expect(send).toHaveBeenCalledTimes(1); // still pending, throttled
    local.dispose();
    vi.advanceTimersByTime(100);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[0]).toEqual({ kind: 'awareness', id: 'ada', cleared: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('throws when the viewport wrapper is not mounted and no element is given', () => {
    const { host } = makeHost();
    host.domLayer.remove();
    expect(() => new LocalAwareness(host, { identity, send: vi.fn() })).toThrow(/wrapper/);
  });
});
