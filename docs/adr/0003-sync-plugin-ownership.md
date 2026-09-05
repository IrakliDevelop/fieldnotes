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
  | { kind: 'fog-patch'; generation: string; tiles: FogTileRecord[] }; // ← VTT-specific
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
    snapshot: SyncSnapshot,
    meta: { phase: 'initial' | 'reconnect' | 'offline-replay' },
  ): void;
  handleCorrection?(op: SyncOp): void; // Handle server-sent corrections
}
```

The `handleOp` meta provides the sender identity, whether the op originated locally, and the
connection phase so the plugin can distinguish live ops from reconnect replays and authoritative
snapshot deliveries. `handleCorrection` receives ops the server rejected — the current fog flow
sends the existing tile state back to the sender only, not to the whole room.

**Server plugin:**

```typescript
interface ServerSyncPlugin {
  readonly name: string;
  authorize?(ctx: PluginAuthContext, op: SyncOp): boolean | Promise<boolean>;
  apply?(op: SyncOp, ctx: ServerOpContext): Promise<ApplyResult>;
  snapshot?(room: string, backend: HubBackend): Promise<unknown>;
  registerOpKinds?(registry: OpKindRegistry): void;
}

interface PluginAuthContext {
  userId: string;
  role: string;
  room: string;
  connectionId: string;
  currentState: unknown; // Current plugin state for authorization decisions
}

interface ServerOpContext {
  room: string;
  connectionId: string;
  userId: string;
  role: string;
  backend: HubBackend;
}

interface ApplyResult {
  accepted: SyncOp | null; // The op to fan out (may be modified/partial)
  corrections: SyncOp[]; // Ops to send back to sender only
  broadcast?: SyncOp[]; // Additional ops to broadcast to all (e.g., derived state)
}

