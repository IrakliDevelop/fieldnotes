import { describe, expect, it, vi } from 'vitest';
import { ElementRegistry } from '@fieldnotes/core';
import type {
  BaseElement,
  ElementTypeDefinition,
  ExtensionElementEnvelope,
} from '@fieldnotes/core';
import {
  CapabilityHandshake,
  createCurrentCapabilities,
  createLegacyCapabilities,
  translateOpForPeer,
} from './capabilities';
import { createExtensionKind } from './sync-plugin';
import type { ExtensionKind } from './sync-plugin';

interface LegacyGrid extends BaseElement {
  type: 'grid';
  cellSize: number;
}

const gridDefinition: ElementTypeDefinition<LegacyGrid> = {
  type: 'vtt:grid',
  legacyTypes: ['grid'],
  decodeLegacy: (raw) => raw as unknown as LegacyGrid,
  encodeLegacy: (element) => ({ ...element }),
  validateData: (data) => typeof data['cellSize'] === 'number',
  unwrap: (envelope) => ({
    ...envelope,
    type: 'grid',
    cellSize: envelope.data['cellSize'] as number,
  }),
  wrap: (element) => ({
    ...element,
    type: 'extension',
    extensionType: 'vtt:grid',
    data: { cellSize: element.cellSize },
  }),
  bounds: () => null,
};

describe('CapabilityHandshake', () => {
  it('drains a bounded queue when capabilities arrive', () => {
    const handshake = new CapabilityHandshake<string>(2);
    handshake.queue('one');
    handshake.queue('two');
    expect(handshake.receive(createCurrentCapabilities([]))).toEqual(['one', 'two']);
    expect(handshake.complete).toBe(true);
    expect(handshake.legacy).toBe(false);
  });

  it('rejects queue overflow', () => {
    const handshake = new CapabilityHandshake<string>(1);
    handshake.queue('one');
    expect(() => handshake.queue('two')).toThrow('queue exceeded 1 messages');
  });

  it('falls back to legacy on timeout, then upgrades when a peer frame arrives late', () => {
    vi.useFakeTimers();
    try {
      const handshake = new CapabilityHandshake<string>();
      const fallback = vi.fn();
      handshake.queue('pending');
      handshake.startTimeout(50, fallback);
      vi.advanceTimersByTime(50);
      expect(handshake.legacy).toBe(true);
      expect(handshake.timedOut).toBe(true);
      expect(fallback).toHaveBeenCalledWith(['pending']);
      // A slow connect or late BroadcastChannel joiner must not be locked into legacy.
      expect(handshake.receive(createCurrentCapabilities(['x']))).toEqual([]);
      expect(handshake.legacy).toBe(false);
      expect(handshake.timedOut).toBe(false);
      // Only the first peer-provided frame is final.
      expect(handshake.receive(createLegacyCapabilities())).toEqual([]);
      expect(handshake.legacy).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('hands its queue to a successor without settling', () => {
    const handshake = new CapabilityHandshake<string>();
    handshake.queue('one');
    handshake.queue('two');
    expect(handshake.pendingCount).toBe(2);
    expect(handshake.takePending()).toEqual(['one', 'two']);
    expect(handshake.pendingCount).toBe(0);
    expect(handshake.complete).toBe(false);
  });
});

describe('translateOpForPeer', () => {
  const envelope: ExtensionElementEnvelope = {
    id: 'grid-1',
    type: 'extension',
    extensionType: 'vtt:grid',
    position: { x: 0, y: 0 },
    zIndex: 0,
    locked: false,
    layerId: 'default-layer',
    data: { cellSize: 50 },
  };

  it('translates upserts and snapshots for legacy peers', () => {
    const registry = new ElementRegistry();
    registry.register(gridDefinition);
    const peer = createLegacyCapabilities();

    const upsert = translateOpForPeer({ kind: 'upsert', element: envelope }, peer, registry);
    const snapshot = translateOpForPeer(
      { kind: 'snapshot', to: 'legacy', elements: [envelope] },
      peer,
      registry,
    );

    expect(upsert.kind === 'upsert' && upsert.element.type).toBe('grid');
    expect(snapshot.kind === 'snapshot' && snapshot.elements[0]?.type).toBe('grid');
  });

  it('omits untranslatable elements from a legacy snapshot instead of failing the frame', () => {
    const registry = new ElementRegistry();
    registry.register(gridDefinition);
    const orphan: ExtensionElementEnvelope = {
      ...envelope,
      id: 'orphan',
      extensionType: 'app:unknown',
    };
    const snapshot = translateOpForPeer(
      { kind: 'snapshot', to: 'legacy', elements: [orphan, envelope] },
      createLegacyCapabilities(),
      registry,
    );
    expect(snapshot.kind === 'snapshot' && snapshot.elements.map((el) => el.id)).toEqual([
      'grid-1',
    ]);
    // An upsert stays strict: the caller decides whether to skip this peer.
    expect(() =>
      translateOpForPeer({ kind: 'upsert', element: orphan }, createLegacyCapabilities(), registry),
    ).toThrow('No adapter registered');
  });

  it('passes envelopes through for capable peers', () => {
    const op = { kind: 'upsert' as const, element: envelope };
    expect(translateOpForPeer(op, createCurrentCapabilities([]), new ElementRegistry())).toBe(op);
  });

  it('translates unsupported extension ops through their legacy descriptor', () => {
    const kind = createExtensionKind({
      extensionKind: 'vtt:fog',
      codec: { validate: (value): value is { generation: string } => typeof value === 'object' },
      legacy: {
        kinds: ['fog-meta'],
        encode: () => ({ kind: 'fog-meta', record: { version: 1, editor: 'bridge' } }),
        decode: () => null,
      },
    });
    // ExtensionKind is invariant in its payload, so widening to the map's
    // ExtensionKind<unknown> repeats the assertion ClientPluginRegistry makes
    // when it stores a registered kind (sync-plugin.ts).
    const definitions = new Map<string, ExtensionKind<unknown>>([
      [kind.extensionKind, kind as ExtensionKind<unknown>],
    ]);
    const translated = translateOpForPeer(
      { kind: 'extension', extensionKind: kind.extensionKind, payload: { generation: 'g' } },
      createLegacyCapabilities(),
      new ElementRegistry(),
      definitions,
    );
    expect(translated.kind).toBe('fog-meta');
  });

  it('rejects lossy extension translation', () => {
    expect(() =>
      translateOpForPeer(
        { kind: 'extension', extensionKind: 'unknown', payload: {} },
        createLegacyCapabilities(),
        new ElementRegistry(),
      ),
    ).toThrow('no translator registered');
  });
});
