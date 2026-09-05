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

### Phase 1: Stay on v3, add `extensions` field (immediate)

Keep `CURRENT_VERSION = 3`. Add an optional `extensions` field to `CanvasState`:

```typescript
interface CanvasState {
  version: 3; // Unchanged
  camera: { position: Point; zoom: number };
  elements: CanvasElement[];
  layers?: Layer[];
  activeLayerId?: string;
  fog?: FogStateV1; // Legacy — still written
  extensions?: Record<string, unknown>; // New — also written
}
```

**Write:** Both `fog` (legacy) and `extensions.fog` (new) are written.
**Read:** `extensions.fog` first, fall back to `fog`.

```typescript
function resolveFogState(state: CanvasState): FogStateV1 | undefined {
  return state.extensions?.fog ?? state.fog;
}
```

The `extensions` field is an unknown field from v3's perspective — it doesn't trigger the version gate because the version is still 3. Old clients that don't know about `extensions` simply ignore it (standard JSON forward compatibility for unknown fields within the same version).

### Phase 2: Remove legacy fog field (after adoption gate)

Once **all** clients are confirmed upgraded to read from `extensions.fog`:

**Write:** Only `extensions.fog`. The `fog` field is no longer written.
**Read:** `extensions.fog` only. The `fog` fallback is removed.

The state is still `version: 3`.

> **Critical:** This phase must not proceed on a timer. Removing the top-level `fog` field while keeping `version: 3` creates a **silent privacy failure** — an old client will accept the state (version 3 passes validation), find no `fog` field, and render without fog. No error, no migration message, just missing fog. This is worse than a version-bump rejection because it is silent.

**Adoption gate:** Phase 2 proceeds only when 100% of connecting clients report v3+dual-write capability. Client versions are tracked via the sync handshake — each connecting client reports its serializer capabilities, and the server tracks the minimum across all active and recently-seen clients. The legacy `fog` fallback (`state.fog`) must remain written for as long as ANY old reader is supported.

Removal of the legacy `fog` field requires either:

- A measured adoption gate with explicit version tracking (this phase), OR
- A major compatibility boundary (version bump to v4, which old clients reject explicitly)

### Phase 3: Bump to v4 (after soak period)

After a measured soak period (proposed: 4 weeks minimum):

**Write:** `version: 4` with `extensions` only.
**Read:** v4 with automatic migration from v3.

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

The version gate changes: `CURRENT_VERSION = 4`. v3 states are migrated on load. v4 states are read directly.

### Sync protocol: preserve wire kinds

The same dual-write strategy applies to the sync protocol:

**Phase 1-2:** `fog-meta` and `fog-patch` wire kinds are preserved exactly. No changes to the sync protocol. Fog ops flow through the existing paths in sync-hub and sync-redis.

**Phase 3:** Introduce a generic `extension` envelope alongside fog kinds. Both are accepted.

**Phase 4:** Deprecate `fog-meta`/`fog-patch`. Only generic `extension` envelope remains.

### Compatibility matrix

| Writer \ Reader | v3 (no extensions)                   | v3 (dual-write)                      | v4 (extensions only) |
| --------------- | ------------------------------------ | ------------------------------------ | -------------------- |
| v3 (no ext)     | ✅ Works                             | ✅ Works                             | ❌ Rejects (version) |
| v3 (dual-write) | ✅ Reads legacy                      | ✅ Reads ext                         | ❌ Rejects (version) |
| v4 (ext only)   | ❌ Rejects (v3 reader can't read v4) | ❌ Rejects (v3 reader can't read v4) | ✅ Works             |

Key insight: **old readers cannot read newer versions.** The version gate is a hard reject (`if (version > CURRENT_VERSION) throw`). Only newer readers can read older versions (via migration). During Phase 1-2, all writers produce v3, so old readers work because the version hasn't changed. The `extensions` field is an additive, unknown JSON field that old clients ignore.

### Old-client re-export data loss

During the dual-write phase (Phase 1-2), an old client that reads v3 dual-write state and re-exports it will silently destroy extension data:

