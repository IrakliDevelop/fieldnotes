import type { ElementStore } from '@fieldnotes/core';
import type { SyncTransport } from './sync-transport';
import { parseEnvelope, isValidElement, type SyncOp } from './protocol';

export interface SyncClientOptions {
  store: ElementStore;
  transport: SyncTransport;
  clientId?: string;
}

const REMOTE_ORIGIN = 'remote';

function isExternal(origin: string | undefined): boolean {
  return origin !== undefined && origin !== 'local';
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `c-${Math.random().toString(36).slice(2)}`;
}

export class SyncClient {
  private readonly store: ElementStore;
  private readonly transport: SyncTransport;
  private readonly clientId: string;
  private unsubscribers: (() => void)[] = [];
  private started = false;

  constructor(options: SyncClientOptions) {
    this.store = options.store;
    this.transport = options.transport;
    this.clientId = options.clientId ?? randomId();
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.unsubscribers = [
      this.store.on('add', (el, meta) =>
        this.onLocal({ kind: 'upsert', element: el }, meta.origin),
      ),
      this.store.on('update', ({ current }, meta) =>
        this.onLocal({ kind: 'upsert', element: current }, meta.origin),
      ),
      this.store.on('remove', (el, meta) =>
        this.onLocal({ kind: 'remove', id: el.id }, meta.origin),
      ),
      this.store.on('clear', (_data, meta) => this.onLocal({ kind: 'clear' }, meta.origin)),
      this.transport.onMessage((msg) => this.onRemote(msg)),
    ];
    // MUST be last: a synchronous bus delivers the peer's reply reentrantly, so the
    // onMessage receive handler above must already be wired before we request.
    this.sendOp({ kind: 'request-snapshot' });
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.unsubscribers.forEach((u) => u());
    this.unsubscribers = [];
  }

  private sendOp(op: SyncOp): void {
    this.transport.send(JSON.stringify({ from: this.clientId, op }));
  }

  private onLocal(op: SyncOp, origin: string | undefined): void {
    if (isExternal(origin)) return; // applied remote ops must not re-broadcast
    this.sendOp(op);
  }

  private onRemote(message: string): void {
    const env = parseEnvelope(message);
    if (!env || env.from === this.clientId) return; // malformed/invalid + own echo
    const op = env.op;
    if (op.kind === 'request-snapshot') {
      this.sendOp({ kind: 'snapshot', to: env.from, elements: this.store.snapshot() });
    } else if (op.kind === 'snapshot') {
      if (op.to !== this.clientId) return; // not addressed to us
      for (const el of op.elements) {
        if (isValidElement(el)) this.applyOp({ kind: 'upsert', element: el });
      }
    } else {
      this.applyOp(op); // narrows to upsert | remove | clear
    }
  }

  private applyOp(op: SyncOp): void {
    if (op.kind === 'upsert') {
      const el = op.element;
      if (this.store.getById(el.id)) {
        this.store.update(el.id, el, { origin: REMOTE_ORIGIN });
      } else {
        this.store.add(el, { origin: REMOTE_ORIGIN });
      }
    } else if (op.kind === 'remove') {
      this.store.remove(op.id, { origin: REMOTE_ORIGIN });
    } else if (op.kind === 'clear') {
      this.store.clear({ origin: REMOTE_ORIGIN });
    }
    // applyOp handles the data ops only (upsert/remove/clear). The control ops
    // (request-snapshot/snapshot) are dispatched in onRemote; unknown kinds are filtered by
    // isValidEnvelope — so no destructive default here.
  }
}