// OpKindRegistry allows plugins to extend the wire protocol
interface OpKindRegistry {
  register(kind: string, validator: (op: unknown) => boolean): void;
}
```

The server plugin interfaces model the actual fog processing flow in `sync-hub.ts`:

1. Authorize with full context — `PluginAuthContext` carries `userId`, `role`, `room`,
   `connectionId`, and `currentState` (the plugin's own snapshot, mirroring today's
   `AuthorizeFogContext.current: FogSnapshot`).
2. On denial: return corrections (current state) via `ApplyResult.corrections` — the hub sends
   these to the sender only.
3. On accept: `ApplyResult.accepted` is the (possibly partial) op to fan out to all other
   connections; `corrections` go to the sender only; `broadcast` covers additional derived ops
   that go to everyone.
4. `snapshot()` takes a `room` parameter — the current `fogSnapshot()` is room-scoped.
5. `registerOpKinds()` lets plugins extend the `SyncOp` union with new wire kinds instead of
   requiring changes to `@fieldnotes/sync` for every new domain op.

**Backend (Redis) plugin:**

```typescript
interface BackendSyncPlugin {
  readonly name: string;
  keyPrefix: string;
  scripts?: Record<string, string>;
  // Atomic operations — not just encode/decode
  snapshot?(room: string): Promise<unknown>;
  apply?(room: string, op: SyncOp): Promise<ApplyResult>;
}
```

The backend plugin exposes atomic `snapshot` and `apply` operations rather than only raw
encode/decode codecs. This matches the current Redis backend where `applyFogPatch` runs a Lua
script that performs validation, LWW resolution, and tile canonicalization atomically — the
result is an `ApplyResult` with accepted and corrected subsets, not a simple success/failure.

### Wire format preservation

During the mixed-version window, `fog-meta` and `fog-patch` wire kinds are preserved exactly as-is. The generic `extension` envelope is introduced only after all clients support the plugin system (see [ADR-0004](0004-serialization-compatibility.md) for the compatibility strategy).

### RollKeeper relay migration

RollKeeper's relay wraps fog backend methods. After extraction, it uses the VTT backend plugin plus its own buffering plugin. The backend plugin's atomic `apply()` returns an `ApplyResult` that the buffering layer can intercept and modify:

```typescript
const backend = new RedisHubBackend({
  plugins: [
    createFogBackendPlugin(), // VTT fog persistence — atomic apply()
    createRollKeeperBufferPlugin(), // RollKeeper-specific buffering
  ],
});
```

DM-only authorization moves from `policies.ts` to the server plugin configuration. The `PluginAuthContext` provides full connection context including the current plugin state:

```typescript
const server = createSyncServer({
  plugins: [
    createFogServerPlugin({
      authorizeFog: (ctx: PluginAuthContext, op: SyncOp) => {
        // ctx.userId, ctx.role, ctx.room, ctx.connectionId available
        // ctx.currentState contains the current fog snapshot
        return ctx.role === 'dm';
      },
    }),
  ],
  backend,
});
```

The server plugin's `apply()` method returns an `ApplyResult` with `accepted`, `corrections`, and optional `broadcast` fields, matching the current fog processing flow where corrections go to the sender only and accepted ops fan out to all other connections.

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
- **Interfaces model real semantics:** The expanded plugin interfaces (`PluginAuthContext`, `ServerOpContext`, `ApplyResult`, `handleOp` meta) directly mirror the existing fog processing flow — authorization with full connection context, partial acceptance with corrections, sender-only correction delivery, and reconnect/snapshot phase distinction. Migration is a structural refactor, not a semantic redesign.
- **Wire protocol extensibility:** `OpKindRegistry` lets plugins register new op kinds with validators, so VTT (or future domains) can own new wire operations without modifying `@fieldnotes/sync` core.
- **Subpath exports prevent environment coupling:** `@fieldnotes/vtt/sync`, `@fieldnotes/vtt/server`, and `@fieldnotes/vtt/redis` keep browser bundles free of Node-only dependencies without requiring separate packages.

### Negative

- **Three plugin interfaces:** Client, server, and backend plugins have different contracts. More API surface to learn.
- **Server refactoring:** sync-server and sync-redis need significant internal refactoring to support plugins. The `processFogOp()` dispatch, `HubBackend` fog methods, and Lua scripts must all become plugin-driven.
- **Deployment coordination:** Server must deploy before clients. Mixed-version rooms need backward compatibility.
- **Testing complexity:** Need integration tests that span client → server → Redis with plugins at each layer.
- **Subpath export maintenance:** Each subpath (`/sync`, `/server`, `/redis`) needs its own entry point, build configuration, and dependency boundary. The package `exports` map must be kept in sync.

### Risks

- The Lua scripts are complex (~180 lines) and handle optimistic concurrency, LWW conflict resolution, and tile canonicalization. Extracting them into a plugin mechanism without breaking fog sync is high-risk.
- RollKeeper's relay wraps fog backend methods in a cost-optimized buffered backend. The plugin mechanism must support this kind of composition (multiple backend plugins, ordering matters).
- The `HubBackend` interface's fog methods are optional. The plugin system must handle the case where no backend plugin is registered (fall back to in-memory `FogLedger`, as today).
- `OpKindRegistry` introduces dynamic op validation. A misconfigured plugin could register a validator that accepts malformed ops or conflicts with an existing kind.

## Review Response

The following changes address review findings:

- **F6 (Sync plugin interfaces cannot model existing fog semantics):** Expanded all three plugin interfaces to model actual fog processing flow. `ClientSyncPlugin` now carries sender/phase metadata and a correction handler. `ServerSyncPlugin` uses `PluginAuthContext` (with `currentState`), `ServerOpContext` (with room/connection/role), and `ApplyResult` (with accepted/corrections/broadcast). `BackendSyncPlugin` exposes atomic `snapshot()`/`apply()` instead of just encode/decode. Added `OpKindRegistry` so plugins can extend the wire protocol.
- **F11 (Runtime package boundaries):** Added "VTT subpath exports" section recommending `@fieldnotes/vtt/sync`, `@fieldnotes/vtt/server`, and `@fieldnotes/vtt/redis` subpath exports to keep browser bundles free of Node-only dependencies without requiring separate packages.

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