1. Read the state (version 3, has both `fog` and `extensions`)
2. The `extensions` field is unknown → old client ignores it (standard JSON forward compat)
3. On re-export, old client writes `version: 3` with only known fields → `extensions` is lost
4. Extension data (fog, future extensions) is silently destroyed

During Phase 1-2 this is acceptable because `fog` (legacy) is also written, so fog data survives. But if additional extensions are added later, they would be lost on old-client re-export. This reinforces the need for the version bump (Phase 3) to happen before adding more extensions beyond fog.

### Old-client element validation constraint

The serializer's `validateTypeFields()` has a 9-case switch covering known element types. If ADR-0001 introduces extension elements with `type: 'extension'`, old clients' `validateTypeFields()` will reject them (unknown type). This means extension elements cannot flow through old clients at all.

**Constraint:** Extension elements are only supported after all clients upgrade to the registry-aware version. During the dual-write phase, only legacy element types (stroke, note, arrow, etc.) plus grid/template (which old clients already know) can be used. New extension element types must wait until Phase 3 or later.

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
- **Measured rollout:** Each phase can be deployed independently. Adoption gate ensures Phase 2 only proceeds when safe.
- **Follows existing pattern:** The `migrateElement()` pattern already handles forward-compatibility via additive defaults. The `extensions` field follows the same principle.
- **Sync compatibility:** Wire kinds are preserved. No protocol break during transition.
- **Explicit version tracking:** The adoption gate requires tracking client versions via sync handshake, providing visibility into the upgrade state of the fleet.

### Negative

- **Dual-write complexity:** During Phase 1-2, state is written twice (legacy + extensions). Slightly larger payloads.
- **Long transition:** 4 phases over ~6 months. Requires discipline to progress through phases.
- **Testing matrix:** Must test all combinations of writer/reader versions during each phase.
- **Adoption gate overhead:** Phase 2 requires implementing and maintaining client version tracking in the sync handshake.
- **Old-client data loss risk:** During dual-write, old clients that re-export state will silently drop the `extensions` field (see "Old-client re-export data loss" above).

### Risks

- **Silent privacy failure (mitigated):** Phase 2 removes `fog` while keeping `version: 3`. Without the adoption gate, old clients would silently render without fog. The adoption gate (100% client upgrade confirmation) prevents this.
- **Old-client re-export data loss:** During Phase 1-2, old clients that read and re-export state will silently destroy extension data. Acceptable for fog (legacy field survives) but unacceptable for future extensions. Reinforces the need to complete Phase 3 before adding more extensions.
- **Element validation blocks extension types:** Old clients' `validateTypeFields()` rejects unknown element types. Extension elements (`type: 'extension'`) cannot flow through old clients. New element types must wait until all clients upgrade.
- The `extensions` field grows unbounded if multiple domain packages register extensions. Need a size limit or warning.
- RollKeeper's relay deploys independently. If the relay is upgraded before the web client (or vice versa), mixed-version rooms may have unexpected behavior.

## Review Response

This revision addresses Finding 7 (F7) from the ADR review:

- **Part A (Matrix corrected):** The compatibility matrix now correctly shows that v3 readers reject v4 states (hard version gate). The off-diagonal cases are fixed.
- **Part B (Phase 2 adoption gate):** Phase 2 now requires an adoption gate (100% client upgrade confirmation via sync handshake), not a timer. The silent privacy failure risk is documented.
- **Part C (Old-client re-export data loss):** Added explicit documentation of the risk that old clients silently destroy extension data on re-export. Acceptable during dual-write for fog, but reinforces the need for Phase 3 before adding more extensions.
- **Part D (Element validation constraint):** Added explicit documentation that old clients' `validateTypeFields()` rejects unknown element types. Extension elements cannot flow through old clients.

## References

- `packages/core/src/core/state-serializer.ts` — CanvasState, CURRENT_VERSION, validateState, migrateElement
- `packages/sync/src/protocol.ts` — isValidEnvelope, parseEnvelope
- `MIGRATION_VTT_EXTRACTION.md` §Serialization Strategy
- `MIGRATION_VTT_EXTRACTION.md` §Sync Protocol Strategy
