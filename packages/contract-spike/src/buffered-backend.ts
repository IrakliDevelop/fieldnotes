import type { ApplyResult, HubBackend, WireElement, WireSyncOp } from './types';

// ─── Buffer entry types ──────────────────────────────────────────────────────

type BufferEntry = { kind: 'upsert'; element: WireElement } | { kind: 'remove'; id: string };

// ─── BufferedBackend ─────────────────────────────────────────────────────────

export class BufferedBackend implements HubBackend {
  private readonly buffers = new Map<string, BufferEntry[]>();
  private readonly index = new Map<string, Map<string, WireElement>>();
  private readonly clearedRooms = new Set<string>();

  constructor(private readonly inner: HubBackend) {}

  async snapshot(room: string): Promise<WireElement[]> {
    if (this.clearedRooms.has(room)) {
      // After clear: return only buffered upserts, not inner contents
      const buffer = this.buffers.get(room) ?? [];
      return buffer
        .filter((e): e is Extract<BufferEntry, { kind: 'upsert' }> => e.kind === 'upsert')
        .map((e) => e.element);
    }

    const innerSnapshot = await this.inner.snapshot(room);
    const buffer = this.buffers.get(room) ?? [];
    const merged = new Map<string, WireElement>();

    for (const el of innerSnapshot) {
      merged.set(el.id, el);
    }
    for (const entry of buffer) {
      if (entry.kind === 'upsert') {
        merged.set(entry.element.id, entry.element);
      } else {
        // Tombstone: exclude this ID from the snapshot
        merged.delete(entry.id);
      }
    }

    return [...merged.values()];
  }

  async get(room: string, id: string): Promise<WireElement | undefined> {
    // If room is cleared, only look in buffer
    if (this.clearedRooms.has(room)) {
      const roomIndex = this.index.get(room);
      return roomIndex?.get(id);
    }

    const roomIndex = this.index.get(room);
    if (roomIndex) {
      // Check if this ID has been tombstoned in the buffer
      const buffer = this.buffers.get(room) ?? [];
      const hasTombstone = buffer.some((e) => e.kind === 'remove' && e.id === id);
      if (hasTombstone && !roomIndex.has(id)) {
        return undefined;
      }
      if (roomIndex.has(id)) {
        return roomIndex.get(id);
      }
    }
    return this.inner.get(room, id);
  }

  async apply(room: string, op: WireSyncOp): Promise<ApplyResult> {
    if (op.kind === 'clear' && isBaseElementRoom(room, op)) {
      this.clearRoom(room);
      return {
        accepted: op,
        corrections: [],
        locality: 'local',
      };
    }

    if (isBaseElementOp(op)) {
      this.bufferOp(room, op);
      return {
        accepted: op,
        corrections: [],
        locality: 'local',
      };
    }

    return this.inner.apply(room, op);
  }

  async flush(room: string): Promise<WireElement[]> {
    const buffer = this.buffers.get(room) ?? [];
    const wasCleared = this.clearedRooms.has(room);

    // Persist ALL buffered ops to inner FIRST
    if (wasCleared) {
      await this.inner.apply(room, { kind: 'clear' });
    }

    for (const entry of buffer) {
      if (entry.kind === 'upsert') {
        await this.inner.apply(room, { kind: 'upsert', element: entry.element });
      } else {
        await this.inner.apply(room, { kind: 'remove', id: entry.id });
      }
    }

    // Only delete buffers AFTER all persist calls succeed
    this.buffers.delete(room);
    this.index.delete(room);
    this.clearedRooms.delete(room);

    // Return the resulting elements (upserts only)
    return buffer
      .filter((e): e is Extract<BufferEntry, { kind: 'upsert' }> => e.kind === 'upsert')
      .map((e) => e.element);
  }

  async dispose(): Promise<void> {
    // Flush all pending rooms before disposing
    const rooms = [...this.buffers.keys()];
    for (const room of rooms) {
      try {
        await this.flush(room);
      } catch (err) {
        console.warn(`BufferedBackend: failed to flush room "${room}" during dispose`, err);
      }
    }

    this.buffers.clear();
    this.index.clear();
    this.clearedRooms.clear();
    await this.inner.dispose?.();
  }

  getBufferedCount(room: string): number {
    return this.buffers.get(room)?.length ?? 0;
  }

  private bufferOp(room: string, op: WireSyncOp): void {
    if (!this.buffers.has(room)) {
      this.buffers.set(room, []);
    }
    if (!this.index.has(room)) {
      this.index.set(room, new Map());
    }

    const buffer = this.buffers.get(room);
    const roomIndex = this.index.get(room);
    if (!buffer || !roomIndex) return;

    if (op.kind === 'upsert') {
      // Remove any existing entry for this ID, then append
      const existingIdx = buffer.findIndex(
        (e) =>
          (e.kind === 'upsert' && e.element.id === op.element.id) ||
          (e.kind === 'remove' && e.id === op.element.id),
      );
      if (existingIdx >= 0) {
        buffer.splice(existingIdx, 1);
      }
      buffer.push({ kind: 'upsert', element: op.element });
      roomIndex.set(op.element.id, op.element);
    } else if (op.kind === 'remove') {
      // Remove any existing entry for this ID, then add tombstone
      const existingIdx = buffer.findIndex(
        (e) =>
          (e.kind === 'upsert' && e.element.id === op.id) ||
          (e.kind === 'remove' && e.id === op.id),
      );
      if (existingIdx >= 0) {
        buffer.splice(existingIdx, 1);
      }
      buffer.push({ kind: 'remove', id: op.id });
      roomIndex.delete(op.id);
    }
  }

  private clearRoom(room: string): void {
    this.clearedRooms.add(room);
    this.buffers.set(room, []);
    this.index.set(room, new Map());
  }
}

// ─── Op classification ───────────────────────────────────────────────────────

function isBaseElementOp(op: WireSyncOp): boolean {
  if (op.kind === 'upsert') {
    const type = op.element.type;
    return type !== 'grid' && type !== 'template' && type !== 'extension';
  }
  if (op.kind === 'remove') {
    return true;
  }
  return false;
}

/** Clear is room-scoped, not element-type-scoped — always buffer it. */
function isBaseElementRoom(_room: string, _op: WireSyncOp): boolean {
  return true;
}

// ─── In-memory backend (test helper) ─────────────────────────────────────────

export function createMemoryBackend(): HubBackend {
  const store = new Map<string, Map<string, WireElement>>();

  return {
    async snapshot(room: string): Promise<WireElement[]> {
      return [...(store.get(room)?.values() ?? [])];
    },

    async get(room: string, id: string): Promise<WireElement | undefined> {
      return store.get(room)?.get(id);
    },

    async apply(room: string, op: WireSyncOp): Promise<ApplyResult> {
      if (!store.has(room)) {
        store.set(room, new Map());
      }
      const roomStore = store.get(room);
      if (!roomStore) return { accepted: null, corrections: [], locality: 'shared' };

      if (op.kind === 'upsert') {
        roomStore.set(op.element.id, op.element);
        return { accepted: op, corrections: [], locality: 'shared' };
      }
      if (op.kind === 'remove') {
        roomStore.delete(op.id);
        return { accepted: op, corrections: [], locality: 'shared' };
      }
      if (op.kind === 'clear') {
        roomStore.clear();
        return { accepted: op, corrections: [], locality: 'shared' };
      }

      return { accepted: null, corrections: [], locality: 'shared' };
    },

    async dispose(): Promise<void> {
      store.clear();
    },
  };
}
