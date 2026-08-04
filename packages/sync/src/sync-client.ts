import type { CanvasElement, ElementStore } from '@fieldnotes/core';
import type { SyncTransport } from './sync-transport';
import { parseEnvelope, isValidElement, type SyncOp, type SyncElement } from './protocol';

/**
 * Which authoritative-snapshot merge is being applied:
 *
 * - `bootstrap` — the client's first snapshot. Local elements absent from it
 *   are kept (non-destructive merge) unless the host discards them.
 * - `reconcile` — a later resync snapshot. Local elements absent from it are
 *   removed (deleted-while-away) unless the host preserves them.
 */
export type AuthoritativeSnapshotPhase = 'bootstrap' | 'reconcile';

export interface LocalOnlyElement {
  readonly element: CanvasElement;
  /**
   * Whether the hub has known this id during this session: it appeared in a
   * received snapshot or remote upsert, or was sent as a local upsert while
   * this client (or a predecessor sharing `hubKnownIds`) was attached. A
   * hub-known element that is absent from a reconcile snapshot was deleted
   * while this client was away; a hub-unknown one is local-authoritative
   * state the hub has never seen.
   */
  readonly hubKnown: boolean;
}

export interface AuthoritativeSnapshotContext {
  readonly phase: AuthoritativeSnapshotPhase;
  /** The validated elements carried by the authoritative snapshot. */
  readonly snapshot: readonly CanvasElement[];
  /**
   * Local elements the snapshot does not contain, excluding elements touched
   * locally during the resync window (those are already shielded and sent).
   */
  readonly localOnly: readonly LocalOnlyElement[];
}

/**
 * Host decision for `localOnly` elements. Ids outside `localOnly` are
 * ignored; an id listed in both sets is preserved. Unlisted elements keep the
 * phase default: kept on `bootstrap`, removed on `reconcile`.
 */
export interface LocalOnlyResolution {
  /**
   * Kept locally and re-pushed to the hub through the normal local-upsert
   * path, so `resolveAudience` stamping and server-side filtering apply.
   */
  preserve?: readonly string[];
  /** Removed locally without broadcasting a remove. */
  discard?: readonly string[];
}

export type ResolveLocalOnly = (
  context: AuthoritativeSnapshotContext,
) => LocalOnlyResolution | undefined;

export interface SyncClientOptions {
  store: ElementStore;
  transport: SyncTransport;
  clientId?: string;
  resolveAudience?: (element: CanvasElement) => string | undefined;
  /**
   * Called synchronously for every authoritative snapshot addressed to this
   * client, before the merge/reconcile mutates the store, so hosts own
   * bootstrap/reconcile semantics without observing raw frames or deferring
   * work to timers. A throwing hook falls back to the phase defaults and
   * never wedges the resync state machine.
   */
  resolveLocalOnly?: ResolveLocalOnly;
  /**
   * Ids the hub is known to have seen. The client mutates the set as it
   * learns; pass one shared set to successive clients over the same store
   * (e.g. across managed-connection rebuilds) to keep `hubKnown`
   * classification accurate.
   */
  hubKnownIds?: Set<string>;
  /**
   * How to treat the first authoritative snapshot. `merge` (default) keeps
   * unknown local elements; `reconcile` applies destructive resync semantics
   * immediately — for successor clients resuming an already-synced store,
   * with local ops made before the snapshot shielded as touched-during-resync.
   */
  firstSnapshot?: 'merge' | 'reconcile';
}

const REMOTE_ORIGIN = 'remote';

function isExternal(origin: string | undefined): boolean {
  return origin !== undefined && origin !== 'local';
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `c-${Math.random().toString(36).slice(2)}`;
}

export class SyncClient {
  private readonly store: ElementStore;
  private readonly transport: SyncTransport;
  private readonly clientId: string;
  private readonly resolveAudience?: (element: CanvasElement) => string | undefined;
  private readonly resolveLocalOnly?: ResolveLocalOnly;
  private readonly hubKnownIds: Set<string>;
  private unsubscribers: (() => void)[] = [];
  private started = false;
  private joined = false;
  private resyncPending = false;
  private readonly touchedDuringResync = new Set<string>();
  private readonly presenceHandlers = new Set<(from: string, data: unknown) => void>();
  private readonly presenceLeaveHandlers = new Set<(from: string) => void>();

