export interface HubFanout {
  publish(payload: string): void;
  subscribe(handler: (payload: string) => void): () => void;
  close?(): void;
}

export class InMemoryHubFanout implements HubFanout {
  private readonly handlers = new Set<(payload: string) => void>();

  publish(payload: string): void {
    for (const h of this.handlers) {
      try {
        h(payload);
      } catch {
        /* one throwing subscriber must not break the publish loop */
      }
    }
  }

  subscribe(handler: (payload: string) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
}
