# ADR-0003: Sync/Server Plugin Ownership

- **Status:** Proposed
- **Deciders:** Project maintainer
- **Date:** 2026-09-05
- **Supersedes:** —
- **Related:** [ADR-0004](0004-serialization-compatibility.md) (serialization), [ADR-0005](0005-plugin-lifecycle.md) (plugin lifecycle)

## Context

Fog sync is not a client-side concern. It spans four layers, each with significant fog-specific code:

### Layer 1: Sync client (`@fieldnotes/sync`)

`SyncOp` has 11 variants, 2 of which are fog-specific:

```typescript
// packages/sync/src/protocol.ts
type SyncOp =
  | { kind: 'upsert'; element: CanvasElement }
  | { kind: 'remove'; id: string }
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
  | { kind: 'fog-meta'; record: FogMetaRecord } // ← VTT-specific
  | { kind: 'fog-patch'; generation: string; tiles: FogTileRecord[] } // ← VTT-specific
  | ExtensionOp; // ← Plugin extension envelope

// Extension ops use a uniform envelope that extends the closed SyncOp union
type ExtensionOp = {
  kind: 'extension';
  extensionKind: string; // e.g., 'vtt:fog-meta', 'vtt:fog-patch'
  payload: unknown; // Validated by the owning plugin's codec
};

// Plugin-scoped snapshot envelope
interface PluginSnapshot {
  pluginName: string; // Owning plugin's name
  version: number; // Plugin-specific version for migration
  data: unknown; // Plugin-specific state (validated by plugin)
}
```

`isValidEnvelope()` is a switch on `op.kind` with a `default: return false` — unknown op kinds are rejected. `parseEnvelope()` returns `null` for invalid envelopes, and the sync hub silently drops nulls.

### Layer 2: Sync server (`@fieldnotes/sync-server`)

- `authorize.ts`: `AuthorizeFog` type, `AuthorizeFogContext` with `userId`, `role`, `room`, `op`, `current: FogSnapshot`
- `hub-backend.ts`: `HubBackend` interface with 4 optional fog methods: `fogSnapshot()`, `applyFogMeta()`, `applyFogTile()`, `applyFogPatch()`
- `sync-hub.ts`: `processFogOp()` routes fog ops through authorization, applies via backend, fans out accepted ops, sends corrections for denied ops
- `memory-hub-backend.ts`: `MemoryHubBackend` implements all fog methods via in-memory `FogLedger`
- Constructor validates fog methods are all-or-none: if any of `fogSnapshot`, `applyFogMeta`, `applyFogPatch` is present, all must be

### Layer 3: Redis backend (`@fieldnotes/sync-redis`)

`redis-hub-backend.ts` contains ~300+ lines of fog-specific code:

- **Key schemas:** `fogMetaKey(room)` → `{prefix}{room}:fog:meta`, `fogTilesKey(room)` → `{prefix}{room}:fog:tiles`
- **Lua script `FOG_META_LWW_SCRIPT`** (~80 lines): Last-writer-wins conflict resolution for fog metadata. Compares `(version, editor)` ordering. On acceptance, deletes tiles hash and re-populates with replacement tiles. Validates definition structure inline. Retries up to 4 times on optimistic concurrency conflict.
- **Lua script `FOG_PATCH_LWW_SCRIPT`** (~100 lines): Per-tile LWW. Validates each tile against current definition's generation and bounds intersection. Enforces 256-tile cap. Returns `{#accepted, ...accepted, #corrections, ...corrections}`.
- **Validation:** `isValidFogMetaRecord`, `isValidFogTileRecord`, `isValidFogSnapshot`
- **Canonicalization:** `canonicalizeFogTile()` re-canonicalizes stored tiles when definition changes within same generation

### Layer 4: RollKeeper relay (`~/Projects/RollKeeper/relay/src/`)

- `backend.ts`: Wraps fog backend methods in cost-optimized buffered backend
- `policies.ts`: DM-only fog authorization (`AuthorizeFog` implementation)

### The problem

The original migration plan treated sync-redis as "unchanged / generic key-value" and proposed only a client-side `FogSyncPlugin`. This ignores ~300 lines of Lua scripts, dedicated Redis key schemas, server authorization hooks, and RollKeeper's relay wrapping. The server-side extraction is a separate, substantial workstream.

