# Plan: VTT Feature Extraction & the Emacs Philosophy

> **Status:** Phase 5 complete — all VTT features (Measure, Grid, Templates, Fog) extracted to `@fieldnotes/vtt`. Core is domain-agnostic. See `MIGRATION_VTT_EXTRACTION.md` §Implementation Progress for details.
> **Created:** 2026-09-05
> **Revised:** 2026-09-05 (post-review — incorporated Codex review findings)
> **Scope:** Architectural reorganization of @fieldnotes/core
> **Companion:** `MIGRATION_VTT_EXTRACTION.md` (revised migration plan), `VISION.md` (north star)

## Vision: Emacs for Canvas

Field Notes should be to canvas applications what Emacs is to text editors: a **minimal, extensible core** that can be composed into arbitrary domain-specific tools.

### Emacs Analogy

| Emacs                                                      | Field Notes                                                                                |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Core: text buffer, display engine, input, extension system | Core: elements, layers, camera, rendering, input, history, serialization, extension system |
| elisp packages: org-mode, magit, evil                      | Domain packages: @fieldnotes/vtt, @fieldnotes/diagramming, @fieldnotes/whiteboard          |
| Minor/major modes                                          | Tools, plugins, overlays                                                                   |
| Hooks (before-save-hook, etc.)                             | Extension points (render hooks, input hooks, serialization plugins)                        |

### Core Principles

1. **Core is domain-agnostic.** No VTT-specific, diagramming-specific, or whiteboard-specific code. Only canvas fundamentals.
2. **Domain features live in separate packages.** Fog of war, grid, ruler, tokens → `@fieldnotes/vtt`. Connectors, shapes → `@fieldnotes/diagramming`. Etc.
3. **Extension points are first-class.** The extension API is the most important contract in the system. It must be ergonomic, performant, and well-documented.
4. **Composability over completeness.** Core provides building blocks, not solutions. Domain packages compose blocks into features.

## Current State

### What's in Core Today (VTT-specific)

- **Fog of war** — tile-based fog with rendering, serialization, sync protocol integration
- **Grid** — rendering, snapping, camera modifiers
- **Ruler/measurement** — distance calculations, overlay display
- **Token/entity system** — (if present) domain-specific element behavior

### Why This Is a Problem

- Core is a "VTT engine" not a "canvas engine"
- Non-VTT use cases (diagramming, whiteboarding) carry VTT baggage
- Domain-specific code constrains core's evolution
- Extension API can't be designed cleanly because domain features bypass it

### npm Download Stats (as of 2026-09-05)

- Last week: 173
- Last month: 4,711
- Last year: 18,883

Small but non-zero external audience. Breaking changes require major version bump and migration guide, but the scope is manageable.

### Real-World Usage: RollKeeper

RollKeeper (`~/Projects/RollKeeper`) is the primary consumer — a D&D character sheet / battlemap application built with Next.js. It uses:

- `@fieldnotes/core` ^0.68.0
- `@fieldnotes/react` ^0.11.0
- `@fieldnotes/sync` ^0.12.0
- Relay server uses `@fieldnotes/sync-server`, `@fieldnotes/sync-redis`

#### Core APIs Used

**From `@fieldnotes/core`:**

- `SelectTool`, `PencilTool`, `ArrowTool`, `MeasureTool`, `TemplateTool`, `NoteTool`, `TextTool`, `ShapeTool`, `EraserTool`, `LaserTool`, `PingTool`, `AutoSave`, `FogTool`
- `Viewport`, `ElementStore`, `ToolContext`, `CanvasElement`, `CameraView`, `FocusAudience`, `PeerRoster`, `PathTool`

**From `@fieldnotes/react`:**

- `FieldNotesCanvas`, `ViewportContext`, `useActiveTool`

#### Custom Tools Built on Top

RollKeeper already extends the tool system with domain-specific tools:

- `DmTokenTool` — combatant token placement/interaction
- `PlayerHandTool` — player hand view
- `DmMarkerTool` — marker placement
- `MovementPathTool` — movement path drawing (via `createMovementPathTool`)

#### Feature Usage

