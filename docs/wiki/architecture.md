# Architecture Overview

## System Design

Field Notes is a **framework-agnostic infinite canvas SDK** built as a TypeScript monorepo. The architecture follows a layered design where:

- **Core** provides the framework-free canvas engine
- **React** wraps core with React-specific lifecycle and hooks
- **Sync packages** add real-time collaboration on top of core

Dependencies flow **one direction**: wrappers and adapters depend toward contracts, never the reverse.

```
┌─────────────────────────────────────────────────────────┐
│                    Application Layer                     │
│  (demo, examples/react-app, examples/live-play)         │
└────────────────┬────────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────────┐
│                   @fieldnotes/react                      │
│  (React bindings, hooks, context, components)           │
└────────────────┬────────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────────┐
│                    @fieldnotes/core                      │
│  (Canvas engine, elements, tools, history, rendering)   │
└────────────────┬────────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────────┐
│  @fieldnotes/sync  →  @fieldnotes/sync-server           │
│  (Client protocol)   (WebSocket relay, auth)            │
│         │                                               │
│         ▼                                               │
│  @fieldnotes/sync-redis                                 │
│  (Redis persistence, cross-instance fanout)             │
└─────────────────────────────────────────────────────────┘
```

## Package Responsibilities

### @fieldnotes/core (v0.68.0)

The **framework-free canvas engine**. Zero framework dependencies — pure TypeScript that works in any browser environment.

**Key subsystems:**

| Directory   | Responsibility                                                    |
| ----------- | ----------------------------------------------------------------- |
| `canvas/`   | Viewport, camera, input routing, rendering, export, interactions  |
| `elements/` | Element types, factories, store, geometry, editing, rendering     |
| `tools/`    | Tool strategies (hand, pencil, eraser, select, arrow, note, etc.) |
| `history/`  | Commands, transaction recording, undo/redo                        |
| `layers/`   | Layer ordering, visibility, locking, opacity                      |
| `fog/`      | Fog of war system (mask, tiles, rendering, tools)                 |
| `core/`     | Generic geometry, events, indexing, persistence, serialization    |

**Composition root:** `Viewport` class in `canvas/viewport.ts` coordinates all subsystems. It owns:

- Camera (pan/zoom transforms)
- ElementStore (element CRUD + spatial index)
- ToolManager (tool lifecycle)
- HistoryStack (undo/redo)
- LayerManager (layer state)
- RenderLoop (frame scheduling)
- InputHandler (pointer/keyboard routing)
- FogManager (fog of war state)

### @fieldnotes/react (v0.11.0)

**Thin React wrapper** over core. Provides:

- `<FieldNotesCanvas>` component
- React hooks (`useViewport`, `useCamera`, `useElements`, `useHistory`, etc.)
- Context provider for viewport access
- Automatic lifecycle management (cleanup on unmount)

**Key principle:** React bindings are a thin adapter layer. All logic lives in core.

### @fieldnotes/sync (v0.12.0)

**Transport-neutral sync client.** Handles:

- Wire protocol (envelopes, ops, validation)
- Transport abstraction (WebSocket, BroadcastChannel)
- Element synchronization (upsert, remove, snapshot)
- Layer synchronization (versioned records, conflict resolution)
- Fog synchronization (tile patches, generation tracking)
- Presence (cursors, selection, awareness)

**Key classes:**

- `SyncClient` — main client orchestrator
- `WebSocketTransport` / `BroadcastChannelTransport` — transport implementations
- `LayerLedger` / `FogLedger` — version tracking for conflict resolution

### @fieldnotes/sync-server (v0.14.0)

**Authoritative WebSocket relay.** Provides:

- `SyncHub` — room-based message routing
- Authentication and authorization hooks
- Heartbeat monitoring
- Resource limits (JSON depth, presence throttling)
- Read filtering (per-viewer element visibility)

**Key principle:** The server is a relay, not a store. It validates and routes messages but doesn't persist state (unless using Redis backend).

### @fieldnotes/sync-redis (v0.5.0)

**Redis-backed persistence** for the sync server. Implements:

- `RedisHubBackend` — persistent element/layer/fog storage
- `RedisHubFanout` — cross-instance message fanout via Pub/Sub

## Rendering Architecture

Field Notes uses **hybrid canvas+DOM rendering**:

- **Canvas layer** — drawing-heavy content (strokes, shapes, arrows, fog)
- **DOM layer** — interactive embedded content (notes, HTML elements, text)

Both layers share the same camera transform. The `RenderLoop` coordinates:

1. Clear and apply camera transform
2. Draw background (grid, pattern)
3. Draw elements (canvas-rendered)
4. Update DOM nodes (DOM-rendered)
5. Draw fog mask (if enabled)
6. Draw tool overlays
7. Draw registered overlay renderers

**Culling:** Only elements intersecting the visible viewport (plus margin) are rendered.

**Caching:** `LayerCache` caches rendered layers to avoid redundant work.

## Data Flow

### Local Editing

```
User input → InputHandler → Tool → ElementStore → HistoryRecorder
                                      ↓
                              RenderLoop (dirty flag)
                                      ↓
                              Render next frame
```

### Real-Time Sync

```
Local change → SyncClient → Transport → Server → Other clients
     ↑                                              ↓
     └──────────── SyncClient ← Transport ←─────────┘
```

1. Local change hits `ElementStore`
2. `SyncClient` observes via subscription
3. Change serialized into `SyncEnvelope`
4. Sent via `Transport` (WebSocket/BroadcastChannel)
5. Server validates and relays to other clients
6. Remote `SyncClient` receives and applies to local `ElementStore`
7. `origin: 'remote'` flag prevents re-broadcast and undo recording

## Serialization

State is serialized via `packages/core/src/core/state-serializer.ts`:

```typescript
interface CanvasState {
  version: 3; // current version
  elements: CanvasElement[];
  layers?: Layer[];
  fog?: FogStateV1;
}
```

**Versioning:** The serializer handles backward compatibility. Older versions still parse.

**Storage adapters:** `StorageAdapter` interface with implementations:

- `LocalStorageAdapter` — browser localStorage
- `IndexedDBAdapter` — browser IndexedDB
- `MemoryAdapter` — in-memory (for testing)

## Sync Protocol

The wire protocol is defined in `packages/sync/src/protocol.ts`:

```typescript
type SyncOp =
  | { kind: 'upsert'; element: CanvasElement }
  | { kind: 'remove'; id: string }
  | { kind: 'clear' }
  | {
      kind: 'snapshot';
      to: string;
      elements: CanvasElement[];
      layers?: LayerRecord[];
      fog?: FogSnapshot;
    }
  | { kind: 'presence'; data: unknown }
  | { kind: 'layer-upsert'; layer: Layer; version: number; editor: string }
  | { kind: 'fog-patch'; generation: string; tiles: FogTileRecord[] };
// ... etc
```

**Conflict resolution:** Layers and fog use versioned records with monotonic counters. Higher version wins; ties broken by lexicographic editor ID.

## Key Design Principles

1. **Framework-free core** — React is an adapter, not a dependency
2. **Composition over inheritance** — Viewport coordinates narrow collaborators
3. **One gesture = one undo step** — tool mutations stay inside history transactions
4. **Hybrid rendering** — canvas for performance, DOM for interactivity
5. **Transport-neutral sync** — protocol works over any message channel
6. **Authoritative server** — server validates and filters, clients trust it
7. **Backward-compatible serialization** — old state still loads
8. **Type-safe public API** — exports from `src/index.ts`, internal helpers stay internal
