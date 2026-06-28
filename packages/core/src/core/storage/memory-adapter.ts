import type { StorageAdapter } from './storage-adapter';

export class MemoryAdapter implements StorageAdapter {
  private store = new Map<string, string>();
  async load(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async save(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
  async clear(key: string): Promise<void> {
    this.store.delete(key);
  }
}
