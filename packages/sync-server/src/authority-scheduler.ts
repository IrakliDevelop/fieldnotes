type WorkKind = 'metadata' | 'heavy' | 'commit';
const PUBLISHER = Symbol('authority-publisher');
interface Descriptor {
  kind: WorkKind;
  run: () => Promise<void>;
  afterRelease?: () => void;
  dirty: boolean;
  active: boolean;
}
interface PeerReservation {
  room: string;
  prospective: boolean;
  retired: boolean;
  active: number;
  onRelease?: () => void;
}

/** Fixed authority reservations; callbacks release only after actual work settlement. */
export class AuthorityScheduler {
  private readonly usage = { metadata: 0, heavy: 0, commit: 0, stream: 0 };
  private readonly limits = { metadata: 8, heavy: 2, commit: 4, stream: 4 };
  private readonly peers = new Map<string, PeerReservation>();
  private readonly rooms = new Map<string, number>();
  private readonly ready = new Map<string | typeof PUBLISHER, Descriptor>();
  private prospective = 0;
  private closed = false;

  admitPeer(
    id: string,
    room: string,
    prospective: boolean,
    onRelease?: () => void,
  ): (() => void) | null {
    if (
      this.closed ||
      this.peers.has(id) ||
      this.peers.size >= 128 ||
      (prospective && this.prospective >= 32) ||
      (!this.rooms.has(room) && this.rooms.size >= 32)
    )
      return null;
    const reservation: PeerReservation = {
      room,
      prospective,
      retired: false,
      active: 0,
      onRelease,
    };
    this.peers.set(id, reservation);
    this.rooms.set(room, (this.rooms.get(room) ?? 0) + 1);
    if (prospective) this.prospective++;
    return () => {
      if (reservation.retired) return;
      reservation.retired = true;
      this.ready.delete(id);
      this.finishPeer(id, reservation);
    };
  }

  private finishPeer(id: string, reservation: PeerReservation): void {
    if (!reservation.retired || reservation.active !== 0 || this.peers.get(id) !== reservation)
      return;
    this.peers.delete(id);
    const count = (this.rooms.get(reservation.room) ?? 1) - 1;
    if (count === 0) this.rooms.delete(reservation.room);
    else this.rooms.set(reservation.room, count);
    if (reservation.prospective) this.prospective--;
    reservation.onRelease?.();
  }

  retainPeer(id: string): (() => void) | null {
    const reservation = this.peers.get(id);
    if (!reservation || reservation.retired) return null;
    reservation.active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      reservation.active--;
      this.finishPeer(id, reservation);
    };
  }

  promotePeer(id: string): void {
    const reservation = this.peers.get(id);
    if (reservation?.prospective) {
      reservation.prospective = false;
      this.prospective--;
    }
  }

  reserve(kind: WorkKind | 'stream', peerId?: string): (() => void) | null {
    if (this.closed || this.usage[kind] >= this.limits[kind]) return null;
    const releasePeer = peerId === undefined ? undefined : this.retainPeer(peerId);
    if (peerId !== undefined && !releasePeer) return null;
    this.usage[kind]++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.usage[kind]--;
      releasePeer?.();
      this.pump();
    };
  }

  /** One coalesced descriptor per peer; a busy peer never accumulates tasks. */
  schedule(
    peerId: string,
    kind: WorkKind,
    run: () => Promise<void>,
    afterRelease?: () => void,
  ): void {
    if (this.closed || !this.peers.has(peerId) || this.peers.get(peerId)?.retired) return;
    const existing = this.ready.get(peerId);
    if (existing) {
      existing.kind = kind;
      existing.run = run;
      existing.afterRelease = afterRelease;
      existing.dirty = true;
      return;
    }
    this.ready.set(peerId, { kind, run, afterRelease, dirty: true, active: false });
    this.pump();
  }

  /** The publisher has one coalesced global descriptor, even without admitted peers. */
  schedulePublisher(run: () => Promise<void>): void {
    if (this.closed) return;
    const existing = this.ready.get(PUBLISHER);
    if (existing) {
      existing.run = run;
      existing.dirty = true;
      return;
    }
    this.ready.set(PUBLISHER, { kind: 'metadata', run, dirty: true, active: false });
    this.pump();
  }

  private pump(): void {
    if (this.closed) return;
    for (const [key, descriptor] of this.ready) {
      if (!descriptor.dirty || descriptor.active) continue;
      const release = this.reserve(descriptor.kind, key === PUBLISHER ? undefined : key);
      if (!release) continue;
      descriptor.active = true;
      descriptor.dirty = false;
      const run = descriptor.run;
      const afterRelease = descriptor.afterRelease;
      // Rotate so the next vacant slot starts with another peer.
      this.ready.delete(key);
      this.ready.set(key, descriptor);
      void Promise.resolve()
        .then(run)
        .catch(() => undefined)
        .finally(() => {
          descriptor.active = false;
          if (this.ready.get(key) === descriptor && !descriptor.dirty) this.ready.delete(key);
          release();
          try {
            afterRelease?.();
          } catch {
            // A post-work callback cannot change scheduler settlement.
          }
        });
    }
  }

  close(): void {
    this.closed = true;
    this.ready.clear();
    // Active reservations intentionally remain occupied until their real promises settle.
  }
}
