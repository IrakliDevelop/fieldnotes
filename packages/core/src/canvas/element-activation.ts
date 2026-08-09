import type { Camera } from './camera';
import type { ElementStore } from '../elements/element-store';
import type { CanvasElement, HtmlElement } from '../elements/types';
import type { Point } from '../core/types';
import type { HtmlRouting } from './html-painter-registry';
import type { ToolContext } from '../tools/types';
import { hitTest } from '../tools/select-hit';

export interface ElementActivationEvent {
  element: Readonly<CanvasElement>;
  /** Pointerup location converted through the pointerup camera snapshot. */
  world: Point;
  /**
   * Raw `PointerEvent.pointerType`. Usually `'mouse' | 'touch' | 'pen'`, but the
   * spec permits vendor-defined and empty strings, so this is NOT narrowed and
   * NOT normalised.
   */
  pointerType: string;
  gesture: 'single' | 'double';
}

export interface ActivationOptions {
  gesture: 'single' | 'double';
  /** Additional host filter, applied on top of the core canvas-routing gate. */
  isActivatable?: (el: Readonly<CanvasElement>) => boolean;
  /** Host-owned camera animators the viewport cannot see. */
  isCameraBusy?: () => boolean;
  /** Maximum pointer travel between down and up. Default `8` (PingInput parity). */
  slopPx?: number;
  /** Maximum gap between the halves of a double tap. Default `300`. */
  doubleDelayMs?: number;
}

export interface ElementActivationDeps {
  /** The viewport wrapper. Activation may only fire from a pointerup on it. */
  element: HTMLElement;
  camera: Camera;
  store: ElementStore;
  resolveHtmlRouting: (el: Readonly<HtmlElement>) => HtmlRouting;
  isLayerVisible: (layerId: string) => boolean;
  /** Owner-side busy signal, OR-ed with the host's `options.isCameraBusy`. */
  isCameraBusy?: () => boolean;
}

export const DEFAULT_ACTIVATION_SLOP_PX = 8;
export const DEFAULT_ACTIVATION_DOUBLE_DELAY_MS = 300;

interface ActivePointer {
  pointerId: number;
  pointerType: string;
  /** Client-space pointerdown position; slop is measured against this. */
  clientPoint: Point;
  elementId: string;
  cameraRevision: number;
}

interface PendingTap {
  elementId: string;
  pointerType: string;
  /**
   * Where the first half landed. Recorded because the contract specifies this
   * record shape, but deliberately NOT compared: pairing is decided by element
   * identity, which is strictly stronger than screen distance (that is exactly
   * what lets two adjacent markers fuse in the shared `DoubleTapDetector`).
   */
  clientPoint: Point;
  time: number;
}

const PASSIVE: AddEventListenerOptions = { passive: true };

function noop(): void {
  // Hit-testing never renders.
}

/**
 * Turns a gesture on a canvas-painted element into a typed activation event.
 *
 * Canvas-painted elements are not DOM nodes, so they cannot receive DOM events.
 * This controller is the bridge: it hit-tests pointer gestures against the
 * element store and emits `ElementActivationEvent` for the ones a host declared
 * activatable.
 *
 * Like `PingInput`, it is a **passive observer by contract**: every listener is
 * registered `{ passive: true }` and it never calls `preventDefault`,
 * `stopPropagation`, or takes pointer capture, so native scroll/zoom, the active
 * tool, panning and pinch navigation behave exactly as if it were absent.
 *
 * Recognition is **element-aware**: the shared `DoubleTapDetector` compares only
 * time and screen distance, so two adjacent markers could fuse into one double
 * tap. This controller keeps its own pending record and pairs a second tap only
 * when it resolves to the same element id and the same `pointerType`.
 */
export class ElementActivation {
  private readonly deps: ElementActivationDeps;
  private readonly options: ActivationOptions;
  private readonly slopPx: number;
  private readonly doubleDelayMs: number;
  private readonly hitContext: ToolContext;

  private active: ActivePointer | null = null;
  private pending: PendingTap | null = null;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly downPointers = new Set<number>();
  private cameraRevision = 0;
  private disposed = false;

  private readonly listeners = new Set<(e: ElementActivationEvent) => void>();
  private readonly unsubCamera: () => void;
  private readonly unsubStore: (() => void)[];

  private readonly handlePointerDown = (e: PointerEvent): void => this.onPointerDown(e);
  private readonly handlePointerMove = (e: PointerEvent): void => this.onPointerMove(e);
  private readonly handlePointerUp = (e: PointerEvent): void => this.onPointerUp(e);
  private readonly handlePointerCancel = (e: PointerEvent): void => this.onPointerCancel(e);
  private readonly handleWindowPointerEnd = (e: PointerEvent): void => this.onWindowPointerEnd(e);
  private readonly handleInterrupt = (): void => this.reset();

