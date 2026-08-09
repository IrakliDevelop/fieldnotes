// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ElementActivation } from './element-activation';
import type { ActivationOptions, ElementActivationEvent } from './element-activation';
import { Camera } from './camera';
import { ElementStore } from '../elements/element-store';
import { HtmlPainterRegistry, resolveHtmlRouting } from './html-painter-registry';
import { createHtmlElement, createNote, createText } from '../elements/element-factory';
import type { CanvasElement, HtmlElement } from '../elements/types';
import { Viewport } from './viewport';

/**
 * The wrapper sits at a non-zero client offset so any handler that forgets to
 * convert client -> element-local coordinates misses every marker.
 */
const WRAPPER_LEFT = 10;
const WRAPPER_TOP = 20;

const MARKER_TYPE = 'marker';
const DOM_TYPE = 'plain-embed';
const MISSING_TYPE = 'declared-but-unpainted';

const VISIBLE_LAYER = 'layer-visible';
const HIDDEN_LAYER = 'layer-hidden';

/** Screen point (element-local) -> client point on the stubbed wrapper. */
function clientOf(local: { x: number; y: number }): { x: number; y: number } {
  return { x: local.x + WRAPPER_LEFT, y: local.y + WRAPPER_TOP };
}

interface Harness {
  wrapper: HTMLDivElement;
  camera: Camera;
  store: ElementStore;
  registry: HtmlPainterRegistry;
  controller: ElementActivation;
  events: ElementActivationEvent[];
  hiddenLayers: Set<string>;
  busy: { value: boolean };
  activatable: { predicate: ((el: Readonly<CanvasElement>) => boolean) | null };
  dispose: () => void;
}

interface HarnessOptions extends Partial<ActivationOptions> {
  /** Extra viewport-owned busy signal, mirroring the viewport's inertia gate. */
  hostBusy?: () => boolean;
}

interface AddRecord {
  type: string;
  options: AddEventListenerOptions | boolean | undefined;
}

/**
 * Records every `addEventListener` call on `target` (type and options) while
 * still registering it for real. Patched directly rather than via `vi.spyOn`
 * because both `HTMLElement` and `Window` declare overloaded, event-map-typed
 * signatures that a mock implementation cannot satisfy without `any`.
 */
function recordAdds(target: EventTarget, sink: AddRecord[]): () => void {
  const original = target.addEventListener.bind(target);
  target.addEventListener = (type, listener, options): void => {
    sink.push({ type, options });
    original(type, listener, options);
  };
  return () => {
    target.addEventListener = original;
  };
}

function recordRemovals(target: EventTarget, sink: string[]): () => void {
  const original = target.removeEventListener.bind(target);
  target.removeEventListener = (type, listener, options): void => {
    sink.push(type);
    original(type, listener, options);
  };
  return () => {
    target.removeEventListener = original;
  };
}

