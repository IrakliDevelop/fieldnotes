export interface StorageAdapter {
  load(key: string): Promise<string | null>;
  save(key: string, value: string): Promise<void>;
  clear(key: string): Promise<void>;
}
