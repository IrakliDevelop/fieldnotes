import type { SyncTransport } from './sync-transport';

export interface WebSocketTransportOptions {
  WebSocket?: typeof WebSocket;
}

export class WebSocketTransport implements SyncTransport {
  private ws: WebSocket | null;
  private readonly handlers = new Set<(message: string) => void>();
  private buffer: string[] = [];

  constructor(url: string, options: WebSocketTransportOptions = {}) {
    const WS = options.WebSocket ?? (typeof WebSocket !== 'undefined' ? WebSocket : null);
    if (!WS) {
      this.ws = null;
      return;
    }
    const ws = new WS(url);
    this.ws = ws;
    ws.onopen = () => {
      const pending = this.buffer;
      this.buffer = [];
      for (const m of pending) ws.send(m);
    };
    ws.onmessage = (e: MessageEvent) => {
      if (typeof e.data !== 'string') return;
      const data = e.data;
      this.handlers.forEach((h) => h(data));
    };
  }

  send(message: string): void {
    const ws = this.ws;
    if (!ws) return;
    if (ws.readyState === ws.OPEN) ws.send(message);
    else if (ws.readyState === ws.CONNECTING) this.buffer.push(message);
  }

  onMessage(handler: (message: string) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
    this.handlers.clear();
    this.buffer = [];
  }
}