  constructor(deps: ElementActivationDeps, options: ActivationOptions) {
    this.slopPx = options.slopPx ?? DEFAULT_ACTIVATION_SLOP_PX;
    this.doubleDelayMs = options.doubleDelayMs ?? DEFAULT_ACTIVATION_DOUBLE_DELAY_MS;
    if (!Number.isFinite(this.slopPx) || this.slopPx < 0) {
      throw new RangeError(`[fieldnotes] activation slopPx must be finite and >= 0`);
    }
    if (!Number.isFinite(this.doubleDelayMs) || this.doubleDelayMs <= 0) {
      throw new RangeError(`[fieldnotes] activation doubleDelayMs must be finite and > 0`);
    }
    this.deps = deps;
    this.options = options;

    // Reuses `select-hit`'s topmost-first bounds walk. `isLayerLocked` is
    // deliberately OMITTED rather than passed: locking prevents moving an
    // element, not reading it, so a marker on a locked layer still activates
    // while staying undraggable.
    this.hitContext = {
      camera: deps.camera,
      store: deps.store,
      requestRender: noop,
      isLayerVisible: deps.isLayerVisible,
    };

    // Own monotonic revision derived from the existing public `camera.onChange`;
    // integer comparison, never float, and no new public member on `Camera`.
    this.unsubCamera = deps.camera.onChange(() => {
      this.cameraRevision += 1;
    });

    this.unsubStore = [
      deps.store.on('remove', (el) => this.forgetElement(el.id)),
      deps.store.on('clear', () => this.reset()),
    ];

    deps.element.addEventListener('pointerdown', this.handlePointerDown, PASSIVE);
    deps.element.addEventListener('pointermove', this.handlePointerMove, PASSIVE);
    deps.element.addEventListener('pointerup', this.handlePointerUp, PASSIVE);
    deps.element.addEventListener('pointercancel', this.handlePointerCancel, PASSIVE);

    // State-clearing only — these can never activate. Without capture, a pointer
    // pressed on the canvas and released elsewhere would leave a stale record.
    window.addEventListener('pointerup', this.handleWindowPointerEnd, PASSIVE);
    window.addEventListener('pointercancel', this.handleWindowPointerEnd, PASSIVE);
    window.addEventListener('blur', this.handleInterrupt, PASSIVE);
    window.addEventListener('visibilitychange', this.handleInterrupt, PASSIVE);
  }