## Decision

**Hybrid approach** (combination of Options A and B):

- **Client (`@fieldnotes/sync`):** Plugin contracts in existing package (Option B). The sync client gains a `registerPlugin()` API. Fog sync becomes a client plugin.
- **Server (`@fieldnotes/sync-server`):** Plugin contracts in existing package (Option B). The sync server gains a `registerPlugin()` API for authorization and op routing.
- **Redis backend (`@fieldnotes/sync-redis`):** Plugin contracts in existing package (Option B). The Redis backend gains a `registerPlugin()` API for domain-specific Lua scripts and key schemas.
- **VTT package (`@fieldnotes/vtt`):** Exports three plugin factories — one for each layer:

```typescript
// @fieldnotes/vtt exports:
export function createFogClientPlugin(options?: FogClientOptions): ClientSyncPlugin;
export function createFogServerPlugin(options: FogServerOptions): ServerSyncPlugin;
export function createFogBackendPlugin(): BackendSyncPlugin;
```

### Plugin interfaces

**Client plugin:**

```typescript
interface ClientSyncPlugin {
  readonly name: string;
  produceOps?(): SyncOp[];
  handleOp?(
    op: SyncOp,
    meta: {
      sender: string;
      isLocal: boolean;
      phase: 'live' | 'reconnect' | 'snapshot';
    },
  ): void;
  extendSnapshot?(snapshot: SyncSnapshot): void;
  applySnapshot?(
    snapshot: PluginSnapshot,
    meta: { phase: 'initial' | 'reconnect' | 'offline-replay' },
  ): void;
  handleCorrection?(op: SyncOp): void; // Handle server-sent corrections

  // Register extension kinds this plugin owns — atomic binding
  registerExtensionKinds?(registry: ClientExtensionRegistry): void;

  // Snapshot migration and validation
  migrateSnapshot?(data: unknown, fromVersion: number): unknown;
  validateSnapshot?(data: unknown): boolean;
}

interface ClientExtensionRegistry {
  register<TPayload>(config: {
    extensionKind: string;
    codec: OpCodec<TPayload>;
    handler: (op: ExtensionOp) => void;
  }): void;
}
```

The `handleOp` meta provides the sender identity, whether the op originated locally, and the
connection phase so the plugin can distinguish live ops from reconnect replays and authoritative
snapshot deliveries. `handleCorrection` receives ops the server rejected — the current fog flow
sends the existing tile state back to the sender only, not to the whole room.

`applySnapshot()` receives a `PluginSnapshot` (not the full `SyncSnapshot`) — the sync hub
dispatches snapshots to plugins by `pluginName`. `migrateSnapshot()` allows the plugin to migrate
old snapshot data when the `version` has changed. `validateSnapshot()` allows the plugin to
validate snapshot data on receipt.

**Server plugin:**

```typescript
interface ServerSyncPlugin {
  readonly name: string;

  // Unified processing for CORE ops only
  process?(op: SyncOp, ctx: ServerOpContext): Promise<ApplyResult>;

  // Register extension kinds this plugin owns — atomic binding
  registerExtensionKinds?(registry: ServerExtensionRegistry): void;

  snapshot?(room: string, backend: HubBackend): Promise<PluginSnapshot>;
  filterSnapshot?(
    snapshot: PluginSnapshot,
    viewer: { userId: string; role: string },
  ): PluginSnapshot | null;
}

interface ServerOpContext {
  room: string;
  connectionId: string;
  userId: string;
  role: string;
  backend: HubBackend;
  // Typed access to this plugin's corresponding backend plugin
  backendPlugin<T extends BackendSyncPlugin>(name: string): T | undefined;
}

interface ApplyResult {
  accepted: SyncOp | null; // The op to fan out (may be modified/partial)
  corrections: SyncOp[]; // Ops to send back to sender only
  broadcast?: SyncOp[]; // Additional ops to broadcast to all (e.g., derived state)
}

// OpCodec validates payloads for a specific extension kind
interface OpCodec<TPayload = unknown> {
  extensionKind: string;
  validate(payload: unknown): payload is TPayload;
}

// ServerExtensionRegistry atomically binds extension kind + codec + handler
interface ServerExtensionRegistry {
  register<TPayload>(config: {
    extensionKind: string;
    codec: OpCodec<TPayload>;
    handler: (op: ExtensionOp, ctx: ServerOpContext) => Promise<ApplyResult>;
  }): void;
}
```

