export interface EventMeta {
  origin?: string;
}

const EMPTY_META: EventMeta = Object.freeze({});

type Listener<T> = (data: T, meta: EventMeta) => void;

interface CoalescedEvent<TEvents> {
  readonly event: keyof TEvents;
  readonly data: TEvents[keyof TEvents];
  readonly meta?: EventMeta;
}

export class EventBus<TEvents extends { [K in keyof TEvents]: TEvents[K] }> {
  private listeners = new Map<keyof TEvents, Set<Listener<never>>>();
  private notificationDepth = 0;
  private pending: { event: keyof TEvents; data: TEvents[keyof TEvents]; meta: EventMeta }[] = [];

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
    if (this.notificationDepth > 0) {
      this.pending.push({ event, data, meta });
      return;
    }
    this.deliver(event, data, meta);
  }

  suspendNotifications(coalesce?: () => CoalescedEvent<TEvents>): {
    resume(): void;
    discard(): void;
  } {
    this.notificationDepth += 1;
    let settled = false;
    const settle = (flush: boolean): void => {
      if (settled) return;
      settled = true;
      this.notificationDepth = Math.max(0, this.notificationDepth - 1);
      if (!flush) this.pending = [];
      if (flush && this.notificationDepth === 0) {
        const pending = this.pending;
        this.pending = [];
        if (coalesce && pending.length > 0) {
          const item = coalesce();
          this.deliver(item.event, item.data, item.meta ?? EMPTY_META);
        } else {
          for (const item of pending) this.deliver(item.event, item.data, item.meta);
        }
      }
    };
    return {
      resume: () => settle(true),
      discard: () => settle(false),
    };
  }

  private deliver<K extends keyof TEvents>(event: K, data: TEvents[K], meta: EventMeta): void {
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
    this.pending = [];
  }
}
