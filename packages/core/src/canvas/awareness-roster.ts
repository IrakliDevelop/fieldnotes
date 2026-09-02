import type { Point } from '../core/types';
import { isAwarenessPresence } from './awareness-presence';
import type { AwarenessIdentity, AwarenessPresence } from './awareness-presence';

/** One remote peer as last seen. Liveness timestamps are deliberately not exposed. */
export interface Peer extends AwarenessIdentity {
  /** The relay's server-owned per-socket sender key (the envelope `from`). */
  readonly from: string;
  readonly cursor: Point | null;
  readonly selection: readonly string[];
  readonly tool: string | null;
}

export type PeerLeaveReason = 'left' | 'cleared' | 'stale';

export interface PeerRosterOptions {
  /**
   * A sender with no valid frame for this long is dropped (row and discovery
   * entry) with reason `'stale'`. Default `45000` (3× the publisher heartbeat);
   * `0` disables expiry.
   */
  staleMs?: number;
  /** Clock seam for tests; default `Date.now`. */
  now?: () => number;
}

const DEFAULT_STALE_MS = 45_000;
const EMPTY_PEERS: readonly Peer[] = Object.freeze([]);
const EMPTY_SELECTION: readonly string[] = Object.freeze([]);

function sameSelection(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function samePoint(a: Point | null, b: Point | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y;
}

function toPeer(from: string, data: AwarenessPresence, prev: Peer | undefined): Peer {
  const cursor: Point | null = data.cursor ? { x: data.cursor.x, y: data.cursor.y } : null;
  const incoming = data.selection ?? EMPTY_SELECTION;
  // Preserve the previous selection array by reference when its contents are
  // unchanged, so overlays can detect a selection change by identity.
  const selection: readonly string[] =
    prev && sameSelection(prev.selection, incoming)
      ? prev.selection
      : incoming.length === 0
        ? EMPTY_SELECTION
        : Object.freeze([...incoming]);
  const tool = data.tool ?? null;
  if (
    prev &&
    prev.id === data.id &&
    prev.name === data.name &&
    prev.color === data.color &&
    prev.role === data.role &&
    prev.tool === tool &&
    prev.selection === selection &&
    samePoint(prev.cursor, cursor)
  ) {
    return prev;
  }
  const peer: Peer = {
    from,
    id: data.id,
    ...(data.name === undefined ? {} : { name: data.name }),
    ...(data.color === undefined ? {} : { color: data.color }),
    ...(data.role === undefined ? {} : { role: data.role }),
    cursor,
    selection,
    tool,
  };
  return peer;
}

/**
 * Last-known awareness state per remote sender, keyed by the relay's
 * server-owned `from`. Two books are kept deliberately separate:
 *
 * - **Rows** are visible membership: created by any valid non-cleared frame,
 *   removed by a `cleared` frame, by `remove()` (the server-authored
 *   presence-leave), or by stale expiry.
 * - **Discovery entries** are the re-announce budget: touched by EVERY valid
 *   frame (cleared included) and dropped ONLY by `remove()` or by `staleMs`
 *   without any valid frame. `onDiscover` fires when a valid frame arrives from
 *   a sender with no entry — at most once per socket lifetime, so a client
 *   cycling full → cleared → full cannot make every peer re-announce.
 *
 * `getPeers()` returns the same array until a visible field or membership
 * changes (a heartbeat carrying identical state is silent), which makes it a
 * valid `useSyncExternalStore` snapshot. Remote clocks are never trusted; all
 * timing is local.
 */
export class PeerRoster {
  private readonly staleMs: number;
  private readonly now: () => number;
  private readonly rows = new Map<string, Peer>();
  private readonly discovered = new Map<string, number>();
  private readonly changeListeners = new Set<() => void>();
  private readonly discoverListeners = new Set<(from: string) => void>();
  private readonly leaveListeners = new Set<(peer: Peer, reason: PeerLeaveReason) => void>();
  private snapshot: readonly Peer[] = EMPTY_PEERS;
  private snapshotDirty = false;
  private staleTimer: ReturnType<typeof setTimeout> | null = null;
  private isDisposed = false;

  constructor(options: PeerRosterOptions = {}) {
    this.staleMs = options.staleMs ?? DEFAULT_STALE_MS;
    this.now = options.now ?? (() => Date.now());
  }

  get disposed(): boolean {
    return this.isDisposed;
  }

  /**
   * Applies a presence payload from `from`. Non-awareness or malformed payloads
   * return `false` untouched, so hosts can feed every presence frame through.
   */
  apply(from: string, data: unknown): boolean {
    if (this.isDisposed || !isAwarenessPresence(data)) return false;
    const isNew = !this.discovered.has(from);
    this.discovered.set(from, this.now());
    if ('cleared' in data) {
      this.dropRow(from, 'cleared');
    } else {
      const prev = this.rows.get(from);
      const next = toPeer(from, data, prev);
      if (next !== prev) {
        this.rows.set(from, next);
        this.changed();
      }
    }
    this.armStaleTimer();
    if (isNew) this.emit(this.discoverListeners, (l) => l(from));
    return true;
  }

  /** Server-authored presence-leave: drops the row AND the discovery entry. */
  remove(from: string): void {
    if (this.isDisposed) return;
    const hadEntry = this.discovered.delete(from);
    this.dropRow(from, 'left');
    if (hadEntry) this.armStaleTimer();
  }

  getPeers(): readonly Peer[] {
    if (this.snapshotDirty) {
      this.snapshot = this.rows.size === 0 ? EMPTY_PEERS : Object.freeze([...this.rows.values()]);
      this.snapshotDirty = false;
    }
    return this.snapshot;
  }

  getPeer(from: string): Peer | undefined {
    return this.rows.get(from);
  }

  /** Fires only when `getPeers()` would return a new reference. */
  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  /** First valid frame from a sender since its discovery entry was last dropped. */
  onDiscover(listener: (from: string) => void): () => void {
    this.discoverListeners.add(listener);
    return () => this.discoverListeners.delete(listener);
  }

  onLeave(listener: (peer: Peer, reason: PeerLeaveReason) => void): () => void {
    this.leaveListeners.add(listener);
    return () => this.leaveListeners.delete(listener);
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    if (this.staleTimer !== null) clearTimeout(this.staleTimer);
    this.staleTimer = null;
    this.rows.clear();
    this.discovered.clear();
    this.snapshot = EMPTY_PEERS;
    this.snapshotDirty = false;
    this.changeListeners.clear();
    this.discoverListeners.clear();
    this.leaveListeners.clear();
  }

  private dropRow(from: string, reason: PeerLeaveReason): void {
    const row = this.rows.get(from);
    if (!row) return;
    this.rows.delete(from);
    this.changed();
    this.emit(this.leaveListeners, (l) => l(row, reason));
  }

  private changed(): void {
    this.snapshotDirty = true;
    this.emit(this.changeListeners, (l) => l());
  }

  private emit<L>(listeners: Set<L>, call: (listener: L) => void): void {
    for (const listener of [...listeners]) {
      try {
        call(listener);
      } catch {
        // A throwing host listener must not break the roster.
      }
    }
  }

  private armStaleTimer(): void {
    if (this.staleTimer !== null) clearTimeout(this.staleTimer);
    this.staleTimer = null;
    if (this.staleMs <= 0 || this.isDisposed || this.discovered.size === 0) return;
    let earliest = Infinity;
    for (const seen of this.discovered.values()) if (seen < earliest) earliest = seen;
    const delay = Math.max(0, earliest + this.staleMs - this.now());
    this.staleTimer = setTimeout(() => {
      this.staleTimer = null;
      this.expireStale();
    }, delay);
  }

  private expireStale(): void {
    const t = this.now();
    for (const [from, seen] of [...this.discovered]) {
      if (t - seen >= this.staleMs) {
        this.discovered.delete(from);
        this.dropRow(from, 'stale');
      }
    }
    this.armStaleTimer();
  }
}
