import { describe, expect, it } from 'vitest';
import type { ExtensionElementEnvelope } from '@fieldnotes/core';
import { CapabilityHandshake, createCurrentCapabilities, translateOpForPeer } from './capabilities';

describe('createCurrentCapabilities', () => {
  it('advertises the v4 element envelope marker', () => {
    expect(createCurrentCapabilities(['test:cursor'])).toEqual({
      protocolVersion: 1,
      extensionKinds: ['test:cursor'],
      elementEnvelope: true,
    });
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
    zIndex: 0,
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
