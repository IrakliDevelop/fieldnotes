# ADR-0004: Serialization Compatibility Strategy

- **Status:** Proposed
- **Deciders:** Project maintainer
- **Date:** 2026-09-05
- **Supersedes:** —
- **Related:** [ADR-0001](0001-element-extensibility.md) (element types), [ADR-0003](0003-sync-plugin-ownership.md) (sync plugins)

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

### Phase 2: Internal refactor — envelope in memory, legacy on wire (v3)

Introduce the in-memory `ExtensionElementEnvelope` in `ElementStore`. Grid and template elements are stored as envelopes in memory but retain their legacy wire shape (`type: 'grid'`, `type: 'template'`). The serializer converts between the two forms.

**Write:** `version: 3`. Legacy wire format for all elements. Dual-write fog.
**Read:** Legacy wire format. Serializer wraps into envelope for ElementStore.

### Phase 3: Move definitions to domain packages (v3)

Grid and template type definitions move to `@fieldnotes/vtt`. Core's switch statements shrink. Wire format unchanged.

**Write:** `version: 3`. Legacy wire format. Dual-write fog.
**Read:** Same as Phase 2.

### Phase 4: Adopt extension envelope + bump to v4

Coordinated with ADR-0001 Phase 4. Extension elements use `type: 'extension'` envelope on the wire. Legacy `fog` field removed. Version bumped to 4.

**Write:** `version: 4`. Extension envelope for extension elements. `extensions` only (no legacy `fog`).
**Read:** v4 with automatic migration from v3 via `migrateState()`.

```typescript
function migrateState(state: CanvasState): CanvasState {
  if (state.version === 3) {
    const v4 = { ...state, version: 4 };
    if (state.fog && !state.extensions?.fog) {
      v4.extensions = { ...v4.extensions, fog: state.fog };
    }
    delete v4.fog;
    return v4;
  }
  return state;
}
```

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

On sync connection, both peers exchange capabilities. If both support `elementEnvelope: true`, extension elements can flow through sync ops. If one doesn't, the capable peer must translate extension elements to legacy format (or drop them if no legacy equivalent exists).

This ensures capability negotiation precedes any extension-shaped element on the wire. The v4 bump and capability exchange are simultaneous — no window where extension elements can arrive before the peer is ready.

#### Translation layer (Phase 4+)

During Phase 4, peers may support different extension kinds. The sync hub translates for peers that don't support a specific extension kind:

```typescript
function translateForClient(op: SyncOp, clientCapabilities: SyncCapabilities): SyncOp | null {
  if (op.kind === 'extension' && !clientCapabilities.extensionKinds.includes(op.extensionKind)) {
    // This peer doesn't support this extension kind — drop the op
    // (or translate to legacy format if a legacy equivalent exists)
    return null;
  }
  if (
    op.kind === 'upsert' &&
    op.element.type === 'extension' &&
    !clientCapabilities.elementEnvelope
  ) {
    // This peer doesn't support extension envelope — translate to legacy if possible
    return translateToLegacyElement(op);
  }
  return op;
}
```

#### Timeline

| Phase | Sync behavior                                                                                                                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1-3   | All ops use legacy wire kinds. No extension elements. No capability exchange needed.                                                                                           |
| 4     | Capability exchange on sync connection. Extension elements only sent if both peers support `elementEnvelope`. Translation layer for mixed-version peers within v4 (if needed). |

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

**Why rejected:** Overkill. We're transitioning from v3 to v4 — two versions. A negotiation protocol is warranted for many versions but not for one. The dual-write approach handles the transition simply. Capability negotiation can be introduced later if the version count grows.

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

## References

- `packages/core/src/core/state-serializer.ts` — CanvasState, CURRENT_VERSION, validateState, migrateElement
- `packages/sync/src/protocol.ts` — isValidEnvelope, parseEnvelope
- `MIGRATION_VTT_EXTRACTION.md` §Serialization Strategy
- `MIGRATION_VTT_EXTRACTION.md` §Sync Protocol Strategy
