import type { ApplyResult, HubBackend, WireElement, WireSyncOp } from './types';

export class BufferedBackend implements HubBackend {
  private readonly buffers = new Map<string, WireElement[]>();
  private readonly index = new Map<string, Map<string, WireElement>>();

  constructor(private readonly inner: HubBackend) {}

  async snapshot(room: string): Promise<WireElement[]> {
    const innerSnapshot = await this.inner.snapshot(room);
    const buffered = this.buffers.get(room) ?? [];
    const merged = new Map<string, WireElement>();

    for (const el of innerSnapshot) {
      merged.set(el.id, el);
    }
    for (const el of buffered) {
      merged.set(el.id, el);
    }

    return [...merged.values()];
  }

  async get(room: string, id: string): Promise<WireElement | undefined> {
    const roomIndex = this.index.get(room);
    if (roomIndex?.has(id)) {
      return roomIndex.get(id);
    }
    return this.inner.get(room, id);
  }

  async apply(room: string, op: WireSyncOp): Promise<ApplyResult> {
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
    const buffered = this.buffers.get(room) ?? [];
    this.buffers.delete(room);
    this.index.delete(room);

    for (const el of buffered) {
      await this.inner.apply(room, { kind: 'upsert', element: el });
    }

    return buffered;
  }

  async dispose(): Promise<void> {
    this.buffers.clear();
    this.index.clear();
    await this.inner.dispose?.();
  }

  getBufferedCount(room: string): number {
    return this.buffers.get(room)?.length ?? 0;
  }

  private bufferOp(room: string, op: WireSyncOp): void {
    if (op.kind !== 'upsert') return;

    if (!this.buffers.has(room)) {
      this.buffers.set(room, []);
    }
    if (!this.index.has(room)) {
      this.index.set(room, new Map());
    }

    const buffer = this.buffers.get(room);
    const roomIndex = this.index.get(room);
    if (!buffer || !roomIndex) return;

    const existingIdx = buffer.findIndex((e) => e.id === op.element.id);
    if (existingIdx >= 0) {
      buffer[existingIdx] = op.element;
    } else {
      buffer.push(op.element);
    }
    roomIndex.set(op.element.id, op.element);
  }
}

function isBaseElementOp(op: WireSyncOp): boolean {
  if (op.kind !== 'upsert') return false;
  const type = op.element.type;
  return type !== 'grid' && type !== 'template' && type !== 'extension';
}

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
