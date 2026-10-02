import { MAX_AUTHORITY_FRAME_BYTES } from './authority-protocol';
import type {
  AuthorityClientTransport,
  AuthorityClientTransportHandlers,
} from './authority-client-types';
import type { ManagedSyncEndpoint } from './managed-connection';

const encoder = new TextEncoder();

class AuthorityWebSocketTransport implements AuthorityClientTransport {
  #endpoint: ManagedSyncEndpoint | null;
  #socket: WebSocket | null = null;
  #started = false;
  #closed = false;

  constructor(endpoint: ManagedSyncEndpoint) {
    if (
      typeof endpoint !== 'object' ||
      endpoint === null ||
      typeof endpoint.url !== 'string' ||
      endpoint.url.length === 0 ||
      (endpoint.protocols !== undefined &&
        (!Array.isArray(endpoint.protocols) ||
          endpoint.protocols.some((value) => typeof value !== 'string')))
    ) {
      throw new TypeError('Invalid authority WebSocket endpoint');
    }
    this.#endpoint = Object.freeze({
      url: endpoint.url,
      ...(endpoint.protocols === undefined
        ? {}
        : { protocols: Object.freeze([...endpoint.protocols]) }),
    });
  }

  start(handlers: AuthorityClientTransportHandlers): void {
    if (this.#started) throw new Error('Authority transport already started');
    this.#started = true;
    if (this.#closed) return;
    const endpoint = this.#endpoint;
    this.#endpoint = null;
    if (endpoint === null) return;
    if (typeof WebSocket === 'undefined') {
      queueMicrotask(() => handlers.onClose(1006, ''));
      return;
    }
    const socket = endpoint.protocols
      ? new WebSocket(endpoint.url, [...endpoint.protocols])
      : new WebSocket(endpoint.url);
    this.#socket = socket;
    const fail = (code: number): void => {
      try {
        socket.close(code);
      } catch {
        // Native close failure cannot make callback dispatch unbounded or reentrant.
      }
    };
    socket.onopen = () => {
      if (this.#closed || this.#socket !== socket) return;
      try {
        handlers.onOpen();
      } catch {
        fail(1013);
      }
    };
    socket.onmessage = (event: MessageEvent<unknown>) => {
      if (this.#closed || this.#socket !== socket) return;
      if (typeof event.data !== 'string') {
        fail(4406);
        return;
      }
      if (encoder.encode(event.data).length > MAX_AUTHORITY_FRAME_BYTES) {
        fail(1013);
        return;
      }
      try {
        handlers.onMessage(event.data);
      } catch {
        fail(1013);
      }
    };
    socket.onclose = (event: CloseEvent) => {
      if (this.#closed || this.#socket !== socket) return;
      this.#socket = null;
      try {
        handlers.onClose(event.code, event.reason ?? '');
      } catch {
        // A close observer cannot restart or retain this terminal socket.
      }
    };
  }

  trySend(raw: string): boolean {
    const socket = this.#socket;
    if (this.#closed || socket === null || socket.readyState !== socket.OPEN) return false;
    socket.send(raw);
    return true;
  }

  close(): void {
    this.closeWithCode();
  }

  closeWithCode(code?: number): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#endpoint = null;
    const socket = this.#socket;
    this.#socket = null;
    if (socket !== null) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      try {
        socket.close(code);
      } catch {
        // close() is idempotent and best-effort after ownership is released.
      }
    }
  }
}

/** Internal manager hook; custom transports continue to use the public code-agnostic close(). */
export function closeAuthorityWebSocketTransport(
  transport: AuthorityClientTransport,
  code: number,
): boolean {
  if (!(transport instanceof AuthorityWebSocketTransport)) return false;
  transport.closeWithCode(code);
  return true;
}

/** Creates a dormant, non-buffering, single-socket browser authority transport. */
export function createAuthorityWebSocketTransport(
  endpoint: ManagedSyncEndpoint,
): AuthorityClientTransport {
  return new AuthorityWebSocketTransport(endpoint);
}
