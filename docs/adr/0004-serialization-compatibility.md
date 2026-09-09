# ADR-0004: Serialization Compatibility Strategy

- **Status:** Accepted and implemented; v4 package release pending
- **Deciders:** Project maintainer
- **Date:** 2026-09-05
- **Supersedes:** —
- **Related:** [ADR-0001](0001-element-extensibility.md) (element types), [ADR-0003](0003-sync-plugin-ownership.md) (sync plugins)

## Implementation status (2026-09-10)

The v4 boundary is implemented for the coordinated `@fieldnotes/core` 0.82 / `@fieldnotes/sync`
0.19 / `@fieldnotes/sync-server` 0.18 package set. Core writes v4 extension-only state, migrates
v1–v3 state transactionally through registered legacy adapters, and moves top-level fog into its
plugin state. Sync peers exchange bounded capabilities and translate envelope traffic per peer
across snapshots, upserts, corrections, broadcasts, and fanout.

Legacy element codecs and fog wire codecs remain available as translation targets during the
mixed-peer window. Their final deletion is a later release gate, not part of introducing the v4
writer. See [CanvasState v4 migration](../CANVAS_STATE_V4_MIGRATION.md).

## Context

`CanvasState` is currently at version 3:

```typescript
// packages/core/src/core/state-serializer.ts
export interface CanvasState {
  version: number;
  camera: { position: Point; zoom: number };
  elements: CanvasElement[];
  layers?: Layer[];
  activeLayerId?: string;
  fog?: FogStateV1; // ← VTT-specific, hardcoded
}

const CURRENT_VERSION = 3;
```

The version gate is **hard-reject**:

```typescript
if ((obj['version'] as number) > CURRENT_VERSION) {
  throw new Error(`Invalid state: unsupported version ${String(obj['version'])}`);
}
```

Any state with `version > 3` throws. Old clients **cannot** read a hypothetical v4 state. This invalidates the original migration plan's claim that "old clients ignore the `extensions` field."

Similarly, the sync protocol's `isValidEnvelope()` rejects unknown op kinds:

```typescript
// packages/sync/src/protocol.ts
switch (op.kind) {
  case 'upsert': ...
  case 'fog-meta': ...
  case 'fog-patch': ...
  // ...
  default: return false;  // ← unknown kinds rejected
}
```

`parseEnvelope()` returns `null` for invalid envelopes, and the sync hub silently drops nulls. Unknown op kinds are never processed, never broadcast, never reach the backend.

### Existing migration pattern

The serializer already has a forward-compatibility pattern — `migrateElement()` runs unconditionally on every element, filling in defaults for fields added after v1:

```typescript
function migrateElement(obj: Record<string, unknown>, useDefaultLayer: boolean): void {
  if (obj['layerId'] === undefined || ...) obj['layerId'] = 'default-layer';
  if (obj['type'] === 'arrow' && obj['bend'] === undefined) obj['bend'] = 0;
  if (obj['type'] === 'stroke' && ...) { /* pressure default */ }
  if (obj['type'] === 'shape' && obj['shape'] === undefined) obj['shape'] = 'rectangle';
  if (obj['type'] === 'note' && obj['textColor'] === undefined) obj['textColor'] = '#000000';
  // ...
}
```

This is an **in-place mutation** with unconditional `undefined` checks — no version-conditional branching. It works because all migrations are additive (filling in missing defaults).

### Constraints

- RollKeeper has existing battlemaps persisted as v3 in production databases
- RollKeeper's web and relay deploy independently — mixed-version rooms are possible
- npm consumers (173 weekly downloads) may be on older versions
- The `fog` field must move to an extensible location without breaking existing persisted state

## Decision

**Dual-write on v3 with eventual bump to v4** (Option A).

### Phase 1: Add the registry alongside existing types (v3, no wire changes)

Keep `CURRENT_VERSION = 3`. Add `ElementRegistry` and `ExtensionElementEnvelope` as additive types. No wire format changes. All elements retain their current wire shape.

**Write:** `version: 3`. Both `fog` (legacy) and `extensions.fog` (new) are written. Extension elements NOT used — all elements use current wire format.
**Read:** `extensions.fog` first, fall back to `fog`. Extension elements not present.

