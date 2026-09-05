# ADR-0003: Sync/Server Plugin Ownership

- **Status:** Decided
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
  handleOp?(op: SyncOp): void;
  extendSnapshot?(snapshot: SyncSnapshot): void;
  applySnapshot?(snapshot: SyncSnapshot): void;
}
```

**Server plugin:**

```typescript
interface ServerSyncPlugin {
  readonly name: string;
  authorize?(ctx: AuthContext, op: SyncOp): boolean | Promise<boolean>;
  apply?(op: SyncOp, backend: HubBackend): Promise<void>;
  snapshot?(backend: HubBackend): Promise<unknown>;
}
```

**Backend (Redis) plugin:**

```typescript
interface BackendSyncPlugin {
  readonly name: string;
  keyPrefix: string;
  scripts?: Record<string, string>;
  encode?(data: unknown): string;
  decode?(raw: string): unknown;
}
```

### Wire format preservation

During the mixed-version window, `fog-meta` and `fog-patch` wire kinds are preserved exactly as-is. The generic `extension` envelope is introduced only after all clients support the plugin system (see [ADR-0004](0004-serialization-compatibility.md) for the compatibility strategy).

### RollKeeper relay migration

RollKeeper's relay wraps fog backend methods. After extraction, it uses the VTT backend plugin plus its own buffering plugin:

```typescript
const backend = new RedisHubBackend({
  plugins: [
    createFogBackendPlugin(), // VTT fog persistence
    createRollKeeperBufferPlugin(), // RollKeeper-specific buffering
  ],
});
```

DM-only authorization moves from `policies.ts` to the server plugin configuration:

```typescript
const server = createSyncServer({
  plugins: [
    createFogServerPlugin({
      authorizeFog: (ctx) => ctx.role === 'dm',
    }),
  ],
  backend,
});
```

### Deployment order

1. Deploy plugin-capable sync-server + sync-redis (backward compatible — fog methods still work as before)
2. Deploy RollKeeper relay with plugin registration
3. Deploy RollKeeper web/client with client-side plugin registration
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

### Negative

- **Three plugin interfaces:** Client, server, and backend plugins have different contracts. More API surface to learn.
- **Server refactoring:** sync-server and sync-redis need significant internal refactoring to support plugins. The `processFogOp()` dispatch, `HubBackend` fog methods, and Lua scripts must all become plugin-driven.
- **Deployment coordination:** Server must deploy before clients. Mixed-version rooms need backward compatibility.
- **Testing complexity:** Need integration tests that span client → server → Redis with plugins at each layer.

### Risks

- The Lua scripts are complex (~180 lines) and handle optimistic concurrency, LWW conflict resolution, and tile canonicalization. Extracting them into a plugin mechanism without breaking fog sync is high-risk.
- RollKeeper's relay wraps fog backend methods in a cost-optimized buffered backend. The plugin mechanism must support this kind of composition (multiple backend plugins, ordering matters).
- The `HubBackend` interface's fog methods are optional. The plugin system must handle the case where no backend plugin is registered (fall back to in-memory `FogLedger`, as today).

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
