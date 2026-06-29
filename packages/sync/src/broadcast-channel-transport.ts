import type { SyncTransport } from './sync-transport';

export interface BroadcastChannelTransportOptions {
  BroadcastChannel?: typeof BroadcastChannel;
}

export class BroadcastChannelTransport implements SyncTransport {
  private channel: BroadcastChannel | null;
  private readonly handlers = new Set<(message: string) => void>();

  constructor(channelName: string, options: BroadcastChannelTransportOptions = {}) {
    const BC =
      options.BroadcastChannel ??
      (typeof BroadcastChannel !== 'undefined' ? BroadcastChannel : null);
    this.channel = BC ? new BC(channelName) : null;
    if (this.channel) {
      this.channel.onmessage = (e: MessageEvent) => {
        const data = typeof e.data === 'string' ? e.data : '';
        this.handlers.forEach((h) => h(data));
      };
    }
  }

  send(message: string): void {
    this.channel?.postMessage(message);
  }

  onMessage(handler: (message: string) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  close(): void {
    this.channel?.close();
    this.channel = null;
    this.handlers.clear();
  }
}
