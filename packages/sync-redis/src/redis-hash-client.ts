// The minimal Redis surface RedisHubBackend needs. node-redis v4 conforms directly; ioredis via a thin shim.
export interface RedisHashClient {
  hGetAll(key: string): Promise<Record<string, string>>;
  hSet(key: string, field: string, value: string): Promise<unknown>;
  hDel(key: string, field: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
}