  constructor(options: SyncClientOptions) {
    this.store = options.store;
    this.transport = options.transport;
    this.clientId = options.clientId ?? randomId();
    this.resolveAudience = options.resolveAudience;
    this.resolveLocalOnly = options.resolveLocalOnly;
    this.hubKnownIds = options.hubKnownIds ?? new Set();
    this.joined = options.firstSnapshot === 'reconcile';
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    // A reconcile-first client resumes an already-synced store, so its first
    // snapshot IS a resync: shield local ops made before it arrives.
    if (this.joined) this.resyncPending = true;
    this.unsubscribers = [
      this.store.on('add', (el, meta) =>
        this.onLocal({ kind: 'upsert', element: el }, meta.origin),
      ),
      this.store.on('update', ({ current }, meta) =>
        this.onLocal({ kind: 'upsert', element: current }, meta.origin),
      ),
      this.store.on('remove', (el, meta) =>
        this.onLocal({ kind: 'remove', id: el.id }, meta.origin),
      ),
      this.store.on('clear', (_data, meta) => this.onLocal({ kind: 'clear' }, meta.origin)),
      this.transport.onMessage((msg) => this.onRemote(msg)),
    ];
    if (this.transport.onReconnect) {
      this.unsubscribers.push(this.transport.onReconnect(() => this.onReconnect()));
    }
    // MUST be last: a synchronous bus delivers the peer's reply reentrantly, so the
    // onMessage receive handler above must already be wired before we request.
    this.sendOp({ kind: 'request-snapshot' });
  }

  private onReconnect(): void {
    this.resyncPending = true;
    this.touchedDuringResync.clear();
    this.sendOp({ kind: 'request-snapshot' });
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.unsubscribers.forEach((u) => u());
    this.unsubscribers = [];
  }

  sendPresence(data: unknown): void {
    if (!this.started) return;
    this.sendOp({ kind: 'presence', data });
  }

  onPresence(handler: (from: string, data: unknown) => void): () => void {
    this.presenceHandlers.add(handler);
    return () => this.presenceHandlers.delete(handler);
  }

  onPresenceLeave(handler: (from: string) => void): () => void {
    this.presenceLeaveHandlers.add(handler);
    return () => this.presenceLeaveHandlers.delete(handler);
  }

  private sendOp(op: SyncOp): void {
    this.transport.send(JSON.stringify({ from: this.clientId, op }));
  }

  private stampAudience(op: SyncOp): SyncOp {
    if (op.kind !== 'upsert' || !this.resolveAudience) return op;
    const audience = this.resolveAudience(op.element);
    if (audience === undefined) return op;
    const element: SyncElement = { ...op.element, audience };
    return { kind: 'upsert', element };
  }

  private onLocal(op: SyncOp, origin: string | undefined): void {
    if (isExternal(origin)) return; // applied remote ops must not re-broadcast
    const outgoing = this.stampAudience(op);
    if (this.resyncPending) {
      if (outgoing.kind === 'upsert') this.touchedDuringResync.add(outgoing.element.id);
      else if (outgoing.kind === 'remove') this.touchedDuringResync.add(outgoing.id);
      // 'clear' during a resync window is not shielded (whole-store, rare) — acceptable
    }
    // Fire-and-forget delivery: a sent upsert is assumed to reach the hub, the
    // same assumption the resync shield already makes.
    if (outgoing.kind === 'upsert') this.hubKnownIds.add(outgoing.element.id);
    this.sendOp(outgoing);
  }

