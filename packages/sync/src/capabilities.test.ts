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

  it('settles permanently in legacy mode after timeout', () => {
    vi.useFakeTimers();
    try {
      const handshake = new CapabilityHandshake<string>();
      const fallback = vi.fn();
      handshake.queue('pending');
      handshake.startTimeout(50, fallback);
      vi.advanceTimersByTime(50);
      expect(handshake.legacy).toBe(true);
      expect(fallback).toHaveBeenCalledWith(['pending']);
      expect(handshake.receive(createCurrentCapabilities([]))).toEqual([]);
      expect(handshake.legacy).toBe(true);
    } finally {
      vi.useRealTimers();
    }
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
    const definitions = new Map<string, typeof kind>([[kind.extensionKind, kind]]);
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