### Phase 2: Public model transition — envelope in memory, legacy on wire (v3)

Introduce the in-memory `ExtensionElementEnvelope` in `ElementStore`. Grid and template elements are stored as envelopes in memory but retain their legacy wire shape (`type: 'grid'`, `type: 'template'`). The serializer converts between the two forms.

This preserves serialized compatibility but changes the public runtime element union and typed
store queries. It therefore ships with the Phase 2 compatibility facade, migration guide, and
major package version described by ADR-0001; it is not an internal-only refactor.

**Write:** `version: 3`. Legacy wire format for all elements. Dual-write fog.
**Read:** Legacy wire format. Serializer wraps into envelope for ElementStore.

### Phase 3: Move definitions to domain packages (v3)

Grid and template type definitions move to `@fieldnotes/vtt`. Core's switch statements shrink. Wire format unchanged.

**Write:** `version: 3`. Legacy wire format. Dual-write fog.
**Read:** Same as Phase 2.

### Phase 4: Adopt extension envelope + bump to v4

**Implemented 2026-09-10; pending coordinated package publication and consumer adoption.**

Coordinated with ADR-0001 Phase 4. Extension elements use `type: 'extension'` envelope on the wire. Legacy `fog` field removed. Version bumped to 4.

**Write:** `version: 4`. Extension envelope for extension elements. `extensions` only (no legacy `fog`).
**Read:** v4 with automatic migration from v3 via `migrateState()`.

```typescript
function migrateState(state: CanvasState): CanvasState {
  if (state.version === 3) {
    const { fog, ...preserved } = state;
    const extensions = structuredClone(state.extensions ?? {});
    if (fog && !extensions.fog) {
      extensions.fog = { version: 1, data: structuredClone(fog) };
    }
    return {
      ...preserved, // camera, layers, activeLayerId, and future additive fields survive
      version: 4,
      elements: state.elements.map(migrateElementToV4),
      extensions,
    };
  }
  return state;
}
```

The fog slice is wrapped in `{ version: 1, data: ... }` to satisfy the `PersistedPluginState` contract (ADR-0005). Without this envelope, the migrated state would fail the versioned plugin state validation.

The version gate changes: `CURRENT_VERSION = 4`. v3 states are migrated on load via `migrateState()`. v4 states are read directly.

The legacy `fog` field is removed ONLY at this v4 boundary, where old readers explicitly reject v4 states via the hard version gate. Old readers get a clear error ("unsupported version 4"), not silent data loss. The version bump itself is the adoption gate — there is no separate client version tracking.

### Sync protocol: preserve wire kinds

The same dual-write strategy applies to the sync protocol:

**Phases 1–3:** `fog-meta` and `fog-patch` wire kinds are preserved exactly. No changes to the sync protocol. Fog ops flow through the existing paths in sync-hub and sync-redis.

**Phase 4:** Introduce a generic `extension` envelope alongside fog kinds. Both are accepted. Deprecate `fog-meta`/`fog-patch` — only the generic `extension` envelope remains for new code paths.

### Compatibility matrix

| Writer \ Reader         | v3 (no extensions) | v3 (dual-write)  | v3 (envelope in memory) | v4 (extensions + v4 bump) |
| ----------------------- | ------------------ | ---------------- | ----------------------- | ------------------------- |
| v3 (no ext)             | ✅ Works           | ✅ Works         | ✅ Works                | ✅ Migrates v3→v4         |
| v3 (dual-write)         | ✅ Reads legacy    | ✅ Reads ext     | ✅ Reads ext            | ✅ Migrates v3→v4         |
| v3 (envelope in memory) | ✅ Reads legacy    | ✅ Reads ext     | ✅ Reads ext            | ✅ Migrates v3→v4         |
| v4 (ext + v4 bump)      | ❌ Rejects (ver)   | ❌ Rejects (ver) | ❌ Rejects (ver)        | ✅ Works                  |

Key: v3 readers reject v4 states (hard version gate). v4 readers migrate v3 states via `migrateState()`. The version gate is a hard reject (`if (version > CURRENT_VERSION) throw`). During Phases 1–3, all writers produce v3, so old readers work because the version hasn't changed. The `extensions` field is an additive, unknown JSON field that old clients ignore.

