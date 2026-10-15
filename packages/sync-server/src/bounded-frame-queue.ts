export const FRAME_TIMEOUT_MS = 5000;
export const MAX_CONNECTION_FRAMES = 64;
export const MAX_CONNECTION_BYTES = 4 * 1024 * 1024;
export const MAX_ROOM_FRAMES = 256;
export const MAX_ROOM_BYTES = 16 * 1024 * 1024;
export const MAX_AUTHORITY_FACTORY_FRAMES = 1024;
export const MAX_AUTHORITY_FACTORY_BYTES = 64 * 1024 * 1024;

interface Usage {
  count: number;
  bytes: number;
}

/** Counts queued and active inbound and outbound frames in one budget. */
export class FrameBudget {
  private readonly connections = new Map<string, Usage>();
  private readonly rooms = new Map<string, Usage>();
  private readonly global: Usage = { count: 0, bytes: 0 };

  constructor(
    private readonly connectionFrames = MAX_CONNECTION_FRAMES,
    private readonly connectionBytes = MAX_CONNECTION_BYTES,
    private readonly roomFrames = MAX_ROOM_FRAMES,
    private readonly roomBytes = MAX_ROOM_BYTES,
    private readonly globalFrames = Infinity,
    private readonly globalBytes = Infinity,
  ) {}

  reserve(connectionId: string, room: string, message: string): (() => void) | null {
    const bytes = Buffer.byteLength(message, 'utf8');
    const conn = this.connections.get(connectionId) ?? { count: 0, bytes: 0 };
    const shared = this.rooms.get(room) ?? { count: 0, bytes: 0 };
    if (
      conn.count + 1 > this.connectionFrames ||
      conn.bytes + bytes > this.connectionBytes ||
      shared.count + 1 > this.roomFrames ||
      shared.bytes + bytes > this.roomBytes ||
      this.global.count + 1 > this.globalFrames ||
      this.global.bytes + bytes > this.globalBytes
    )
      return null;
    conn.count++;
    conn.bytes += bytes;
    shared.count++;
    shared.bytes += bytes;
    this.global.count++;
    this.global.bytes += bytes;
    this.connections.set(connectionId, conn);
    this.rooms.set(room, shared);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      conn.count--;
      conn.bytes -= bytes;
      shared.count--;
      shared.bytes -= bytes;
      this.global.count--;
      this.global.bytes -= bytes;
      if (conn.count === 0) this.connections.delete(connectionId);
      if (shared.count === 0) this.rooms.delete(room);
    };
  }
}
