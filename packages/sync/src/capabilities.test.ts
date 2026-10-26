import { describe, expect, it } from 'vitest';
import type { ExtensionElementEnvelope } from '@fieldnotes/core';
import {
  CapabilityHandshake,
  createAuthorityCapabilities,
  createCurrentCapabilities,
  supportsLegacyHierarchy,
  supportsAuthority,
  translateOpForPeer,
} from './capabilities';
import { isValidEnvelope, parseEnvelope } from './protocol';
import { createManagedAuthorityConnection } from './managed-authority-connection';

describe('createCurrentCapabilities', () => {
  it('advertises legacy protocol 3 with the hierarchy marker', () => {
    expect(createCurrentCapabilities(['test:cursor'])).toEqual({
      protocolVersion: 3,
      extensionKinds: ['test:cursor'],
      elementEnvelope: true,
      elementHierarchy: 1,
    });
  });

  it('keeps the legacy bytes and requires explicit authority opt-in', () => {
    const legacy = createCurrentCapabilities(['e']);
    expect(JSON.stringify(legacy)).toBe(
      '{"protocolVersion":3,"extensionKinds":["e"],"elementEnvelope":true,"elementHierarchy":1}',
    );
    expect(supportsAuthority(legacy)).toBe(false);
    const optedIn = createAuthorityCapabilities(['e']);
    expect(optedIn).toEqual({
      protocolVersion: 1,
      extensionKinds: ['e'],
      elementEnvelope: true,
      authority: 1,
    });
    expect(JSON.stringify(optedIn)).toBe(
      '{"protocolVersion":1,"extensionKinds":["e"],"elementEnvelope":true,"authority":1}',
    );
    expect(supportsAuthority(optedIn)).toBe(true);
    for (const authority of [undefined, 0, 2, '1', null]) {
      const frame = {
        from: 'a',
        op: { kind: 'capabilities', capabilities: { ...legacy, authority } },
      };
      expect(isValidEnvelope(frame)).toBe(false);
      if (authority !== undefined) expect(parseEnvelope(JSON.stringify(frame))).toBeNull();
    }
    expect(
      parseEnvelope(
        JSON.stringify({ from: 'a', op: { kind: 'capabilities', capabilities: optedIn } }),
      ),
    ).not.toBeNull();
  });

  it('keeps authority capabilities at protocol 1 so a managed authority connection constructs', () => {
    expect(createAuthorityCapabilities([]).protocolVersion).toBe(1);
    const connection = createManagedAuthorityConnection({
      scopeId: 'scope',
      clientId: 'client',
      resolveUrl: () => null,
    });
    connection.stop();
  });

  it('copies and sorts an exact authority extension inventory', () => {
    const entries = [
      { key: 'z', pluginName: 'plugin-z', version: 2 },
      { key: 'a', pluginName: 'plugin-a', version: 1 },
    ];
    const capabilities = createAuthorityCapabilities([], entries);
    entries[0] = { key: 'changed', pluginName: 'plugin-z', version: 2 };
    expect(capabilities.authorityExtensions).toEqual([
      { key: 'a', pluginName: 'plugin-a', version: 1 },
      { key: 'z', pluginName: 'plugin-z', version: 2 },
    ]);
    const repeated = { key: 'a', pluginName: 'plugin-a', version: 1 };
    expect(() => createAuthorityCapabilities([], [repeated, repeated])).toThrow();
  });
});

describe('supportsLegacyHierarchy', () => {
  it.each([
    ['protocol 3', true, { protocolVersion: 3, elementHierarchy: 1 }],
    ['newer protocol', false, { protocolVersion: 4, elementHierarchy: 1 }],
    ['protocol 2', false, { protocolVersion: 2, elementHierarchy: 1 }],
    ['protocol 1', false, { protocolVersion: 1, elementHierarchy: 1 }],
    ['missing marker', false, { protocolVersion: 3 }],
    ['invalid marker', false, { protocolVersion: 3, elementHierarchy: 2 }],
    ['zero marker', false, { protocolVersion: 3, elementHierarchy: 0 }],
    ['string marker', false, { protocolVersion: 3, elementHierarchy: '1' }],
    ['null marker', false, { protocolVersion: 3, elementHierarchy: null }],
  ])('%s returns %s', (_name, expected, capabilities) => {
    expect(supportsLegacyHierarchy(capabilities)).toBe(expected);
  });

  it('does not require matching extension inventories', () => {
    expect(
      supportsLegacyHierarchy({
        protocolVersion: 3,
        extensionKinds: ['cursor'],
        elementEnvelope: true,
        elementHierarchy: 1,
      }),
    ).toBe(true);
    expect(
      supportsLegacyHierarchy({
        protocolVersion: 3,
        extensionKinds: ['grid', 'fog'],
        elementEnvelope: true,
        elementHierarchy: 1,
      }),
    ).toBe(true);
  });
});

describe('CapabilityHandshake', () => {
  it('drains a bounded queue when capabilities arrive', () => {
    const handshake = new CapabilityHandshake<string>(2);
    handshake.queue('one');
    handshake.queue('two');
    expect(handshake.receive(createCurrentCapabilities([]))).toEqual(['one', 'two']);
    expect(handshake.complete).toBe(true);
  });

  it('rejects queue overflow', () => {
    const handshake = new CapabilityHandshake<string>(1);
    handshake.queue('one');
    expect(() => handshake.queue('two')).toThrow('queue exceeded 1 messages');
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
    index: 'a0',
    version: 1,
    locked: false,
    layerId: 'default-layer',
    data: { cellSize: 50 },
  };

  it('passes envelopes through for capable peers', () => {
    const op = { kind: 'upsert' as const, element: envelope };
    expect(translateOpForPeer(op, createCurrentCapabilities([]))).toBe(op);
  });

  it('passes extension ops through when the peer supports the kind', () => {
    const op = { kind: 'extension' as const, extensionKind: 'test:cursor', payload: { x: 1 } };
    expect(translateOpForPeer(op, createCurrentCapabilities(['test:cursor']))).toBe(op);
  });

  it('throws for extension ops the peer does not support', () => {
    expect(() =>
      translateOpForPeer(
        { kind: 'extension', extensionKind: 'unknown', payload: {} },
        createCurrentCapabilities([]),
      ),
    ).toThrow('cannot be translated');
  });
});

describe('opBatching capability', () => {
  it.each([1, 2])('isValidEnvelope accepts capabilities with opBatching %i', (opBatching) => {
    const capabilities = { ...createCurrentCapabilities([]), opBatching };
    expect(isValidEnvelope({ from: 'a', op: { kind: 'capabilities', capabilities } })).toBe(true);
  });

  it('is not advertised by the current or authority capabilities yet', () => {
    expect('opBatching' in createCurrentCapabilities([])).toBe(false);
    expect('opBatching' in createAuthorityCapabilities([])).toBe(false);
  });
});
