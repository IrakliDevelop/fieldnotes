import type { ElementRegistry } from './element-registry';
import type { SyncCapabilities, WireElement, WireSyncOp } from './types';

export class CapabilityHandshake {
  private localCaps: SyncCapabilities | null = null;
  private remoteCaps: SyncCapabilities | null = null;
  private readonly pendingOps: WireSyncOp[] = [];

  setLocalCapabilities(caps: SyncCapabilities): void {
    this.localCaps = caps;
  }

  receiveRemoteCapabilities(caps: SyncCapabilities): void {
    this.remoteCaps = caps;
  }

  isComplete(): boolean {
    return this.localCaps !== null && this.remoteCaps !== null;
  }

  getRemoteCapabilities(): SyncCapabilities | null {
    return this.remoteCaps;
  }

  queueUntilReady(op: WireSyncOp): WireSyncOp[] | null {
    if (this.isComplete()) return null;
    this.pendingOps.push(op);
    return this.pendingOps;
  }

  drainPending(): WireSyncOp[] {
    const ops = [...this.pendingOps];
    this.pendingOps.length = 0;
    return ops;
  }
}

export function translateForPeer(
  op: WireSyncOp,
  peerCapabilities: SyncCapabilities,
  registry: ElementRegistry,
): WireSyncOp | null {
  if (op.kind === 'extension') {
    if (!peerCapabilities.extensionKinds.includes(op.extensionKind)) {
      return null;
    }
    return op;
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

function translateElementToLegacy(el: WireElement, registry: ElementRegistry): WireElement {
  if (el.type !== 'extension') return el;

  const adapter = registry.getAdapter(el.extensionType);
  if (!adapter) return el;

  const legacyType = adapter.legacyTypes[0];
  if (!legacyType) return el;

  const legacyFields = adapter.encodeLegacy(el);
  return { ...el, ...legacyFields, type: legacyType } as WireElement;
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