Instead of trying to extend the closed `SyncOp` union at runtime (which TypeScript cannot do),
all extension ops flow through a single `ExtensionOp` envelope with `kind: 'extension'`. The
`extensionKind` field discriminates between different extension op types (e.g.,
`'vtt:fog-meta'`, `'vtt:fog-patch'`). Each plugin registers its extension kinds via
`registerExtensionKinds()`, which atomically binds the extension kind, codec, and handler at
every participating layer (client, server, and backend). The sync hub routes `ExtensionOp` by
looking up `extensionKind` in the registry, which returns both the codec (for validation) and
the handler (for processing). There is no separate `handleExtensionOp()` — the handler
registered via `registerExtensionKinds()` IS the processing entry point for extension ops.

Each extension kind is owned by exactly one plugin. The `registerExtensionKinds()` method
atomically binds the extension kind, codec, and handler. The sync hub routes incoming
`ExtensionOp` instances by looking up the `extensionKind` in the registry — the registered
handler processes the op. There is no ambiguity about ownership.

`process()` handles CORE ops only (upsert, remove, clear, etc.). Extension ops are routed
through the registered handlers, not through `process()`. This eliminates the overlap between
`process()` and extension op handling.

The server plugin interfaces model the actual fog processing flow in `sync-hub.ts`:

1. `process()` handles CORE ops only and unifies authorization and application into a single
   step. The current fog flow does authorization and application in a single `processFogOp()`
   function — the separate `authorize()` + `apply()` split didn't match this flow because
   denial needs to return corrections (current state), which requires backend access. A unified
   `process()` handles both paths naturally.
2. On denial: return `{ accepted: null, corrections: [current state] }` — the hub sends these
   to the sender only.
3. On accept: `ApplyResult.accepted` is the (possibly partial) op to fan out to all other
   connections; `corrections` go to the sender only; `broadcast` covers additional derived ops
   that go to everyone.
4. `snapshot()` takes a `room` parameter and returns a `PluginSnapshot` (with `pluginName`,
   `version`, and `data`) — the current `fogSnapshot()` is room-scoped.
5. `registerExtensionKinds()` lets plugins atomically register extension kinds with their codec
   and handler, so VTT (or future domains) can own new wire operations without modifying
   `@fieldnotes/sync` core.
6. `filterSnapshot()` allows per-viewer filtering of snapshot data. Return `null` to exclude
   the plugin's snapshot entirely for a viewer (e.g., hide fog state from non-DM viewers).
7. `ServerOpContext.backendPlugin<T>()` gives the server plugin typed access to its
   corresponding backend plugin, enabling server-side logic to coordinate with backend state.

The server collects snapshots from all registered plugins into a `SyncSnapshot`:

```typescript
interface SyncSnapshot {
  // ... existing fields (elements, layers, etc.) ...
  extensions: Record<string, PluginSnapshot>; // Keyed by pluginName
}
```

The server calls `snapshot()` on each `ServerSyncPlugin`, then applies `filterSnapshot()` per
viewer to allow per-viewer exclusion or modification. The client dispatches each
`PluginSnapshot` to the matching `ClientSyncPlugin` by `pluginName`, calling `applySnapshot()`
with the phase metadata.

**Backend (Redis) plugin:**

```typescript
interface BackendSyncPlugin {
  readonly name: string;
  readonly sharedAcrossInstances: boolean; // true = shared Redis, false = process-local
  keyPrefix: string;
  scripts?: Record<string, string>;
  snapshot?(room: string): Promise<PluginSnapshot>;
  // Middleware chain — each plugin can intercept, modify, or pass through
  apply?(room: string, op: SyncOp, next: BackendNext): Promise<ApplyResult>;
  dispose?(): void; // Lifecycle cleanup
}

// Middleware chain — each plugin can intercept, modify, or pass through
type BackendNext = (room: string, op: SyncOp) => Promise<ApplyResult>;
```