function makeWrapper(): HTMLDivElement {
  const el = document.createElement('div');
  el.getBoundingClientRect = (): DOMRect =>
    ({
      left: WRAPPER_LEFT,
      top: WRAPPER_TOP,
      right: WRAPPER_LEFT + 800,
      bottom: WRAPPER_TOP + 600,
      width: 800,
      height: 600,
      x: WRAPPER_LEFT,
      y: WRAPPER_TOP,
    }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

function createHarness(options: HarnessOptions = {}): Harness {
  const wrapper = makeWrapper();
  const camera = new Camera();
  const store = new ElementStore();
  const registry = new HtmlPainterRegistry();
  registry.register(MARKER_TYPE, () => {
    /* painting is irrelevant here; presence is what makes routing 'canvas' */
  });
  registry.expect([MISSING_TYPE]); // declared, never painted -> routing 'missing'

  const hiddenLayers = new Set<string>([HIDDEN_LAYER]);
  const busy = { value: false };
  const activatable: Harness['activatable'] = { predicate: null };

  const { hostBusy, ...activation } = options;
  const controller = new ElementActivation(
    {
      element: wrapper,
      camera,
      store,
      resolveHtmlRouting: (el: Readonly<HtmlElement>) => resolveHtmlRouting(el, registry),
      isLayerVisible: (layerId: string) => !hiddenLayers.has(layerId),
      ...(hostBusy ? { isCameraBusy: hostBusy } : {}),
    },
    {
      gesture: activation.gesture ?? 'single',
      ...activation,
      isCameraBusy: () => busy.value,
      isActivatable: (el) => (activatable.predicate ? activatable.predicate(el) : true),
    },
  );

  const events: ElementActivationEvent[] = [];
  controller.onActivate((e) => events.push(e));

  return {
    wrapper,
    camera,
    store,
    registry,
    controller,
    events,
    hiddenLayers,
    busy,
    activatable,
    dispose: () => {
      controller.dispose();
      wrapper.remove();
    },
  };
}

let markerSeq = 0;
function addMarker(
  store: ElementStore,
  world: { x: number; y: number },
  overrides: Partial<HtmlElement> = {},
): HtmlElement {
  const el: HtmlElement = {
    ...createHtmlElement({
      position: world,
      size: { w: 40, h: 40 },
      htmlType: MARKER_TYPE,
      layerId: VISIBLE_LAYER,
    }),
    ...overrides,
    id: overrides.id ?? `marker-${++markerSeq}`,
  };
  store.add(el);
  return el;
}

/** Centre of a 40x40 marker placed at `world`, in client coordinates. */
function centreClient(world: { x: number; y: number }): { x: number; y: number } {
  return clientOf({ x: world.x + 20, y: world.y + 20 });
}

function fire(
  target: EventTarget,
  type: string,
  client: { x: number; y: number },
  init: PointerEventInit = {},
): PointerEvent {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    buttons: 1,
    clientX: client.x,
    clientY: client.y,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

function tap(
  target: EventTarget,
  client: { x: number; y: number },
  init: PointerEventInit = {},
): void {
  fire(target, 'pointerdown', client, init);
  fire(target, 'pointerup', client, { ...init, buttons: 0 });
}

const POINTER_TYPES = ['mouse', 'touch', 'pen'] as const;

const MARKER_A_WORLD = { x: 100, y: 100 };
const MARKER_B_WORLD = { x: 200, y: 100 };

describe('ElementActivation', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  describe.each(POINTER_TYPES)('pointerType "%s"', (pointerType) => {
    const init: PointerEventInit = { pointerType };

    it('fires on a single tap when gesture is single', () => {
      const h = createHarness({ gesture: 'single' });
      const marker = addMarker(h.store, MARKER_A_WORLD);

      tap(h.wrapper, centreClient(MARKER_A_WORLD), init);

      expect(h.events).toHaveLength(1);
      const event = h.events[0];
      expect(event?.gesture).toBe('single');
      expect(event?.element.id).toBe(marker.id);
      expect(event?.pointerType).toBe(pointerType);
      // world is the pointerup location converted through the pointerup camera.
      expect(event?.world).toEqual({ x: 120, y: 120 });
      h.dispose();
    });

    it('does not fire on a single tap when gesture is double', () => {
      const h = createHarness({ gesture: 'double' });
      addMarker(h.store, MARKER_A_WORLD);
      const centre = centreClient(MARKER_A_WORLD);

      // Positive control first: two taps DO produce exactly one double event.
      tap(h.wrapper, centre, init);
      tap(h.wrapper, centre, init);
      expect(h.events.map((e) => e.gesture)).toEqual(['double']);

      // Now the case under test: one lone tap must produce nothing.
      h.events.length = 0;
      tap(h.wrapper, centre, init);
      expect(h.events).toEqual([]);
      h.dispose();
    });

    it('fires once on a double tap on the SAME element', () => {
      const h = createHarness({ gesture: 'double' });
      const marker = addMarker(h.store, MARKER_A_WORLD);
      const centre = centreClient(MARKER_A_WORLD);

      tap(h.wrapper, centre, init);
      expect(h.events).toEqual([]); // first half must not fire
      tap(h.wrapper, centre, init);

      expect(h.events).toHaveLength(1);
      expect(h.events[0]?.gesture).toBe('double');
      expect(h.events[0]?.element.id).toBe(marker.id);
      expect(h.events[0]?.pointerType).toBe(pointerType);

      // A third tap starts a fresh pending record rather than re-firing.
      tap(h.wrapper, centre, init);
      expect(h.events).toHaveLength(1);
      h.dispose();
    });

    it('does not fuse taps on two adjacent markers into a double', () => {
      const h = createHarness({ gesture: 'double', slopPx: 400 });
      const a = addMarker(h.store, MARKER_A_WORLD);
      const b = addMarker(h.store, MARKER_B_WORLD);
      const centreA = centreClient(MARKER_A_WORLD);
      const centreB = centreClient(MARKER_B_WORLD);

      // Positive control: two taps on A pair into a double.
      tap(h.wrapper, centreA, init);
      tap(h.wrapper, centreA, init);
      expect(h.events).toHaveLength(1);
      expect(h.events[0]?.element.id).toBe(a.id);

      // Case under test: A then B must not fuse, even though both taps are
      // valid single taps within the double delay.
      h.events.length = 0;
      tap(h.wrapper, centreA, init);
      tap(h.wrapper, centreB, init);
      expect(h.events).toEqual([]);

      // ...and the B tap became the new pending half, so B pairs with itself.
      tap(h.wrapper, centreB, init);
      expect(h.events).toHaveLength(1);
      expect(h.events[0]?.element.id).toBe(b.id);
      h.dispose();
    });

    it('requires pointerup to hit the same element as pointerdown', () => {
      // slop is deliberately huge so element identity, not travel, is the gate.
      const h = createHarness({ gesture: 'single', slopPx: 400 });
      const a = addMarker(h.store, MARKER_A_WORLD);
      addMarker(h.store, MARKER_B_WORLD);
      const centreA = centreClient(MARKER_A_WORLD);
      const centreB = centreClient(MARKER_B_WORLD);

      // Positive control: down and up on A fires for A.
      fire(h.wrapper, 'pointerdown', centreA, init);
      fire(h.wrapper, 'pointermove', centreA, init);
      fire(h.wrapper, 'pointerup', centreA, init);
      expect(h.events).toHaveLength(1);
      expect(h.events[0]?.element.id).toBe(a.id);

      // Case under test: press A, release over B.
      h.events.length = 0;
      fire(h.wrapper, 'pointerdown', centreA, init);
      fire(h.wrapper, 'pointermove', centreB, init);
      fire(h.wrapper, 'pointerup', centreB, init);
      expect(h.events).toEqual([]);
      h.dispose();
    });

    it('does not fire when the pointer moved beyond slopPx', () => {
      const h = createHarness({ gesture: 'single', slopPx: 8 });
      // A large marker so a 40px drag still lands inside the SAME element:
      // travel, not identity, must be what suppresses this.
      const marker = addMarker(h.store, { x: 0, y: 0 }, { size: { w: 400, h: 400 } });
      const from = clientOf({ x: 100, y: 100 });
      const near = clientOf({ x: 104, y: 100 });
      const far = clientOf({ x: 140, y: 100 });

      // Positive control: movement within slop still activates.
      fire(h.wrapper, 'pointerdown', from, init);
      fire(h.wrapper, 'pointermove', near, init);
      fire(h.wrapper, 'pointerup', near, init);
      expect(h.events).toHaveLength(1);
      expect(h.events[0]?.element.id).toBe(marker.id);

      h.events.length = 0;
      fire(h.wrapper, 'pointerdown', from, init);
      fire(h.wrapper, 'pointermove', far, init);
      fire(h.wrapper, 'pointerup', far, init);
      expect(h.events).toEqual([]);

      // Travel must also be rejected at pointerup with NO intervening
      // pointermove: browsers coalesce and may drop moves, so the release
      // position cannot be trusted to have been announced.
      fire(h.wrapper, 'pointerdown', from, init);
      fire(h.wrapper, 'pointerup', far, init);
      expect(h.events).toEqual([]);

      // A drag that wanders past slop and comes back stays dead: slop governs
      // the whole gesture, not merely the release position.
      fire(h.wrapper, 'pointerdown', from, init);
      fire(h.wrapper, 'pointermove', far, init);
      fire(h.wrapper, 'pointermove', from, init);
      fire(h.wrapper, 'pointerup', from, init);
      expect(h.events).toEqual([]);
      h.dispose();
    });

    it('does not fire when a second pointer went down', () => {
      const h = createHarness({ gesture: 'single' });
      addMarker(h.store, MARKER_A_WORLD);
      const centre = centreClient(MARKER_A_WORLD);

      // Positive control with the same pointerId.
      tap(h.wrapper, centre, { ...init, pointerId: 7 });
      expect(h.events).toHaveLength(1);

      h.events.length = 0;
      fire(h.wrapper, 'pointerdown', centre, { ...init, pointerId: 7 });
      fire(h.wrapper, 'pointerdown', centre, { ...init, pointerId: 8 });
      fire(h.wrapper, 'pointerup', centre, { ...init, pointerId: 7 });
      fire(h.wrapper, 'pointerup', centre, { ...init, pointerId: 8 });
      expect(h.events).toEqual([]);

      // A THIRD pointer arriving while two are still down must not arm a
      // gesture either: the multi-pointer path must not forget the pointers
      // it already saw.
      fire(h.wrapper, 'pointerdown', centre, { ...init, pointerId: 7 });
      fire(h.wrapper, 'pointerdown', centre, { ...init, pointerId: 8 });
      fire(h.wrapper, 'pointerdown', centre, { ...init, pointerId: 9 });
      fire(h.wrapper, 'pointerup', centre, { ...init, pointerId: 9 });
      expect(h.events).toEqual([]);
      h.dispose();
    });

    it('does not fire after pointercancel', () => {
      const h = createHarness({ gesture: 'single' });
      addMarker(h.store, MARKER_A_WORLD);
      const centre = centreClient(MARKER_A_WORLD);

      tap(h.wrapper, centre, init);
      expect(h.events).toHaveLength(1);

      h.events.length = 0;
      fire(h.wrapper, 'pointerdown', centre, init);
      fire(h.wrapper, 'pointercancel', centre, init);
      fire(h.wrapper, 'pointerup', centre, init);
      expect(h.events).toEqual([]);
      h.dispose();
    });

    it('does not fire when the camera revision changed during the gesture', () => {
      const h = createHarness({ gesture: 'single' });
      addMarker(h.store, MARKER_A_WORLD);
      const centre = centreClient(MARKER_A_WORLD);

      tap(h.wrapper, centre, init);
      expect(h.events).toHaveLength(1);

      // A camera change between down and up invalidates the gesture. The pan is
      // 0.0001px so the marker is still under the pointer at pointerup: only the
      // revision counter can reject this.
      h.events.length = 0;
      fire(h.wrapper, 'pointerdown', centre, init);
      h.camera.pan(0.0001, 0);
      fire(h.wrapper, 'pointerup', centre, init);
      expect(h.events).toEqual([]);

      // A camera change BEFORE the next gesture is harmless.
      h.camera.pan(-0.0001, 0);
      tap(h.wrapper, centre, init);
      expect(h.events).toHaveLength(1);
      h.dispose();
    });

    it('does not fire when isCameraBusy() is true at pointerdown or pointerup', () => {
      const h = createHarness({ gesture: 'single' });
      addMarker(h.store, MARKER_A_WORLD);
      const centre = centreClient(MARKER_A_WORLD);

      tap(h.wrapper, centre, init);
      expect(h.events).toHaveLength(1);

      // Busy at pointerdown.
      h.events.length = 0;
      h.busy.value = true;
      fire(h.wrapper, 'pointerdown', centre, init);
      h.busy.value = false;
      fire(h.wrapper, 'pointerup', centre, init);
      expect(h.events).toEqual([]);

      // Busy at pointerup.
      fire(h.wrapper, 'pointerdown', centre, init);
      h.busy.value = true;
      fire(h.wrapper, 'pointerup', centre, init);
      expect(h.events).toEqual([]);
      h.busy.value = false;
      h.dispose();
    });

    it('activates a marker on a locked layer but not on a hidden layer', () => {
      const vp = createViewportHarness({ gesture: 'single' });
      const layer = vp.viewport.layerManager.createLayer('markers');
      // Element-level lock too: neither lock flavour may block a read gesture.
      const marker = addMarker(vp.viewport.store, MARKER_A_WORLD, {
        layerId: layer.id,
        locked: true,
      });
      const centre = { x: MARKER_A_WORLD.x + 20, y: MARKER_A_WORLD.y + 20 };

      vp.viewport.layerManager.setLayerLocked(layer.id, true);
      expect(vp.viewport.layerManager.isLayerLocked(layer.id)).toBe(true);
      tap(vp.wrapper, centre, init);
      expect(vp.events).toHaveLength(1);
      expect(vp.events[0]?.element.id).toBe(marker.id);

      vp.events.length = 0;
      vp.viewport.layerManager.setLayerVisible(layer.id, false);
      tap(vp.wrapper, centre, init);
      expect(vp.events).toEqual([]);

      // Restoring visibility restores activation, so the layer flag is what moved.
      vp.viewport.layerManager.setLayerVisible(layer.id, true);
      tap(vp.wrapper, centre, init);
      expect(vp.events).toHaveLength(1);
      vp.dispose();
    });

    it('clears state when the pointer is released outside the wrapper', () => {
      const h = createHarness({ gesture: 'single' });
      addMarker(h.store, MARKER_A_WORLD);
      const centre = centreClient(MARKER_A_WORLD);
      const outside = document.createElement('div');
      document.body.appendChild(outside);

      tap(h.wrapper, centre, init);
      expect(h.events).toHaveLength(1);

      h.events.length = 0;
      fire(h.wrapper, 'pointerdown', centre, init);
      fire(outside, 'pointerup', centre, init);
      expect(h.events).toEqual([]);

      // The active record is gone: a later wrapper pointerup with no matching
      // pointerdown must not resurrect the gesture.
      fire(h.wrapper, 'pointerup', centre, init);
      expect(h.events).toEqual([]);
      h.dispose();
    });
  });

  it('rejects non-primary buttons', () => {
    const h = createHarness({ gesture: 'single' });
    addMarker(h.store, MARKER_A_WORLD);
    const centre = centreClient(MARKER_A_WORLD);

    tap(h.wrapper, centre, { button: 0 });
    expect(h.events).toHaveLength(1);

    h.events.length = 0;
    tap(h.wrapper, centre, { button: 2, buttons: 2 });
    tap(h.wrapper, centre, { button: 1, buttons: 4 });
    expect(h.events).toEqual([]);
    h.dispose();
  });

  it('rejects note, text, and dom-routed html elements', () => {
    const h = createHarness({ gesture: 'single' });
    const marker = addMarker(h.store, MARKER_A_WORLD);
    const note = createNote({ position: { x: 300, y: 100 }, size: { w: 40, h: 40 } });
    const text = createText({ position: { x: 400, y: 100 }, size: { w: 40, h: 40 } });
    const domEmbed = createHtmlElement({
      position: { x: 500, y: 100 },
      size: { w: 40, h: 40 },
      htmlType: DOM_TYPE,
    });
    const unpainted = createHtmlElement({
      position: { x: 600, y: 100 },
      size: { w: 40, h: 40 },
      htmlType: MISSING_TYPE,
    });
    for (const el of [note, text, domEmbed, unpainted]) h.store.add(el);

    // Positive control: the canvas-routed marker activates through this harness.
    tap(h.wrapper, centreClient(MARKER_A_WORLD), {});
    expect(h.events).toHaveLength(1);
    expect(h.events[0]?.element.id).toBe(marker.id);

    h.events.length = 0;
    for (const el of [note, text, domEmbed, unpainted]) {
      tap(h.wrapper, centreClient(el.position), {});
    }
    expect(h.events).toEqual([]);

    // Registering a painter flips the 'missing' embed to canvas routing, which
    // proves the taps above were landing on those elements.
    h.registry.register(MISSING_TYPE, () => {
      /* now paintable */
    });
    tap(h.wrapper, centreClient(unpainted.position), {});
    expect(h.events).toHaveLength(1);
    expect(h.events[0]?.element.id).toBe(unpainted.id);
    h.dispose();
  });

  it('suppresses on the owner-supplied isCameraBusy dep as well as the host option', () => {
    // Two independent busy signals: the owner (viewport) may pass its own, and
    // the host composes another through options. Either one suppresses.
    let ownerBusy = false;
    const h = createHarness({ gesture: 'single', hostBusy: () => ownerBusy });
    addMarker(h.store, MARKER_A_WORLD);
    const centre = centreClient(MARKER_A_WORLD);

    tap(h.wrapper, centre, {});
    expect(h.events).toHaveLength(1);

    h.events.length = 0;
    ownerBusy = true;
    tap(h.wrapper, centre, {});
    expect(h.events).toEqual([]);

    ownerBusy = false;
    tap(h.wrapper, centre, {});
    expect(h.events).toHaveLength(1);
    h.dispose();
  });

  it('rejects an element failing isActivatable', () => {
    const h = createHarness({ gesture: 'single' });
    const a = addMarker(h.store, MARKER_A_WORLD);
    const b = addMarker(h.store, MARKER_B_WORLD);

    tap(h.wrapper, centreClient(MARKER_A_WORLD), {});
    tap(h.wrapper, centreClient(MARKER_B_WORLD), {});
    expect(h.events.map((e) => e.element.id)).toEqual([a.id, b.id]);

    h.events.length = 0;
    h.activatable.predicate = (el) => el.id === b.id;
    tap(h.wrapper, centreClient(MARKER_A_WORLD), {});
    expect(h.events).toEqual([]);
    tap(h.wrapper, centreClient(MARKER_B_WORLD), {});
    expect(h.events.map((e) => e.element.id)).toEqual([b.id]);
    h.dispose();
  });

  it('pairs an empty-string pointerType with itself and never with a different type', () => {
    const h = createHarness({ gesture: 'double' });
    addMarker(h.store, MARKER_A_WORLD);
    const centre = centreClient(MARKER_A_WORLD);

    // An unknown device pairs with itself.
    tap(h.wrapper, centre, { pointerType: '' });
    tap(h.wrapper, centre, { pointerType: '' });
    expect(h.events).toHaveLength(1);
    expect(h.events[0]?.gesture).toBe('double');
    expect(h.events[0]?.pointerType).toBe('');

    // It never pairs with a different type.
    h.events.length = 0;
    tap(h.wrapper, centre, { pointerType: '' });
    tap(h.wrapper, centre, { pointerType: 'mouse' });
    expect(h.events).toEqual([]);

    // The mouse tap became the pending half and pairs with a mouse tap.
    tap(h.wrapper, centre, { pointerType: 'mouse' });
    expect(h.events).toHaveLength(1);
    expect(h.events[0]?.pointerType).toBe('mouse');

    // A vendor-defined string behaves the same way.
    h.events.length = 0;
    tap(h.wrapper, centre, { pointerType: 'vendor-wand' });
    tap(h.wrapper, centre, { pointerType: 'vendor-wand' });
    expect(h.events).toHaveLength(1);
    expect(h.events[0]?.pointerType).toBe('vendor-wand');
    h.dispose();
  });

  it('clears pending state on blur and visibilitychange', () => {
    for (const clear of [
      () => window.dispatchEvent(new Event('blur')),
      () => document.dispatchEvent(new Event('visibilitychange', { bubbles: true })),
    ]) {
      const h = createHarness({ gesture: 'double' });
      addMarker(h.store, MARKER_A_WORLD);
      const centre = centreClient(MARKER_A_WORLD);

      // Positive control: without the interruption the two taps pair.
      tap(h.wrapper, centre, {});
      tap(h.wrapper, centre, {});
      expect(h.events).toHaveLength(1);

      h.events.length = 0;
      tap(h.wrapper, centre, {});
      clear();
      tap(h.wrapper, centre, {});
      expect(h.events).toEqual([]);

      // Pending was re-armed by that second tap, so the next tap pairs again.
      tap(h.wrapper, centre, {});
      expect(h.events).toHaveLength(1);
      h.dispose();
    }
  });

  it('drops pending state when the element is removed between taps', () => {
    const h = createHarness({ gesture: 'double' });
    const first = addMarker(h.store, MARKER_A_WORLD);
    const centre = centreClient(MARKER_A_WORLD);

    tap(h.wrapper, centre, {});
    tap(h.wrapper, centre, {});
    expect(h.events).toHaveLength(1);

    // Delete-then-undo restores the SAME id, so identity comparison alone
    // cannot notice: the pending half must be dropped when the element goes.
    h.events.length = 0;
    tap(h.wrapper, centre, {});
    h.store.remove(first.id);
    h.store.add(first);
    tap(h.wrapper, centre, {});
    expect(h.events).toEqual([]);

    // Replacing it with a different marker at the same place is likewise no pair.
    // (An empty-space tap first, so the previous leg's trailing half cannot pair.)
    h.events.length = 0;
    tap(h.wrapper, clientOf({ x: 700, y: 500 }), {});
    tap(h.wrapper, centre, {});
    h.store.remove(first.id);
    const replacement = addMarker(h.store, MARKER_A_WORLD);
    tap(h.wrapper, centre, {});
    expect(h.events).toEqual([]);

    tap(h.wrapper, centre, {});
    expect(h.events).toHaveLength(1);
    expect(h.events[0]?.element.id).toBe(replacement.id);
    h.dispose();
  });

  it('drops pending state when setActivation is changed or disabled', () => {
    const vp = createViewportHarness({ gesture: 'double' });
    addMarker(vp.viewport.store, MARKER_A_WORLD);
    const centre = { x: MARKER_A_WORLD.x + 20, y: MARKER_A_WORLD.y + 20 };

    tap(vp.wrapper, centre);
    tap(vp.wrapper, centre);
    expect(vp.events).toHaveLength(1);

    // Replacing the options resets the half-finished gesture.
    vp.events.length = 0;
    tap(vp.wrapper, centre);
    vp.viewport.setActivation({ gesture: 'double' });
    tap(vp.wrapper, centre);
    expect(vp.events).toEqual([]);
    tap(vp.wrapper, centre);
    expect(vp.events).toHaveLength(1);

    // Disabling stops activation entirely.
    vp.events.length = 0;
    tap(vp.wrapper, centre);
    vp.viewport.setActivation(null);
    tap(vp.wrapper, centre);
    tap(vp.wrapper, centre);
    expect(vp.events).toEqual([]);
    vp.dispose();
  });

  it('isolates a throwing listener and supports self- and sibling-unsubscribe', () => {
    const h = createHarness({ gesture: 'single' });
    addMarker(h.store, MARKER_A_WORLD);
    const centre = centreClient(MARKER_A_WORLD);

    const order: string[] = [];
    h.controller.onActivate(() => {
      order.push('throwing');
      throw new Error('listener boom');
    });
    const unsubSelf = h.controller.onActivate(() => {
      order.push('self');
      unsubSelf();
    });
    let unsubSibling = (): void => {
      /* replaced below */
    };
    h.controller.onActivate(() => {
      order.push('killer');
      unsubSibling();
    });
    unsubSibling = h.controller.onActivate(() => {
      order.push('sibling');
    });
    h.controller.onActivate(() => {
      order.push('survivor');
    });

    tap(h.wrapper, centre, {});
    // The snapshot means every listener present at emit time runs exactly once,
    // including the one unsubscribed by an earlier sibling mid-emission.
    expect(order).toEqual(['throwing', 'self', 'killer', 'sibling', 'survivor']);
    expect(h.events).toHaveLength(1); // the throw did not stop the harness listener

    order.length = 0;
    tap(h.wrapper, centre, {});
    expect(order).toEqual(['throwing', 'killer', 'survivor']);
    expect(h.events).toHaveLength(2);
    h.dispose();
  });

  it('registers only passive listeners and never calls preventDefault', () => {
    const wrapper = makeWrapper();
    const elementAdds: AddRecord[] = [];
    const windowAdds: AddRecord[] = [];
    const restoreElement = recordAdds(wrapper, elementAdds);
    const restoreWindow = recordAdds(window, windowAdds);

    const camera = new Camera();
    const store = new ElementStore();
    const registry = new HtmlPainterRegistry();
    registry.register(MARKER_TYPE, () => {
      /* canvas routing */
    });
    const controller = new ElementActivation(
      {
        element: wrapper,
        camera,
        store,
        resolveHtmlRouting: (el: Readonly<HtmlElement>) => resolveHtmlRouting(el, registry),
        isLayerVisible: () => true,
      },
      { gesture: 'single' },
    );
    restoreElement();
    restoreWindow();

    const events: ElementActivationEvent[] = [];
    controller.onActivate((e) => events.push(e));
    addMarker(store, MARKER_A_WORLD);

    const allAdds = [...elementAdds, ...windowAdds];
    const pointerAdds = allAdds.filter((add) => add.type.startsWith('pointer'));
    expect(pointerAdds.length).toBeGreaterThanOrEqual(6);
    expect(elementAdds.map((add) => add.type).sort()).toEqual([
      'pointercancel',
      'pointerdown',
      'pointermove',
      'pointerup',
    ]);
    for (const { type, options } of allAdds) {
      expect(
        typeof options === 'object' && options !== null && options.passive === true,
        `${type} must be registered { passive: true }`,
      ).toBe(true);
    }

    const centre = centreClient(MARKER_A_WORLD);
    const dispatched = [
      fire(wrapper, 'pointerdown', centre),
      fire(wrapper, 'pointermove', centre),
      fire(wrapper, 'pointerup', centre),
    ];
    // The sequence really reached the controller...
    expect(events).toHaveLength(1);
    // ...and nothing in it was defaultPrevented.
    for (const event of dispatched) expect(event.defaultPrevented).toBe(false);

    const prevented = vi.fn();
    const event = new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      clientX: centre.x,
      clientY: centre.y,
    });
    Object.defineProperty(event, 'preventDefault', { value: prevented });
    wrapper.dispatchEvent(event);
    expect(prevented).not.toHaveBeenCalled();

    controller.dispose();
    wrapper.remove();
  });

  it('is idempotent on dispose and removes window listeners', () => {
    const h = createHarness({ gesture: 'single' });
    addMarker(h.store, MARKER_A_WORLD);
    const centre = centreClient(MARKER_A_WORLD);

    tap(h.wrapper, centre, {});
    expect(h.events).toHaveLength(1);

    const windowRemovals: string[] = [];
    const restoreRemovals = recordRemovals(window, windowRemovals);

    h.controller.dispose();
    expect(windowRemovals.sort()).toEqual([
      'blur',
      'pointercancel',
      'pointerup',
      'visibilitychange',
    ]);

    // Second dispose is a no-op rather than a throw or a double removal.
    windowRemovals.length = 0;
    expect(() => h.controller.dispose()).not.toThrow();
    expect(windowRemovals).toEqual([]);
    restoreRemovals();

    // Wrapper listeners are gone too.
    h.events.length = 0;
    tap(h.wrapper, centre, {});
    expect(h.events).toEqual([]);

    // Window state-clearing listeners are gone: dispatching them must not throw
    // and must not resurrect anything.
    window.dispatchEvent(new Event('blur'));
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
    expect(h.events).toEqual([]);
    h.dispose();
  });

  it('rejects a non-finite or negative slopPx and a non-positive doubleDelayMs', () => {
    const h = createHarness({ gesture: 'single' });
    const make = (options: Partial<ActivationOptions>): ElementActivation =>
      new ElementActivation(
        {
          element: h.wrapper,
          camera: h.camera,
          store: h.store,
          resolveHtmlRouting: (el: Readonly<HtmlElement>) => resolveHtmlRouting(el, h.registry),
          isLayerVisible: () => true,
        },
        { gesture: 'single', ...options },
      );

    expect(() => make({ slopPx: -1 })).toThrow(RangeError);
    expect(() => make({ slopPx: Number.NaN })).toThrow(RangeError);
    expect(() => make({ slopPx: Number.POSITIVE_INFINITY })).toThrow(RangeError);
    expect(() => make({ doubleDelayMs: 0 })).toThrow(RangeError);
    expect(() => make({ doubleDelayMs: -5 })).toThrow(RangeError);
    expect(() => make({ doubleDelayMs: Number.NaN })).toThrow(RangeError);

    const ok = make({ slopPx: 0, doubleDelayMs: 1 });
    expect(ok).toBeInstanceOf(ElementActivation);
    ok.dispose();
    h.dispose();
  });

  it('expires the pending tap after doubleDelayMs', () => {
    vi.useFakeTimers();
    const h = createHarness({ gesture: 'double', doubleDelayMs: 300 });
    addMarker(h.store, MARKER_A_WORLD);
    const centre = centreClient(MARKER_A_WORLD);

    // Positive control: inside the window the taps pair.
    tap(h.wrapper, centre, {});
    vi.advanceTimersByTime(100);
    tap(h.wrapper, centre, {});
    expect(h.events).toHaveLength(1);

    h.events.length = 0;
    tap(h.wrapper, centre, {});
    vi.advanceTimersByTime(400);
    tap(h.wrapper, centre, {});
    expect(h.events).toEqual([]);
    h.dispose();
  });
});

interface ViewportActivationHarness {
  viewport: Viewport;
  wrapper: HTMLDivElement;
  events: ElementActivationEvent[];
  dispose: () => void;
}

function createViewportHarness(options: ActivationOptions): ViewportActivationHarness {
  const container = document.createElement('div');
  Object.defineProperty(container, 'getBoundingClientRect', {
    value: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }),
  });
  document.body.appendChild(container);
  const viewport = new Viewport(container);
  const wrapper = container.firstElementChild;
  if (!(wrapper instanceof HTMLDivElement)) throw new Error('viewport wrapper not found');
  viewport.registerHtmlPainter(MARKER_TYPE, () => {
    /* canvas routing for markers */
  });
  const events: ElementActivationEvent[] = [];
  viewport.onElementActivate((e) => events.push(e));
  viewport.setActivation(options);
  return {
    viewport,
    wrapper,
    events,
    dispose: () => {
      viewport.destroy();
      container.remove();
    },
  };
}
