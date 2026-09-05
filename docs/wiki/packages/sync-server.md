# @fieldnotes/sync-server

**Version:** 0.14.0
**Location:** `packages/sync-server/`
**Description:** Authoritative WebSocket relay server for Field Notes real-time sync

## Overview

The sync server provides an **authoritative WebSocket relay** for real-time collaboration. It:

- Routes messages between clients in the same room
- Validates and filters messages
- Enforces authentication and authorization
- Manages heartbeats and connection health
- Applies resource limits (JSON depth, presence throttling)

**Key principle:** The server is a relay, not a store. It validates and routes messages but doesn't persist state (unless using Redis backend via `@fieldnotes/sync-redis`).

## Directory Structure

```
packages/sync-server/src/
├── sync-hub.ts              # Room-based message routing
├── hub-backend.ts           # Storage backend interface
├── memory-hub-backend.ts    # In-memory backend (default)
├── hub-fanout.ts            # Fanout interface
├── create-sync-server.ts    # WebSocket server factory
├── authenticate.ts          # Auth hook types
├── authorize.ts             # Authorization hook types
├── heartbeat.ts             # Connection health monitoring
├── resource-limits.ts       # JSON depth, presence limits
└── index.ts                 # Public API exports
```

## Key Classes

### SyncHub

Room-based message router. Manages connections, validates messages, and relays ops.

```typescript
import { SyncHub } from '@fieldnotes/sync-server';

const hub = new SyncHub({
  backend: new MemoryHubBackend(),
  authorize: async (info) => {
    // Validate auth token
    return { userId: info.token, role: 'editor' };
  },
  canRead: (element, viewer) => {
    // Filter elements per-viewer
    return element.audience === 'all' || element.audience === viewer.userId;
  },
});

// Handle WebSocket connections
wss.on('connection', (ws) => {
  hub.handleConnection(ws, { room: 'room-1' });
});
```

**Options:**

- `backend?: HubBackend` — storage backend (default: `MemoryHubBackend`)
- `fanout?: HubFanout` — cross-instance fanout (default: `InMemoryHubFanout`)
- `authorize?: Authenticate` — auth hook
- `authorizeLayer?: AuthorizeLayer` — layer auth hook
- `authorizeFog?: AuthorizeFog` — fog auth hook
- `canRead?: CanRead` — element read filter
- `maxJsonDepth?: number` — max JSON nesting depth (default: 10)
- `presenceThrottleMs?: number` — presence rate limit (default: 50ms)
- `maxPresenceLanes?: number` — max presence categories

**Methods:**

- `handleConnection(ws, options)` — register WebSocket connection
- `getRoom(roomId)` — get room state
- `broadcast(roomId, message)` — send to all clients in room

### MemoryHubBackend

In-memory storage backend (default). Stores elements, layers, and fog in memory.

```typescript
const backend = new MemoryHubBackend();
```

**Note:** Data is lost on server restart. Use `RedisHubBackend` for persistence.

### InMemoryHubFanout

In-memory fanout (default). Routes messages within a single server instance.

```typescript
const fanout = new InMemoryHubFanout();
```

**Note:** Doesn't work across multiple server instances. Use `RedisHubFanout` for horizontal scaling.

### createSyncServer

Factory for creating a WebSocket server with sync hub:

```typescript
import { createSyncServer } from '@fieldnotes/sync-server';

const { server, hub } = createSyncServer({
  port: 8080,
  authorize: async (info) => {
    return { userId: info.token };
  },
});
```

## Authentication

Auth hook validates client connections:

```typescript
interface AuthInfo {
  token?: string;
  headers?: Record<string, string>;
}

interface AuthResult {
  userId: string;
  role?: string;
  metadata?: Record<string, unknown>;
}

type Authenticate = (info: AuthInfo) => Promise<AuthResult | null>;
```

**Example:**

```typescript
const authorize = async (info: AuthInfo) => {
  const token = info.headers?.['authorization'];
  if (!token) return null;

  const user = await verifyToken(token);
  if (!user) return null;

  return { userId: user.id, role: user.role };
};
```

## Authorization

Authorization hooks control access to rooms, layers, and fog:

### Authorize (Room Access)

```typescript
type Authorize = (auth: AuthResult, room: string) => Promise<boolean>;
```

### AuthorizeLayer (Layer Access)

```typescript
type AuthorizeLayer = (auth: AuthResult, room: string, layer: Layer) => Promise<boolean>;
```

### AuthorizeFog (Fog Access)

```typescript
type AuthorizeFog = (auth: AuthResult, room: string, fog: FogDefinitionV1) => Promise<boolean>;
```

### CanRead (Element Filtering)

```typescript
type CanRead = (element: CanvasElement, viewer: AuthResult) => boolean;
```

**Important:** Hidden data must not be sent — not merely hidden in the UI.

## Heartbeat

Monitors connection health:

```typescript
import { startHeartbeat } from '@fieldnotes/sync-server';

const heartbeat = startHeartbeat(ws, {
  interval: 30000,
  timeout: 10000,
  onTimeout: () => {
    ws.close();
  },
});
```

## Resource Limits

### JSON Depth

Limits message nesting to prevent DoS:

```typescript
const maxJsonDepth = 10;
if (!hasJsonDepthAtMost(message, maxJsonDepth)) {
  ws.close();
  return;
}
```

### Presence Throttling

Rate-limits presence updates:

```typescript
const presenceThrottleMs = 50;
// Presence updates are throttled to max 20 per second
```

### Presence Lanes

Presence is categorized into lanes (by `kind` field):

```typescript
// Each lane is throttled independently
// Max 64 lanes per room
```

## Message Flow

### Client → Server → Client

```
1. Client A sends envelope
2. Server validates envelope
3. Server checks auth/authorization
4. Server applies resource limits
5. Server filters elements (canRead)
6. Server relays to other clients in room
7. Client B receives envelope
```

### Snapshot Flow

```
1. Client connects and requests snapshot
2. Server loads state from backend
3. Server filters elements (canRead)
4. Server sends snapshot to client
5. Client applies snapshot to local store
```

## HubBackend Interface

Storage backend interface:

```typescript
interface HubBackend {
  // Elements
  getElements(room: string): Promise<CanvasElement[]>;
  upsertElement(room: string, element: CanvasElement): Promise<void>;
  removeElement(room: string, id: string): Promise<void>;
  clearElements(room: string): Promise<void>;

  // Layers
  getLayerRecords(room: string): Promise<LayerRecord[]>;
  upsertLayerRecord(room: string, record: LayerRecord): Promise<void>;
  removeLayerRecord(room: string, id: string): Promise<void>;

  // Fog
  getFogSnapshot(room: string): Promise<FogSnapshot | null>;
  applyFogMeta(room: string, record: FogMetaRecord): Promise<void>;
  applyFogPatch(room: string, tiles: FogTileRecord[]): Promise<FogApplyResult>;
}
```

## HubFanout Interface

Cross-instance message routing:

```typescript
interface HubFanout {
  publish(room: string, message: string): Promise<void>;
  subscribe(room: string, handler: (message: string) => void): Promise<void>;
  unsubscribe(room: string): Promise<void>;
}
```

## Testing

```bash
# Run all server tests
pnpm --filter @fieldnotes/sync-server test

# Run specific test
pnpm --filter @fieldnotes/sync-server test -- src/sync-hub.test.ts
```

## Build

```bash
pnpm --filter @fieldnotes/sync-server build
```

## Dependencies

- `ws` — WebSocket server
- `@fieldnotes/sync` — shared protocol types
