# @fieldnotes/sync-redis

A `HubBackend` that persists Field Notes relay room state in Redis — state survives relay restarts and is
shared across relay instances.

## Install

```bash
pnpm add @fieldnotes/sync-redis
# plus your Redis client of choice, e.g.:
pnpm add redis        # node-redis v4
# or
pnpm add ioredis
```

`@fieldnotes/sync-redis` has **no Redis dependency of its own** — you inject a client that satisfies a
minimal `RedisHashClient` interface (`hGetAll` / `hSet` / `hDel` / `del`).

## node-redis v4 (direct)

node-redis v4's client already matches `RedisHashClient`, so you can pass it straight through:

```ts
import { createClient } from 'redis';
import { createSyncServer } from '@fieldnotes/sync-server';
import { RedisHubBackend } from '@fieldnotes/sync-redis';

const client = createClient({ url: process.env.REDIS_URL });
await client.connect();
createSyncServer({ port: 8080, backend: new RedisHubBackend(client) });
```

## ioredis (shim)

ioredis uses lowercased method names, so wrap it in a small adapter:

```ts
import Redis from 'ioredis';
import { RedisHubBackend } from '@fieldnotes/sync-redis';

const io = new Redis(process.env.REDIS_URL);
const client = {
  hGetAll: (k: string) => io.hgetall(k),
  hSet: (k: string, f: string, v: string) => io.hset(k, f, v),
  hDel: (k: string, f: string) => io.hdel(k, f),
  del: (k: string) => io.del(k),
};
const backend = new RedisHubBackend(client);
```

## Key schema

Each room is stored as a Redis **HASH** at `{keyPrefix}{room}` (default prefix `fieldnotes:room:`):

- **field** = element id
- **value** = `JSON.stringify(element)`

The prefix is configurable:

```ts
new RedisHubBackend(client, { keyPrefix: 'myapp:room:' });
```

## Single vs. multiple relay instances

Persistence and shared state work with any number of relay instances — every instance reads and writes the
same Redis, so room state survives restarts and is visible to all of them.

However, for clients connected to **different** relay instances to see each other's **live** ops, you also
need cross-instance fan-out (Redis pub/sub) — a planned follow-up. A **single** relay instance is fully live
today.
