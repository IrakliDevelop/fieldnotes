import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isMeasurePresence,
  toMeasurePresence,
  MEASURE_PRESENCE_KIND,
  RemoteMeasureOverlay,
  type RemoteMeasureOverlayHost,
} from './remote-measure-overlay';

const active = {
  kind: 'measure',
  start: { x: 0, y: 0 },
  end: { x: 100, y: 50 },
  cells: 6,
  feet: 30,
  color: '#FF5722',
};

describe('isMeasurePresence', () => {
  it('accepts an active payload and the cleared form', () => {
    expect(isMeasurePresence(active)).toBe(true);
    expect(isMeasurePresence({ kind: 'measure', cleared: true })).toBe(true);
  });

  it('accepts an active payload without the optional color', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { color: _color, ...noColor } = active;
    expect(isMeasurePresence(noColor)).toBe(true);
  });

  it('rejects wrong kinds, primitives, and null', () => {
    expect(isMeasurePresence({ ...active, kind: 'ping' })).toBe(false);
    expect(isMeasurePresence('measure')).toBe(false);
    expect(isMeasurePresence(null)).toBe(false);
    expect(isMeasurePresence(undefined)).toBe(false);
  });

  it('rejects non-finite or missing numeric fields', () => {
    expect(isMeasurePresence({ ...active, feet: Number.NaN })).toBe(false);
    expect(isMeasurePresence({ ...active, cells: Infinity })).toBe(false);
    expect(isMeasurePresence({ ...active, start: { x: 0 } })).toBe(false);
    expect(isMeasurePresence({ ...active, end: { x: 'a', y: 0 } })).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { feet: _feet, ...missingFeet } = active;
    expect(isMeasurePresence(missingFeet)).toBe(false);
  });

  it('rejects a non-string color and a non-true cleared', () => {
    expect(isMeasurePresence({ ...active, color: 7 })).toBe(false);
    expect(isMeasurePresence({ kind: 'measure', cleared: 1 })).toBe(false);
  });

  it('accepts a cleared payload even with bogus extra fields (cleared branch ignores active fields)', () => {
    expect(isMeasurePresence({ kind: 'measure', cleared: true, start: { x: 0 }, feet: 'x' })).toBe(
      true,
    );
  });

  it('rejects cleared present but not exactly true, even with valid active fields', () => {
    expect(isMeasurePresence({ ...active, cleared: false })).toBe(false);
  });

  it('rejects an active payload missing cells', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { cells: _cells, ...missingCells } = active;
    expect(isMeasurePresence(missingCells)).toBe(false);
  });
});

describe('toMeasurePresence', () => {
  it('maps an emission to the wire shape, dropping worldDistance', () => {
    const presence = toMeasurePresence({
      start: { x: 1, y: 2 },
      end: { x: 3, y: 4 },
      worldDistance: 2.83,
      cells: 2,
      feet: 10,
      color: '#00AA00',
    });
    expect(presence).toEqual({
      kind: MEASURE_PRESENCE_KIND,
      start: { x: 1, y: 2 },
      end: { x: 3, y: 4 },
      cells: 2,
      feet: 10,
      color: '#00AA00',
    });
  });

  it('maps null to the cleared form', () => {
    expect(toMeasurePresence(null)).toEqual({ kind: MEASURE_PRESENCE_KIND, cleared: true });
  });
});

function makeHost(): RemoteMeasureOverlayHost & {
  draws: number;
  drawFrame: () => void;
  unregistered: boolean;
  lastContext: Record<string, unknown> | null;
} {
  let renderer: ((ctx: CanvasRenderingContext2D) => void) | null = null;
  const host = {
    draws: 0,
    unregistered: false,
    lastContext: null as Record<string, unknown> | null,
    registerOverlay(draw: (ctx: CanvasRenderingContext2D) => void) {
      renderer = draw;
      return () => {
        host.unregistered = true;
        renderer = null;
      };
    },
    requestRender: vi.fn(),
    drawFrame() {
      host.draws += 1;
      const ctx: Record<string, unknown> = {
        save: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
        setLineDash: vi.fn(),
        roundRect: vi.fn(),
        fillText: vi.fn(),
        measureText: vi.fn(() => ({ width: 40 })),
        strokeStyle: '',
      };
      renderer?.(ctx as unknown as CanvasRenderingContext2D);
      host.lastContext = ctx;
    },
  };
  return host;
}

function setNow(overlay: RemoteMeasureOverlay, value: number): void {
  vi.spyOn(overlay as unknown as { now: () => number }, 'now').mockReturnValue(value);
}

