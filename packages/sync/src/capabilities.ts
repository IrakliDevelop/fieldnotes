import type { SyncCapabilities, SyncOp } from './protocol';
import type { AuthorityExtensionManifestEntry } from './authority-protocol';

export const DEFAULT_CAPABILITY_QUEUE_LIMIT = 1_000;

export function createCurrentCapabilities(extensionKinds: readonly string[]): SyncCapabilities {
  return { protocolVersion: 1, extensionKinds: [...extensionKinds], elementEnvelope: true };
}

/** Explicit opt-in only; existing connections continue to advertise legacy capabilities. */
export function createAuthorityCapabilities(
  extensionKinds: readonly string[],
  extensions: readonly AuthorityExtensionManifestEntry[] = [],
): SyncCapabilities {
  if (
    extensionKinds.length > 256 ||
    new Set(extensionKinds).size !== extensionKinds.length ||
    extensionKinds.some((kind) => !bounded(kind))
  )
    throw new TypeError('Invalid authority capabilities');
  const inventory = extensions.map((entry) => ({
    key: entry.key,
    pluginName: entry.pluginName,
    version: entry.version,
  }));
  if (
    inventory.length > 256 ||
    inventory.some(
      (entry) =>
        !bounded(entry.key) ||
        !bounded(entry.pluginName) ||
        !Number.isSafeInteger(entry.version) ||
        entry.version < 1,
    )
  )
    throw new TypeError('Invalid authority capabilities');
  inventory.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  if (inventory.some((entry, index) => index > 0 && entry.key === inventory[index - 1]?.key))
    throw new TypeError('Invalid authority capabilities');
  return {
    ...createCurrentCapabilities(extensionKinds),
    authority: 1,
    ...(inventory.length ? { authorityExtensions: inventory } : {}),
  };
}

function bounded(value: string): boolean {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 128 &&
    /^[\x20-\x7e]+$/.test(value)
  );
}

export function supportsAuthority(capabilities: SyncCapabilities): boolean {
  return capabilities.authority === 1;
}

/**
 * Translates an op for a peer that may not support every extension kind.
 * Extension ops the peer doesn't advertise are dropped (throws so callers
 * can skip lossy ops). Element ops pass through unchanged — all v4 peers
 * understand the extension envelope format.
 */
export function translateOpForPeer(op: SyncOp, peer: SyncCapabilities): SyncOp {
  if (op.kind === 'extension' && !peer.extensionKinds.includes(op.extensionKind)) {
    throw new Error(
      `Extension op '${op.extensionKind}' cannot be translated for peer — peer does not support this kind`,
    );
  }
  return op;
}

export class CapabilityHandshake<T> {
  private remote: SyncCapabilities | null = null;
  private readonly pending: T[] = [];
  private settled = false;

  constructor(private readonly maxPending = DEFAULT_CAPABILITY_QUEUE_LIMIT) {
    if (!Number.isSafeInteger(maxPending) || maxPending < 1) {
      throw new RangeError('Capability handshake queue limit must be a positive safe integer');
    }
  }

  receive(capabilities: SyncCapabilities): T[] {
    if (this.settled) return [];
    this.remote = capabilities;
    this.settled = true;
    return this.drain();
  }

  queue(value: T): void {
    if (this.settled) throw new Error('Capability handshake is already complete');
    if (this.pending.length >= this.maxPending) {
      throw new Error(`Capability handshake queue exceeded ${String(this.maxPending)} messages`);
    }
    this.pending.push(value);
  }

  get capabilities(): SyncCapabilities | null {
    return this.remote;
  }

  get complete(): boolean {
    return this.settled;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  /** Removes and returns the queued values without settling — for hand-off to a successor. */
  takePending(): T[] {
    return this.drain();
  }

  dispose(): void {
    this.pending.length = 0;
  }

  private drain(): T[] {
    const values = this.pending.splice(0);
    return values;
  }
}
