import type { Point } from '../core/types';
import { AWARENESS_PRESENCE_KIND, AWARENESS_MAX_SELECTION } from './awareness-presence';
import type { AwarenessIdentity, AwarenessPresence } from './awareness-presence';

/** The viewport capabilities the publisher reads; `Viewport` satisfies it. */
export interface LocalAwarenessHost {
  readonly camera: { screenToWorld(screen: Point): Point };
  /** The pointer listener attaches to `domLayer.parentElement` (the wrapper). */
  readonly domLayer: HTMLElement;
  onSelectionChange(listener: () => void): () => void;
  getSelectedIds(): string[];
  readonly toolManager: {
    onChange(listener: (name: string) => void): () => void;
    readonly activeTool: { readonly name: string } | null;
  };
}

export interface AwarenessFields {
  cursor?: boolean;
  /** Off by default: selection ids are a disclosure the moment they are sent. */
  selection?: boolean;
  tool?: boolean;
}

export interface LocalAwarenessOptions {
  identity: AwarenessIdentity;
  /** Default `{ cursor: true, selection: false, tool: true }`. */
  fields?: AwarenessFields;
  /**
   * Host projection applied to selected ids before they leave the client.
   * Fails closed: if it throws or returns anything but an array of strings,
   * frames carry NO selection (never the unfiltered ids) until it next
   * succeeds, and the error goes to `onError`.
   */
  selectionFilter?: (ids: readonly string[]) => readonly string[];
  onError?: (error: unknown) => void;
  /** Minimum spacing between frames. Default `50` (the relay lane throttle). */
  intervalMs?: number;
  /** Full-state re-send while idle, measured from the last send. Default `15000`; `0` disables. */
  heartbeatMs?: number;
  /** Pointer listener target override; default `host.domLayer.parentElement`. */
  element?: HTMLElement;
  send: (data: AwarenessPresence) => void;
}

const DEFAULT_FIELDS: Readonly<Required<AwarenessFields>> = Object.freeze({
  cursor: true,
  selection: false,
  tool: true,
});
const DEFAULT_INTERVAL_MS = 50;
const DEFAULT_HEARTBEAT_MS = 15_000;
/** `setTimeout` clamps delays outside this range to 1ms; never schedule those. */
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;
const MAX_IDENTITY_ID_LENGTH = 128;
const MAX_IDENTITY_NAME_LENGTH = 64;
const MAX_IDENTITY_COLOR_LENGTH = 64;
const MAX_IDENTITY_ROLE_LENGTH = 32;
const MAX_TOOL_LENGTH = 64;
/** Matches `isAwarenessPresence`'s per-selection-id cap in awareness-presence.ts. */
const MAX_SELECTION_ID_LENGTH = 128;

