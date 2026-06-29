export interface EventMeta {
  origin?: string;
}

const EMPTY_META: EventMeta = Object.freeze({});

type Listener<T> = (data: T, meta: EventMeta) => void;

export class EventBus<TEvents extends { [K in keyof TEvents]: TEvents[K] }> {
  private listeners = new Map<keyof TEvents, Set<Listener<never>>>();

  on<K extends keyof TEvents>(event: K, listener: Listener<TEvents[K]>): () => void {
    const existing = this.listeners.get(event);
    if (existing) {
      existing.add(listener as Listener<never>);
    } else {
      const set = new Set<Listener<never>>([listener as Listener<never>]);
      this.listeners.set(event, set);
    }
    return () => this.off(event, listener);
  }

  off<K extends keyof TEvents>(event: K, listener: Listener<TEvents[K]>): void {
    this.listeners.get(event)?.delete(listener as Listener<never>);
  }

  emit<K extends keyof TEvents>(event: K, data: TEvents[K], meta: EventMeta = EMPTY_META): void {
    this.listeners.get(event)?.forEach((listener) => {
      try {
        listener(data as never, meta);
      } catch (err) {
        console.error(`[fieldnotes] listener error for "${String(event)}"`, err);
      }
    });
  }

  clear(): void {
    this.listeners.clear();
  }
}
