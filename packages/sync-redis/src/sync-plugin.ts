import type { ServiceKey } from '@fieldnotes/core';
import type { RedisHashClient } from './redis-hash-client';

export interface BackendPluginContext {
  readonly client: RedisHashClient;
  /** Raw key prefix shared by every room-scoped hash. Prefer `roomKey`. */
  readonly roomKeyPrefix: string;
  /**
   * The escaped base key for `room`; derive sub-keys as `${roomKey(room)}:<suffix>`.
   * Building keys from `roomKeyPrefix` and the raw room name lets a hostile
   * room name alias another room's sub-key hashes.
   */
  roomKey(room: string): string;
  registerService<T>(key: ServiceKey<T>, service: NoInfer<T>): void;
  addDisposer(dispose: () => void): void;
}

export interface BackendSyncPlugin {
  readonly name: string;
  readonly keyPrefix: string;
  readonly scripts?: Readonly<Record<string, string>>;
  start(context: BackendPluginContext): void;
}
