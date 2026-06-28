import type { StorageAdapter } from './storage-adapter';

export interface IndexedDBAdapterOptions {
  dbName?: string;
  storeName?: string;
  indexedDB?: IDBFactory;
}

const DEFAULT_DB = 'fieldnotes';
const DEFAULT_STORE = 'state';

export class IndexedDBAdapter implements StorageAdapter {
  private readonly dbName: string;
  private readonly storeName: string;
  private readonly idb: IDBFactory | null;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(options: IndexedDBAdapterOptions = {}) {
    this.dbName = options.dbName ?? DEFAULT_DB;
    this.storeName = options.storeName ?? DEFAULT_STORE;
    this.idb = options.indexedDB ?? (typeof indexedDB !== 'undefined' ? indexedDB : null);
  }

  private open(): Promise<IDBDatabase> {
    const idb = this.idb;
    if (!idb) return Promise.reject(new Error('IndexedDB unavailable'));
    if (!this.dbPromise) {
      const storeName = this.storeName;
      this.dbPromise = new Promise((resolve, reject) => {
        const req = idb.open(this.dbName, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
      });
    }
    return this.dbPromise;
  }

  async load(key: string): Promise<string | null> {
    if (!this.idb) return null;
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(this.storeName, 'readonly').objectStore(this.storeName).get(key);
      req.onsuccess = () => {
        const v = req.result;
        resolve(typeof v === 'string' ? v : null);
      };
      req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed'));
    });
  }

  async save(key: string, value: string): Promise<void> {
    if (!this.idb) return;
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      tx.objectStore(this.storeName).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'));
    });
  }

  async clear(key: string): Promise<void> {
    if (!this.idb) return;
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      tx.objectStore(this.storeName).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB delete aborted'));
    });
  }
}
