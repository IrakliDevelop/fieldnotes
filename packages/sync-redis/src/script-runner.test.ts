import { describe, it, expect, vi } from 'vitest';
import { createScriptRunner } from './script-runner';
import type { RedisHashClient } from './redis-hash-client';

const SCRIPT = "return redis.call('HGET', KEYS[1], ARGV[1])";
const OPTIONS = { keys: ['room:fog:meta'], arguments: ['current'] };

function baseClient(): RedisHashClient {
  return {
    hGetAll: async () => ({}),
    hGet: async () => null,
    hSet: async () => 1,
    hDel: async () => 1,
    del: async () => 1,
    eval: async () => null,
  };
}

describe('createScriptRunner', () => {
  it('uses EVAL when the client has no evalSha', async () => {
    const evalFn = vi.fn(async () => 'evaluated');
    const client: RedisHashClient = { ...baseClient(), eval: evalFn };

    const run = createScriptRunner(client);
    await expect(run(SCRIPT, OPTIONS)).resolves.toBe('evaluated');

    expect(evalFn).toHaveBeenCalledTimes(1);
    expect(evalFn).toHaveBeenCalledWith(SCRIPT, OPTIONS);
  });

  it('loads once and evaluates by sha afterwards', async () => {
    const evalFn = vi.fn(async () => 'evaluated');
    const scriptLoad = vi.fn(async () => 'sha-1');
    const evalSha = vi.fn(async () => 'by-sha');
    const client: RedisHashClient = { ...baseClient(), eval: evalFn, scriptLoad, evalSha };

    const run = createScriptRunner(client);
    await expect(run(SCRIPT, OPTIONS)).resolves.toBe('by-sha');
    await expect(run(SCRIPT, OPTIONS)).resolves.toBe('by-sha');

    expect(scriptLoad).toHaveBeenCalledTimes(1);
    expect(scriptLoad).toHaveBeenCalledWith(SCRIPT);
    expect(evalSha).toHaveBeenCalledTimes(2);
    expect(evalSha).toHaveBeenNthCalledWith(1, 'sha-1', OPTIONS);
    expect(evalFn).toHaveBeenCalledTimes(0);
  });

  it('reloads after NOSCRIPT', async () => {
    const evalFn = vi.fn(async () => 'evaluated');
    const scriptLoad = vi.fn(async () => 'sha-1');
    let failures = 1;
    const evalSha = vi.fn(async () => {
      if (failures > 0) {
        failures -= 1;
        throw new Error('NOSCRIPT No matching script. Please use EVAL.');
      }
      return 'by-sha';
    });
    const client: RedisHashClient = { ...baseClient(), eval: evalFn, scriptLoad, evalSha };

    const run = createScriptRunner(client);
    await expect(run(SCRIPT, OPTIONS)).resolves.toBe('by-sha');
    await expect(run(SCRIPT, OPTIONS)).resolves.toBe('by-sha');

    expect(scriptLoad).toHaveBeenCalledTimes(2);
    expect(evalSha).toHaveBeenCalledTimes(3);
    expect(evalFn).toHaveBeenCalledTimes(0);
  });

  it('loads a script once for two calls started concurrently', async () => {
    const evalFn = vi.fn(async () => 'evaluated');
    const scriptLoad = vi.fn(async () => 'sha-1');
    const evalSha = vi.fn(async () => 'by-sha');
    const client: RedisHashClient = { ...baseClient(), eval: evalFn, scriptLoad, evalSha };

    const run = createScriptRunner(client);
    const first = run(SCRIPT, OPTIONS);
    const second = run(SCRIPT, OPTIONS);

    await expect(Promise.all([first, second])).resolves.toEqual(['by-sha', 'by-sha']);
    expect(scriptLoad).toHaveBeenCalledTimes(1);
    expect(evalSha).toHaveBeenCalledTimes(2);
    expect(evalFn).toHaveBeenCalledTimes(0);
  });

  it('keeps the reload a concurrent NOSCRIPT already started', async () => {
    const evalFn = vi.fn(async () => 'evaluated');
    let loads = 0;
    const scriptLoad = vi.fn(async () => {
      loads += 1;
      return `sha-${loads}`;
    });
    // Only the first load's sha is missing server-side; a reload must happen once.
    const evalSha = vi.fn(async (sha: string) => {
      if (sha === 'sha-1') throw new Error('NOSCRIPT No matching script. Please use EVAL.');
      return 'by-sha';
    });
    const client: RedisHashClient = { ...baseClient(), eval: evalFn, scriptLoad, evalSha };

    const run = createScriptRunner(client);
    const first = run(SCRIPT, OPTIONS);
    const second = run(SCRIPT, OPTIONS);

    await expect(Promise.all([first, second])).resolves.toEqual(['by-sha', 'by-sha']);
    expect(scriptLoad).toHaveBeenCalledTimes(2);
    expect(evalSha).toHaveBeenCalledTimes(4);
  });

  it('propagates other errors', async () => {
    const evalFn = vi.fn(async () => 'evaluated');
    const scriptLoad = vi.fn(async () => 'sha-1');
    const evalSha = vi.fn(async () => {
      throw new Error('READONLY You cannot write against a read only replica.');
    });
    const client: RedisHashClient = { ...baseClient(), eval: evalFn, scriptLoad, evalSha };

    const run = createScriptRunner(client);
    await expect(run(SCRIPT, OPTIONS)).rejects.toThrow('READONLY');

    expect(scriptLoad).toHaveBeenCalledTimes(1);
    expect(evalSha).toHaveBeenCalledTimes(1);
    expect(evalFn).toHaveBeenCalledTimes(0);
  });
});