### Old-client re-export data loss

During Phase 1 (v3 dual-write), an old client that reads v3 dual-write state and re-exports it will silently drop the `extensions` field:

1. Read the state (version 3, has both `fog` and `extensions`)
2. The `extensions` field is unknown → old client ignores it (standard JSON forward compat)
3. On re-export, old client writes `version: 3` with only known fields → `extensions` is lost

However, fog data survives because the legacy `fog` field is also written during Phase 1. The re-exported state still contains `fog`, so no data is lost for fog specifically.

At Phase 4 (v4), old clients reject the state entirely via the hard version gate — they cannot read or re-export v4 states. This is the correct behavior: an explicit rejection is safer than silent data loss.

### Old-client element validation constraint

The serializer's `validateTypeFields()` has a 9-case switch covering known element types. If ADR-0001 introduces extension elements with `type: 'extension'`, old clients' `validateTypeFields()` will reject them (unknown type). This means extension elements cannot flow through old clients at all.

**Constraint:** During Phases 1–3 (v3 dual-write), ALL elements retain their current wire format. Grid stays `type: 'grid'`, template stays `type: 'template'`. No `type: 'extension'` envelope is written. This is because old clients' `validateTypeFields()` rejects unknown types. At the v4 boundary (Phase 4), extension elements CAN begin using the `type: 'extension'` envelope, because old clients reject v4 entirely (safe failure).

### Shared rollout state machine

This is the **canonical rollout state machine** that all ADRs reference. ADR-0001, ADR-0003, and `MIGRATION_VTT_EXTRACTION.md` all reference these phase numbers.

| Phase | Version | Wire format | Extension elements (wire) | Extension elements (memory) | Legacy fog |
| ----- | ------- | ----------- | ------------------------- | --------------------------- | ---------- |
| 1     | v3      | Legacy      | Not used                  | Legacy                      | Dual-write |
| 2     | v3      | Legacy      | Not used                  | Envelope                    | Dual-write |
| 3     | v3      | Legacy      | Not used                  | Envelope                    | Dual-write |
| 4     | v4      | Envelope    | `type: 'extension'`       | Envelope                    | Removed    |

During Phases 1–3, no `type: 'extension'` envelope is written — all elements use their existing wire formats. At Phase 4, the v4 version bump creates a clean compatibility boundary where old clients fail explicitly, making it safe to introduce new element envelopes.

See [ADR-0001](0001-element-extensibility.md) for the element-type registry rollout, which is coordinated with this serialization timeline.

### Sync protocol compatibility

The compatibility matrix above addresses persisted state. The sync protocol has its own compatibility concerns that require separate treatment.

#### The problem

The sync protocol's `isValidEnvelope()` rejects unknown op kinds. In mixed-version RollKeeper rooms, old clients silently discard extension ops because `parseEnvelope()` returns `null` for unrecognized kinds, and the sync hub drops nulls. A four-week state soak is not a protocol capability gate — it does not prevent old clients from receiving ops they cannot process.

#### Solution: continued legacy emission during mixed-version window

During the mixed-version window (Phases 1–3), the sync protocol continues to emit legacy wire kinds (`fog-meta`, `fog-patch`). Extension ops are NOT emitted during this period. This ensures old clients can process all ops they receive.

```
Phases 1–3 (v3 dual-write):
  SYNC: All ops use legacy wire kinds. No extension elements. No capability exchange needed.
```

#### Phase 4: Capability exchange with v4 bump

When the v4 bump occurs (Phase 4), introduce capability exchange on sync connection. This happens BEFORE any extension-shaped elements are sent:

```typescript
interface SyncCapabilities {
  protocolVersion: number; // Incremented when new extension kinds are added
  extensionKinds: string[]; // Supported extension kinds
  elementEnvelope: boolean; // Supports type: 'extension' envelope
}
```

On sync connection, both peers exchange capabilities. If both support `elementEnvelope: true`, extension elements can flow through sync ops. If one doesn't, the capable peer must translate extension elements to legacy format. If no lossless legacy representation exists, the outbound operation is rejected explicitly; it is never silently dropped.

