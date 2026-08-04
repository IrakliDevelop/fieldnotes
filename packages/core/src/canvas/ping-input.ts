import type { Point } from '../core/types';
import type { PingEmission } from '../tools/ping-tool';

/**
 * The one camera capability `PingInput` needs; `Camera` satisfies it. Screen
 * coordinates are element-local (the same space `Camera.screenToWorld`
 * expects).
 */
export interface PingInputHost {
  screenToWorld(screen: Point): Point;
}

export interface PingInputOptions {
  /**
   * Opt-in for the long-press gesture. Off by default: a hidden hold-to-ping
   * gesture surprises users outside shared-canvas products, so hosts enable
   * it deliberately. The keyboard/programmatic paths (`pingAtPointer`,
   * `pingAt`) are always available. Default `false`.
   */
  longPressEnabled?: boolean;
  /** Hold duration before a still press pings. Default `600`. */
  longPressMs?: number;
  /** Maximum pointer travel while holding; moving further cancels. Default `8`. */
  slopPx?: number;
  /** Emission style forwarded to hosts; matches `PingTool` defaults. */
  color?: string;
  durationMs?: number;
  radius?: number;
  /**
   * Minimum interval between emitted pings, shared across the long-press and
   * keyboard/programmatic paths. Faster pings are dropped entirely. Default
   * `300`.
   */
  minIntervalMs?: number;
  /**
   * Host veto consulted at fire time on every path (e.g. return `false` while
   * a ping tool is active to avoid double pings). A veto does not consume the
   * rate-limit interval.
   */
  shouldPing?: () => boolean;
}

interface PressState {
  pointerId: number;
  /** Element-local press position; the ping fires here, not where the pointer drifted. */
  x: number;
  y: number;
  timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_LONG_PRESS_MS = 600;
const DEFAULT_SLOP_PX = 8;
const DEFAULT_COLOR = '#ff3b30';
const DEFAULT_DURATION_MS = 1800;
const DEFAULT_RADIUS = 48;
const DEFAULT_MIN_INTERVAL_MS = 300;

/**
 * Always-available ping input alongside the active tool: long-press-to-ping
 * plus keyboard/programmatic pings, independent of `PingTool`.
 *
 * `PingInput` is a passive observer by contract. Its DOM pointer listeners are
 * registered `passive: true` and it never calls `preventDefault`,
 * `stopPropagation`, or captures pointers, so the active tool, panning, and
 * pinch navigation behave exactly as if it were absent (with a pencil active,
 * a still hold pings AND the pencil still draws its dot). It also never
 * renders: hosts feed emissions into their own `RemotePingOverlay` under a
 * `'self'` sender key. Pings are ephemeral — no elements, no undo history, no
 * persisted state, no camera movement.
 *
 * The long-press gesture is opt-in via `longPressEnabled` (hosts whose users
 * would not expect hold-to-ping simply leave it off and keep the keyboard
 * paths). When enabled, a long-press arms on the first pointer down (mouse
 * primary button, touch, or pen), fires after `longPressMs` at the original
 * press position, and
 * cancels on movement past `slopPx`, a second pointer (two-finger
 * navigation), or pointer up/cancel/leave. Keyboard support is a capability,
 * not a binding: hosts call `pingAtPointer()` (last tracked hover position,
 * world-converted at call time) or `pingAt(world)` from their own shortcut
 * handling.
 */
export class PingInput {
  private readonly element: HTMLElement;
  private readonly host: PingInputHost;
  private longPressEnabled: boolean;
  private longPressMs: number;
  private slopPx: number;
  private color: string;
  private durationMs: number;
  private radius: number;
  private minIntervalMs: number;
  private shouldPing: (() => boolean) | undefined;

  private press: PressState | null = null;
  private readonly downPointers = new Set<number>();
  private lastPointerScreen: Point | null = null;
  private lastEmitAt = -Infinity;
  private disposed = false;
  private optionListeners = new Set<() => void>();
  private pingListeners = new Set<(emission: PingEmission) => void>();

  private readonly handlePointerDown = (e: PointerEvent): void => this.onPointerDown(e);
  private readonly handlePointerMove = (e: PointerEvent): void => this.onPointerMove(e);
  private readonly handlePointerUp = (e: PointerEvent): void => this.onPointerEnd(e);
  private readonly handlePointerCancel = (e: PointerEvent): void => this.onPointerEnd(e);
  private readonly handlePointerLeave = (e: PointerEvent): void => this.onPointerEnd(e);

  constructor(element: HTMLElement, host: PingInputHost, options: PingInputOptions = {}) {
    this.element = element;
    this.host = host;
    this.longPressEnabled = options.longPressEnabled ?? false;
    this.longPressMs = options.longPressMs ?? DEFAULT_LONG_PRESS_MS;
    this.slopPx = options.slopPx ?? DEFAULT_SLOP_PX;
    this.color = options.color ?? DEFAULT_COLOR;
    this.durationMs = options.durationMs ?? DEFAULT_DURATION_MS;
    this.radius = options.radius ?? DEFAULT_RADIUS;
    this.minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
    this.shouldPing = options.shouldPing;

    const opts: AddEventListenerOptions = { passive: true };
    element.addEventListener('pointerdown', this.handlePointerDown, opts);
    element.addEventListener('pointermove', this.handlePointerMove, opts);
    element.addEventListener('pointerup', this.handlePointerUp, opts);
    element.addEventListener('pointercancel', this.handlePointerCancel, opts);
    element.addEventListener('pointerleave', this.handlePointerLeave, opts);
  }

