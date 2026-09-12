// The minimal Redis surface RedisHubBackend needs. node-redis v4 conforms directly; ioredis via a thin shim.
export interface RedisHashClient {
  hGetAll(key: string): Promise<Record<string, string>>;
  hGet(key: string, field: string): Promise<string | null>;
  hSet(key: string, field: string, value: string): Promise<unknown>;
  hDel(key: string, field: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
  /** Primitive used by backend plugins for atomic updates; node-redis conforms directly. */
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
  /** Optional: caches a Lua script server-side and returns its SHA1. Enables EVALSHA. */
  scriptLoad?(script: string): Promise<string>;
  /** Optional: runs a cached Lua script by SHA1. Only used when `scriptLoad` is present too. */
  evalSha?(sha: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}
