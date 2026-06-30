import type { SyncTransport } from './sync-transport';

export interface WebSocketTransportOptions {
  WebSocket?: typeof WebSocket;
  reconnect?: boolean;
  reconnectInitialDelayMs?: number;
  reconnectMaxDelayMs?: number;
  reconnectFactor?: number;
  maxBufferSize?: number;
  random?: () => number;
}

export class WebSocketTransport implements SyncTransport {
  private readonly url: string;
  private readonly WS: typeof WebSocket | null;
  private readonly reconnect: boolean;
  private readonly initialDelay: number;
  private readonly maxDelay: number;
  private readonly factor: number;
  private readonly maxBufferSize: number;
  private readonly random: () => number;

  private ws: WebSocket | null = null;
  private readonly handlers = new Set<(message: string) => void>();
  private readonly reconnectHandlers = new Set<() => void>();
  private buffer: string[] = [];
  private closed = false;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private hasConnectedOnce = false;

  constructor(url: string, options: WebSocketTransportOptions = {}) {
    this.url = url;
    this.WS = options.WebSocket ?? (typeof WebSocket !== 'undefined' ? WebSocket : null);
    this.reconnect = options.reconnect ?? true;
    this.initialDelay = options.reconnectInitialDelayMs ?? 500;
    this.maxDelay = options.reconnectMaxDelayMs ?? 10_000;
    this.factor = options.reconnectFactor ?? 2;
    this.maxBufferSize = options.maxBufferSize ?? 1000;
    this.random = options.random ?? Math.random;
    if (!this.WS) return;
    this.connect();
  }

  private connect(): void {
    if (!this.WS) return;
    const ws = new this.WS(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      const pending = this.buffer;
      this.buffer = [];
      for (const m of pending) ws.send(m);
      if (this.hasConnectedOnce) this.reconnectHandlers.forEach((h) => h());
      else this.hasConnectedOnce = true;
    };
    ws.onmessage = (e: MessageEvent) => {
      if (typeof e.data !== 'string') return;
      const data = e.data;
      this.handlers.forEach((h) => h(data));
    };
    ws.onclose = () => {
      if (this.closed || !this.reconnect) return;
      this.reconnectTimer = setTimeout(() => this.connect(), this.backoff(this.attempt++));
    };
  }

  private backoff(attempt: number): number {
    const base = Math.min(this.maxDelay, this.initialDelay * this.factor ** attempt);
    return base / 2 + this.random() * (base / 2);
  }

  private bufferOutgoing(message: string): void {
    if (this.buffer.length >= this.maxBufferSize) this.buffer.shift();
    this.buffer.push(message);
  }

  send(message: string): void {
    if (this.closed) return;
    const ws = this.ws;
    if (!ws) return;
    if (ws.readyState === ws.OPEN) {
      ws.send(message);
      return;
    }
    if (ws.readyState === ws.CONNECTING) {
      this.bufferOutgoing(message);
      return;
    }
    if (this.reconnect) this.bufferOutgoing(message);
  }

  onMessage(handler: (message: string) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  onReconnect(handler: () => void): () => void {
    this.reconnectHandlers.add(handler);
    return () => this.reconnectHandlers.delete(handler);
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.ws?.close();
    this.ws = null;
    this.handlers.clear();
    this.reconnectHandlers.clear();
    this.buffer = [];
  }
}