The backend plugin exposes atomic `snapshot` and `apply` operations rather than only raw
encode/decode codecs. This matches the current Redis backend where `applyFogPatch` runs a Lua
script that performs validation, LWW resolution, and tile canonicalization atomically — the
result is an `ApplyResult` with accepted and corrected subsets, not a simple success/failure.

The `next` callback in `apply()` allows backend plugins to form a middleware chain. Each plugin
can intercept ops, modify them, buffer them, or pass them through to the next plugin via
`next()`. This matches the middleware pattern used in web frameworks and enables composition
such as RollKeeper's buffering layer wrapping the VTT fog backend plugin.

The `plugins` array is ordered outer-to-inner. The first plugin's `apply()` is called first.
It can intercept, modify, or pass through to `next()`, which calls the second plugin, and so
on. The terminal `next()` call (after the last plugin) performs the default backend persistence
(in-memory or Redis).

Each op is owned by exactly one backend plugin. The middleware chain determines ownership: the
first plugin that handles the op (without calling `next()`) owns it. If a plugin calls `next()`,
ownership passes to the next plugin in the chain. The terminal handler (default persistence) is
the final owner.

Backend plugins can implement `dispose()` for lifecycle cleanup. The `RedisHubBackend` calls
`dispose()` on each plugin during shutdown, in reverse order.

### Wire format preservation

During the mixed-version window, `fog-meta` and `fog-patch` wire kinds are preserved as
top-level `SyncOp` members — they are not wrapped in the `ExtensionOp` envelope. This ensures
backward compatibility with clients that do not yet support the plugin system.

The `ExtensionOp` envelope is introduced only after all clients support the plugin system. The
migration from specific wire kinds (`fog-meta`, `fog-patch`) to the extension envelope is
coordinated with [ADR-0004](0004-serialization-compatibility.md)'s serialization phases,
ensuring that the wire format transition is synchronized with the broader serialization
compatibility strategy.

### RollKeeper relay migration

RollKeeper's relay wraps fog backend methods. After extraction, it uses the VTT backend plugin
plus its own buffering plugin. The buffer plugin wraps the fog plugin — it is outer in the
middleware chain:

```typescript
const backend = new RedisHubBackend({
  plugins: [
    createRollKeeperBufferPlugin(), // Outer — intercepts ops, buffers, calls next()
    createFogBackendPlugin(), // Inner — persists fog to Redis
  ],
});
```

The buffer plugin's `apply()` intercepts base-element ops, buffers them in process memory, and
calls `next()` to forward to the fog plugin. The fog plugin persists fog ops to shared Redis.

DM-only authorization moves from `policies.ts` to the server plugin's `process()` method. The
`ServerOpContext` provides full connection context and typed backend plugin access:

```typescript
const server = createSyncServer({
  plugins: [
    createFogServerPlugin({
      process: async (op, ctx) => {
        // ctx.backendPlugin('fog-backend') gives typed access to the backend plugin
        const backend = ctx.backendPlugin<FogBackendPlugin>('fog-backend');
        // ... authorization + application logic
        return { accepted: op, corrections: [] };
      },
    }),
  ],
  backend,
});
```

The server plugin's `process()` method returns an `ApplyResult` with `accepted`, `corrections`,
and optional `broadcast` fields, matching the current fog processing flow where corrections go
to the sender only and accepted ops fan out to all other connections.

### Multi-instance semantics

Plugins with `sharedAcrossInstances: true` (e.g., fog backend) persist to shared storage (Redis)
that is visible to all server instances. Plugins with `sharedAcrossInstances: false` (e.g.,
RollKeeper buffer) use process-local storage that is NOT shared. The sync hub handles fanout
differently for shared vs. local plugins: shared plugin ops are broadcast to all connections,
while local plugin ops may need cross-instance synchronization.

### VTT subpath exports

A single root `@fieldnotes/vtt` export containing browser, sync-server, and Redis factories would
couple browser consumers to server-side dependencies (Redis, Lua scripts, Node-only APIs). Instead,
VTT-owned subpath exports keep each deployment target free of cross-environment dependencies:

