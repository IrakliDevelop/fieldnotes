import type { ElementRegistry } from './element-registry';
import type {
  SyncCapabilities,
  WireElement,
  WireElementV3,
  WireSyncOp,
  WireSyncOpV3,
} from './types';

export interface ExtensionWireAdapter {
  readonly encodeLegacyOp: (payload: unknown) => WireSyncOpV3;
}

export class CapabilityHandshake {
  private localCaps: SyncCapabilities | null = null;
  private remoteCaps: SyncCapabilities | null = null;
  private readonly pendingOps: WireSyncOp[] = [];
  private timedOut = false;
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly maxPendingOps = 1_000) {}

  setLocalCapabilities(caps: SyncCapabilities): void {
    this.localCaps = caps;
  }

  receiveRemoteCapabilities(caps: SyncCapabilities): void {
    if (this.timedOut) return;
    this.remoteCaps = caps;
    if (this.timeoutHandle !== null) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
  }

  isComplete(): boolean {
    return this.localCaps !== null && this.remoteCaps !== null;
  }

  getRemoteCapabilities(): SyncCapabilities | null {
    return this.remoteCaps;
  }

  queueUntilReady(op: WireSyncOp): WireSyncOp[] | null {
    if (this.isComplete()) return null;
    if (this.pendingOps.length >= this.maxPendingOps) {
      throw new Error(`Capability handshake queue exceeded ${String(this.maxPendingOps)} ops`);
    }
    this.pendingOps.push(op);
    return [...this.pendingOps];
  }

  drainPending(): WireSyncOp[] {
    const ops = [...this.pendingOps];
    this.pendingOps.length = 0;
    return ops;
  }

  startTimeout(ms: number, onTimeout: (pending: WireSyncOp[]) => void): void {
    if (this.isComplete()) return;
    this.timeoutHandle = setTimeout(() => {
      this.timedOut = true;
      this.forceLegacyMode();
      onTimeout(this.drainPending());
    }, ms);
  }

  isTimedOut(): boolean {
    return this.timedOut;
  }

  forceLegacyMode(): void {
    this.remoteCaps = {
      protocolVersion: 1,
      extensionKinds: [],
      elementEnvelope: false,
    };
  }

  dispose(): void {
    if (this.timeoutHandle !== null) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
    this.pendingOps.length = 0;
  }

  isLegacyMode(): boolean {
    if (this.timedOut) return true;
    return this.remoteCaps !== null && !this.remoteCaps.elementEnvelope;
  }
}

export function translateForPeer(
  op: WireSyncOp,
  peerCapabilities: SyncCapabilities,
  registry: ElementRegistry,
  extensionKinds?: ReadonlyMap<string, ExtensionWireAdapter>,
): WireSyncOp {
  if (op.kind === 'extension') {
    if (peerCapabilities.extensionKinds.includes(op.extensionKind)) {
      return op;
    }
    // Peer doesn't support this extension kind — try legacy translator
    const kindDef = extensionKinds?.get(op.extensionKind);
    if (kindDef) {
      return kindDef.encodeLegacyOp(op.payload);
    }
    throw new Error(
      `Extension op '${op.extensionKind}' cannot be translated for legacy peer — no translator registered`,
    );
  }

  if (op.kind === 'upsert' && !peerCapabilities.elementEnvelope) {
    return { ...op, element: translateElementToLegacy(op.element, registry) };
  }

  if (op.kind === 'snapshot' && !peerCapabilities.elementEnvelope) {
    return {
      ...op,
      elements: op.elements.map((el) => translateElementToLegacy(el, registry)),
    };
  }

  return op;
}

function translateElementToLegacy(el: WireElement, registry: ElementRegistry): WireElementV3 {
  if (el.type !== 'extension') return el;

  const adapter = registry.getAdapter(el.extensionType);
  if (!adapter) {
    throw new Error(`No adapter registered for extension type "${el.extensionType}"`);
  }

  const legacyType = adapter.legacyTypes[0];
  if (!legacyType) {
    throw new Error(`No legacy type for extension type "${el.extensionType}"`);
  }

  const legacyFields = adapter.encodeLegacy(el);
  return { ...el, ...legacyFields, type: legacyType } as unknown as WireElementV3;
}

export function translateSnapshotElements(
  elements: WireElement[],
  peerCapabilities: SyncCapabilities,
  registry: ElementRegistry,
): WireElement[] {
  if (peerCapabilities.elementEnvelope) return elements;
  return elements.map((el) => translateElementToLegacy(el, registry));
}

export function createDefaultCapabilities(): SyncCapabilities {
  return {
    protocolVersion: 1,
    extensionKinds: [],
    elementEnvelope: false,
  };
}

export function createV4Capabilities(extensionKinds: string[]): SyncCapabilities {
  return {
    protocolVersion: 1,
    extensionKinds,
    elementEnvelope: true,
  };
}