- **Fog:** `viewport.setFogStyle()`, `viewport.fog.getState()`, fog appearance configuration, procedural fog styling
- **Grid:** `vp.addGrid(settings)`, `vp.removeGrid()`, grid type switching (hex/square/off), `snapToGrid` prop on `FieldNotesCanvas`
- **Measure:** MeasureTool for distance calculation
- **Sync:** Full sync with managed connection, layer sync, laser/ping/measure/focus broadcasting
- **Presence:** Awareness sync, cursor sharing, player cursors
- **Camera:** Camera views, camera sharing, go-to/send camera
- **Markers:** Rich markers with audience control (DM-only vs shared)
- **Movement:** Movement paths with dash support, path broadcasting
- **Export:** Battle map export with fog state
- **Minimap:** Battle map minimap

#### Key Insight

RollKeeper is **already building custom tools** on top of core. This validates the extension point approach — the tool registry and Tool interface are already working as extension mechanisms. The gap is that VTT features (fog, grid) are baked into core rather than being composable packages.

## Migration Strategy

### Phase 1: Audit & Design (Current)

**Goal:** Map every VTT integration point in core. Design extension point interfaces.

**Deliverables:**

- Integration point audit (see below)
- Extension point interface designs
- Migration plan with concrete steps

### Phase 2: Extension Points in Core

**Goal:** Add extension point interfaces to core without moving any code yet.

**Approach:**

- Define interfaces for: rendering hooks, input hooks, serialization plugins, tool registry, camera modifiers, element decorators
- Implement hooks in core (e.g., `Viewport.renderOverlay` hook)
- Keep VTT features in core, but refactor them to use the new extension API
- Validate: does the extension API work? Is it ergonomic?

**Risk:** Low. No public API changes. Internal refactoring only.

### Phase 3: Extract to @fieldnotes/vtt

**Goal:** Move refactored VTT code to a new package.

**Approach:**

- Create `packages/vtt/` with its own package.json, tsconfig, tests
- Move fog, grid, ruler, tokens to the new package
- New package depends on `@fieldnotes/core` and uses its extension points
- Core removes VTT-specific code (now replaced by extension points)
- Update RollKeeper to depend on `@fieldnotes/vtt`

**Risk:** Medium. Public API changes. Requires major version bump for core (0.68.0 → 0.69.0 or 1.0.0).

### Phase 4: Document Extension API

**Goal:** The extension API becomes the contract for building domain packages.

**Deliverables:**

- Extension API documentation
- Example: how to build a domain package
- Example: how to build a custom tool
- Migration guide for existing consumers

## Review Findings (2026-09-05)

This audit and the companion migration plan (`MIGRATION_VTT_EXTRACTION.md`) were reviewed by Codex with high reasoning effort. Six P1 issues and one P2 were identified. All findings have been incorporated into the revised migration plan. Summary:

