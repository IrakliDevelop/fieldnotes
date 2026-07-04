import { parseEnvelope, type SyncOp } from '@fieldnotes/sync';
import { MemoryHubBackend } from './memory-hub-backend';
import { InMemoryHubFanout, type HubFanout } from './hub-fanout';
import type { HubBackend } from './hub-backend';
import type { Authorize, CanRead, OwnedElement } from './authorize';

export interface Connection {
  id: string;
  room: string;
  userId?: string;
  role?: string;
  send(message: string): void;
}

export interface SyncHubOptions {
  backend?: HubBackend;
  fanout?: HubFanout;
  instanceId?: string;
  authorize?: Authorize;
  canRead?: CanRead;
}

const HUB_FROM = 'hub';

function generateInstanceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    return crypto.randomUUID();
  return `i-${Math.random().toString(36).slice(2)}`;
}

export class SyncHub {
  private readonly backend: HubBackend;
  private readonly conns = new Map<string, Connection>();
  private readonly rooms = new Map<string, Set<string>>(); // room → connIds
  private readonly roomQueues = new Map<string, Promise<void>>(); // room → serial tail
  private readonly instanceId: string;
  private readonly fanout: HubFanout;
  private readonly fanoutUnsub: () => void;
  private readonly authorize?: Authorize;
  private readonly canRead?: CanRead;

  constructor(options: SyncHubOptions = {}) {
    this.backend = options.backend ?? new MemoryHubBackend();
    this.instanceId = options.instanceId ?? generateInstanceId();
    this.fanout = options.fanout ?? new InMemoryHubFanout();
    this.authorize = options.authorize;
    this.canRead = options.canRead;
    this.fanoutUnsub = this.fanout.subscribe((payload) => this.onFanout(payload));
  }

  addConnection(conn: Connection): void {
    this.conns.set(conn.id, conn);
    let set = this.rooms.get(conn.room);
    if (!set) {
      set = new Set();
      this.rooms.set(conn.room, set);
    }
    set.add(conn.id);
  }

  removeConnection(connId: string): void {
    const conn = this.conns.get(connId);
    if (!conn) return;
    this.conns.delete(connId);
    const members = this.rooms.get(conn.room);
    if (members) {
      members.delete(connId);
      if (members.size === 0) {
        this.rooms.delete(conn.room);
        this.roomQueues.delete(conn.room);
      }
    }
  }

  roomCount(): number {
    return this.rooms.size;
  }

  handleMessage(connId: string, message: string): Promise<void> {
    const conn = this.conns.get(connId);
    if (!conn) return Promise.resolve();
    const room = conn.room;
    // The per-room serial queue is the single total-order authority: ops apply in arrival order
    // (arrival-order LWW — no per-element seq; see D3 / TD-12). Different rooms run independently.
    const prev = this.roomQueues.get(room) ?? Promise.resolve();
    const next = prev
      .then(() => this.process(conn, message))
      .catch(() => {
        // swallow so one failed message never wedges the room's serial queue
      });
    this.roomQueues.set(room, next);
    return next;
  }

  private async process(conn: Connection, message: string): Promise<void> {
    const env = parseEnvelope(message);
    if (!env) return;
    const op = env.op;
    if (op.kind === 'request-snapshot') {
      const all = (await this.backend.snapshot(conn.room)) as OwnedElement[];
      const elements = this.canRead ? all.filter((el) => this.mayRead(conn, el.audience)) : all;
      conn.send(
        JSON.stringify({ from: HUB_FROM, op: { kind: 'snapshot', to: env.from, elements } }),
      );
    } else if (op.kind === 'upsert' || op.kind === 'remove' || op.kind === 'clear') {
      const id = op.kind === 'upsert' ? op.element.id : op.kind === 'remove' ? op.id : undefined;
      const needCurrent = (this.authorize || this.canRead) && id !== undefined;
      const current: OwnedElement | undefined = needCurrent
        ? await this.backend.get(conn.room, id)
        : undefined;

      let outboundOp: SyncOp = op;
      if (this.authorize) {
        const allowed = await this.authorize({
          userId: conn.userId,
          role: conn.role,
          room: conn.room,
          op,
          currentElement: current,
        });
        if (!allowed) {
          await this.sendCorrection(conn, env.from, op, current);
          return;
        }
        if (op.kind === 'upsert') {
          const ownerId = current?.ownerId ?? conn.userId;
          const stampedElement: OwnedElement = { ...op.element, ownerId };
          outboundOp = { kind: 'upsert', element: stampedElement };
        }
      }

      await this.backend.apply(conn.room, outboundOp);

      const prevExisted = current !== undefined;
      const prevAudience = current?.audience;

      this.deliverToRoom(conn.room, conn.id, env.from, outboundOp, prevAudience, prevExisted);

      this.fanout.publish(
        JSON.stringify({
          o: this.instanceId,
          room: conn.room,
          from: env.from,
          op: outboundOp,
          prev: prevAudience,
          existed: prevExisted,
          // Transitional: the current onFanout still reads `m`. Kept so cross-instance forwarding
          // (and its tests) stay green until the next task reworks onFanout to consume the fields above.
          m: JSON.stringify({ from: env.from, op: outboundOp }),
        }),
      );
    }
    // 'snapshot' from a client → ignored
  }