This ensures capability negotiation precedes any extension-shaped element on the wire. The v4 bump and capability exchange are simultaneous — no window where extension elements can arrive before the peer is ready.

**Handshake gating:** The capability exchange MUST complete before extension-sensitive data is sent
or processed. Legacy-safe core operations remain live so an old peer can complete its existing
snapshot bootstrap without understanding the additive capability frame:

1. On sync connection, both peers exchange `SyncCapabilities`
2. Neither peer sends extension-shaped elements until it has received the other's capabilities
3. If a peer has not yet received capabilities, extension ops and element operations containing
   extension envelopes are queued; legacy-safe core operations continue
4. If a peer does not send capabilities (legacy client), the capable peer assumes legacy mode: no extension elements are sent, all ops use legacy wire format. The handshake is additive — it does not break existing clients.
5. **Timeout → legacy fallback:** If the capability handshake does not complete within a configurable timeout (default 5s), the remote peer is treated as legacy (v3). Extension elements are translated to legacy wire format using registered adapters. Extension ops that cannot be translated are rejected with an error — they are never silently dropped.

This eliminates the window where extension elements could arrive before the peer is ready. The handshake is not merely documented as happening 'before' — it is enforced as a protocol gate.

#### Translation layer (Phase 4+)

During Phase 4, peers may support different extension kinds. The sync hub translates for peers that don't support a specific extension kind. The translation layer must cover every outbound path that can carry extension elements:

1. **Snapshot elements** (`snapshot.kind === 'snapshot'`, `elements: CanvasElement[]`) — initial snapshots, reconnect snapshots, and snapshot corrections
2. **Upserts** (`op.kind === 'upsert'`, `element: CanvasElement`) — individual element updates
3. **Corrections** — server-sent corrections containing elements
4. **Additional broadcasts** (`ApplyResult.broadcast`) — plugin-produced additional ops
5. **Peer-produced snapshots** — server plugin `snapshot()` results that include elements

Each path is translated per-peer based on that peer's capabilities. A peer without `elementEnvelope` support receives legacy-format elements in ALL of these paths, not just in individual upserts.

```typescript
// Translation covers ALL outbound paths — not just individual ops
function translateForPeer(
  op: WireSyncOpV4,
  peerCapabilities: SyncCapabilities,
  registry: ElementRegistry,
  extensionKinds: ExtensionKindRegistry,
): WireSyncOpV3 | WireSyncOpV4 {
  // The adapter returns a complete legacy op, not an extension op with changed payload.
  if (op.kind === 'extension' && !peerCapabilities.extensionKinds.includes(op.extensionKind)) {
    const adapter = extensionKinds.get(op.extensionKind)?.legacy;
    if (!adapter) throw new Error(`No legacy translation for ${op.extensionKind}`);
    return adapter.encode(op.payload);
  }

  // Upserts containing extension elements: translate to legacy if peer lacks envelope support
  if (
    op.kind === 'upsert' &&
    op.element.type === 'extension' &&
    !peerCapabilities.elementEnvelope
  ) {
    return translateElementToLegacy(op, registry);
  }

  // Snapshots containing extension elements in their elements[] array
  if (op.kind === 'snapshot' && !peerCapabilities.elementEnvelope) {
    return translateSnapshotElements(op, registry);
  }

  return op;
}
```

Snapshot translation detail: A `snapshot` op carries `elements: CanvasElement[]`. When translating for a peer without `elementEnvelope` support, each element with `type: 'extension'` is converted to its legacy wire format using the element registry's `encodeLegacy()` (see ADR-0001). The translated snapshot retains the same structure but with legacy-typed elements instead of extension envelopes.

#### WireSyncOp — separate from runtime SyncOp

Sync ops on the wire are versioned separately from `RuntimeElement`. V3 admits the legacy
`CanvasElement` union; V4 admits only remaining core elements plus
`ExtensionElementEnvelope`. This prevents a v4 writer from accidentally emitting extracted
`grid` or `template` shapes.

```typescript
type WireElementV3 = CanvasElement;
type WireElementV4 = CoreElement | ExtensionElementEnvelope;
type WireSyncOpV3 = NonElementSyncOp | ElementOps<WireElementV3>;
type WireSyncOpV4 = NonElementSyncOp | ElementOps<WireElementV4> | ExtensionOp;
```

