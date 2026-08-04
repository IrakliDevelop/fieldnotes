// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PingInput } from './ping-input';
import type { PingEmission } from '../tools/ping-tool';
import { Camera } from './camera';

interface NowLike {
  now(): number;
}

function setNow(input: PingInput, value: number): void {
  vi.spyOn(input as unknown as NowLike, 'now').mockReturnValue(value);
}

/** Element whose bounding rect sits at (10, 20) so client→local conversion is visible. */
function makeElement(): HTMLElement {
  const el = document.createElement('div');
  el.getBoundingClientRect = () =>
    ({
      left: 10,
      top: 20,
      right: 810,
      bottom: 620,
      width: 800,
      height: 600,
      x: 10,
      y: 20,
    }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

type PointerInit = PointerEventInit & { clientX?: number; clientY?: number };

function fire(el: HTMLElement, type: string, opts: PointerInit = {}): PointerEvent {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    ...opts,
  });
  el.dispatchEvent(event);
  return event;
}

describe('PingInput', () => {
  let el: HTMLElement;
  let camera: Camera;
  let input: PingInput;
  let emissions: PingEmission[];

  function make(options: ConstructorParameters<typeof PingInput>[2] = {}): PingInput {
    const created = new PingInput(el, camera, options);
    created.onPing((e) => emissions.push(e));
    return created;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    el = makeElement();
    camera = new Camera();
    emissions = [];
    // Most tests exercise the long-press path, which is opt-in.
    input = make({ longPressEnabled: true });
    setNow(input, 0);
  });

  afterEach(() => {
    input.dispose();
    el.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('longPressEnabled opt-in', () => {
    it('long-press is disabled by default; keyboard paths still work', () => {
      input.dispose();
      input = make();
      setNow(input, 0);

      fire(el, 'pointerdown', { clientX: 110, clientY: 120 });
      vi.advanceTimersByTime(600);
      fire(el, 'pointerup', {});
      expect(emissions.length).toBe(0);

      // The pointer was still tracked for pingAtPointer.
      expect(input.pingAtPointer()).toBe(true);
      expect(emissions[0]).toMatchObject({ x: 100, y: 100 });
    });

    it('disabling mid-press cancels the pending press; re-enabling arms new presses', () => {
      fire(el, 'pointerdown', { clientX: 110, clientY: 120 });
      input.setOptions({ longPressEnabled: false });
      vi.advanceTimersByTime(600);
      expect(emissions.length).toBe(0);

      fire(el, 'pointerup', {});
      fire(el, 'pointerdown', { clientX: 110, clientY: 120 });
      vi.advanceTimersByTime(600);
      expect(emissions.length).toBe(0);

      fire(el, 'pointerup', {});
      input.setOptions({ longPressEnabled: true });
      fire(el, 'pointerdown', { clientX: 110, clientY: 120 });
      vi.advanceTimersByTime(600);
      expect(emissions.length).toBe(1);
    });
  });

  describe('long-press firing', () => {
    it('fires one ping at the original press position after longPressMs, for mouse', () => {
      camera.moveTo(100, 0); // world x = local x - 100 at zoom 1
      fire(el, 'pointerdown', { clientX: 60, clientY: 70 }); // local (50, 50)
      expect(emissions.length).toBe(0);

      vi.advanceTimersByTime(599);
      expect(emissions.length).toBe(0);
      vi.advanceTimersByTime(1);
      expect(emissions).toEqual([
        { x: -50, y: 50, color: '#ff3b30', durationMs: 1800, radius: 48 },
      ]);

      // Holding longer never fires again for the same press.
      vi.advanceTimersByTime(5000);
      expect(emissions.length).toBe(1);
    });

    it('fires for touch and pen pointers too', () => {
      fire(el, 'pointerdown', { pointerType: 'touch', clientX: 10, clientY: 20 });
      vi.advanceTimersByTime(600);
      fire(el, 'pointerup', { pointerType: 'touch' });

      setNow(input, 10_000);
      fire(el, 'pointerdown', { pointerType: 'pen', pointerId: 2, clientX: 10, clientY: 20 });
      vi.advanceTimersByTime(600);
      expect(emissions.length).toBe(2);
    });

    it('uses the configured longPressMs and emission style', () => {
      input.dispose();
      input = make({
        longPressEnabled: true,
        longPressMs: 200,
        color: '#00ff00',
        durationMs: 900,
        radius: 24,
      });
      setNow(input, 0);
      fire(el, 'pointerdown', { clientX: 10, clientY: 20 });
      vi.advanceTimersByTime(200);
      expect(emissions).toEqual([{ x: 0, y: 0, color: '#00ff00', durationMs: 900, radius: 24 }]);
    });

    it('fires at the original press position even after movement within slop', () => {
      fire(el, 'pointerdown', { clientX: 110, clientY: 120 }); // local (100, 100)
      fire(el, 'pointermove', { clientX: 115, clientY: 120 }); // 5px, inside slop
      vi.advanceTimersByTime(600);
      expect(emissions.length).toBe(1);
      expect(emissions[0]).toMatchObject({ x: 100, y: 100 });
    });
  });

  describe('cancellation', () => {
    it('movement past slopPx cancels; exactly slopPx does not', () => {
      fire(el, 'pointerdown', { clientX: 110, clientY: 120 });
      fire(el, 'pointermove', { clientX: 118, clientY: 120 }); // exactly 8px
      vi.advanceTimersByTime(600);
      expect(emissions.length).toBe(1);

      setNow(input, 10_000);
      fire(el, 'pointerup', {});
      fire(el, 'pointerdown', { clientX: 110, clientY: 120 });
      fire(el, 'pointermove', { clientX: 119, clientY: 120 }); // 9px > slop
      vi.advanceTimersByTime(600);
      expect(emissions.length).toBe(1);
    });

    it('moving past slop and back does not re-arm', () => {
      fire(el, 'pointerdown', { clientX: 110, clientY: 120 });
      fire(el, 'pointermove', { clientX: 200, clientY: 120 });
      fire(el, 'pointermove', { clientX: 110, clientY: 120 });
      vi.advanceTimersByTime(600);
      expect(emissions.length).toBe(0);
    });

    it('pointerup before the delay cancels', () => {
      fire(el, 'pointerdown', { clientX: 110, clientY: 120 });
      vi.advanceTimersByTime(400);
      fire(el, 'pointerup', {});
      vi.advanceTimersByTime(600);
      expect(emissions.length).toBe(0);
    });

    it('pointercancel and pointerleave cancel', () => {
      fire(el, 'pointerdown', { clientX: 110, clientY: 120 });
      fire(el, 'pointercancel', {});
      vi.advanceTimersByTime(600);
      expect(emissions.length).toBe(0);

      fire(el, 'pointerdown', { clientX: 110, clientY: 120 });
      fire(el, 'pointerleave', { clientX: 110, clientY: 120 });
      vi.advanceTimersByTime(600);
      expect(emissions.length).toBe(0);
    });

    it('a second pointer cancels (two-finger navigation), and a later fresh press arms again', () => {
      fire(el, 'pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 110, clientY: 120 });
      fire(el, 'pointerdown', { pointerType: 'touch', pointerId: 2, clientX: 210, clientY: 120 });
      vi.advanceTimersByTime(600);
      expect(emissions.length).toBe(0);

      // The second finger must not arm its own press either.
      fire(el, 'pointerup', { pointerType: 'touch', pointerId: 1 });
      vi.advanceTimersByTime(600);
      expect(emissions.length).toBe(0);

      fire(el, 'pointerup', { pointerType: 'touch', pointerId: 2 });
      fire(el, 'pointerdown', { pointerType: 'touch', pointerId: 3, clientX: 110, clientY: 120 });
      vi.advanceTimersByTime(600);
      expect(emissions.length).toBe(1);
    });

    it('non-primary mouse buttons do not arm a press', () => {
      fire(el, 'pointerdown', { button: 2, clientX: 110, clientY: 120 });
      vi.advanceTimersByTime(600);
      expect(emissions.length).toBe(0);
    });
  });

  describe('rate limiting', () => {
    it('shares minIntervalMs across long-press and programmatic paths', () => {
      fire(el, 'pointerdown', { clientX: 110, clientY: 120 });
      vi.advanceTimersByTime(600);
      expect(emissions.length).toBe(1);

      setNow(input, 100); // 100ms after the long-press fire
      expect(input.pingAt({ x: 5, y: 5 })).toBe(false);
      expect(emissions.length).toBe(1);

      setNow(input, 300);
      expect(input.pingAt({ x: 5, y: 5 })).toBe(true);
      expect(emissions.length).toBe(2);
    });

    it('a rate-limited long-press fire is dropped entirely', () => {
      expect(input.pingAt({ x: 0, y: 0 })).toBe(true);
      fire(el, 'pointerdown', { clientX: 110, clientY: 120 });
      vi.advanceTimersByTime(600); // now() still 0 → within the 300ms window
      expect(emissions.length).toBe(1);
    });
  });

  describe('shouldPing veto', () => {
    it('suppresses emission and does not consume the rate limit', () => {
      let allow = false;
      input.dispose();
      input = make({ longPressEnabled: true, shouldPing: () => allow });
      setNow(input, 0);

      fire(el, 'pointerdown', { clientX: 110, clientY: 120 });
      vi.advanceTimersByTime(600);
      expect(emissions.length).toBe(0);

      allow = true;
      expect(input.pingAt({ x: 1, y: 2 })).toBe(true); // veto did not start the interval
      expect(emissions.length).toBe(1);
    });
  });

  describe('keyboard/programmatic paths', () => {
    it('pingAt emits a world-space ping with the current style', () => {
      expect(input.pingAt({ x: 7, y: 9 })).toBe(true);
      expect(emissions).toEqual([{ x: 7, y: 9, color: '#ff3b30', durationMs: 1800, radius: 48 }]);
    });

    it('pingAtPointer pings the last hovered position, converted at call time', () => {
      fire(el, 'pointermove', { clientX: 60, clientY: 70 }); // local (50, 50)
      camera.moveTo(100, 0); // camera moves after the hover
      expect(input.pingAtPointer()).toBe(true);
      expect(emissions[0]).toMatchObject({ x: -50, y: 50 });
    });

    it('pointerdown also tracks the pointer position for pingAtPointer', () => {
      fire(el, 'pointerdown', { pointerType: 'touch', clientX: 40, clientY: 50 }); // local (30, 30)
      fire(el, 'pointerup', { pointerType: 'touch' });
      setNow(input, 10_000);
      expect(input.pingAtPointer()).toBe(true);
      expect(emissions[0]).toMatchObject({ x: 30, y: 30 });
    });

    it('pingAtPointer without any hover history is a no-op returning false', () => {
      expect(input.pingAtPointer()).toBe(false);
      expect(emissions.length).toBe(0);
    });
  });

  describe('passivity', () => {
    it('registers all pointer listeners as passive', () => {
      const target = makeElement();
      const spy = vi.spyOn(target, 'addEventListener');
      const passiveInput = new PingInput(target, camera);
      expect(spy.mock.calls.length).toBeGreaterThan(0);
      for (const call of spy.mock.calls) {
        expect(call[2]).toMatchObject({ passive: true });
      }
      passiveInput.dispose();
      target.remove();
    });

    it('never calls preventDefault or stopPropagation on any event', () => {
      const events = [
        fire(el, 'pointerdown', { clientX: 110, clientY: 120 }),
        fire(el, 'pointermove', { clientX: 111, clientY: 120 }),
      ];
      vi.advanceTimersByTime(600);
      events.push(fire(el, 'pointerup', {}));
      expect(emissions.length).toBe(1);
      for (const event of events) {
        expect(event.defaultPrevented).toBe(false);
      }
    });
  });

  describe('options and lifecycle', () => {
    it('exposes defaults through getOptions', () => {
      input.dispose();
      input = make();
      expect(input.getOptions()).toEqual({
        longPressEnabled: false,
        longPressMs: 600,
        slopPx: 8,
        color: '#ff3b30',
        durationMs: 1800,
        radius: 48,
        minIntervalMs: 300,
      });
    });

    it('setOptions updates values and notifies listeners', () => {
      const cb = vi.fn();
      input.onOptionsChange(cb);
      input.setOptions({ longPressMs: 400, slopPx: 12, color: '#123456', minIntervalMs: 50 });
      expect(cb).toHaveBeenCalledTimes(1);
      expect(input.getOptions()).toMatchObject({
        longPressMs: 400,
        slopPx: 12,
        color: '#123456',
        minIntervalMs: 50,
      });
      fire(el, 'pointerdown', { clientX: 110, clientY: 120 });
      vi.advanceTimersByTime(400);
      expect(emissions.length).toBe(1);
      expect(emissions[0]).toMatchObject({ color: '#123456' });
    });

    it('a throwing onPing listener is isolated from other listeners', () => {
      input.dispose();
      input = new PingInput(el, camera);
      setNow(input, 0);
      input.onPing(() => {
        throw new Error('boom');
      });
      input.onPing((e) => emissions.push(e));
      expect(input.pingAt({ x: 0, y: 0 })).toBe(true);
      expect(emissions.length).toBe(1);
    });

    it('unsubscribe stops delivery', () => {
      const extra: PingEmission[] = [];
      const unsubscribe = input.onPing((e) => extra.push(e));
      unsubscribe();
      input.pingAt({ x: 0, y: 0 });
      expect(extra.length).toBe(0);
      expect(emissions.length).toBe(1);
    });

    it('dispose removes DOM listeners and cancels a pending press; it is idempotent', () => {
      const removeSpy = vi.spyOn(el, 'removeEventListener');
      fire(el, 'pointerdown', { clientX: 110, clientY: 120 });
      input.dispose();
      vi.advanceTimersByTime(600);
      expect(emissions.length).toBe(0);
      expect(removeSpy.mock.calls.length).toBeGreaterThan(0);

      fire(el, 'pointerdown', { clientX: 110, clientY: 120 });
      vi.advanceTimersByTime(600);
      expect(emissions.length).toBe(0);

      const callsAfterFirst = removeSpy.mock.calls.length;
      input.dispose();
      expect(removeSpy.mock.calls.length).toBe(callsAfterFirst);
    });
  });
});
