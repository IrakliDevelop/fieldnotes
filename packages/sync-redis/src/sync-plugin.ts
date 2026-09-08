import type { ServiceKey } from '@fieldnotes/core';
import type { RedisHashClient } from './redis-hash-client';

export interface BackendPluginContext {
  readonly client: RedisHashClient;
  readonly roomKeyPrefix: string;
  registerService<T>(key: ServiceKey<T>, service: NoInfer<T>): void;
  addDisposer(dispose: () => void): void;
}

export interface BackendSyncPlugin {
  readonly name: string;
  readonly keyPrefix: string;
  readonly scripts?: Readonly<Record<string, string>>;
  start(context: BackendPluginContext): void;
}