Translation between `WireSyncOp` and runtime ops happens at the transport boundary.

#### Timeline

| Phase | Sync behavior                                                                                                                                                                                                                                       |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1-3   | All ops use legacy wire kinds. No extension elements. No capability exchange needed.                                                                                                                                                                |
| 4     | **Handshake gate:** capability exchange before extension-sensitive data flows. Extension elements are translated for peers without `elementEnvelope`. Translation covers all outbound paths (snapshots, upserts, corrections, broadcasts) per-peer. |

### Historical spike validation (2026-09-06)

These contracts were first proven in `packages/contract-spike` and now live in the production
package test suites. The private spike was retired when Phase 4 was implemented:

- v3→v4 migration preserves camera, layers, active layer, existing extension state, and converts
  grid/template elements while wrapping legacy fog only when needed
- `CapabilityHandshake` has a bounded queue, drains it on timeout fallback, and ignores late
  capabilities after choosing legacy mode
- `translateForPeer` covers all outbound paths: upserts, snapshots, extension ops
- Legacy peers receive complete legacy ops and translated elements; missing adapters reject
  explicitly; v4 peers receive envelopes
- Round-trip tests confirm data preservation through serialize→parse cycle

## Options Considered

### Option B: Bump to v4 immediately

Bump `CURRENT_VERSION` to 4 with migration logic. Old clients reject v4 states.

**Pros:** Clean break. No dual-write complexity. Migration logic is straightforward.
**Cons:** Breaks all existing persisted state for old clients. RollKeeper's production battlemaps become unreadable without migration. Mixed-version sync rooms break (old clients reject v4 states from new clients). npm consumers on older versions lose access.

**Why rejected:** Too disruptive. RollKeeper has production data. The hard version gate means zero backward compatibility. The dual-write approach achieves the same goal without breaking anything.

### Option C: Capability negotiation

Clients negotiate supported versions on sync connection. Mixed-version rooms use the lowest common denominator.

**Pros:** Most flexible. Supports arbitrary version combinations.
**Cons:** Significant complexity. Requires a negotiation protocol. RollKeeper's relay must implement negotiation. Over-engineered for a 2-version transition.

**Why rejected as the persisted-state rollout mechanism:** Negotiation cannot make a v3 reader
understand a v4 file, so dual-write plus the version boundary remains the persistence decision.
Capability negotiation is nevertheless required for the independent live sync transport at Phase
4, as specified above.

## Consequences

### Positive

- **Zero breakage:** Existing persisted state loads correctly. Old clients continue to work during transition.
- **Measured rollout:** Four clean phases. The v4 version bump is the natural adoption gate — old readers reject v4 explicitly, so there is no silent failure mode.
- **Follows existing pattern:** The `migrateElement()` pattern already handles forward-compatibility via additive defaults. The `extensions` field follows the same principle.
- **Sync compatibility:** Wire kinds are preserved during Phase 1. No protocol break during the dual-write period.

### Negative

- **Dual-write complexity:** During Phase 1, state is written twice (legacy + extensions). Slightly larger payloads.
- **Four-phase transition:** Requires discipline to progress through each phase in order, and to complete the v4 bump after the soak period.
- **Testing matrix:** Must test all combinations of writer/reader versions during each phase.
- **Old-client data loss risk:** During Phase 1, old clients that re-export state will silently drop the `extensions` field (see "Old-client re-export data loss" above). Fog survives via the legacy field.

### Risks

- **Old-client re-export drops extensions:** During Phase 1, old clients that read and re-export state will silently drop the `extensions` field. Acceptable for fog (legacy field survives) but reinforces the need to complete the v4 bump before adding more extensions.
- **Element validation blocks extension types:** Old clients' `validateTypeFields()` rejects unknown element types. Extension elements (`type: 'extension'`) cannot flow through old clients. New element types are deferred to Phase 4 (v4), where old clients reject the state entirely.
- The `extensions` field grows unbounded if multiple domain packages register extensions. Need a size limit or warning.
- RollKeeper's relay deploys independently. If the relay is upgraded before the web client (or vice versa), mixed-version rooms may have unexpected behavior.

