import type { CanvasElement, ElementStore } from '@fieldnotes/core';
import type { SyncTransport } from './sync-transport';

export type SyncOp =
  | { kind: 'upsert'; element: CanvasElement }
  | { kind: 'remove'; id: string }
  | { kind: 'clear' };

interface SyncEnvelope {
  from: string;
  op: SyncOp;
}

export interface SyncClientOptions {
  store: ElementStore;
  transport: SyncTransport;
  clientId?: string;
}

const REMOTE_ORIGIN = 'remote';

function isExternal(origin: string | undefined): boolean {
  return origin !== undefined && origin !== 'local';
}

function isValidEnvelope(env: unknown): env is SyncEnvelope {
  if (typeof env !== 'object' || env === null) return false;
  const e = env as { from?: unknown; op?: { kind?: unknown } };
  if (typeof e.from !== 'string' || typeof e.op !== 'object' || e.op === null) return false;
  return e.op.kind === 'upsert' || e.op.kind === 'remove' || e.op.kind === 'clear';
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
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.unsubscribers.forEach((u) => u());
    this.unsubscribers = [];
  }

  private onLocal(op: SyncOp, origin: string | undefined): void {
    if (isExternal(origin)) return; // applied remote ops must not re-broadcast
    const envelope: SyncEnvelope = { from: this.clientId, op };
    this.transport.send(JSON.stringify(envelope));
  }

  private onRemote(message: string): void {
    let env: unknown;
    try {
      env = JSON.parse(message);
    } catch {
      return; // malformed (incl. empty string) — ignore
    }
    if (!isValidEnvelope(env) || env.from === this.clientId) return; // ignore invalid + own echo
    this.applyOp(env.op);
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
    // exhaustive over SyncOp; unknown kinds are filtered out in onRemote (forward-compat: ignored, never destructive)
  }
}
