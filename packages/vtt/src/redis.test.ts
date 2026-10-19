import { describe, expect, it } from 'vitest';
import { RedisHubBackend, type RedisHashClient } from '@fieldnotes/sync-redis';
import {
  createFogBackendPlugin,
  FOG_META_LWW_SCRIPT,
  FogBackendServiceKey,
  type FogBackendService,
} from './redis';
import { fogEncodeBase64 } from './index';

describe('createFogBackendPlugin roomKeys', () => {
  it('declares the fog meta and tiles keys', () => {
    expect(createFogBackendPlugin().roomKeys?.('R')).toEqual(['R:fog:meta', 'R:fog:tiles']);
  });

  it('declares exactly the keys the fog backend writes', async () => {
    const written: string[][] = [];
    const client: RedisHashClient = {
      hGetAll: async () => ({}),
      hGet: async () => null,
      hSet: async () => 0,
      hDel: async () => 0,
      del: async () => 0,
      eval: async (_script, options) => {
        written.push(options.keys);
        return [1];
      },
    };
    const plugin = createFogBackendPlugin();
    const backend = new RedisHubBackend(client, { keyPrefix: 'p:', plugins: [plugin] });
    await backend.getService(FogBackendServiceKey)?.applyMeta('R', { version: 1, editor: 'dm' });
    expect(written).toEqual([plugin.roomKeys?.('p:R')]);
  });
});

describe('createFogBackendPlugin touchRoom', () => {
  it('refreshes the room expiry once after each meta and patch script', async () => {
    const calls: string[] = [];
    const client: RedisHashClient = {
      hGetAll: async () => ({}),
      hGet: async () => JSON.stringify(meta),
      hSet: async () => 0,
      hDel: async () => 0,
      del: async () => 0,
      eval: async (script) => {
        calls.push(script === FOG_META_LWW_SCRIPT ? 'meta' : 'patch');
        return script === FOG_META_LWW_SCRIPT ? [1] : [0, 0];
      },
    };
    const meta = {
      version: 1,
      editor: 'dm',
      definition: {
        version: 1 as const,
        generation: 'g',
        bounds: { x: 0, y: 0, w: 128, h: 128 },
        cellSize: 1,
        tileCells: 128 as const,
        base: 'covered' as const,
      },
    };
    const data = fogEncodeBase64(new Uint8Array(2048).fill(0xff));
    let service: FogBackendService | undefined;
    createFogBackendPlugin().start({
      client,
      roomKeyPrefix: 'p:',
      roomKey: (room) => `p:${room}`,
      touchRoom: async (room) => {
        calls.push(`touch ${room}`);
      },
      registerService: (_key, s) => (service = s as FogBackendService),
      addDisposer: () => undefined,
    });
    await service?.applyMeta('R', meta);
    await service?.applyPatch('R', [
      { generation: 'g', x: 0, y: 0, version: 1, editor: 'dm', data },
    ]);
    expect(calls).toEqual(['meta', 'touch R', 'patch', 'touch R']);
  });
});
