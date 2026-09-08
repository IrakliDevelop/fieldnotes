import type { ApplyResult, HubBackend, WireElement, WireSyncOp } from './types';

type BufferEntry = { kind: 'upsert'; element: WireElement } | { kind: 'remove'; id: string };

interface RoomState {
  readonly elements: Map<string, WireElement>;
  readonly pending: Map<string, BufferEntry>;
  hydrated: boolean;
  hydration?: Promise<void>;
  clearToken?: symbol;
}

/**
 * A write-behind HubBackend decorator. Element mutations fan out immediately from
 * this process and are persisted by flush(); backend plugin services still delegate
 * to the inner backend.
 */
export class BufferedBackend implements HubBackend {
  private readonly rooms = new Map<string, RoomState>();
  readonly sharedAcrossInstances = false;
  readonly layerRecords?: NonNullable<HubBackend['layerRecords']>;
  readonly getLayerRecord?: NonNullable<HubBackend['getLayerRecord']>;
  readonly applyLayerRecord?: NonNullable<HubBackend['applyLayerRecord']>;
  readonly getService?: NonNullable<HubBackend['getService']>;

  constructor(private readonly inner: HubBackend) {
    if (inner.layerRecords) this.layerRecords = inner.layerRecords.bind(inner);
    if (inner.getLayerRecord) this.getLayerRecord = inner.getLayerRecord.bind(inner);
    if (inner.applyLayerRecord) this.applyLayerRecord = inner.applyLayerRecord.bind(inner);
    if (inner.getService) this.getService = inner.getService.bind(inner);
  }

  async snapshot(room: string): Promise<WireElement[]> {
    const state = await this.ensureHydrated(room);
    return [...state.elements.values()];
  }

  async get(room: string, id: string): Promise<WireElement | undefined> {
    const state = await this.ensureHydrated(room);
    return state.elements.get(id);
  }

  async apply(room: string, op: WireSyncOp): Promise<ApplyResult> {
    if (op.kind === 'upsert' || op.kind === 'remove' || op.kind === 'clear') {
      const state = await this.ensureHydrated(room);
      this.bufferElementMutation(state, op);
      return { accepted: op, corrections: [], locality: 'local' };
    }

    return this.inner.apply(room, op);
  }

  async flush(room: string): Promise<WireElement[]> {
    const state = await this.ensureHydrated(room);
    const clearToken = state.clearToken;
    const entries = [...state.pending.entries()];

    if (clearToken) {
      await this.inner.apply(room, { kind: 'clear' });
    }
    for (const [, entry] of entries) {
      await this.inner.apply(
        room,
        entry.kind === 'upsert'
          ? { kind: 'upsert', element: entry.element }
          : { kind: 'remove', id: entry.id },
      );
    }

    // Delete only entries that still match the captured batch. An apply that
    // races with this flush remains pending for the next flush.
    if (clearToken && state.clearToken === clearToken) {
      state.clearToken = undefined;
    }
    for (const [id, entry] of entries) {
      if (state.pending.get(id) === entry) {
        state.pending.delete(id);
      }
    }

    return entries.flatMap(([, entry]) => (entry.kind === 'upsert' ? [entry.element] : []));
  }

  async dispose(): Promise<void> {
    for (const room of this.rooms.keys()) {
      await this.flush(room);
    }
    await this.inner.dispose?.();
    this.rooms.clear();
  }

  getBufferedCount(room: string): number {
    const state = this.rooms.get(room);
    return (state?.pending.size ?? 0) + (state?.clearToken ? 1 : 0);
  }

  private async ensureHydrated(room: string): Promise<RoomState> {
    let state = this.rooms.get(room);
    if (!state) {
      state = { elements: new Map(), pending: new Map(), hydrated: false };
      this.rooms.set(room, state);
    }
    if (state.hydrated) return state;

    state.hydration ??= this.hydrate(room, state);
    await state.hydration;
    return state;
  }

  private async hydrate(room: string, state: RoomState): Promise<void> {
    try {
      const persisted = await this.inner.snapshot(room);
      for (const element of persisted) {
        if (!state.clearToken && !state.pending.has(element.id)) {
          state.elements.set(element.id, element);
        }
      }
      state.hydrated = true;
    } finally {
      state.hydration = undefined;
    }
  }

  private bufferElementMutation(
    state: RoomState,
    op: Extract<WireSyncOp, { kind: 'upsert' | 'remove' | 'clear' }>,
  ): void {
    if (op.kind === 'clear') {
      state.elements.clear();
      state.pending.clear();
      state.clearToken = Symbol('clear');
      return;
    }
    if (op.kind === 'upsert') {
      const entry: BufferEntry = { kind: 'upsert', element: op.element };
      state.elements.set(op.element.id, op.element);
      state.pending.set(op.element.id, entry);
      return;
    }

    const entry: BufferEntry = { kind: 'remove', id: op.id };
    state.elements.delete(op.id);
    state.pending.set(op.id, entry);
  }
}

/** In-memory backend used by the executable contract tests. */
export function createMemoryBackend(): HubBackend {
  const store = new Map<string, Map<string, WireElement>>();

  return {
    async snapshot(room) {
      return [...(store.get(room)?.values() ?? [])];
    },
    async get(room, id) {
      return store.get(room)?.get(id);
    },
    async apply(room, op) {
      let roomStore = store.get(room);
      if (!roomStore) {
        roomStore = new Map();
        store.set(room, roomStore);
      }
      if (op.kind === 'upsert') roomStore.set(op.element.id, op.element);
      if (op.kind === 'remove') roomStore.delete(op.id);
      if (op.kind === 'clear') roomStore.clear();
      return { accepted: op, corrections: [], locality: 'shared' };
    },
    async dispose() {
      store.clear();
    },
  };
}
