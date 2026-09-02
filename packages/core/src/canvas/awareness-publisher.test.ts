// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LocalAwareness } from './awareness-publisher';
import type { LocalAwarenessHost } from './awareness-publisher';
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

  it('throws when the viewport wrapper is not mounted and no element is given', () => {
    const { host } = makeHost();
    host.domLayer.remove();
    expect(() => new LocalAwareness(host, { identity, send: vi.fn() })).toThrow(/wrapper/);
  });
});