  /**
   * Subscribes to activations. Emission iterates a snapshot with a per-listener
   * try/catch, so one throwing listener cannot break its siblings and a
   * concurrent unsubscribe cannot skip one. Returns an idempotent unsubscribe.
   */
  onActivate(listener: (e: ElementActivationEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Removes every listener, clears timers and gesture state. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.reset();
    this.unsubCamera();
    for (const unsub of this.unsubStore) unsub();
    this.deps.element.removeEventListener('pointerdown', this.handlePointerDown);
    this.deps.element.removeEventListener('pointermove', this.handlePointerMove);
    this.deps.element.removeEventListener('pointerup', this.handlePointerUp);
    this.deps.element.removeEventListener('pointercancel', this.handlePointerCancel);
    window.removeEventListener('pointerup', this.handleWindowPointerEnd);
    window.removeEventListener('pointercancel', this.handleWindowPointerEnd);
    window.removeEventListener('blur', this.handleInterrupt);
    window.removeEventListener('visibilitychange', this.handleInterrupt);
    this.listeners.clear();
  }

  private now(): number {
    return performance.now();
  }

  private isCameraBusy(): boolean {
    return (this.deps.isCameraBusy?.() ?? false) || (this.options.isCameraBusy?.() ?? false);
  }

  private toWorld(e: PointerEvent): Point {
    const rect = this.deps.element.getBoundingClientRect();
    return this.deps.camera.screenToWorld({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  /**
   * Topmost visible element under `world` that activation accepts, or `null`.
   * The topmost hit wins outright: a rejected hit does not fall through to
   * whatever sits beneath it.
   */
  private resolveTarget(world: Point): CanvasElement | null {
    const hit = hitTest(world, this.hitContext);
    if (!hit) return null;
    // Core-side routing gate: only elements actually drawn on the canvas.
    if (hit.type === 'note' || hit.type === 'text') return null;
    if (hit.type === 'html' && this.deps.resolveHtmlRouting(hit) !== 'canvas') return null;
    if (this.options.isActivatable && !this.options.isActivatable(hit)) return null;
    return hit;
  }

  private beyondSlop(from: Point, to: Point): boolean {
    return Math.hypot(to.x - from.x, to.y - from.y) > this.slopPx;
  }

  private onPointerDown(e: PointerEvent): void {
    // Right/middle buttons never activate and never disturb a pending tap.
    if (e.button !== 0) return;

    const hadPointers = this.downPointers.size > 0;
    this.downPointers.add(e.pointerId);
    if (hadPointers) {
      // A second pointer means navigation, not activation. The down-pointer set
      // is deliberately NOT cleared here: the earlier pointers are still down,
      // and forgetting them would let a third pointer arm a gesture mid-pinch.
      this.clearGesture();
      return;
    }

    this.active = null;
    if (this.isCameraBusy()) {
      this.clearPending();
      return;
    }

    const target = this.resolveTarget(this.toWorld(e));
    if (!target) {
      // Empty space, or a hit activation rejected: the pending half dies with it.
      this.clearPending();
      return;
    }

    this.active = {
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      clientPoint: { x: e.clientX, y: e.clientY },
      elementId: target.id,
      cameraRevision: this.cameraRevision,
    };
  }

  private onPointerMove(e: PointerEvent): void {
    const active = this.active;
    if (!active || active.pointerId !== e.pointerId) return;
    if (this.beyondSlop(active.clientPoint, { x: e.clientX, y: e.clientY })) this.clearGesture();
  }

  private onPointerUp(e: PointerEvent): void {
    this.downPointers.delete(e.pointerId);
    const active = this.active;
    if (!active || active.pointerId !== e.pointerId) return;
    this.active = null;

    if (this.beyondSlop(active.clientPoint, { x: e.clientX, y: e.clientY })) {
      this.clearPending();
      return;
    }
    // Two independent camera signals: moved during the gesture, or busy now.
    if (this.cameraRevision !== active.cameraRevision || this.isCameraBusy()) {
      this.clearPending();
      return;
    }

    // Down/up identity: the release must resolve to the SAME element, still
    // activatable and still canvas-routed.
    const world = this.toWorld(e);
    const target = this.resolveTarget(world);
    if (!target || target.id !== active.elementId) {
      this.clearPending();
      return;
    }

    if (this.options.gesture === 'single') {
      this.clearPending();
      this.emit({ element: target, world, pointerType: e.pointerType, gesture: 'single' });
      return;
    }

    const pending = this.pending;
    const time = this.now();
    if (
      pending &&
      pending.elementId === target.id &&
      pending.pointerType === e.pointerType &&
      time - pending.time <= this.doubleDelayMs
    ) {
      this.clearPending();
      this.emit({ element: target, world, pointerType: e.pointerType, gesture: 'double' });
      return;
    }

    this.setPending({
      elementId: target.id,
      pointerType: e.pointerType,
      clientPoint: { x: e.clientX, y: e.clientY },
      time,
    });
  }

  private onPointerCancel(e: PointerEvent): void {
    this.downPointers.delete(e.pointerId);
    // Scoped to the tracked pointer: another pointer's cancel leaves an
    // in-flight gesture alone, but with none in flight the pending half dies.
    if (this.active && this.active.pointerId !== e.pointerId) return;
    this.clearGesture();
  }

  /**
   * A pointer pressed on the wrapper and released outside it. State-clearing
   * only: this path can never activate. Events that bubbled up from inside the
   * wrapper were already handled by the wrapper listener.
   */
  private onWindowPointerEnd(e: PointerEvent): void {
    const target = e.target;
    if (target instanceof Node && this.deps.element.contains(target)) return;
    this.downPointers.delete(e.pointerId);
    if (this.active && this.active.pointerId !== e.pointerId) return;
    this.clearGesture();
  }

  private forgetElement(id: string): void {
    if (this.active?.elementId === id) this.active = null;
    if (this.pending?.elementId === id) this.clearPending();
  }

  private setPending(pending: PendingTap): void {
    this.clearPending();
    this.pending = pending;
    this.pendingTimer = setTimeout(() => this.clearPending(), this.doubleDelayMs);
  }

  private clearPending(): void {
    this.pending = null;
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
  }

  /** Drops the in-flight gesture and its pending half; leaves pointer bookkeeping. */
  private clearGesture(): void {
    this.active = null;
    this.clearPending();
  }

  /** Drops everything, including which pointers are believed to be down. */
  private reset(): void {
    this.clearGesture();
    this.downPointers.clear();
  }

  private emit(event: ElementActivationEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // A throwing host listener must not break its siblings or input handling.
      }
    }
  }
}
