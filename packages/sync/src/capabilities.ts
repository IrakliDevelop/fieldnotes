import type { CanvasElement, ElementRegistry } from '@fieldnotes/core';
import type { ExtensionKind } from './sync-plugin';
import type { SyncCapabilities, SyncOp } from './protocol';

export const DEFAULT_CAPABILITY_TIMEOUT_MS = 5_000;
export const DEFAULT_CAPABILITY_QUEUE_LIMIT = 1_000;

export function createLegacyCapabilities(): SyncCapabilities {
  return { protocolVersion: 1, extensionKinds: [], elementEnvelope: false };
}

export function createCurrentCapabilities(extensionKinds: readonly string[]): SyncCapabilities {
  return { protocolVersion: 1, extensionKinds: [...extensionKinds], elementEnvelope: true };
}

export function translateOpForPeer(
  op: SyncOp,
  peer: SyncCapabilities,
  registry: ElementRegistry,
  extensionKinds?: ReadonlyMap<string, ExtensionKind<unknown>>,
): SyncOp {
  if (op.kind === 'extension' && !peer.extensionKinds.includes(op.extensionKind)) {
    const definition = extensionKinds?.get(op.extensionKind);
    if (!definition?.legacy) {
      throw new Error(
        `Extension op '${op.extensionKind}' cannot be translated for legacy peer — no translator registered`,
      );
    }
    if (!definition.codec.validate(op.payload)) {
      throw new Error(`Extension op '${op.extensionKind}' has an invalid payload`);
    }
    return definition.legacy.encode(op.payload);
  }
  if (op.kind === 'upsert' && !peer.elementEnvelope) {
    return { ...op, element: translateElementForPeer(op.element, registry) };
  }
  if (op.kind === 'snapshot' && !peer.elementEnvelope) {
    // Best-effort: a snapshot is the peer's only route to a populated canvas,
    // so one untranslatable element must not withhold every other element.
    const elements: CanvasElement[] = [];
    for (const element of op.elements) {
      try {
        elements.push(translateElementForPeer(element, registry));
      } catch {
        // Lossy for this peer — omitted rather than failing the whole frame.
      }
    }
    return { ...op, elements };
  }
  return op;
}

function translateElementForPeer(element: CanvasElement, registry: ElementRegistry): CanvasElement {
  if (element.type !== 'extension') return element;
  const adapter = registry.getAdapter(element.extensionType);
  if (!adapter) {
    throw new Error(`No adapter registered for extension type "${element.extensionType}"`);
  }
  if (adapter.legacyTypes.length === 0) {
    throw new Error(`No legacy type registered for extension type "${element.extensionType}"`);
  }
  const legacy = adapter.encodeLegacy(element);
  const metadata = element as unknown as Record<string, unknown>;
  if (metadata['audience'] !== undefined) legacy['audience'] = metadata['audience'];
  if (metadata['ownerId'] !== undefined) legacy['ownerId'] = metadata['ownerId'];
  return legacy as unknown as CanvasElement;
}

export class CapabilityHandshake<T> {
  private remote: SyncCapabilities | null = null;
  private readonly pending: T[] = [];
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private settled = false;
  private fallback = false;

  constructor(private readonly maxPending = DEFAULT_CAPABILITY_QUEUE_LIMIT) {
    if (!Number.isSafeInteger(maxPending) || maxPending < 1) {
      throw new RangeError('Capability handshake queue limit must be a positive safe integer');
    }
  }

  receive(capabilities: SyncCapabilities): T[] {
    if (this.settled && !this.fallback) return [];
    // A frame arriving after the legacy-fallback timer (slow connect, late
    // BroadcastChannel joiner) upgrades the session; only a peer-provided
    // capability set is final.
    this.remote = capabilities;
    this.settled = true;
    this.fallback = false;
    this.clearTimer();
    return this.drain();
  }

  queue(value: T): void {
    if (this.settled) throw new Error('Capability handshake is already complete');
    if (this.pending.length >= this.maxPending) {
      throw new Error(`Capability handshake queue exceeded ${String(this.maxPending)} messages`);
    }
    this.pending.push(value);
  }

  startTimeout(ms: number, onLegacyFallback: (pending: T[]) => void): void {
    if (this.settled || this.timeoutHandle !== null) return;
    if (!Number.isFinite(ms) || ms < 0) {
      throw new RangeError('Capability handshake timeout must be a non-negative finite number');
    }
    this.timeoutHandle = setTimeout(() => {
      this.timeoutHandle = null;
      if (this.settled) return;
      this.remote = createLegacyCapabilities();
      this.settled = true;
      this.fallback = true;
      onLegacyFallback(this.drain());
    }, ms);
  }

  get capabilities(): SyncCapabilities | null {
    return this.remote;
  }

  get complete(): boolean {
    return this.settled;
  }

  get legacy(): boolean {
    return this.remote !== null && !this.remote.elementEnvelope;
  }

  /** True while the session settled by timeout rather than by a peer frame. */
  get timedOut(): boolean {
    return this.fallback;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  /** Removes and returns the queued values without settling — for hand-off to a successor. */
  takePending(): T[] {
    return this.drain();
  }

  dispose(): void {
    this.clearTimer();
    this.pending.length = 0;
  }

  private drain(): T[] {
    const values = this.pending.splice(0);
    return values;
  }

  private clearTimer(): void {
    if (this.timeoutHandle === null) return;
    clearTimeout(this.timeoutHandle);
    this.timeoutHandle = null;
  }
}
