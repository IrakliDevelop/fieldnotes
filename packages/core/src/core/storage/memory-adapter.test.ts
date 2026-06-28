import { describe, it, expect } from 'vitest';
import { MemoryAdapter } from './memory-adapter';

describe('MemoryAdapter', () => {
  it('round-trips a saved value', async () => {
    const adapter = new MemoryAdapter();
    await adapter.save('k', 'v');
    expect(await adapter.load('k')).toBe('v');
  });

  it('returns null for a missing key', async () => {
    const adapter = new MemoryAdapter();
    expect(await adapter.load('missing')).toBeNull();
  });

  it('clear removes the value', async () => {
    const adapter = new MemoryAdapter();
    await adapter.save('k', 'v');
    await adapter.clear('k');
    expect(await adapter.load('k')).toBeNull();
  });

  it('overwrite replaces the value', async () => {
    const adapter = new MemoryAdapter();
    await adapter.save('k', 'a');
    await adapter.save('k', 'b');
    expect(await adapter.load('k')).toBe('b');
  });
});