describe('RemoteMeasureOverlay', () => {
  let rafCallbacks: FrameRequestCallback[];
  beforeEach(() => {
    vi.useFakeTimers();
    rafCallbacks = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      rafCallbacks[id - 1] = () => undefined;
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('applies an active payload per sender and replaces on update', () => {
    const host = makeHost();
    const overlay = new RemoteMeasureOverlay(host);
    expect(overlay.apply('a', active)).toBe(true);
    expect(overlay.apply('a', { ...active, feet: 60 })).toBe(true);
    expect(overlay.activeSenderCount).toBe(1);
    expect(host.requestRender).toHaveBeenCalled();
  });

  it('ignores malformed and foreign payloads', () => {
    const host = makeHost();
    const overlay = new RemoteMeasureOverlay(host);
    expect(overlay.apply('a', { kind: 'laser', points: [] })).toBe(false);
    expect(overlay.apply('a', { ...active, feet: Number.NaN })).toBe(false);
    expect(overlay.activeSenderCount).toBe(0);
  });

  it('cleared payload holds, then fades, then deletes', () => {
    const host = makeHost();
    const overlay = new RemoteMeasureOverlay(host); // holdMs 1500, fadeMs 400
    setNow(overlay, 1_000);
    overlay.apply('a', active);
    overlay.apply('a', { kind: 'measure', cleared: true });
    expect(overlay.activeSenderCount).toBe(1); // lingering
    setNow(overlay, 1_000 + 1500 + 399);
    rafCallbacks.splice(0).forEach((cb) => cb(0)); // still fading
    expect(overlay.activeSenderCount).toBe(1);
    setNow(overlay, 1_000 + 1500 + 400);
    rafCallbacks.splice(0).forEach((cb) => cb(0));
    expect(overlay.activeSenderCount).toBe(0);
  });

  it('a new active payload during linger cancels the fade', () => {
    const host = makeHost();
    const overlay = new RemoteMeasureOverlay(host);
    setNow(overlay, 0);
    overlay.apply('a', active);
    overlay.apply('a', { kind: 'measure', cleared: true });
    overlay.apply('a', active); // measurement restarted
    setNow(overlay, 10_000);
    rafCallbacks.splice(0).forEach((cb) => cb(0));
    expect(overlay.activeSenderCount).toBe(1); // still active, no fade delete
  });

  it('maxAgeMs expires a stale active entry with no renders in between', () => {
    const host = makeHost();
    const overlay = new RemoteMeasureOverlay(host); // maxAgeMs 30000
    setNow(overlay, 0);
    overlay.apply('a', active);
    host.requestRender.mockClear();
    setNow(overlay, 30_000);
    vi.advanceTimersByTime(30_000); // idle map: only the timer can wake us
    expect(host.requestRender).toHaveBeenCalled(); // linger started
    setNow(overlay, 30_000 + 1500 + 400);
    rafCallbacks.splice(0).forEach((cb) => cb(0));
    expect(overlay.activeSenderCount).toBe(0);
  });

  it('updates reset the expiry timer', () => {
    const host = makeHost();
    const overlay = new RemoteMeasureOverlay(host);
    setNow(overlay, 0);
    overlay.apply('a', active);
    vi.advanceTimersByTime(20_000);
    overlay.apply('a', { ...active, feet: 15 }); // timer restarts
    vi.advanceTimersByTime(20_000); // 40s total, but only 20s since update
    expect(overlay.activeSenderCount).toBe(1);
    vi.advanceTimersByTime(10_000);
    expect(rafCallbacks.length).toBeGreaterThan(0); // now lingering
  });

  it('remove deletes immediately without linger and cancels the timer', () => {
    const host = makeHost();
    const overlay = new RemoteMeasureOverlay(host);
    overlay.apply('a', active);
    overlay.remove('a');
    expect(overlay.activeSenderCount).toBe(0);
    vi.advanceTimersByTime(60_000); // no leaked timer fires
    expect(vi.getTimerCount()).toBe(0);
  });

  it('dispose is idempotent, cancels timers, and unregisters', () => {
    const host = makeHost();
    const overlay = new RemoteMeasureOverlay(host);
    overlay.apply('a', active);
    host.requestRender.mockClear();
    overlay.dispose();
    expect(host.requestRender).toHaveBeenCalledTimes(1);
    overlay.dispose();
    expect(host.requestRender).toHaveBeenCalledTimes(1); // not called again
    expect(host.unregistered).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(overlay.apply('a', active)).toBe(false);
  });

  it('renders through drawMeasurement with the fallback color when omitted', () => {
    const host = makeHost();
    const overlay = new RemoteMeasureOverlay(host, { color: '#123456' });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { color: _color, ...noColor } = active;
    overlay.apply('a', noColor);
    host.drawFrame(); // must not throw; entry drawn with fallback
    expect(host.draws).toBe(1);
    expect(host.lastContext?.strokeStyle).toBe('#123456');
  });
});