```
@fieldnotes/vtt           — browser-only (elements, rendering, tools)
@fieldnotes/vtt/sync      — sync client plugin (shared browser/node)
@fieldnotes/vtt/server    — sync server plugin (node only)
@fieldnotes/vtt/redis     — Redis backend plugin (node only)
```

This keeps VTT ownership of all four layers without requiring separate packages or putting VTT
code inside generic sync packages. Browser bundles import only `@fieldnotes/vtt` and
`@fieldnotes/vtt/sync`; the server and Redis factories are only pulled in by Node deployments.

### Deployment order

1. Deploy plugin-capable sync-server + sync-redis with expanded plugin interfaces (backward compatible — fog methods still work as before)
2. Deploy RollKeeper relay with plugin registration using `@fieldnotes/vtt/server` and `@fieldnotes/vtt/redis`
3. Deploy RollKeeper web/client with client-side plugin registration using `@fieldnotes/vtt/sync`
4. After soak: remove legacy fog methods from sync-server/sync-redis

## Options Considered

### Option A: Separate VTT sync packages

Create `@fieldnotes/vtt-sync-client`, `@fieldnotes/vtt-sync-server`, `@fieldnotes/vtt-sync-redis`. Each depends on its generic counterpart.

**Pros:** Clean separation. Independent versioning. Each package is focused.
**Cons:** Package proliferation. 3 new packages for one feature. Dependency management complexity. The plugin contracts still need to exist in the generic packages.

**Why rejected (standalone):** The generic packages need plugin APIs regardless. Separate packages add deployment and versioning overhead without eliminating the need for plugin contracts. The hybrid approach gives clean separation (VTT package exports plugins) without package proliferation.

### Option B: Plugin contracts only (no separate packages)

Generic sync packages gain plugin registration APIs. VTT code moves to `@fieldnotes/vtt` which exports plugins.

**Pros:** No new packages. Plugin contracts are the extension mechanism. VTT package is the single source of VTT functionality.
**Cons:** The generic packages grow plugin API surface. Server and Redis plugins are conceptually different from client plugins but share the "plugin" name.

**Why chosen (for server/Redis):** The server and Redis layers are deployment units, not npm packages. Plugin contracts within existing packages keep the deployment model simple. The VTT package exports the plugins, maintaining clean ownership.

### Option C: Subpath exports

`@fieldnotes/sync/vtt`, `@fieldnotes/sync-server/vtt`, `@fieldnotes/sync-redis/vtt`. Single package, separate entry points.

**Pros:** No new packages. Simple import paths.
**Cons:** VTT code lives inside sync packages (violates domain separation). Bundle size includes VTT code even for non-VTT consumers. Versioning is coupled.

**Why rejected:** VTT code should not live inside sync packages. The sync packages should be domain-agnostic. Subpath exports create an implicit coupling between sync and VTT.

## Consequences

### Positive

- **Explicit ownership:** Fog sync code lives in `@fieldnotes/vtt`. Sync packages are domain-agnostic.
- **Clean deployment:** Server plugins deploy with the server. Client plugins deploy with the client. Backend plugins deploy with Redis.
- **RollKeeper compatibility:** Relay can compose VTT backend plugin with its own buffering plugin.
- **Extensibility:** Other domain packages can register their own sync plugins (e.g., movement paths sync).
- **Interfaces model real semantics:** The expanded plugin interfaces (`ServerOpContext` with `backendPlugin<T>()`, unified `process()`, `ApplyResult`, `handleOp` meta) directly mirror the existing fog processing flow — unified authorization and application with full connection context, partial acceptance with corrections, sender-only correction delivery, typed backend plugin access, and reconnect/snapshot phase distinction. Migration is a structural refactor, not a semantic redesign.
- **Wire protocol extensibility:** The `ExtensionOp` envelope with atomic `registerExtensionKinds()` registration (binding extension kind + codec + handler) lets plugins define typed extension kinds with payload validation, so VTT (or future domains) can own new wire operations without modifying `@fieldnotes/sync` core. The sync hub routes `ExtensionOp` by looking up `extensionKind` in the registry, which returns both the codec and handler. There is no ambiguity about ownership.
- **Complete snapshot system:** The `PluginSnapshot` envelope (with `pluginName`, `version`, `data`) provides namespaced, versioned, validated snapshots. Server plugins return typed snapshots, the server collects them into `SyncSnapshot.extensions`, per-viewer filtering is supported via `filterSnapshot()`, and client plugins dispatch by `pluginName` with migration support via `migrateSnapshot()`. Once legacy fog is removed, reconnecting and newly joining clients can receive authoritative extension state.
- **Backend middleware composition:** The `BackendNext` middleware pattern allows backend plugins to form chains — RollKeeper's buffering layer wraps the VTT fog backend plugin by intercepting ops and calling `next()` to forward. Backend composition now includes instance locality tracking (`sharedAcrossInstances`), defined middleware ordering (outer-to-inner), op ownership rules, and lifecycle cleanup (`dispose()`).
- **Subpath exports prevent environment coupling:** `@fieldnotes/vtt/sync`, `@fieldnotes/vtt/server`, and `@fieldnotes/vtt/redis` keep browser bundles free of Node-only dependencies without requiring separate packages.