| #   | Severity | Finding                                                                                                                                    | Status                                                            |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| 1   | P1       | Grid/template remain as closed CanvasElement subtypes — contradicts core-purity goal. Need element-type registry.                          | Addressed in MIGRATION §Element-Type Registry                     |
| 2   | P1       | Sync design omits server/Redis work — sync-redis has fog-specific Lua scripts (~180 lines), Redis keys, canonicalization, generation rules | Addressed in MIGRATION §Server & Redis Extraction                 |
| 3   | P1       | Backward compatibility claims incorrect — core rejects version > 3, sync rejects unknown op kinds                                          | Addressed in MIGRATION §Serialization Strategy (dual-write on v3) |
| 4   | P1       | Rendering hook too coarse — fog is a distinct hybrid surface with separate minimap/export paths                                            | Addressed in MIGRATION §Render Surface Contract                   |
| 5   | P1       | Global pointer-coordinate rewriting breaks RollKeeper tools that mix snapped/unsnapped coordinates                                         | Addressed in MIGRATION §Extension Point Design (snap as service)  |
| 6   | P1       | RollKeeper migration underscoped — 318 refs across 166 files, subtle ordering dependencies                                                 | Addressed in MIGRATION §RollKeeper Migration Path                 |
| 7   | P2       | Audit incomplete — templates, export, React bindings, server/Redis, tool lifecycle not fully audited                                       | See [Known Audit Gaps](#known-audit-gaps) below                   |

**Key takeaway:** Phase 0 (ADRs, compatibility fixtures, facade package) must precede all code movement. Do not begin extracting grid, templates, or fog until extension point designs are validated.

---

## Extension Point Design (Draft)

> **Note:** These are the original draft designs. The revised, review-corrected designs are in `MIGRATION_VTT_EXTRACTION.md` §Extension Point Design. Key changes: rendering hooks are now per-surface, input hooks replaced by explicit snap service, sync plugins span client/server/backend, camera modifiers decoupled from grid snapping.

### Rendering Hooks

```typescript
interface RenderHooks {
  beforeElementsRender(ctx: CanvasRenderingContext2D, camera: Camera): void;
  afterElementsRender(ctx: CanvasRenderingContext2D, camera: Camera): void;
  renderOverlay(ctx: CanvasRenderingContext2D, camera: Camera): void;
}
```

**Use cases:**

- Grid rendering (afterElementsRender)
- Fog rendering (renderOverlay)
- Ruler/measurement display (renderOverlay)

### Input Hooks

```typescript
interface InputHooks {
  onPointerDown?(event: PointerEvent, camera: Camera): PointerEvent | void;
  onPointerMove?(event: PointerEvent, camera: Camera): PointerEvent | void;
  onPointerUp?(event: PointerEvent, camera: Camera): PointerEvent | void;
}
```

**Use cases:**

- Grid snapping (modify pointer coordinates)
- Custom gesture recognition
- Tool-specific input handling

### Serialization Plugins

```typescript
interface SerializationPlugin {
  serialize(state: CanvasState): unknown;
  deserialize(data: unknown): Partial<CanvasState>;
}
```

**Use cases:**

- Fog state persistence
- Domain-specific metadata
- Custom element properties

### Tool Registry

```typescript
interface ToolRegistry {
  register(name: string, tool: Tool): void;
  activate(name: string): void;
  deactivate(): void;
}

interface Tool {
  name: string;
  onPointerDown?(event: PointerEvent): void;
  onPointerMove?(event: PointerEvent): void;
  onPointerUp?(event: PointerEvent): void;
  render?(ctx: CanvasRenderingContext2D): void;
}
```

**Use cases:**

- VTT tools (fog reveal, grid snap toggle)
- Diagramming tools (connector drawing)
- Custom tools

### Camera Modifiers

```typescript
interface CameraModifier {
  modifyCamera(camera: Camera): Camera;
}
```

**Use cases:**

- Grid snapping (snap camera position to grid)
- Zoom constraints (limit zoom range)
- Pan constraints (limit panning area)

### Element Decorators

```typescript
interface ElementDecorator {
  decorate(element: CanvasElement): DecoratedElement;
}
```

**Use cases:**

- Token behavior (HP, AC, etc.)
- Connector behavior (source/target)
- Custom element properties

## Integration Point Audit

### Fog of War

**Files (core):**

- `src/fog/fog-manager.ts` — state management, undo/redo commands
- `src/fog/fog-renderer.ts` — canvas rendering
- `src/fog/fog-style.ts` — solid/procedural style resolution
- `src/fog/fog-procedural-tile.ts` — procedural tile generation
- `src/fog/fog-command.ts` — history commands (FogRegionCommand, FogResetCommand)
- `src/fog/tile-codec.ts` — tile serialization (base64 encode/decode)
- `src/fog/types.ts` — FogStateV1, FogDefinitionV1, FogTileV1, etc.
- `src/tools/fog-tool.ts` — Tool implementation for fog reveal/hide

**Integration points:**

- **Viewport:** `fogManager` and `fogRenderer` are private fields. Viewport exposes `get fog()` accessor and `setFogStyle()`. Fog state flows through Viewport lifecycle (init, load, export, dispose).
- **Serialization:** `exportState()` includes fog state. `loadState()` restores fog via `fogManager.loadState()`. Fog tiles are base64-encoded in persisted state.
- **Auto-save:** `AutoSave` class listens to `fogManager.on('change')` to trigger saves.
- **Minimap:** `minimap.setFogRenderer(fogRenderer)` — minimap renders fog overlay.
- **Export:** `withFogDefaults()` merges fog style into image/SVG export options.
- **Sync protocol (@fieldnotes/sync):** `FogSyncManager`, `FogLedger` — fog has its own sync ops (`fog-meta`, `fog-patch`). 459 references in sync package.
- **Sync server (@fieldnotes/sync-server):** `AuthorizeFog` hook, `HubBackend` has fog methods (`getFogSnapshot`, `applyFogMeta`, `applyFogPatch`). 161 references.
- **History:** Fog mutations produce `Command` objects via `fogManager.onCommand`.

**Coupling: 🔴 Deep.** Fog is woven into Viewport, serialization, auto-save, sync protocol, sync-server, minimap, export, and history. Extracting fog means refactoring all of these integration points.

**Reference count:** ~508 in core, ~459 in sync, ~161 in sync-server.

---

### Grid

**Files (core):**

- `src/canvas/grid-controller.ts` — GridController class (add/update/remove grid, sync context)
- `src/elements/grid-renderer.ts` — renderSquareGrid, renderHexGrid, createHexGridTile
- `src/core/grid-metric.ts` — pathDistanceCells, gridDistanceCells (5e diagonal rule)
- `src/elements/types.ts` — `GridElement` type (grid is a first-class element type)
- `src/elements/element-factory.ts` — `createGrid()` factory
- `src/elements/element-renderer.ts` — dispatches grid rendering

**Integration points:**

- **Viewport:** `gridController` is a private field. Viewport exposes `addGrid()`, `updateGrid()`, `removeGrid()`, `getGridInfo()`, `onGridChange()`, `snapToGrid` property.
- **Element system:** Grid is a `CanvasElement` subtype (`type: 'grid'`). It lives in the ElementStore, is serialized/deserialized, and participates in the element lifecycle.
- **Rendering:** `element-renderer.ts` dispatches to `grid-renderer.ts` when element type is `'grid'`. Grid rendering uses camera-derived bounds.
- **Camera:** `gridController.syncContext()` is called on camera changes. Grid bounds can override camera-derived bounds.
- **Input:** `snapToGrid` is a Viewport property that flows into `toolContext.snapToGrid`. Tools use this for coordinate snapping.
- **History:** Grid mutations go through `recorder.begin()/commit()`.
- **Store:** Grid is queried via `store.getElementsByType('grid')`.

**Coupling: 🔴 Deep.** Grid is a first-class element type, which makes it deeply woven into the element system, rendering pipeline, and serialization. It's not just a feature on top of canvas — it's part of the data model.

**Reference count:** ~1154 in core.

---

### Ruler/Measurement

**Files (core):**

- `src/tools/measure-tool.ts` — MeasureTool class (Tool implementation)
- `src/canvas/measure-render.ts` — drawMeasurement() rendering
- `src/canvas/remote-measure-overlay.ts` — RemoteMeasureOverlay, MeasurePresence (shared live ruler)

**Integration points:**

- **Tool system:** MeasureTool implements the `Tool` interface. It's registered like any other tool.
- **Rendering:** Uses `drawMeasurement()` from measure-render. Renders via tool's `render()` method (overlay).
- **Sync (light):** `RemoteMeasureOverlay` and `MeasurePresence` support shared ruler via presence system. Uses `MEASURE_PRESENCE_KIND` lane.
- **Input:** Standard tool input handling (pointer down/move/up).

**Coupling: 🟢 Shallow.** MeasureTool is a self-contained tool. It uses the tool system and rendering, but doesn't touch serialization, element store, or deep Viewport internals. The shared ruler uses presence (which is already generic).

**Reference count:** ~307 in core.

---

### Summary: Extraction Difficulty

| Feature                    | Coupling | Extraction Difficulty | Scope                    | Notes                                                                                     |
| -------------------------- | -------- | --------------------- | ------------------------ | ----------------------------------------------------------------------------------------- |
| **Measure**                | Shallow  | 🟢 Easy               | Core only                | Self-contained tool. Can extract first to validate pattern.                               |
| **Grid**                   | Deep     | 🔴 Hard               | Core only                | First-class element type. Requires element-type registry (ADR-1).                         |
| **Templates**              | Deep     | 🔴 Hard               | Core only                | First-class element type. Extracted together with grid.                                   |
| **Fog (client)**           | Deep     | 🔴 Hard               | Core + sync              | Woven into Viewport, serialization, sync protocol.                                        |
| **Fog (server)**           | Deep     | 🔴 Hard               | sync-server + sync-redis | `AuthorizeFog`, `HubBackend` fog methods, `FogLedger`.                                    |
| **Fog (Redis)**            | Deep     | 🔴 Hard               | sync-redis               | ~180 lines of Lua scripts, dedicated Redis keys, canonicalization, generation validation. |
| **Fog (RollKeeper relay)** | Deep     | 🟡 Medium             | RollKeeper relay         | Cost-optimized buffered backend, DM-only authorization policies.                          |

### Recommended Extraction Order

> **Revised (post-review):** Server extraction deploys before client extraction. Facade package precedes all code movement.

1. **Phase 0:** Publish `@fieldnotes/vtt` as compatibility facade, migrate RollKeeper imports (zero-risk)
2. **Phase 0:** Write ADRs for open architectural decisions (see `MIGRATION_VTT_EXTRACTION.md` §Open Architectural Decisions)
3. **Phase 1-2:** Implement extension points, refactor VTT features to use them internally
4. **Phase 3:** **MeasureTool** → extract first (low risk, validates pattern)
5. **Phase 4:** **Grid + Templates** → extract together (requires element-type registry)
6. **Phase 5a:** **Fog server + Redis** → extract and deploy first (relay before clients)
7. **Phase 5b:** **Fog client** → extract last (requires sync protocol extension design)
8. **Phase 6:** Soak period, then remove legacy code

## Risks & Mitigations

### Performance

**Risk:** Extension points add indirection to hot paths (rendering, input).

**Mitigation:**

- Profile before/after
- Use direct function calls, not event emitters
- Allow batching (e.g., single `renderOverlay` call, not per-element hooks)

### API Surface

**Risk:** Extension points increase core's API surface, making it harder to learn.

**Mitigation:**

- Clear documentation
- Progressive disclosure (basic API first, extension API for advanced use)
- Examples and templates

### Refactor Cost

**Risk:** Significant upfront work to extract VTT features.

**Mitigation:**

- Phased approach (audit → extension points → extraction → docs)
- Start with least coupled feature (ruler?) to validate pattern
- Core remains usable throughout (no "big bang" rewrite)

### Breaking Changes

**Risk:** External consumers (small but non-zero) must migrate.

**Mitigation:**

- Major version bump (0.68.0 → 0.69.0 or 1.0.0)
- Migration guide
- Deprecation period (keep old API with warnings for one minor version)

## Known Audit Gaps

> **Added (Finding 7):** The original audit called itself complete but did not fully cover the following areas. These must be audited during Phase 0.

### Templates

- Not fully audited for integration depth. Known to be a first-class `CanvasElement` subtype (`type: 'template'`) with VTT-specific fields (`feetPerCell`, `radiusFeet`, `renderStyle`).
- Need to map: how many files reference template-specific validation, rendering, and serialization?
- Need to check: does RollKeeper extend template behavior beyond what core provides?

### Export Surfaces

- Fog has separate bitmap-export and SVG-export paths (`withFogDefaults()`). Not audited for how deeply fog is woven into export.
- RollKeeper exports player-mode fog while composing its own marker HTML painters (`battleMapExport.ts`). Need to understand the full export composition pipeline.
- Minimap fog rendering (`minimap.setFogRenderer()`) not fully audited for privacy implications.

### React Bindings

- `FieldNotesCanvas` exposes `snapToGrid` as a reactive prop. After migration, this must delegate to the snap service.
- Need to check: are there other VTT-specific props or behaviors in the React layer?
- `viewport.toolContext` is used by RollKeeper for external drag placement (`useRosterDrag.ts`). The snap service must be available on toolContext.

### Server/Redis Extraction

- sync-server fog methods (`fogSnapshot`, `applyFogMeta`, `applyFogTile`, `applyFogPatch`) not fully audited for all callers.
- sync-redis Lua scripts (~180 lines) not audited for edge cases, correction logic, or generation validation.
- `FogLedger` in-memory fallback in sync-server — who uses it? Is it tested?
- RollKeeper relay's fog backend wrapping — full dependency map needed.

### Tool Lifecycle

- Plugin-installed tools must have deterministic registration order.
- RollKeeper depends on stable first-registered tool instances and mutable refs.
- Need to verify: does `ToolManager.register()` guarantee ordering? Does `onRegister` fire synchronously?

### RollKeeper Privacy-Sensitive Ordering

- Store subscription ordering: elements marked private before sync observes them.
- Fog event origins: `attachFogPersistence.ts` prevents persistence loops via origin metadata.
- Snapshot/bootstrap ordering: unmasked frame avoidance in `battlemapSync.ts`.
- These ordering constraints must be preserved through the plugin lifecycle.

---

## Open Questions

> **Note:** The six key architectural decisions have been formalized as ADRs in `MIGRATION_VTT_EXTRACTION.md` §Open Architectural Decisions. The remaining open questions are:

1. **What's the minimum viable extension API?** Do we need all extension point types in Phase 1, or can we start with fewer and add the rest as needed?
2. **Should tools be part of core or a domain package?** Tools feel domain-specific, but the tool registry feels like a core primitive. Currently leaning: tool _registry_ is core, tool _implementations_ are domain packages.
3. **How do we handle element metadata?** If tokens have HP/AC, is that element metadata (core) or token behavior (VTT package)? Related to ADR-1 (element extensibility model).
4. **What is the soak period duration?** How long should we run dual-write / wire-kind preservation before removing legacy code? (Proposed: 4 weeks minimum.)
5. **How do we test mixed-version sync?** We need a test harness that simulates old + new clients in the same room.

## Success Criteria

- [ ] Core has no VTT-specific code (fog, grid, ruler, tokens)
- [ ] `@fieldnotes/vtt` package exists and provides all VTT features
- [ ] RollKeeper works with the new architecture (no functionality loss)
- [ ] Extension API is documented with examples
- [ ] Performance is not degraded (within 5% of current)
- [ ] Bundle size of core is reduced (measure before/after)

## Next Steps

> **Revised (post-review):** Phase 0 (compatibility/design) precedes all code movement.

1. ✅ Complete VTT integration audit (done — see above)
2. ✅ Complete RollKeeper usage analysis (done — see above)
3. ✅ Codex review of migration plan (done — findings incorporated)
4. **Phase 0 — Compatibility & Design:**
   a. ✅ Write ADRs for the six open architectural decisions (`docs/adr/0001`–`0006`)
   b. ✅ Executable contract spike (`packages/contract-spike`, 61 tests)
   c. ❌ Create RollKeeper compatibility fixtures (old/new state and protocol matrices)
   d. ❌ Publish `@fieldnotes/vtt` as a compatibility facade (re-exports from core)
   e. ❌ Migrate RollKeeper imports to facade (zero-risk, behavior unchanged)
   f. ❌ Add constructor-time plugin installation to Viewport
   g. ❌ Complete the audit gaps (templates, export, React bindings, server/Redis, tool lifecycle, privacy ordering)
5. **Phase 1 — Extension Point Interfaces (complete ✅):**
   a. ✅ Element-type registry (`ElementRegistry`, PR #160)
   b. ✅ Plugin state lifecycle (`PluginHandle`, PR #160)
   c. ✅ Per-surface render hooks (`createRenderHooks`, PR #163)
   d. ✅ `ServiceKey<T>` / `createServiceKey` (PR #163)
   e. ✅ `PointConstraintService` / `ConstraintServiceProxy` (PR #163)
   f. ✅ Client/server/backend sync plugin interfaces (PR #163)
   g. ⏸ Overlay registry enhancements (deferred — existing system adequate)
6. **Phase 2 — Internal Refactor (type system done, grid snapping done, fog pending):**
   a. ✅ Grid/template type definitions + `ExtensionElementEnvelope` union (PR #162)
   b. ✅ Wire registry + envelope conversion + legacy codecs (PR #162)
   c. ✅ Register grid/template in default registry (already wired in PR #162)
   d. ✅ Fog rendering → per-surface render hooks (PR #165)
   e. ✅ Grid snapping → `PointConstraintService` (`GridConstraintService`, all 9 tools migrated)
   f. ✅ Fog serialization → `PluginHandle` dual-write (`CanvasState.extensions`, extensions-first read)
   g. ❌ Fog sync → client/server/backend plugins
7. **Phase 3:** ✅ Extract MeasureTool as canary — `@fieldnotes/vtt` package created, MeasureTool/RemoteMeasureOverlay/measure-render extracted
8. **Phase 4:** Extract Grid + Templates (requires element-type registry)
9. **Phase 5:** Extract Fog (server/Redis first, then client)
10. **Phase 6:** Deploy, soak, remove legacy code