  private now(): number {
    return performance.now();
  }

  getOptions(): PingInputOptions {
    return {
      longPressEnabled: this.longPressEnabled,
      longPressMs: this.longPressMs,
      slopPx: this.slopPx,
      color: this.color,
      durationMs: this.durationMs,
      radius: this.radius,
      minIntervalMs: this.minIntervalMs,
      ...(this.shouldPing ? { shouldPing: this.shouldPing } : {}),
    };
  }

  setOptions(options: PingInputOptions): void {
    if (options.longPressEnabled !== undefined) {
      this.longPressEnabled = options.longPressEnabled;
      if (!this.longPressEnabled) this.cancelPress();
    }
    if (options.longPressMs !== undefined) this.longPressMs = options.longPressMs;
    if (options.slopPx !== undefined) this.slopPx = options.slopPx;
    if (options.color !== undefined) this.color = options.color;
    if (options.durationMs !== undefined) this.durationMs = options.durationMs;
    if (options.radius !== undefined) this.radius = options.radius;
    if (options.minIntervalMs !== undefined) this.minIntervalMs = options.minIntervalMs;
    if (options.shouldPing !== undefined) this.shouldPing = options.shouldPing;
    for (const listener of this.optionListeners) listener();
  }

  onOptionsChange(listener: () => void): () => void {
    this.optionListeners.add(listener);
    return () => this.optionListeners.delete(listener);
  }

  /**
   * Subscribes to emitted pings. Listeners must not throw; a throwing
   * listener is isolated so it cannot break input handling or other
   * listeners.
   */
  onPing(listener: (emission: PingEmission) => void): () => void {
    this.pingListeners.add(listener);
    return () => this.pingListeners.delete(listener);
  }

  /**
   * Pings at the last tracked pointer position (hover moves and presses),
   * world-converted at call time. Returns `false` when no pointer has been
   * seen yet, the host vetoes, or the rate limit drops the ping.
   */
  pingAtPointer(): boolean {
    if (this.disposed || this.lastPointerScreen === null) return false;
    return this.emit(this.host.screenToWorld(this.lastPointerScreen));
  }

  /** Pings a world position directly. Same veto and rate limit as every path. */
  pingAt(world: Point): boolean {
    if (this.disposed) return false;
    return this.emit(world);
  }

  /** Removes all DOM listeners and cancels any pending press. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelPress();
    this.downPointers.clear();
    this.element.removeEventListener('pointerdown', this.handlePointerDown);
    this.element.removeEventListener('pointermove', this.handlePointerMove);
    this.element.removeEventListener('pointerup', this.handlePointerUp);
    this.element.removeEventListener('pointercancel', this.handlePointerCancel);
    this.element.removeEventListener('pointerleave', this.handlePointerLeave);
    this.optionListeners.clear();
    this.pingListeners.clear();
  }

  private toLocal(e: PointerEvent): Point {
    const rect = this.element.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private onPointerDown(e: PointerEvent): void {
    const local = this.toLocal(e);
    this.lastPointerScreen = local;

    const hadPointers = this.downPointers.size > 0;
    this.downPointers.add(e.pointerId);
    if (hadPointers) {
      // A second pointer means navigation, not a press — and the new pointer
      // must not arm its own press while others are down.
      this.cancelPress();
      return;
    }
    if (!this.longPressEnabled) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    this.press = {
      pointerId: e.pointerId,
      x: local.x,
      y: local.y,
      timer: setTimeout(() => this.firePress(), this.longPressMs),
    };
  }

  private onPointerMove(e: PointerEvent): void {
    const local = this.toLocal(e);
    this.lastPointerScreen = local;
    if (this.press === null || e.pointerId !== this.press.pointerId) return;
    const dx = local.x - this.press.x;
    const dy = local.y - this.press.y;
    if (Math.hypot(dx, dy) > this.slopPx) this.cancelPress();
  }

  private onPointerEnd(e: PointerEvent): void {
    this.downPointers.delete(e.pointerId);
    if (this.press !== null && e.pointerId === this.press.pointerId) this.cancelPress();
  }

  private cancelPress(): void {
    if (this.press === null) return;
    clearTimeout(this.press.timer);
    this.press = null;
  }

  private firePress(): void {
    if (this.press === null) return;
    const screen = { x: this.press.x, y: this.press.y };
    this.press = null;
    // Convert at fire time so the ping lands where the held pointer points now.
    this.emit(this.host.screenToWorld(screen));
  }

  private emit(world: Point): boolean {
    if (this.shouldPing && !this.shouldPing()) return false;
    const t = this.now();
    if (t - this.lastEmitAt < this.minIntervalMs) return false;
    this.lastEmitAt = t;
    const emission: PingEmission = {
      x: world.x,
      y: world.y,
      color: this.color,
      durationMs: this.durationMs,
      radius: this.radius,
    };
    for (const listener of this.pingListeners) {
      try {
        listener(emission);
      } catch {
        // A throwing host listener must not break input handling.
      }
    }
    return true;
  }
}
