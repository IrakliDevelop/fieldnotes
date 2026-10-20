# @fieldnotes/sync

**Version:** 0.19.0
**Location:** `packages/sync/`
**Description:** Real-time element sync for Field Notes canvas SDK

## Overview

The sync package provides **transport-neutral real-time synchronization**. It handles:

- Wire protocol (envelopes, ops, validation)
- Transport abstraction (WebSocket, BroadcastChannel)
- Element synchronization (upsert, remove, snapshot)
- Layer synchronization (versioned records)
- Fog synchronization (tile patches)
- Presence (cursors, selection, awareness)

**Key principle:** The sync client is transport-agnostic. It works over WebSocket, BroadcastChannel, or any message channel.

## Directory Structure

```
packages/sync/src/
├── sync-client.ts              # Main client orchestrator
├── protocol.ts                 # Wire protocol types and validation
├── sync-transport.ts           # Transport interface
├── websocket-transport.ts      # WebSocket transport
├── broadcast-channel-transport.ts # BroadcastChannel transport
├── managed-connection.ts       # Auto-reconnect wrapper
├── layer-ledger.ts             # Layer version tracking
├── fog-ledger.ts               # Fog version tracking
└── index.ts                    # Public API exports
```

## Key Classes

### SyncClient

Main client orchestrator. Manages sync state and applies remote operations.

```typescript
const client = new SyncClient({
  transport: new WebSocketTransport({ url: 'ws://localhost:8080' }),
  clientId: 'client-1',
  room: 'room-1',
  store: elementStore,
  onElementsChange: (elements) => {
    // handle remote changes
  },
});

client.connect();
client.disconnect();
```

**Options:**

- `transport: SyncTransport` — message transport
- `clientId: string` — unique client identifier
- `room: string` — room to join
- `store: ElementStore` — local element store
- `onElementsChange?` — callback for remote changes
- `onPresenceChange?` — callback for presence updates
- `onSnapshot?` — callback for authoritative snapshots
- `layerSync?` — layer sync options
- `fogSync?` — fog sync options
- `flushIntervalMs?` — minimum gap between flushes of queued element ops (default 50, so at most
  20 per second); `0` sends every op synchronously
- `tombstoneRetentionMs?` — how long delete tombstones are kept (default 7 days)

**Methods:**

- `connect()` — establish connection
- `disconnect()` — close connection
- `sendPresence(data)` — broadcast presence
- `requestSnapshot()` — request full state
- `flush()` — send queued element ops now

### SyncTransport

Interface for message transports:

```typescript
interface SyncTransport {
  send(message: string): void;
  onMessage(handler: (message: string) => void): void;
  onOpen(handler: () => void): void;
  onClose?(handler: () => void): () => void; // optional; fired on every unintended close
  onError(handler: (error: Error) => void): void;
  connect(): void;
  disconnect(): void;
}
```

### WebSocketTransport

WebSocket-based transport:

```typescript
const transport = new WebSocketTransport({
  url: 'ws://localhost:8080',
  protocols: ['fieldnotes-sync'],
});
```

### BroadcastChannelTransport

BroadcastChannel-based transport (same-browser testing):

```typescript
const transport = new BroadcastChannelTransport({
  channel: 'test-room',
});
```

### ManagedSyncConnection

Auto-reconnect wrapper:

```typescript
const connection = createManagedSyncConnection({
  transport: new WebSocketTransport({ url: 'ws://localhost:8080' }),
  onStatusChange: (status) => {
    console.log('Status:', status); // 'connecting' | 'connected' | 'disconnected'
  },
});

connection.connect();
```

## Protocol

### SyncEnvelope

All messages are wrapped in envelopes:

```typescript
interface SyncEnvelope {
  from: string; // client ID
  op: SyncOp;
}
```

### SyncOp Types