## Review Response

This revision addresses findings from the third ADR review:

- **F2 Part A (Matrix corrected):** The compatibility matrix now correctly shows that v4 readers migrate v3 states (both with and without extensions) via `migrateState()`. Only old (v3) readers reject v4 states.
- **F2 Part B (Phase 2 eliminated):** The unsafe mid-version legacy field removal phase is removed entirely. The structure is now two phases: Phase 1 (v3 dual-write) and Phase 2 (v4 bump + legacy field removal). The legacy `fog` field is removed ONLY at the v4 boundary, where old readers explicitly reject v4 via the hard version gate. All text about adoption gate based on client version tracking is removed — the version bump itself is the adoption gate.
- **F3 (Shared rollout state machine):** Added a "Shared rollout state machine" section that defines the unified rollout across ADR-0001 and ADR-0004. During Phase 1 (v3 dual-write), all elements retain their current wire format — no `type: 'extension'` envelope is written. At Phase 2 (v4), extension elements can use the `type: 'extension'` envelope because old clients reject v4 entirely (safe failure). Cross-reference to ADR-0001 added.

### Fourth review — F8

- **F8a (Matrix transposed):** The compatibility matrix was transposed — the v4 writer row incorrectly showed "✅ Migrates v3→v4" for v3 readers, but v3 readers reject v4 states via the hard version gate. The matrix now correctly shows: v3 writers → v4 reader = "✅ Migrates v3→v4" (v4 readers migrate v3 states), and v4 writer → v3 readers = "❌ Rejects (version)" (v3 readers cannot read v4 states). The key text is updated to match.
- **F8b (Sync protocol compatibility):** The ADR only addressed persisted state compatibility. Added a "Sync protocol compatibility" section covering: (1) the problem — `isValidEnvelope()` rejects unknown op kinds, causing old clients to silently discard extension ops in mixed-version rooms; (2) the solution — continued legacy wire kind emission during the mixed-version window (Phases 1–3), with extension ops deferred until all clients support the plugin system; (3) a capability exchange protocol (`SyncCapabilities`) introduced at Phase 3+ to negotiate extension op support; (4) a server-side translation layer for mixed-version rooms; (5) a timeline clarifying that the capability exchange is introduced after the v4 bump, not before.

### Fifth review — F3 (partial), F4

- **F3 (Unified rollout state machine):** Replaced 2-phase model with unified 4-phase rollout state machine. Phase 1 (registry additive, no wire changes), Phase 2 (envelope in memory, legacy on wire), Phase 3 (definitions move to domain packages), Phase 4 (extension envelope on wire + v4 bump). This is the canonical rollout state machine — ADR-0001, ADR-0003, and MIGRATION_VTT_EXTRACTION.md all reference these phase numbers. Updated compatibility matrix to include all 4 phases.

- **F4 (Capability negotiation timing):** Moved capability exchange from non-existent "Phase 3" to Phase 4 (coinciding with v4 bump). Capability exchange happens on sync connection BEFORE any extension-shaped elements are sent. Both peers exchange `SyncCapabilities` including `elementEnvelope: boolean`. Extension elements only flow if both peers support them. This eliminates the window where extension elements could arrive before the peer is ready.

- **F5 (Capability translation misses element-bearing snapshots):** The translation section previously only covered extension ops and individual upserts. Expanded `translateForPeer` to cover ALL outbound paths that can carry extension elements: snapshot elements, upserts, corrections, additional broadcasts, and peer-produced snapshots. Added handshake gating requirement — capability exchange MUST complete before ANY data is sent or processed, with incoming ops queued until the handshake completes. Added snapshot translation detail: each `type: 'extension'` element in a snapshot's `elements[]` is converted via `encodeLegacy()` for peers without `elementEnvelope` support.

## References

- `packages/core/src/core/state-serializer.ts` — CanvasState, CURRENT_VERSION, validateState, migrateElement
- `packages/sync/src/protocol.ts` — isValidEnvelope, parseEnvelope
- `MIGRATION_VTT_EXTRACTION.md` §Serialization Strategy
- `MIGRATION_VTT_EXTRACTION.md` §Sync Protocol Strategy