  private onRemote(message: string): void {
    const env = parseEnvelope(message);
    // clientId is STABLE across transport reconnects, so this guard also drops our own ops that the
    // relay echoes back after a reconnect (the reconnected socket is a NEW hub connection, so the hub's
    // connId echo-suppression does not cover them). Do NOT key this guard off the connection.
    if (!env || env.from === this.clientId) return; // malformed/invalid + own echo
    const op = env.op;
    if (op.kind === 'request-snapshot') {
      this.sendOp({ kind: 'snapshot', to: env.from, elements: this.store.snapshot() });
    } else if (op.kind === 'snapshot') {
      if (op.to !== this.clientId) return; // not addressed to us
      const phase: AuthoritativeSnapshotPhase = this.joined ? 'reconcile' : 'bootstrap';
      const preserved = this.applyAuthoritativeSnapshot(phase, op.elements.filter(isValidElement));
      this.joined = true;
      this.resyncPending = false; // TD-1: finalize after ANY snapshot (merge OR reconcile)
      this.touchedDuringResync.clear();
      // Re-push AFTER the resync finalizes, through the normal local-upsert
      // path (audience stamping, hub-knowledge marking) — synchronously, so
      // hosts never need deferred-macrotask timing around snapshots.
      for (const id of preserved) {
        const element = this.store.getById(id);
        if (element) this.onLocal({ kind: 'upsert', element }, 'local');
      }
    } else if (op.kind === 'presence') {
      for (const h of this.presenceHandlers) h(env.from, op.data);
    } else if (op.kind === 'presence-leave') {
      for (const h of this.presenceLeaveHandlers) h(env.from);
    } else {
      this.applyOp(op); // narrows to upsert | remove | clear
    }
  }

  private applyOp(op: SyncOp): void {
    if (op.kind === 'upsert') {
      const el = op.element;
      this.hubKnownIds.add(el.id); // remote/snapshot upserts are hub evidence
      if (this.store.getById(el.id)) {
        this.store.update(el.id, el, { origin: REMOTE_ORIGIN });
      } else {
        this.store.add(el, { origin: REMOTE_ORIGIN });
      }
    } else if (op.kind === 'remove') {
      this.store.remove(op.id, { origin: REMOTE_ORIGIN });
    } else if (op.kind === 'clear') {
      this.store.clear({ origin: REMOTE_ORIGIN });
    }
    // applyOp handles the data ops only (upsert/remove/clear). The control ops
    // (request-snapshot/snapshot) are dispatched in onRemote; unknown kinds are filtered by
    // isValidEnvelope — so no destructive default here.
  }

  /**
   * Applies an authoritative snapshot under explicit bootstrap/reconcile
   * semantics and returns the ids the host chose to preserve and re-push.
   */
  private applyAuthoritativeSnapshot(
    phase: AuthoritativeSnapshotPhase,
    snapshot: CanvasElement[],
  ): string[] {
    const snapshotIds = new Set(snapshot.map((e) => e.id));
    const localOnly: LocalOnlyElement[] = [];
    for (const local of this.store.snapshot()) {
      if (snapshotIds.has(local.id) || this.touchedDuringResync.has(local.id)) continue;
      localOnly.push({ element: local, hubKnown: this.hubKnownIds.has(local.id) });
    }
    const { preserve, discard } = this.resolveLocalOnlyDecision(phase, snapshot, localOnly);
    for (const entry of localOnly) {
      const id = entry.element.id;
      if (preserve.has(id)) continue;
      if (phase === 'reconcile' || discard.has(id)) {
        // deleted-while-away (reconcile default) or host-discarded — no re-broadcast
        this.store.remove(id, { origin: REMOTE_ORIGIN });
      }
    }
    for (const el of snapshot) {
      // On reconcile a touched local edit is newer + already sent to the hub.
      if (phase === 'reconcile' && this.touchedDuringResync.has(el.id)) continue;
      this.applyOp({ kind: 'upsert', element: el });
    }
    return [...preserve];
  }

  private resolveLocalOnlyDecision(
    phase: AuthoritativeSnapshotPhase,
    snapshot: readonly CanvasElement[],
    localOnly: readonly LocalOnlyElement[],
  ): { preserve: Set<string>; discard: Set<string> } {
    const preserve = new Set<string>();
    const discard = new Set<string>();
    if (!this.resolveLocalOnly) return { preserve, discard };
    let resolution: LocalOnlyResolution | undefined;
    try {
      resolution = this.resolveLocalOnly({ phase, snapshot, localOnly });
    } catch {
      return { preserve, discard }; // host hook failure → phase defaults; the resync still finalizes
    }
    if (!resolution) return { preserve, discard };
    const localIds = new Set(localOnly.map((entry) => entry.element.id));
    for (const id of resolution.discard ?? []) {
      if (localIds.has(id)) discard.add(id);
    }
    for (const id of resolution.preserve ?? []) {
      if (!localIds.has(id)) continue;
      preserve.add(id); // preserve wins over discard for the same id
      discard.delete(id);
    }
    return { preserve, discard };
  }
}