### Negative

- **Three plugin interfaces:** Client, server, and backend plugins have different contracts. More API surface to learn.
- **Server refactoring:** sync-server and sync-redis need significant internal refactoring to support plugins. The `processFogOp()` dispatch, `HubBackend` fog methods, and Lua scripts must all become plugin-driven.
- **Deployment coordination:** Server must deploy before clients. Mixed-version rooms need backward compatibility.
- **Testing complexity:** Need integration tests that span client → server → Redis with plugins at each layer.
- **Subpath export maintenance:** Each subpath (`/sync`, `/server`, `/redis`) needs its own entry point, build configuration, and dependency boundary. The package `exports` map must be kept in sync.
- **Backend composition complexity:** Middleware ordering, op ownership, and lifecycle cleanup add complexity. A buggy plugin that fails to call `next()` or calls it multiple times can break the chain.

### Risks

- The Lua scripts are complex (~180 lines) and handle optimistic concurrency, LWW conflict resolution, and tile canonicalization. Extracting them into a plugin mechanism without breaking fog sync is high-risk.
- RollKeeper's relay wraps fog backend methods in a cost-optimized buffered backend. The plugin mechanism must support this kind of composition (multiple backend plugins, ordering matters).
- The `HubBackend` interface's fog methods are optional. The plugin system must handle the case where no backend plugin is registered (fall back to in-memory `FogLedger`, as today).
- Extension kind registration introduces dynamic op handling. A misconfigured plugin could register a handler that accepts malformed payloads or whose `extensionKind` conflicts with another plugin's.
- Backend middleware chains require careful ordering. A buggy plugin that fails to call `next()` or calls it multiple times can break the chain or double-apply operations.

## Review Response

The following changes address review findings:

### First review

- **F6 (Sync plugin interfaces cannot model existing fog semantics):** Expanded all three plugin interfaces to model actual fog processing flow. `ClientSyncPlugin` now carries sender/phase metadata and a correction handler. `ServerSyncPlugin` uses `ServerOpContext` (with room/connection/role), unified `process()`, and `ApplyResult` (with accepted/corrections/broadcast). `BackendSyncPlugin` exposes atomic `snapshot()`/`apply()` instead of just encode/decode. Added `OpKindRegistry` so plugins can extend the wire protocol.
- **F11 (Runtime package boundaries):** Added "VTT subpath exports" section recommending `@fieldnotes/vtt/sync`, `@fieldnotes/vtt/server`, and `@fieldnotes/vtt/redis` subpath exports to keep browser bundles free of Node-only dependencies without requiring separate packages.

### Third review

