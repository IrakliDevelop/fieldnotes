/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect } from 'vitest';
import { ElementRegistry } from './element-registry';
import {
  CapabilityHandshake,
  translateForPeer,
  translateSnapshotElements,
  createDefaultCapabilities,
  createV4Capabilities,
} from './handshake';
import type {
  ElementTypeDefinition,
  BaseElement,
  ExtensionElementEnvelope,
  WireElement,
  WireSyncOp,
} from './types';

// ─── Minimal grid definition for translation tests ──────────────────────────

interface GridData extends BaseElement {
  cellSize: number;
}

const gridDef: ElementTypeDefinition<GridData> = {
  type: 'vtt:grid',
  legacyTypes: ['grid'],
  decodeLegacy: (raw) => ({
    id: raw['id'] as string,
    position: raw['position'] as { x: number; y: number },
    zIndex: raw['zIndex'] as number,
    locked: raw['locked'] as boolean,
    layerId: raw['layerId'] as string,
    cellSize: raw['cellSize'] as number,
  }),
  encodeLegacy: (el) => ({
    id: el.id,
    position: el.position,
    zIndex: el.zIndex,
    locked: el.locked,
    layerId: el.layerId,
    cellSize: el.cellSize,
  }),
  validateData: (data) => typeof data['cellSize'] === 'number',
  unwrap: (env) => ({
    id: env.id,
    position: env.position,
    zIndex: env.zIndex,
    locked: env.locked,
    layerId: env.layerId,
    cellSize: env.data['cellSize'] as number,
  }),
  wrap: (el) => ({
    id: el.id,
    position: el.position,
    zIndex: el.zIndex,
    locked: el.locked,
    layerId: el.layerId,
    type: 'extension',
    extensionType: 'vtt:grid',
    data: { cellSize: el.cellSize },
  }),
  bounds: () => null,
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('CapabilityHandshake', () => {
  it('starts incomplete', () => {
    const hs = new CapabilityHandshake();
    expect(hs.isComplete()).toBe(false);
  });

  it('completes after both sides exchange', () => {
    const hs = new CapabilityHandshake();
    hs.setLocalCapabilities(createV4Capabilities(['vtt:fog-patch']));
    expect(hs.isComplete()).toBe(false);
    hs.receiveRemoteCapabilities(createDefaultCapabilities());
    expect(hs.isComplete()).toBe(true);
  });

  it('queues ops until handshake completes', () => {
    const hs = new CapabilityHandshake();
    hs.setLocalCapabilities(createV4Capabilities([]));

    const op: WireSyncOp = {
      kind: 'upsert',
      element: {
        id: 'x',
        type: 'note',
        position: { x: 0, y: 0 },
        zIndex: 0,
        locked: false,
        layerId: 'd',
        size: { w: 1, h: 1 },
        text: '',
        backgroundColor: '',
        textColor: '',
      },
    };

    const queued = hs.queueUntilReady(op);
    expect(queued).not.toBeNull();
    expect(queued).toHaveLength(1);

    hs.receiveRemoteCapabilities(createDefaultCapabilities());
    const pending = hs.drainPending();
    expect(pending).toHaveLength(1);
    expect(hs.queueUntilReady(op)).toBeNull();
  });
});

describe('translateForPeer', () => {
  it('drops extension ops peer does not support', () => {
    const registry = new ElementRegistry();
    const caps = createDefaultCapabilities();
    const op: WireSyncOp = { kind: 'extension', extensionKind: 'vtt:fog-patch', payload: {} };

    const result = translateForPeer(op, caps, registry);
    expect(result).toBeNull();
  });

  it('passes extension ops peer supports', () => {
    const registry = new ElementRegistry();
    const caps = createV4Capabilities(['vtt:fog-patch']);
    const op: WireSyncOp = { kind: 'extension', extensionKind: 'vtt:fog-patch', payload: {} };

    const result = translateForPeer(op, caps, registry);
    expect(result).toEqual(op);
  });

  it('translates extension elements in upserts for legacy peers', () => {
    const registry = new ElementRegistry();
    registry.register(gridDef);

    const legacyCaps = createDefaultCapabilities();
    const envelope: ExtensionElementEnvelope = {
      id: 'grid-1',
      type: 'extension',
      extensionType: 'vtt:grid',
      position: { x: 0, y: 0 },
      zIndex: 0,
      locked: false,
      layerId: 'default',
      data: { cellSize: 50 },
    };
    const op: WireSyncOp = { kind: 'upsert', element: envelope };

    const result = translateForPeer(op, legacyCaps, registry);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('upsert');
    if (result!.kind === 'upsert') {
      expect(result!.element.type).toBe('grid');
      expect((result!.element as unknown as Record<string, unknown>)['cellSize']).toBe(50);
    }
  });

  it('translates snapshot elements for legacy peers', () => {
    const registry = new ElementRegistry();
    registry.register(gridDef);

    const legacyCaps = createDefaultCapabilities();
    const elements: WireElement[] = [
      {
        id: 'grid-1',
        type: 'extension',
        extensionType: 'vtt:grid',
        position: { x: 0, y: 0 },
        zIndex: 0,
        locked: false,
        layerId: 'default',
        data: { cellSize: 50 },
      },
    ];

    const translated = translateSnapshotElements(elements, legacyCaps, registry);
    expect(translated).toHaveLength(1);
    expect(translated[0]!.type).toBe('grid');
  });

  it('passes elements through for v4-capable peers', () => {
    const registry = new ElementRegistry();
    const v4Caps = createV4Capabilities([]);
    const elements: WireElement[] = [
      {
        id: 'grid-1',
        type: 'extension',
        extensionType: 'vtt:grid',
        position: { x: 0, y: 0 },
        zIndex: 0,
        locked: false,
        layerId: 'default',
        data: { cellSize: 50 },
      },
    ];

    const translated = translateSnapshotElements(elements, v4Caps, registry);
    expect(translated).toEqual(elements);
  });
});
