/* eslint-disable @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-empty-function */
import { describe, it, expect } from 'vitest';
import { UnifiedExtensionRegistry } from './extension-descriptor';
import { createExtensionKind } from './types';
import type { ApplyResult } from './types';

interface FogPayload {
  generation: string;
  tiles: { x: number; y: number; data: string }[];
}

const fogCodec = {
  validate(payload: unknown): payload is FogPayload {
    return (
      typeof payload === 'object' &&
      payload !== null &&
      'generation' in payload &&
      'tiles' in payload
    );
  },
};

const fogKind = createExtensionKind({
  extensionKind: 'vtt:fog-patch',
  codec: fogCodec,
  legacy: {
    kinds: ['fog-patch'],
    encode: (payload) => ({
      kind: 'fog-patch',
      generation: payload.generation,
      tiles: payload.tiles.map((tile) => ({
        ...tile,
        generation: payload.generation,
        version: 1,
        editor: 'legacy-bridge',
      })),
    }),
    decode: (op) =>
      op.kind === 'fog-patch'
        ? {
            generation: op.generation,
            tiles: op.tiles.flatMap((tile) =>
              tile.data === undefined ? [] : [{ x: tile.x, y: tile.y, data: tile.data }],
            ),
          }
        : null,
  },
});

describe('UnifiedExtensionRegistry', () => {
  it('registers kind via client registry', () => {
    const reg = new UnifiedExtensionRegistry();
    const clientReg = reg.getClientRegistry();

    clientReg.register(fogKind, (op) => {
      expect(op.payload.generation).toBe('gen-1');
    });

    expect(reg.getRegisteredKinds()).toContain('vtt:fog-patch');
  });

  it('dispatches client with codec validation', () => {
    const reg = new UnifiedExtensionRegistry();
    let received = false;

    reg.getClientRegistry().register(fogKind, () => {
      received = true;
    });

    const ok = reg.dispatchClient(
      { extensionKind: 'vtt:fog-patch', payload: { generation: 'gen-1', tiles: [] } },
      { sender: 'client-1' },
    );
    expect(ok).toBe(true);
    expect(received).toBe(true);
  });

  it('throws on invalid payload', () => {
    const reg = new UnifiedExtensionRegistry();
    reg.getClientRegistry().register(fogKind, () => {});

    expect(() =>
      reg.dispatchClient(
        { extensionKind: 'vtt:fog-patch', payload: { invalid: true } },
        { sender: 'client-1' },
      ),
    ).toThrow('Codec validation failed');
  });

  it('returns false for unknown extension kind', () => {
    const reg = new UnifiedExtensionRegistry();
    const ok = reg.dispatchClient(
      { extensionKind: 'unknown', payload: {} },
      { sender: 'client-1' },
    );
    expect(ok).toBe(false);
  });

  it('server dispatch returns ApplyResult', async () => {
    const reg = new UnifiedExtensionRegistry();
    const expectedResult: ApplyResult = {
      accepted: null,
      corrections: [],
      locality: 'shared',
    };

    reg.getServerRegistry().register(fogKind, async () => expectedResult);

    const result = await reg.dispatchServer(
      { extensionKind: 'vtt:fog-patch', payload: { generation: 'gen-1', tiles: [] } },
      { room: 'room-1' },
    );
    expect(result).toEqual(expectedResult);
  });

  it('same kind registered at all three layers uses same descriptor', () => {
    const reg = new UnifiedExtensionRegistry();

    reg.getClientRegistry().register(fogKind, () => {});
    reg.getServerRegistry().register(fogKind, async () => ({ accepted: null, corrections: [] }));
    reg.getBackendRegistry().register(fogKind, async () => ({ accepted: null, corrections: [] }));

    const kind = reg.getKind('vtt:fog-patch');
    expect(kind).toBeDefined();
    expect(kind!.extensionKind).toBe('vtt:fog-patch');
    expect(kind!.legacy?.kinds).toContain('fog-patch');
  });
});