- **F6 (Runtime op registration does not actually extend SyncOp):** Replaced the untyped `OpKindRegistry` with a typed extension envelope. Instead of trying to extend the closed `SyncOp` union at runtime, all extension ops flow through a single `ExtensionOp` envelope (`kind: 'extension'`) with an `extensionKind` discriminator and a `payload` validated by the owning plugin's `OpCodec`. The registry now associates each `extensionKind` with its codec via `register<TPayload>(codec)` / `getCodec(extensionKind)`. Both `ServerSyncPlugin` and `ClientSyncPlugin` gain a `handleExtensionOp()` method. Updated the wire format section to explain that `fog-meta` and `fog-patch` are preserved as top-level `SyncOp` members during the mixed-version window; the `ExtensionOp` envelope is introduced only after all clients support the plugin system, coordinated with ADR-0004's serialization phases.
- **F7 (Server/backend contracts cannot model the described fog flow):** Part A — replaced the separate `authorize()` + `apply()` with a unified `process()` method that returns `ApplyResult` for both acceptance and denial, matching the actual `processFogOp()` flow in `sync-hub.ts` where denial needs backend access to return corrections. Removed `PluginAuthContext` (its fields are now part of `ServerOpContext`). Part B — added `backendPlugin<T>(name)` to `ServerOpContext` for typed access to the corresponding backend plugin. Introduced `BackendNext` middleware type so backend plugins form a chain: each plugin's `apply()` receives a `next` callback to forward to the next plugin, enabling RollKeeper's buffering layer to wrap the fog backend plugin by intercepting ops and calling `next()`. Updated the RollKeeper relay migration example to use the middleware pattern.

### Fourth review

- **F5 (Extension sync ops cannot be routed end-to-end):** Replaced separate codec registration (`registerCodec()`) with atomic extension-kind registration (`registerExtensionKinds()`) that binds extension kind + codec + handler + owner at every participating layer. Server-side: `ServerExtensionRegistry.register()` atomically binds the extension kind, codec, and handler — the sync hub routes `ExtensionOp` by looking up `extensionKind` to find both the codec (for validation) and the handler (for processing). Client-side: added `registerExtensionKinds()` with `ClientExtensionRegistry` to `ClientSyncPlugin`. Removed `handleExtensionOp()` from both `ServerSyncPlugin` and `ClientSyncPlugin` — the handler registered via `registerExtensionKinds()` IS the processing entry point. Clarified that `process()` handles CORE ops only; extension ops are routed through registered handlers, eliminating the overlap between `process()` and extension op handling. Each extension kind is owned by exactly one plugin with no ambiguity.
- **F6 (Extension snapshots are undefined):** Defined a complete snapshot system. Added `PluginSnapshot` envelope (with `pluginName`, `version`, `data`) — server plugins now return `PluginSnapshot` instead of anonymous `unknown`. Added `extensions: Record<string, PluginSnapshot>` to `SyncSnapshot`, keyed by `pluginName`. Client dispatches snapshots to plugins by `pluginName` via `applySnapshot(snapshot: PluginSnapshot, meta)`. Added `migrateSnapshot()` for version migration, `validateSnapshot()` for client-side validation, and `filterSnapshot()` on the server for per-viewer filtering (return `null` to exclude a plugin's snapshot for a viewer, e.g., hide fog from non-DM viewers). Once legacy fog is removed, reconnecting and newly joining clients can receive authoritative extension state.
- **F7 (Backend composition does not preserve RollKeeper multi-instance semantics):** Added `sharedAcrossInstances: boolean` to `BackendSyncPlugin` so each plugin declares whether it uses shared Redis or process-local storage. Defined middleware ordering as outer-to-inner (first plugin's `apply()` is called first, terminal `next()` performs default persistence). Defined op ownership: the first plugin that handles without calling `next()` owns the op. Added `dispose()` for lifecycle cleanup (called in reverse order during shutdown). Added "Multi-instance semantics" section documenting how shared vs. local plugins affect fanout. Corrected the RollKeeper relay example to show buffer plugin as outer and fog plugin as inner (was reversed).

## References

- `packages/sync/src/protocol.ts` — SyncOp union, isValidEnvelope, parseEnvelope
- `packages/sync-server/src/sync-hub.ts` — processFogOp, fog routing
- `packages/sync-server/src/hub-backend.ts` — HubBackend interface, fog methods
- `packages/sync-server/src/authorize.ts` — AuthorizeFog type
- `packages/sync-server/src/memory-hub-backend.ts` — MemoryHubBackend fog implementation
- `packages/sync-redis/src/redis-hub-backend.ts` — Lua scripts, key schemas, fog validation
- `~/Projects/RollKeeper/relay/src/backend.ts` — RollKeeper buffered fog backend
- `~/Projects/RollKeeper/relay/src/policies.ts` — DM-only fog authorization
- `MIGRATION_VTT_EXTRACTION.md` §Server & Redis Extraction
