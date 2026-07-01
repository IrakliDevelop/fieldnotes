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
minimal `RedisHashClient` interface (`hGetAll` / `hGet` / `hSet` / `hDel` / `del`).

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
  hGet: (k: string, f: string) => io.hget(k, f),
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

node-redis v4 conforms to `RedisHashClient` directly (it has `hGet`); `RedisHubBackend.get(room, id)`
(via `HGET`) powers the relay's ownership lookups for write authorization (D2).

The prefix is configurable:

```ts
new RedisHubBackend(client, { keyPrefix: 'myapp:room:' });
```

## Single vs. multiple relay instances

Persistence and shared state work with any number of relay instances — every instance reads and writes the
same Redis, so room state survives restarts and is visible to all of them.

For clients connected to **different** relay instances to see each other's **live** ops, you also need
cross-instance fan-out (Redis pub/sub) — available via `RedisHubFanout` (below). A **single** relay instance
is fully live on its own.

## Cross-instance fan-out (`RedisHubFanout`)

`RedisHubFanout` is a `HubFanout` (from `@fieldnotes/sync-server`) over Redis pub/sub: each relay instance
publishes its live ops to a single channel and every other instance forwards them to its local connections.
Like the backend, it has **no Redis dependency of its own** — you inject two connections via the
`RedisPublisher` / `RedisSubscriber` seams.

> **The subscriber MUST be a dedicated connection.** Redis forbids any other command on a connection that is
> in subscribe mode, so publish and subscribe cannot share one connection — that is why `RedisHubFanout`
> takes two.

### node-redis v4

```ts
import { createClient } from 'redis';
import { createSyncServer } from '@fieldnotes/sync-server';
import { RedisHubBackend, RedisHubFanout } from '@fieldnotes/sync-redis';

const hash = createClient({ url: process.env.REDIS_URL });
await hash.connect(); // HASH backend (persistence)

const publisher = createClient({ url: process.env.REDIS_URL });
await publisher.connect();
const subscriber = publisher.duplicate();
await subscriber.connect(); // DEDICATED subscriber — a subscriber connection cannot also publish

createSyncServer({
  port: 8080,
  backend: new RedisHubBackend(hash),
  fanout: new RedisHubFanout(publisher, subscriber),
});
```

### ioredis

ioredis lowercases `publish`/`subscribe` and delivers messages via a `'message'` event, so wrap each client:

```ts
import Redis from 'ioredis';
import { RedisHubFanout } from '@fieldnotes/sync-redis';

const pubIo = new Redis(process.env.REDIS_URL); // publish connection
const subIo = new Redis(process.env.REDIS_URL); // SECOND, dedicated subscriber connection

const publisher = { publish: (c: string, m: string) => pubIo.publish(c, m) };
const subscriber = {
  subscribe: (channel: string, listener: (m: string) => void) => {
    subIo.on('message', (ch, msg) => {
      if (ch === channel) listener(msg);
    });
    return subIo.subscribe(channel);
  },
};

const fanout = new RedisHubFanout(publisher, subscriber);
```

### Channel

All instances must share one channel (default `fieldnotes:fanout`, configurable):

```ts
new RedisHubFanout(publisher, subscriber, { channel: 'myapp:fanout' });
```

### Precondition: shared fanout AND shared backend

Multi-instance **live** sync requires **both** a shared fanout **and** a shared backend (both Redis). The
fanout forwards live ops; the shared backend keeps snapshots consistent. A shared fanout **without** a shared
backend leaves a new joiner's snapshot stale — it would catch up from whichever instance it happened to hit,
missing edits applied elsewhere. Pair `RedisHubFanout` with `RedisHubBackend` for full multi-instance
real-time sync.