/** A non-finite or negative `setTimeout` delay is normalised to `0`. */
function normalizeIntervalMs(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

/** A non-finite or non-positive heartbeat disables the heartbeat (`0`). */
function normalizeHeartbeatMs(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Truncates identity strings to the wire caps and rejects an invalid id, so a
 * sender can never publish a frame that the wire guard would drop outright.
 */
function normalizeIdentity(identity: AwarenessIdentity): AwarenessIdentity {
  if (identity.id.length === 0 || identity.id.length > MAX_IDENTITY_ID_LENGTH) {
    throw new RangeError('LocalAwareness: identity.id must be 1..128 characters');
  }
  const normalized: { id: string; name?: string; color?: string; role?: string } = {
    id: identity.id,
  };
  if (identity.name !== undefined)
    normalized.name = identity.name.slice(0, MAX_IDENTITY_NAME_LENGTH);
  if (identity.color !== undefined) {
    normalized.color = identity.color.slice(0, MAX_IDENTITY_COLOR_LENGTH);
  }
  if (identity.role !== undefined)
    normalized.role = identity.role.slice(0, MAX_IDENTITY_ROLE_LENGTH);
  return normalized;
}

type MutableFrame = {
  -readonly [K in keyof AwarenessPresence]?: AwarenessPresence[K];
} & { kind: 'awareness'; id: string };

/**
 * Publishes this client's awareness state (identity, pointer in world space,
 * selection, active tool) as full-snapshot frames through `send`. Sources are
 * a passive primary-pointer listener on the viewport wrapper, the viewport's
 * selection-change event, and the tool manager's change event. Any change
 * marks the state dirty; a leading-edge frame goes out at once when idle,
 * otherwise one trailing frame per `intervalMs` carries every change made in
 * the window. A heartbeat re-sends the state while idle. `dispose` sends one
 * `cleared` frame. Nothing here touches elements, history, or the camera.
 *
 * Frames are valid by construction: identity is truncated to the wire caps
 * (`name`/`color` to 64 characters, `role` to 32) so a sender can never
 * publish a frame the wire guard would reject outright; an invalid `id`
 * (empty or over 128 characters) throws instead of silently truncating.
 * `tool` is never truncated: a tool name over 64 characters is omitted from
 * the frame rather than corrupted. An over-long or empty selection id fails
 * the selection closed (like a non-string filter entry) rather than being
 * sent. `intervalMs` and `heartbeatMs` are normalised so a non-finite or
 * out-of-range value (e.g. `Infinity`) can never arm a near-zero busy-loop
 * timer.
 */
export class LocalAwareness {
  private readonly host: LocalAwarenessHost;
  private readonly element: HTMLElement;
  private readonly send: (data: AwarenessPresence) => void;
  private readonly selectionFilter: ((ids: readonly string[]) => readonly string[]) | undefined;
  private readonly onError: ((error: unknown) => void) | undefined;
  private readonly intervalMs: number;
  private readonly heartbeatMs: number;
  private identity: AwarenessIdentity;
  private fields: Readonly<Required<AwarenessFields>>;
  private lastPointer: Point | null = null;
  private selection: readonly string[] = [];
  private selectionFailed = false;
  private tool: string | null;
  private dirty = false;
  private lastSentAt: number | null = null;
  private throttleTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly unsubscribers: (() => void)[] = [];
  private isDisposed = false;

  private readonly handlePointerMove = (e: PointerEvent): void => this.onPointerMove(e);
  private readonly handlePointerEnd = (e: PointerEvent): void => this.onPointerEnd(e);

  constructor(host: LocalAwarenessHost, options: LocalAwarenessOptions) {
    const element = options.element ?? host.domLayer.parentElement;
    if (!element) throw new Error('LocalAwareness: the viewport wrapper is not mounted');
    this.host = host;
    this.element = element;
    this.send = options.send;
    this.selectionFilter = options.selectionFilter;
    this.onError = options.onError;
    this.intervalMs = normalizeIntervalMs(options.intervalMs ?? DEFAULT_INTERVAL_MS);
    this.heartbeatMs = normalizeHeartbeatMs(options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS);
    this.identity = normalizeIdentity(options.identity);
    this.fields = mergeFields(DEFAULT_FIELDS, options.fields ?? {});
    this.tool = host.toolManager.activeTool?.name ?? null;
    this.refreshSelection();

    const opts: AddEventListenerOptions = { passive: true };
    element.addEventListener('pointermove', this.handlePointerMove, opts);
    element.addEventListener('pointerleave', this.handlePointerEnd, opts);
    element.addEventListener('pointercancel', this.handlePointerEnd, opts);
    this.unsubscribers.push(
      host.onSelectionChange(() => {
        this.refreshSelection();
        if (this.fields.selection) this.schedule();
      }),
      host.toolManager.onChange((name) => {
        this.tool = name;
        if (this.fields.tool) this.schedule();
      }),
    );
    this.armHeartbeat();
  }

  get disposed(): boolean {
    return this.isDisposed;
  }

  getFields(): Readonly<Required<AwarenessFields>> {
    return this.fields;
  }

  setIdentity(identity: AwarenessIdentity): void {
    this.identity = normalizeIdentity(identity);
    this.schedule();
  }

  /** Merges the given flags into the current policy; `undefined` keys are ignored. */
  setFields(fields: AwarenessFields): void {
    this.fields = mergeFields(this.fields, fields);
    this.schedule();
  }

  /**
   * Requests a full frame: immediate when idle, otherwise folded into the
   * pending trailing frame (so N simultaneous requests cost one frame). Hosts
   * call it when the connection becomes live or reconnects.
   */
  announce(): void {
    this.schedule();
  }

  /** The complete state a frame carries right now. */
  getState(): AwarenessPresence {
    const frame: MutableFrame = { kind: AWARENESS_PRESENCE_KIND, id: this.identity.id };
    if (this.identity.name !== undefined) frame.name = this.identity.name;
    if (this.identity.color !== undefined) frame.color = this.identity.color;
    if (this.identity.role !== undefined) frame.role = this.identity.role;
    if (this.fields.cursor && this.lastPointer !== null) {
      frame.cursor = { x: this.lastPointer.x, y: this.lastPointer.y };
    }
    if (this.fields.selection && !this.selectionFailed && this.selection.length > 0) {
      frame.selection = [...this.selection];
    }
    if (this.fields.tool && this.tool !== null && this.tool.length <= MAX_TOOL_LENGTH) {
      frame.tool = this.tool;
    }
    return frame;
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    if (this.throttleTimer !== null) clearTimeout(this.throttleTimer);
    this.throttleTimer = null;
    if (this.heartbeatTimer !== null) clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.element.removeEventListener('pointermove', this.handlePointerMove);
    this.element.removeEventListener('pointerleave', this.handlePointerEnd);
    this.element.removeEventListener('pointercancel', this.handlePointerEnd);
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers.length = 0;
    this.safeSend({ kind: AWARENESS_PRESENCE_KIND, id: this.identity.id, cleared: true });
  }

  private now(): number {
    return Date.now();
  }

  private onPointerMove(e: PointerEvent): void {
    if (!e.isPrimary) return;
    const rect = this.element.getBoundingClientRect();
    this.lastPointer = this.host.camera.screenToWorld({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
    if (this.fields.cursor) this.schedule();
  }

  private onPointerEnd(e: PointerEvent): void {
    if (!e.isPrimary || this.lastPointer === null) return;
    this.lastPointer = null;
    if (this.fields.cursor) this.schedule();
  }

  private refreshSelection(): void {
    try {
      const raw = this.host.getSelectedIds();
      const ids = this.selectionFilter ? this.selectionFilter(raw) : raw;
      if (!Array.isArray(ids)) throw new TypeError('selectionFilter must return an array');
      // Validate every entry before capping, so a bad id past the cap boundary
      // (e.g. index 280 of a 300-entry array) still fails closed instead of
      // being silently dropped by the slice. An id longer than the wire cap
      // (or empty) is treated the same as a non-string entry: it would make
      // isAwarenessPresence reject the whole frame, so the selection fails
      // closed here instead.
      for (const id of ids as readonly unknown[]) {
        if (typeof id !== 'string') throw new TypeError('selectionFilter must return strings');
        if (id.length === 0 || id.length > MAX_SELECTION_ID_LENGTH) {
          throw new TypeError('selectionFilter must return ids of 1..128 characters');
        }
      }
      this.selection = (ids as readonly string[]).slice(0, AWARENESS_MAX_SELECTION);
      this.selectionFailed = false;
    } catch (error) {
      this.selection = [];
      this.selectionFailed = true;
      this.report(error);
    }
  }

  private schedule(): void {
    if (this.isDisposed) return;
    this.dirty = true;
    if (this.throttleTimer !== null) return;
    const elapsed = this.lastSentAt === null ? Infinity : this.now() - this.lastSentAt;
    if (elapsed >= this.intervalMs) {
      this.flush();
      return;
    }
    this.throttleTimer = setTimeout(
      () => {
        this.throttleTimer = null;
        if (this.dirty) this.flush();
      },
      Math.min(this.intervalMs - elapsed, MAX_TIMER_DELAY_MS),
    );
  }

  private flush(): void {
    this.dirty = false;
    this.lastSentAt = this.now();
    this.safeSend(this.getState());
    this.armHeartbeat();
  }

  private armHeartbeat(): void {
    if (this.heartbeatTimer !== null) clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = null;
    if (this.heartbeatMs <= 0 || this.isDisposed) return;
    this.heartbeatTimer = setTimeout(
      () => {
        this.heartbeatTimer = null;
        this.flush();
      },
      Math.min(this.heartbeatMs, MAX_TIMER_DELAY_MS),
    );
  }

  private safeSend(frame: AwarenessPresence): void {
    try {
      this.send(frame);
    } catch (error) {
      this.report(error);
    }
  }

  private report(error: unknown): void {
    try {
      this.onError?.(error);
    } catch {
      // A throwing error sink must not break the publisher.
    }
  }
}

function mergeFields(
  current: Readonly<Required<AwarenessFields>>,
  patch: AwarenessFields,
): Readonly<Required<AwarenessFields>> {
  return Object.freeze({
    cursor: patch.cursor ?? current.cursor,
    selection: patch.selection ?? current.selection,
    tool: patch.tool ?? current.tool,
  });
}
