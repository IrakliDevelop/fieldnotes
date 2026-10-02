import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAuthorityWebSocketTransport } from './authority-websocket-transport';
import { MAX_AUTHORITY_FRAME_BYTES } from './authority-protocol';

const sockets: FakeSocket[] = [];
class FakeSocket {
  static readonly OPEN = 1;
  readonly OPEN = 1;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  readonly sent: string[] = [];
  readonly closes: number[] = [];
  throwOnSend = false;
  throwOnClose = false;
  constructor(
    readonly url: string,
    readonly protocols?: string | string[],
  ) {
    sockets.push(this);
  }
  send(raw: string): void {
    if (this.throwOnSend) throw new Error('send');
    this.sent.push(raw);
  }
  close(code = 1000): void {
    if (this.throwOnClose) throw new Error('close');
    this.closes.push(code);
    this.readyState = 3;
  }
}

afterEach(() => {
  sockets.length = 0;
  vi.unstubAllGlobals();
});

describe('createAuthorityWebSocketTransport', () => {
  it('is dormant and non-buffering, then sends only while the one socket is open', () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    const transport = createAuthorityWebSocketTransport({ url: 'ws://example', protocols: ['p'] });
    expect(sockets).toHaveLength(0);
    const onOpen = vi.fn();
    transport.start({ onOpen, onMessage: vi.fn(), onClose: vi.fn() });
    const socket = sockets[0];
    if (!socket) throw new Error('fixture');
    expect(transport.trySend('before')).toBe(false);
    socket.readyState = socket.OPEN;
    socket.onopen?.();
    expect(onOpen).toHaveBeenCalledOnce();
    expect(transport.trySend('after')).toBe(true);
    expect(socket.sent).toEqual(['after']);
    expect(() => transport.start({ onOpen, onMessage: vi.fn(), onClose: vi.fn() })).toThrow();
  });

  it('forwards bounded text, closes binary with 4406, and oversized text with 1013', () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    const received = vi.fn();
    const transport = createAuthorityWebSocketTransport({ url: 'ws://example' });
    transport.start({ onOpen: vi.fn(), onMessage: received, onClose: vi.fn() });
    const socket = sockets[0];
    if (!socket) throw new Error('fixture');
    socket.onmessage?.({ data: 'ok' });
    expect(received).toHaveBeenCalledWith('ok');
    socket.onmessage?.({ data: new Uint8Array([1]) });
    expect(socket.closes).toContain(4406);
    socket.onmessage?.({ data: 'x'.repeat(MAX_AUTHORITY_FRAME_BYTES + 1) });
    expect(socket.closes).toContain(1013);
  });

  it('reports send throws as ambiguous and makes close idempotent even when native close throws', () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    const transport = createAuthorityWebSocketTransport({ url: 'ws://example' });
    transport.start({ onOpen: vi.fn(), onMessage: vi.fn(), onClose: vi.fn() });
    const socket = sockets[0];
    if (!socket) throw new Error('fixture');
    socket.readyState = socket.OPEN;
    socket.throwOnSend = true;
    expect(() => transport.trySend('ambiguous')).toThrow('send');
    socket.throwOnClose = true;
    expect(() => transport.close()).not.toThrow();
    expect(() => transport.close()).not.toThrow();
  });

  it('closes with 1013 when an inbound callback throws and isolates close callback failure', () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    const transport = createAuthorityWebSocketTransport({ url: 'ws://example' });
    transport.start({
      onOpen: vi.fn(),
      onMessage: () => {
        throw new Error('handler');
      },
      onClose: () => {
        throw new Error('close handler');
      },
    });
    const socket = sockets[0];
    if (!socket) throw new Error('fixture');
    expect(() => socket.onmessage?.({ data: 'ok' })).not.toThrow();
    expect(socket.closes).toContain(1013);
    expect(() => socket.onclose?.({ code: 1006, reason: '' })).not.toThrow();
  });

  it('surfaces native construction failure and closes when the open callback throws', () => {
    vi.stubGlobal(
      'WebSocket',
      class {
        static readonly OPEN = 1;
        constructor() {
          throw new Error('constructor');
        }
        send(): void {
          throw new Error('unreachable');
        }
      },
    );
    const failed = createAuthorityWebSocketTransport({ url: 'ws://example' });
    expect(() => failed.start({ onOpen: vi.fn(), onMessage: vi.fn(), onClose: vi.fn() })).toThrow(
      'constructor',
    );

    vi.stubGlobal('WebSocket', FakeSocket);
    const transport = createAuthorityWebSocketTransport({ url: 'ws://example' });
    transport.start({
      onOpen: () => {
        throw new Error('open handler');
      },
      onMessage: vi.fn(),
      onClose: vi.fn(),
    });
    const socket = sockets[0];
    if (!socket) throw new Error('fixture');
    expect(() => socket.onopen?.()).not.toThrow();
    expect(socket.closes).toContain(1013);
  });

  it('permits a close callback to close the transport reentrantly exactly once', () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    const transport = createAuthorityWebSocketTransport({ url: 'ws://example' });
    const onClose = vi.fn(() => transport.close());
    transport.start({ onOpen: vi.fn(), onMessage: vi.fn(), onClose });
    const socket = sockets[0];
    if (!socket) throw new Error('fixture');
    expect(() => socket.onclose?.({ code: 1006, reason: '' })).not.toThrow();
    expect(onClose).toHaveBeenCalledOnce();
    expect(() => transport.close()).not.toThrow();
    expect(socket.closes).toEqual([]);
  });
});