```typescript
type SyncOp =
  | { kind: 'upsert'; element: CanvasElement }
  | { kind: 'remove'; id: string }
  | { kind: 'batch'; ops: BatchOp[] } // only to and from hubs that advertise opBatching
  | { kind: 'unsupported'; protocolVersion: number; minProtocolVersion: number; reason: string }
  | { kind: 'clear' }
  | { kind: 'request-snapshot' }
  | {
      kind: 'snapshot';
      to: string;
      elements: CanvasElement[];
      layers?: LayerRecord[];
      fog?: FogSnapshot;
    }
  | { kind: 'presence'; data: unknown }
  | { kind: 'presence-leave' }
  | { kind: 'layer-upsert'; layer: Layer; version: number; editor: string }
  | { kind: 'layer-remove'; id: string; version: number; editor: string }
  | { kind: 'fog-meta'; record: FogMetaRecord }
  | { kind: 'fog-patch'; generation: string; tiles: FogTileRecord[] };
```

### Validation

Protocol messages are validated before processing:

```typescript
import { isValidEnvelope, isValidElement } from '@fieldnotes/sync';

if (!isValidEnvelope(envelope)) {
  throw new Error('Invalid envelope');
}
```

### Protocol Versions

```typescript
const LAYER_SYNC_PROTOCOL_VERSION = 1;
const FOG_SYNC_PROTOCOL_VERSION = 1;
```

## Conflict Resolution

### Layers

Layers use versioned records:

```typescript
interface LayerRecord {
  id: string;
  version: number; // monotonic counter
  editor: string; // client ID
  definition?: Layer; // undefined = tombstone
}

// Higher version wins; ties broken by lexicographic editor ID
function isNewerLayerRecord(a: LayerRecord, b: LayerRecord): boolean {
  if (a.version !== b.version) return a.version > b.version;
  return a.editor > b.editor;
}
```

### Fog

Fog uses generation-based tracking:

```typescript
interface FogTileRecord {
  generation: string; // fog definition ID
  x: number;
  y: number;
  version: number;
  editor: string;
  data?: string; // base64-encoded tile
}
```

## Presence

Presence data is broadcast to all clients:

```typescript
client.sendPresence({
  kind: 'cursor',
  x: 100,
  y: 200,
  color: '#ff0000',
});
```

**Presence types:**

- Cursor position
- Selection state
- Laser pointer
- Ping (attention)
- Stroke preview (`PencilTool.onPreview`, drawn by `RemoteStrokeOverlay`)
- Focus (viewport)

The hub does not filter presence by audience, so do not forward stroke previews for strokes on
audience-restricted layers.

## Data Flow

### Local Change → Remote

```
1. Local mutation → ElementStore
2. SyncClient observes via subscription
3. Op queued; the queue is flushed at most every flushIntervalMs (as a batch through 0.29 hubs)
4. Sent via Transport
5. Server validates and relays to other clients
```

### Remote → Local Change

```
1. Transport receives message
2. SyncClient parses envelope
3. Validates op
4. Applies to local ElementStore with origin: 'remote'
5. ElementStore fires 'add'/'update'/'remove' event
6. RenderLoop renders updated state
```

## Testing

```bash
# Run all sync tests
pnpm --filter @fieldnotes/sync test

# Run specific test
pnpm --filter @fieldnotes/sync test -- src/sync-client.test.ts
```

**Testing pattern:** Use `BroadcastChannelTransport` for same-browser testing:

```typescript
const client1 = new SyncClient({
  transport: new BroadcastChannelTransport({ channel: 'test' }),
  clientId: 'client-1',
  room: 'room-1',
  store: store1,
});

const client2 = new SyncClient({
  transport: new BroadcastChannelTransport({ channel: 'test' }),
  clientId: 'client-2',
  room: 'room-1',
  store: store2,
});

// Changes in client1 appear in client2
// Pass flushIntervalMs: 0 to send element ops synchronously instead of every 50 ms.
```

## Build

```bash
pnpm --filter @fieldnotes/sync build
```

## Peer Dependencies

- `@fieldnotes/core` >= 0.82.0 < 1.0.0
