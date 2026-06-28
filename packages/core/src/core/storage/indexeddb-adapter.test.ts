import { describe, it, expect } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDBAdapter } from './indexeddb-adapter';

describe('IndexedDBAdapter', () => {
  it('round-trips save → load → clear', async () => {
    const adapter = new IndexedDBAdapter({ indexedDB: new IDBFactory(), dbName: 'rt-db' });
    await adapter.save('k', 'v');
    expect(await adapter.load('k')).toBe('v');
    await adapter.clear('k');
    expect(await adapter.load('k')).toBeNull();
  });

  it('returns null for a missing key', async () => {
    const adapter = new IndexedDBAdapter({ indexedDB: new IDBFactory(), dbName: 'miss-db' });
    expect(await adapter.load('missing')).toBeNull();
  });

  it('persists across adapter instances sharing one IDBFactory', async () => {
    const idb = new IDBFactory();
    const writer = new IndexedDBAdapter({ indexedDB: idb, dbName: 'shared-db' });
    const reader = new IndexedDBAdapter({ indexedDB: idb, dbName: 'shared-db' });
    await writer.save('k', 'persisted');
    expect(await reader.load('k')).toBe('persisted');
  });

  it('is graceful with no usable factory (SSR)', async () => {
    const hadGlobal = typeof (globalThis as { indexedDB?: unknown }).indexedDB !== 'undefined';
    const original = (globalThis as { indexedDB?: unknown }).indexedDB;
    if (hadGlobal) delete (globalThis as { indexedDB?: unknown }).indexedDB;
    try {
      const adapter = new IndexedDBAdapter({ indexedDB: undefined });
      expect(await adapter.load('k')).toBeNull();
      await expect(adapter.save('k', 'v')).resolves.toBeUndefined();
      await expect(adapter.clear('k')).resolves.toBeUndefined();
    } finally {
      if (hadGlobal) (globalThis as { indexedDB?: unknown }).indexedDB = original;
    }
  });
});
