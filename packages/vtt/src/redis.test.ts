import { describe, expect, it } from 'vitest';
import { RedisHubBackend, type RedisHashClient } from '@fieldnotes/sync-redis';
import { createFogBackendPlugin, FogBackendServiceKey } from './redis';

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
