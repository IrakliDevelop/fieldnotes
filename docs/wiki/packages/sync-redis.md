# @fieldnotes/sync-redis

**Version:** 0.5.0
**Location:** `packages/sync-redis/`
**Description:** Redis-backed HubBackend for Field Notes real-time sync relay

## Overview

The sync-redis package provides **Redis-backed persistence** for the sync server. It implements:

- `RedisHubBackend` — persistent element/layer/fog storage
- `RedisHubFanout` — cross-instance message fanout via Redis Pub/Sub

**Key principle:** Use this package when you need:

- Persistent state across server restarts
- Horizontal scaling across multiple server instances

## Directory Structure

```
packages/sync-redis/src/
├── redis-hub-backend.ts    # Redis storage backend
├── redis-hub-fanout.ts     # Redis Pub/Sub fanout
├── redis-hash-client.ts    # Redis hash operations interface
├── redis-fanout-client.ts  # Redis Pub/Sub interface
└── index.ts                # Public API exports
```

## Key Classes

### RedisHubBackend

Redis-backed storage backend. Persists elements, layers, and fog to Redis.

```typescript
import { RedisHubBackend } from '@fieldnotes/sync-redis';
import { createClient } from 'redis';

const redisClient = createClient({ url: 'redis://localhost:6379' });
await redisClient.connect();

const backend = new RedisHubBackend({
  client: redisClient,
  keyPrefix: 'fieldnotes:',
});
```

**Options:**

- `client: RedisClient` — Redis client instance
- `keyPrefix?: string` — key prefix (default: `'fieldnotes:'`)

**Data model:**

- Elements stored as Redis hashes: `{prefix}:room:{roomId}:elements`
- Layers stored as Redis hashes: `{prefix}:room:{roomId}:layers`
- Fog stored as Redis hashes: `{prefix}:room:{roomId}:fog:meta` and `{prefix}:room:{roomId}:fog:tiles`

### RedisHubFanout

Redis Pub/Sub-based fanout. Routes messages across multiple server instances.

```typescript
import { RedisHubFanout } from '@fieldnotes/sync-redis';

const fanout = new RedisHubFanout({
  publisher: redisPublisher,
  subscriber: redisSubscriber,
  channelPrefix: 'fieldnotes:fanout:',
});
```

**Options:**

- `publisher: RedisPublisher` — Redis client for publishing
- `subscriber: RedisSubscriber` — Redis client for subscribing
- `channelPrefix?: string` — channel prefix (default: `'fieldnotes:fanout:'`)

**How it works:**

1. Server instance A publishes message to Redis channel
2. All server instances subscribed to that channel receive the message
3. Each instance relays to its local WebSocket connections

## Usage with SyncHub

Combine with `@fieldnotes/sync-server`:

```typescript
import { SyncHub } from '@fieldnotes/sync-server';
import { RedisHubBackend, RedisHubFanout } from '@fieldnotes/sync-redis';
import { createClient } from 'redis';

// Create Redis clients
const redisClient = createClient({ url: 'redis://localhost:6379' });
const redisPublisher = createClient({ url: 'redis://localhost:6379' });
const redisSubscriber = createClient({ url: 'redis://localhost:6379' });

await Promise.all([redisClient.connect(), redisPublisher.connect(), redisSubscriber.connect()]);

// Create hub with Redis backend and fanout
const hub = new SyncHub({
  backend: new RedisHubBackend({ client: redisClient }),
  fanout: new RedisHubFanout({
    publisher: redisPublisher,
    subscriber: redisSubscriber,
  }),
});
```

## Horizontal Scaling

With Redis backend and fanout, you can run multiple server instances:

```
                    ┌─────────────┐
                    │    Redis    │
                    │  (storage)  │
                    │  (pub/sub)  │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
        ┌─────▼─────┐ ┌───▼─────┐ ┌───▼─────┐
        │  Server 1 │ │ Server 2│ │ Server 3│
        │  (Node)   │ │ (Node)  │ │ (Node)  │
        └─────┬─────┘ └───┬─────┘ └───┬─────┘
              │            │            │
              └────────────┼────────────┘
                           │
                    ┌──────▼──────┐
                    │   Clients   │
                    └─────────────┘
```

**Flow:**

1. Client connects to Server 1
2. Server 1 stores state in Redis
3. Client sends message
4. Server 1 publishes to Redis Pub/Sub
5. Servers 2 and 3 receive via subscription
6. Each server relays to its local clients

## Redis Client Interfaces

### RedisHashClient

Interface for Redis hash operations:

```typescript
interface RedisHashClient {
  hgetall(key: string): Promise<Record<string, string>>;
  hset(key: string, field: string, value: string): Promise<void>;
  hdel(key: string, field: string): Promise<void>;
  del(key: string): Promise<void>;
}
```

### RedisPublisher / RedisSubscriber

Interfaces for Redis Pub/Sub:

```typescript
interface RedisPublisher {
  publish(channel: string, message: string): Promise<void>;
}

interface RedisSubscriber {
  subscribe(channel: string, handler: (message: string) => void): Promise<void>;
  unsubscribe(channel: string): Promise<void>;
}
```

**Note:** These interfaces are compatible with the `redis` package (node-redis) but can be implemented for other Redis clients.

## Testing

```bash
# Run all Redis tests
pnpm --filter @fieldnotes/sync-redis test

# Run specific test
pnpm --filter @fieldnotes/sync-redis test -- src/redis-hub-backend.test.ts
```

**Testing requirements:** Redis server must be running for integration tests. Tests use a test-specific key prefix to avoid conflicts.

## Build

```bash
pnpm --filter @fieldnotes/sync-redis build
```

## Dependencies

- `@fieldnotes/sync` — shared protocol types

## Dev Dependencies

- `@fieldnotes/sync-server` — for integration tests
- `@fieldnotes/core` — for type definitions
