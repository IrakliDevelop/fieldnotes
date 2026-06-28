// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { LocalStorageAdapter } from './local-storage-adapter';

describe('LocalStorageAdapter', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('round-trips a saved value', async () => {
    const adapter = new LocalStorageAdapter();
    await adapter.save('k', 'v');
    expect(await adapter.load('k')).toBe('v');
  });

  it('returns null for a missing key', async () => {
    const adapter = new LocalStorageAdapter();
    expect(await adapter.load('missing')).toBeNull();
  });

  it('clear removes the value', async () => {
    const adapter = new LocalStorageAdapter();
    await adapter.save('k', 'v');
    await adapter.clear('k');
    expect(await adapter.load('k')).toBeNull();
  });

  it('is SSR-graceful when localStorage is undefined', async () => {
    const original = globalThis.localStorage;
    try {
      Object.defineProperty(globalThis, 'localStorage', {
        value: undefined,
        configurable: true,
      });
      const adapter = new LocalStorageAdapter();
      expect(await adapter.load('k')).toBeNull();
      await expect(adapter.save('k', 'v')).resolves.toBeUndefined();
      await expect(adapter.clear('k')).resolves.toBeUndefined();
    } finally {
      Object.defineProperty(globalThis, 'localStorage', {
        value: original,
        configurable: true,
      });
    }
  });

  it('rejects when the quota is exceeded', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    const adapter = new LocalStorageAdapter();
    await expect(adapter.save('k', 'v')).rejects.toThrow();
  });
});
