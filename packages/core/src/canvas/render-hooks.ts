export type ViewportSlot = 'afterSceneBeforeOverlay' | 'afterOverlay' | 'afterToolOverlay';

const SLOT_ORDER: Record<ViewportSlot, number> = {
  afterSceneBeforeOverlay: 0,
  afterOverlay: 1,
  afterToolOverlay: 2,
};

export interface HookRegistrationOptions {
  slot?: ViewportSlot;
  priority?: number;
  required?: boolean;
  satisfies?: string[];
}

interface InternalEntry<T> {
  hooks: Partial<T>;
  slot: ViewportSlot;
  priority: number;
  required: boolean;
  satisfies: string[];
  insertionOrder: number;
}

export class TypedHookRegistry<T extends Record<string, unknown>> {
  private readonly entries: InternalEntry<T>[] = [];
  private readonly capabilityCounts = new Map<string, number>();
  private nextId = 0;

  register(hooks: Partial<T>, options: HookRegistrationOptions = {}): () => void {
    const entry: InternalEntry<T> = {
      hooks,
      slot: options.slot ?? 'afterSceneBeforeOverlay',
      priority: options.priority ?? 0,
      required: options.required ?? false,
      satisfies: options.satisfies ?? [],
      insertionOrder: this.nextId++,
    };

    this.entries.push(entry);

    for (const cap of entry.satisfies) {
      this.capabilityCounts.set(cap, (this.capabilityCounts.get(cap) ?? 0) + 1);
    }

    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      const idx = this.entries.indexOf(entry);
      if (idx >= 0) this.entries.splice(idx, 1);
      for (const cap of entry.satisfies) {
        const count = (this.capabilityCounts.get(cap) ?? 0) - 1;
        if (count <= 0) {
          this.capabilityCounts.delete(cap);
        } else {
          this.capabilityCounts.set(cap, count);
        }
      }
    };
  }

  *iterate(
    hookName: keyof T & string,
  ): Generator<Extract<T[keyof T], (...args: unknown[]) => unknown>> {
    const sorted = [...this.entries].sort((a, b) => {
      const slotDiff = SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot];
      if (slotDiff !== 0) return slotDiff;
      const prioDiff = a.priority - b.priority;
      if (prioDiff !== 0) return prioDiff;
      return a.insertionOrder - b.insertionOrder;
    });

    for (const entry of sorted) {
      const fn = entry.hooks[hookName];
      if (typeof fn === 'function') {
        yield fn as Extract<T[keyof T], (...args: unknown[]) => unknown>;
      }
    }
  }

  *iterateRequired(): Generator<Extract<T[keyof T], (...args: unknown[]) => unknown>> {
    const sorted = [...this.entries]
      .filter((e) => e.required)
      .sort((a, b) => {
        const slotDiff = SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot];
        if (slotDiff !== 0) return slotDiff;
        const prioDiff = a.priority - b.priority;
        if (prioDiff !== 0) return prioDiff;
        return a.insertionOrder - b.insertionOrder;
      });

    for (const entry of sorted) {
      for (const fn of Object.values(entry.hooks)) {
        if (typeof fn === 'function') {
          yield fn as Extract<T[keyof T], (...args: unknown[]) => unknown>;
        }
      }
    }
  }

  getSatisfiedCapabilities(): string[] {
    return [...this.capabilityCounts.keys()];
  }

  clear(): void {
    this.entries.length = 0;
    this.capabilityCounts.clear();
  }
}