  private mayRead(conn: Connection, audience: string | undefined): boolean {
    if (!this.canRead) return true;
    return this.canRead({ userId: conn.userId, role: conn.role, room: conn.room, audience });
  }

  private deliverToRoom(
    room: string,
    excludeId: string | undefined,
    from: string,
    op: SyncOp,
    prevAudience: string | undefined,
    prevExisted: boolean,
  ): void {
    const members = this.rooms.get(room);
    if (!members) return;
    const send = (conn: Connection, msg: string): void => {
      try {
        conn.send(msg);
      } catch {
        /* a throwing socket must not break the delivery loop */
      }
    };
    if (op.kind === 'upsert') {
      const audience = (op.element as OwnedElement).audience;
      const upsertMsg = JSON.stringify({ from, op });
      const removeMsg = JSON.stringify({
        from: HUB_FROM,
        op: { kind: 'remove', id: op.element.id },
      });
      for (const cid of members) {
        if (cid === excludeId) continue;
        const conn = this.conns.get(cid);
        if (!conn) continue;
        if (this.mayRead(conn, audience)) send(conn, upsertMsg);
        else if (prevExisted && this.mayRead(conn, prevAudience)) send(conn, removeMsg);
      }
    } else if (op.kind === 'remove') {
      const removeMsg = JSON.stringify({ from, op });
      for (const cid of members) {
        if (cid === excludeId) continue;
        const conn = this.conns.get(cid);
        if (!conn) continue;
        // No read filter → forward to all (today's behavior; current/prevExisted aren't fetched without
        // a hook). With canRead, only recipients who could see the removed element get it.
        const wasVisible = !this.canRead || (prevExisted && this.mayRead(conn, prevAudience));
        if (wasVisible) send(conn, removeMsg);
      }
    } else if (op.kind === 'clear') {
      const clearMsg = JSON.stringify({ from, op });
      for (const cid of members) {
        if (cid === excludeId) continue;
        const conn = this.conns.get(cid);
        if (conn) send(conn, clearMsg);
      }
    }
  }

  private async sendCorrection(
    conn: Connection,
    from: string,
    op: SyncOp,
    current: OwnedElement | undefined,
  ): Promise<void> {
    let correction: SyncOp | undefined;
    if (op.kind === 'upsert') {
      correction = current
        ? { kind: 'upsert', element: current }
        : { kind: 'remove', id: op.element.id };
    } else if (op.kind === 'remove') {
      correction = current ? { kind: 'upsert', element: current } : undefined;
    } else if (op.kind === 'clear') {
      const elements = await this.backend.snapshot(conn.room);
      correction = { kind: 'snapshot', to: from, elements };
    }
    if (correction) conn.send(JSON.stringify({ from: HUB_FROM, op: correction }));
  }

  private onFanout(payload: string): void {
    // Off the serial queue on purpose: forward-only (no backend re-apply — the origin already applied to the
    // SHARED backend), and delivery is already ordered. Do not wrap this in roomQueues.
    let env: { o?: unknown; room?: unknown; m?: unknown };
    try {
      env = JSON.parse(payload);
    } catch {
      return;
    }
    if (typeof env.o !== 'string' || typeof env.room !== 'string' || typeof env.m !== 'string')
      return;
    if (env.o === this.instanceId) return; // our own publish — already forwarded locally
    const members = this.rooms.get(env.room);
    if (!members) return;
    const m = env.m;
    for (const id of members) {
      try {
        this.conns.get(id)?.send(m);
      } catch {
        /* a throwing socket must not break the fanout loop */
      }
    }
  }

  close(): void {
    this.fanoutUnsub();
  }
}
