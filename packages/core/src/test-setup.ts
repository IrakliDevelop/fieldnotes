// Stub document.execCommand and document.queryCommandState which are not
// implemented in jsdom but are needed for rich-text formatting tests.
if (typeof document !== 'undefined' && !('execCommand' in document)) {
  Object.defineProperty(document, 'execCommand', {
    value: (_command: string) => false,
    writable: true,
    configurable: true,
  });
}

if (typeof document !== 'undefined' && !('queryCommandState' in document)) {
  Object.defineProperty(document, 'queryCommandState', {
    value: (_command: string) => false,
    writable: true,
    configurable: true,
  });
}

// Provide a localStorage mock for tests. jsdom should provide it, but Node.js 22+
// has experimental localStorage support that may interfere. This mock ensures tests
// have a working localStorage and that vi.spyOn(Storage.prototype, 'setItem') works.
const testStorageStore = new Map<string, string>();

// Ensure Storage constructor exists
if (typeof globalThis.Storage === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).Storage = class Storage {
    getItem(key: string): string | null {
      return testStorageStore.get(key) ?? null;
    }
    setItem(key: string, value: string): void {
      testStorageStore.set(key, String(value));
    }
    removeItem(key: string): void {
      testStorageStore.delete(key);
    }
    clear(): void {
      testStorageStore.clear();
    }
    key(index: number): string | null {
      return Array.from(testStorageStore.keys())[index] ?? null;
    }
    get length(): number {
      return testStorageStore.size;
    }
  };
}

// Override localStorage with an instance that uses Storage.prototype methods
// This ensures vi.spyOn(Storage.prototype, 'setItem') affects localStorage.setItem
Object.defineProperty(globalThis, 'localStorage', {
  value: Object.create(Storage.prototype),
  writable: true,
  configurable: true,
});

// Initialize the prototype methods to use our test store
Storage.prototype.getItem = function (key: string): string | null {
  return testStorageStore.get(key) ?? null;
};
Storage.prototype.setItem = function (key: string, value: string): void {
  testStorageStore.set(key, String(value));
};
Storage.prototype.removeItem = function (key: string): void {
  testStorageStore.delete(key);
};
Storage.prototype.clear = function (): void {
  testStorageStore.clear();
};
Storage.prototype.key = function (index: number): string | null {
  return Array.from(testStorageStore.keys())[index] ?? null;
};
Object.defineProperty(Storage.prototype, 'length', {
  get: function () {
    return testStorageStore.size;
  },
  configurable: true,
});
