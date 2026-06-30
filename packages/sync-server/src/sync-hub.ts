import { parseEnvelope } from '@fieldnotes/sync';
import { MemoryHubBackend } from './memory-hub-backend';
import type { HubBackend } from './hub-backend';

export interface Connection {
  id: string;
  room: string;
  send(message: string): void;
}

export interface SyncHubOptions {
  backend?: HubBackend;
}

const HUB_FROM = 'hub';

export class SyncHub {
  private readonly backend: HubBackend;
  private readonly conns = new Map<string, Connection>();
  private readonly rooms = new Map<string, Set<string>>(); // room → connIds
  private readonly roomQueues = new Map<string, Promise<void>>(); // room → serial tail

  constructor(options: SyncHubOptions = {}) {
    this.backend = options.backend ?? new MemoryHubBackend();
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
      const elements = await this.backend.snapshot(conn.room);
      conn.send(
        JSON.stringify({ from: HUB_FROM, op: { kind: 'snapshot', to: env.from, elements } }),
      );
    } else if (op.kind === 'upsert' || op.kind === 'remove' || op.kind === 'clear') {
      await this.backend.apply(conn.room, op);
      const members = this.rooms.get(conn.room);
      if (members) {
        for (const id of members) {
          if (id === conn.id) continue;
          this.conns.get(id)?.send(message);
        }
      }
    }
    // 'snapshot' from a client → ignored
  }
}
