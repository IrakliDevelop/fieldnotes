import type { HubFanout } from '@fieldnotes/sync-server';
import type { RedisPublisher, RedisSubscriber } from './redis-fanout-client';

export interface RedisHubFanoutOptions {
  channel?: string;
  onError?: (err: unknown) => void;
}

export class RedisHubFanout implements HubFanout {
  private readonly publisher: RedisPublisher;
  private readonly subscriber: RedisSubscriber;
  private readonly channel: string;
  private readonly onError: (err: unknown) => void;
  private readonly handlers = new Set<(payload: string) => void>();
  private subscribed = false;

  constructor(
    publisher: RedisPublisher,
    subscriber: RedisSubscriber,
    options: RedisHubFanoutOptions = {},
  ) {
    this.publisher = publisher;
    this.subscriber = subscriber;
    this.channel = options.channel ?? 'fieldnotes:fanout';
    this.onError = options.onError ?? (() => undefined);
  }

  publish(payload: string): void {
    Promise.resolve(this.publisher.publish(this.channel, payload)).catch(this.onError);
  }

  subscribe(handler: (payload: string) => void): () => void {
    this.handlers.add(handler);
    if (!this.subscribed) {
      this.subscribed = true;
      Promise.resolve(
        this.subscriber.subscribe(this.channel, (message) => {
          for (const h of this.handlers) {
            try {
              h(message);
            } catch {
              /* isolate handlers */
            }
          }
        }),
      ).catch(this.onError);
    }
    return () => this.handlers.delete(handler);
  }
}
