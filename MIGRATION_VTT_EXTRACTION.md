# Migration Plan: VTT Feature Extraction

> **Companion documents:** `VISION.md` (the Emacs philosophy), `PLAN_VTT_EXTRACTION.md` (audit results)
> **Status:** Phase 0 — compatibility work and extension-design spikes. **Do not begin moving grid, templates, or fog yet.**
> **Created:** 2026-09-05
> **Revised:** 2026-09-05 (post-review — incorporated Codex review findings, see [Review Findings](#review-findings))
> **Revised:** 2026-09-06 (aligned with fourth ADR review — see ADR-0001 through ADR-0006 Review Response sections)

## Table of Contents

1. [Goals](#goals)
2. [Review Findings](#review-findings)
3. [Open Architectural Decisions (ADRs Needed)](#open-architectural-decisions)
4. [Architecture Overview](#architecture-overview)
5. [Extension Point Design](#extension-point-design)
6. [Element-Type Registry](#element-type-registry)
7. [Render Surface Contract](#render-surface-contract)
8. [Package Communication](#package-communication)
9. [Dependency Flow](#dependency-flow)
10. [Serialization Strategy](#serialization-strategy)
11. [Sync Protocol Strategy](#sync-protocol-strategy)
12. [Server & Redis Extraction](#server--redis-extraction)
13. [Phased Migration](#phased-migration)
14. [RollKeeper Migration Path](#rollkeeper-migration-path)
15. [Risk Mitigation](#risk-mitigation)
16. [Success Criteria](#success-criteria)

---

## Goals

1. **Core purity:** `@fieldnotes/core` contains zero VTT-specific code. No fog, no grid logic, no ruler, no templates.
2. **Domain packages:** VTT features live in `@fieldnotes/vtt`, depending on core via extension points.
3. **Extensibility:** The extension API is the most important contract — ergonomic, performant, composable, versioned.
4. **Backward compatibility:** Existing consumers (RollKeeper) can migrate incrementally. Wire formats remain stable through a mixed-version window.
5. **No functionality loss:** Every feature RollKeeper uses today must work after migration.
6. **Server-side parity:** Sync-server and sync-redis extraction is scoped explicitly — not treated as an afterthought.

---

## Review Findings

This plan was reviewed (2026-09-05) and found to contain six P1 issues. All have been addressed in this revision:

| #   | Severity | Finding                                                                                                                                            | Resolution                                                                                                                                                                                       |
| --- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | P1       | Target architecture contradicts core-purity goal — grid/template remain as closed CanvasElement subtypes with core validation and rendering        | Added [Element-Type Registry](#element-type-registry) section; plan now requires a generic element extension mechanism before grid/template can leave core                                       |
| 2   | P1       | Sync design omits the hardest server and Redis work — sync-redis contains fog-specific Lua scripts, Redis keys, canonicalization, generation rules | Added [Server & Redis Extraction](#server--redis-extraction) section; sync plugin contracts now span client, server, authorization, fan-out, and persistence                                     |
| 3   | P1       | Backward compatibility claims are incorrect — core rejects version > 3, sync rejects unknown op kinds                                              | [Serialization Strategy](#serialization-strategy) and [Sync Protocol Strategy](#sync-protocol-strategy) rewritten: stay on v3 temporarily, dual-write, read extension-first with legacy fallback |
| 4   | P1       | Rendering hook is too coarse — fog is a distinct hybrid surface with separate minimap/export paths                                                 | Added [Render Surface Contract](#render-surface-contract); extension model now covers viewport, minimap, image-export, and SVG-export                                                            |
| 5   | P1       | Global pointer-coordinate rewriting would break RollKeeper tools that mix snapped and unsnapped coordinates                                        | [Input Hooks](#2-input-hooks) redesigned: snapping is an explicit world-space service tools opt into, not a global PointerState mutation                                                         |
| 6   | P1       | RollKeeper migration phase is substantially underscoped — 318 references across 166 files, subtle ordering dependencies                            | [RollKeeper Migration Path](#rollkeeper-migration-path) expanded with full dependency inventory and ordering constraints                                                                         |
| 7   | P2       | Audit is useful but not complete — templates, export surfaces, React bindings, server/Redis, tool lifecycle not fully audited                      | [PLAN_VTT_EXTRACTION.md](PLAN_VTT_EXTRACTION.md) updated with known gaps                                                                                                                         |

---

## Open Architectural Decisions

> **These ADRs must be written and approved before Phase 1 begins.** Each decision gates downstream work.

### ADR-1: Element Extensibility Model

**Decision needed:** How do grid and template leave the CanvasElement union?

- **Option A — Full element-type registry:** Core provides a generic registration API (`registerElementType({ type, validate, bounds, hitTest, render, serialize })`). Domain packages register their own element types. CanvasElement becomes an open union with a `CustomElement` escape hatch.
- **Option B — Generic primitives:** Grid and template are reclassified as intentionally generic core primitives (like `shape` or `html`). They stay in the CanvasElement union but their VTT-specific _behavior_ (snapping, AoE calculations) moves to the VTT package.
- **Option C — Metadata-only:** Grid and template remain as element types but their VTT-specific fields (e.g., `feetPerCell`, `gridType`) move to a generic `metadata: Record<string, unknown>` field. Core validates only base fields; domain packages validate their own metadata.

**Recommendation:** Option A. It is the most general solution and aligns with the Emacs philosophy. However, it is the highest upfront cost. Option C is a viable incremental step toward A.

### ADR-2: Render Surface Model

**Decision needed:** How do extensions declare which render surfaces they participate in?

- **Option A — Per-surface hooks:** Extensions register separately for viewport, minimap, image-export, SVG-export. Each surface has its own hook API.
- **Option B — Unified render pass:** Extensions declare render passes with a `surface` filter (`['viewport', 'minimap']`). One registration, multiple surfaces.
- **Option C — Surface-agnostic callbacks:** Extensions provide a single render function; core routes it to the appropriate surfaces automatically.

**Recommendation:** Option A. Fog needs different rendering logic for viewport (hybrid DOM surface) vs. minimap (separate canvas) vs. export (SVG nodes). Conflating them hides real complexity.

### ADR-3: Sync/Server Plugin Ownership

**Decision needed:** How is fog sync extracted across the client/server/Redis boundary?

- **Option A — Separate VTT sync packages:** `@fieldnotes/vtt-sync-client`, `@fieldnotes/vtt-sync-server`, `@fieldnotes/vtt-sync-redis`. Each depends on its generic counterpart.
- **Option B — Plugin contracts in existing packages:** Generic sync packages gain plugin registration APIs. VTT packages export plugins that are registered at construction time.
- **Option C — Subpath exports:** `@fieldnotes/sync/vtt`, `@fieldnotes/sync-server/vtt`, `@fieldnotes/sync-redis/vtt`. Single package, separate entry points.

**Recommendation:** Option B for client (aligns with extension system). Option A for server/Redis (cleaner deployment boundary, independent versioning). RollKeeper's relay already deploys independently.

### ADR-4: Serialization Compatibility Strategy

**Decision needed:** How do we transition persisted state without breaking old clients?

- **Option A — Stay on v3, dual-write:** Keep `version: 3`. Write both `fog` (legacy) and `extensions.fog` (new). Read `extensions.fog` first, fall back to `fog`. Remove legacy field after soak period.
- **Option B — Bump to v4 with migration:** Bump to `version: 4`. Old clients reject v4 (current behavior). Provide migration tooling.
- **Option C — Capability negotiation:** Clients negotiate supported versions on sync connection. Mixed-version rooms use the lowest common denominator.

**Recommendation:** Option A. It preserves backward compatibility with all existing persisted state and avoids a hard version break. The dual-write window is temporary and can be measured.

### ADR-5: Plugin Lifecycle & Installation

**Decision needed:** When and how are plugins installed?

- **Constraint:** Plugins required for privacy (e.g., fog masking) must install **before** the first render, load, or sync connection. There is no "add plugin later" for privacy-critical extensions.
- **Constraint:** Plugin installation must be deterministic (registration order = behavior order) and idempotent (re-registering the same plugin is a no-op).
- **Constraint:** Disposal must be clean — `dispose()` unregisters all hooks, cancels all subscriptions, releases all resources.

**Recommendation:** Constructor-time plugin installation. `new Viewport({ plugins: [fogPlugin, gridPlugin] })`. Plugins are installed before any lifecycle method runs.

### ADR-6: Snapping as Service vs. Global Hook

**Decision needed:** How do tools access grid snapping?

- **Option A — Global input hook:** `InputHooks.beforePointerDown` rewrites `PointerState` coordinates before tools see them. All tools receive snapped coordinates when snapping is active.
- **Option B — Explicit snap service:** Core exposes `snap(worldPoint, options) → snappedPoint`. Tools call it when they want snapping. Different tools can use different snap strategies in the same gesture.

**Recommendation:** Option B. RollKeeper deliberately mixes snapped and unsnapped coordinates within the same gesture (unsnapped markers with screen-pixel drag thresholds, footprint-centered token snapping, smart-snapped spell templates). Global rewriting breaks these workflows. See Finding 5.

---

## Architecture Overview

### Current Architecture

```
@fieldnotes/core
├── Element system (elements, store, rendering, serialization)
├── Camera/viewport
├── Rendering pipeline (hybrid canvas + DOM)
├── Input pipeline (pointer events, tool system)
├── History/undo
├── Serialization (CanvasState v3)
├── Fog of war ← VTT-specific
├── Grid ← VTT-specific (element type + snap + metrics)
├── Measure/Ruler ← VTT-specific
├── Templates ← VTT-specific
└── Sync integration (presence, overlays)

@fieldnotes/react
└── React bindings for core

@fieldnotes/sync
├── Sync client
├── Fog sync protocol ← VTT-specific
└── Presence system

@fieldnotes/sync-server
├── WebSocket relay
├── Fog authorization ← VTT-specific
└── Hub backend interface

@fieldnotes/sync-redis
└── Redis persistence (includes fog storage) ← VTT-specific
    ├── Fog-specific Lua scripts (LWW conflict resolution)
    ├── Fog-specific Redis keys ({room}:fog:meta, {room}:fog:tiles)
    ├── Fog-specific validation (base64 patterns, generation rules)
    └── Fog canonicalization
```

### Target Architecture

```
@fieldnotes/core (pure canvas engine)
├── Element system (elements, store, rendering, serialization)
│   └── Element-type registry ← NEW (generic, domain-agnostic)
├── Camera/viewport
├── Rendering pipeline (hybrid canvas + DOM)
│   └── Render surface contract ← NEW (viewport, minimap, export surfaces)
├── Input pipeline (pointer events, tool system)
│   └── Point constraint service ← NEW (explicit, opt-in, world-space, domain-neutral)
├── History/undo
├── Serialization (CanvasState v3 + extensions field, dual-write)
├── Extension system ← NEW
│   ├── Rendering hooks (per-surface)
│   ├── Serialization plugins
│   ├── Sync plugins (client-side)
│   ├── Overlay registry (enhanced)
│   └── Plugin lifecycle (constructor-time installation)
└── Generic utilities (distance, bounds — domain-agnostic)

@fieldnotes/vtt ← NEW PACKAGE
├── Fog of war (manager, renderer, tool, codec)
├── Grid (controller, renderer, snap integration)
│   └── Registers 'grid' element type via element-type registry
├── Measure/Ruler (tool, overlay)
├── Templates (tool, element renderer)
│   └── Registers 'template' element type via element-type registry
├── Fog sync plugin (client)
├── Fog sync plugin (server) ← separate from client plugin
└── VTT-specific utilities (hex distance, etc.)

@fieldnotes/react (updated)
└── React bindings for core
    └── snapToGrid prop delegates to constraint service (not global rewrite)

@fieldnotes/sync (extensible)
├── Sync client
├── Plugin system ← NEW (client-side op routing)
└── Presence system (generic)

@fieldnotes/sync-server (extensible)
├── WebSocket relay
├── Plugin system ← NEW (server-side op authorization + application)
└── Hub backend interface (generic)

@fieldnotes/sync-redis (extensible)
├── Redis persistence (generic key-value + plugin-owned domains)
└── Plugin system ← NEW (domain-specific Lua scripts, key schemas)
```

---

## Extension Point Design

### 1. Rendering Hooks (Per-Surface)

> **Corrected (Finding 4):** The original design used a single `afterElements(ctx)` callback. Fog is a distinct hybrid paint-stack surface with separate minimap, bitmap-export, and SVG-export paths. The hook model must cover all surfaces.

**Design:**

```typescript
// Semantic viewport slots — not numeric zOrder
type ViewportSlot = 'afterSceneBeforeOverlay' | 'afterOverlay' | 'afterToolOverlay';

interface ViewportHookOptions {
  slot: ViewportSlot;
  priority?: number; // Within slot only
  required?: boolean;
  satisfies?: string[];
}

// Each render surface has its own hook registration:
interface RenderSurfaceHooks {
  // Viewport surface (hybrid canvas + DOM)
  viewport: SurfaceHookRegistry;
  // Minimap surface (separate canvas)
  minimap: SurfaceHookRegistry;
  // Image export surface (offscreen canvas)
  imageExport: SurfaceHookRegistry;
  // SVG export surface (SVG document)
  svgExport: SurfaceHookRegistry;
}

interface SurfaceHookRegistry {
  register(hooks: SurfaceRenderHooks, options?: ViewportHookOptions): () => void;
}

interface SurfaceRenderHooks {
  beforeElements?(ctx: RenderContext, camera: Camera): void;
  afterElements?(ctx: RenderContext, camera: Camera): void;
  afterAll?(ctx: RenderContext, camera: Camera): void;
}

// Domain packages register per-surface using semantic slots:
viewport.renderHooks.viewport.register(
  {
    afterElements: (ctx, camera) => {
      /* fog rendering on hybrid surface */
    },
  },
  { slot: 'afterSceneBeforeOverlay' },
);

viewport.renderHooks.minimap.register(
  {
    afterElements: (ctx, camera) => {
      /* fog on minimap — privacy-aware */
    },
  },
  { slot: 'afterSceneBeforeOverlay' },
);
```

**Key differences from original:**

- Fog registers separately for viewport (hybrid DOM stratum) and minimap (canvas overlay)
- Export hooks receive the appropriate context type (canvas vs. SVG document)
- Ordering uses semantic slots (not numeric `zOrder`); `priority` is within-slot only
- Privacy-critical surfaces (e.g., player-view minimap) can be fail-closed

### 2. Input Hooks → Point Constraint Service

> **Corrected (Finding 5):** The original design used global `InputHooks` that rewrote `PointerState` coordinates before tools saw them. This breaks RollKeeper tools that deliberately mix snapped and unsnapped coordinates within the same gesture.

**Design:**

```typescript
// Core provides a domain-neutral constraint service — no VTT concepts
interface PointConstraintService {
  constrainPoint(point: Point, options?: ConstraintOptions): Point;
  getConstraintInfo(): ConstraintInfo | null;
  readonly isActive: boolean;
  setActive(active: boolean): void;
  hasCapability(capability: string): boolean;
}

interface ConstraintOptions {
  mode?: string; // 'cell-center', 'smart', 'footprint'
  footprint?: { width: number; height: number };
}

// Core owns a stable proxy — activation survives service replacement
class ConstraintServiceProxy implements PointConstraintService {
  private _impl: PointConstraintService | null = null;
  private _active = false;
  // ... delegates to _impl, re-applies activation on replacement
}

// Tools call constraint explicitly when they want it:
class DmTokenTool implements Tool {
  onPointerDown(state: PointerState, ctx: ToolContext) {
    const worldPoint = ctx.camera.screenToWorld(state);
    const snapped = ctx.constraintService.constrainPoint(worldPoint, { mode: 'cell-center' });
    // Place token at snapped position
  }
}

class DmMarkerTool implements Tool {
  onPointerDown(state: PointerState, ctx: ToolContext) {
    const worldPoint = ctx.camera.screenToWorld(state);
    // NO constraint — marker uses raw world coordinates
    // Screen-pixel drag threshold for marker placement
  }
}

// Domain-specific access uses typed service retrieval:
const gridService = viewport.getService<GridConstraintService>('grid');
```

**Key differences from original:**

- No global `PointerState` mutation
- Each tool decides independently whether to constrain
- Different tools can use different constraint strategies in the same gesture
- `PointConstraintService` is domain-neutral (no grid/hex/cell concepts in core)
- `ConstraintServiceProxy` is always present on `ToolContext` (never undefined once initialized)
- Activation state survives service replacement
- Domain-specific access uses `viewport.getService<T>(key)` for typed retrieval
- Screen-space coordinates are never modified

### 3. Serialization Plugins

> **Corrected (Finding 3):** The original design bumped to v4 and claimed old clients would "ignore" the extensions field. In reality, core rejects `version > 3`. The corrected strategy uses dual-write on v3.

See [Serialization Strategy](#serialization-strategy) for the full corrected approach. The plugin interface remains similar:

```typescript
interface SerializationPlugin<T = unknown> {
  readonly key: string; // e.g., 'fog', 'vtt'
  serialize(): T;
  deserialize(data: T): void;
  validate(data: unknown): data is T;
}

// Registered at construction time:
const viewport = new Viewport({
  plugins: [fogSerializationPlugin],
  // ...
});
```

### 4. Sync Plugins (Client + Server)

> **Corrected (Finding 2):** The original design only covered client-side plugins. Sync-server has fog-specific authorization (`AuthorizeFog`), backend methods (`fogSnapshot`, `applyFogMeta`, `applyFogPatch`), and sync-redis has fog-specific Lua scripts, Redis keys, and canonicalization. The plugin contract must span all three layers.

**Client-side plugin:**

```typescript
interface ClientSyncPlugin {
  readonly name: string;
  // Outbound: plugin can produce custom ops
  produceOps?(): SyncOp[];
  // Inbound: plugin handles custom ops with full metadata
  handleOp?(
    op: SyncOp,
    meta: { sender: string; isLocal: boolean; phase: 'live' | 'reconnect' | 'snapshot' },
  ): void;
  // Extension kind registration
  registerExtensionKinds?(registry: ClientExtensionRegistry): void;
  // Snapshot: plugin extends snapshot
  extendSnapshot?(snapshot: SyncSnapshot): void;
  applySnapshot?(
    snapshot: PluginSnapshot,
    meta: { phase: 'initial' | 'reconnect' | 'offline-replay' },
  ): void;
  validateSnapshot?(data: unknown): boolean;
  migrateSnapshot?(data: unknown, fromVersion: number): unknown;
  handleCorrection?(op: SyncOp): void;
}
```

**Server-side plugin:**

```typescript
interface ServerSyncPlugin {
  readonly name: string;
  // Unified process: combines authorization + application in one step
  process?(op: SyncOp, ctx: ServerOpContext): Promise<ApplyResult>;
  // Extension kind registration
  registerExtensionKinds?(registry: ServerExtensionRegistry): void;
  // Snapshot: plugin provides snapshot data
  snapshot?(room: string, backend: HubBackend): Promise<PluginSnapshot>;
  filterSnapshot?(
    snapshot: PluginSnapshot,
    viewer: { userId: string; role: string },
  ): PluginSnapshot | null;
}
```

**Backend (Redis) plugin:**

```typescript
interface BackendSyncPlugin {
  readonly name: string;
  readonly sharedAcrossInstances: boolean;
  // Key schema: Redis keys owned by this plugin
  keyPrefix: string;
  // Persistence: Lua scripts for atomic operations
  scripts?: Record<string, string>;
  // Snapshot: plugin provides snapshot data
  snapshot?(room: string): Promise<PluginSnapshot>;
  // Middleware-style apply: outer-to-inner ordering, op ownership
  apply?(room: string, op: SyncOp, next: BackendNext): Promise<ApplyResult>;
  dispose?(): void;
}
```

> **Note on backend middleware ordering:** Backend plugins compose as middleware — `apply()` receives a `next` callback and may call it to delegate to inner plugins, or return an `ApplyResult` directly to short-circuit. Plugins execute outer-to-inner (registration order). Each plugin owns the ops for its `keyPrefix`; ops not matching any plugin's prefix are rejected.

See [Server & Redis Extraction](#server--redis-extraction) for the full extraction plan.

### 5. Camera Modifiers (Decoupled from Grid)

> **Corrected (Finding 5):** The original design coupled camera modifiers to grid snapping. Camera constraints (zoom limits, pan bounds) are genuinely useful for non-VTT use cases, but grid snapping for tools is now a `PointConstraintService` (see above), not a camera modifier.

**Design:**

```typescript
// Camera modifiers are for viewport-level constraints, NOT tool snapping:
interface CameraModifier {
  // Constrain zoom range
  constrainZoom?(zoom: number, camera: Camera): number;
  // Constrain pan bounds (e.g., keep viewport within page boundaries)
  constrainPosition?(position: Point, camera: Camera): Point;
}

// Example: diagramming package constrains viewport to page bounds
viewport.camera.registerModifier({
  constrainPosition: (pos, camera) => clampToPageBounds(pos, pageBounds),
  constrainZoom: (zoom) => clamp(zoom, 0.25, 4.0),
});
```

**Key differences from original:**

- No grid snapping in camera modifiers
- Grid snapping is a `PointConstraintService` that tools call explicitly
- Camera modifiers are for viewport-level constraints (zoom limits, pan bounds)

### 6. Overlay Registry (Enhanced)

Mostly unchanged from original. Z-ordering and lifecycle are still useful:

```typescript
interface OverlayOptions {
  zOrder: number;
  lifecycle?: 'persistent' | 'linger';
  lingerDuration?: number;
}

viewport.overlays.register(renderer, { zOrder: 300, lifecycle: 'persistent' });
```

### 7. Service Registry (Plugin Lifecycle)

Plugins register typed services during `start()` and retrieve them via the viewport:

```typescript
// During plugin start():
ctx.registerService<T>(key: string, service: T): void;

// Typed retrieval from anywhere with a viewport reference:
viewport.getService<T>(key: string): T;

// Plugin state is stored at extensions[plugin.name] — one opaque value per plugin
```

This enables domain packages to expose rich, typed services (e.g., `GridConstraintService`, `FogManager`) without core knowing about them. The service registry is the primary mechanism for cross-plugin communication.

---

## Element-Type Registry

> **New (Finding 1):** The original plan kept grid and template as closed CanvasElement subtypes with core validation and rendering, which contradicts the core-purity goal. This section describes the element-type registry that must exist before grid and template can leave core.

### Problem

`CanvasElement` is an exhaustive union:

```typescript
export type CanvasElement =
  | StrokeElement
  | NoteElement
  | ArrowElement
  | ImageElement
  | HtmlElement
  | TextElement
  | ShapeElement
  | GridElement // ← VTT-specific
  | TemplateElement; // ← VTT-specific
```

Core validates, renders, serializes, and hit-tests every element type. Grid and template cannot leave core until their validation, rendering, and serialization are handled by a generic mechanism.

### Proposed Design

```typescript
// Core's runtime union — includes extension envelope
type CanvasElement =
  | StrokeElement
  | NoteElement
  | ArrowElement
  | ImageElement
  | HtmlElement
  | TextElement
  | ShapeElement
  | ExtensionElementEnvelope; // Core-owned extension type

interface ExtensionElementEnvelope extends BaseElement {
  readonly type: 'extension';
  readonly extensionType: string; // 'vtt:grid', 'vtt:template'
  readonly data: Record<string, unknown>;
}

interface ElementTypeDefinition<T extends BaseElement> {
  readonly type: string;
  validate(el: unknown): el is T;
  unwrap(el: ExtensionElementEnvelope): T;
  wrap(el: T): ExtensionElementEnvelope;
  bounds(el: T): Bounds | null;
  hitTest(el: T, point: Point): boolean;
  renderMode: 'canvas' | 'dom' | 'hybrid' | 'none';
  render?(el: T, renderCtx: ElementRenderContext): void;
  interaction?: ElementInteractionAdapter<T>;
  renderPass?: RenderPassDescriptor;
  // ... other methods
}

// Registration:
viewport.elementTypes.register(gridElementTypeDefinition);
viewport.elementTypes.register(templateElementTypeDefinition);

// Application code uses the registry for typed access, not generic propagation:
const gridDef = viewport.elementTypes.get('vtt:grid');
const gridElement = gridDef.unwrap(envelope); // Typed GridElement
```

### Migration Path

1. **Phase 0:** Design the element-type registry interface (ADR-1).
2. **Phase 1:** Implement the registry in core. Keep existing element types as-is.
3. **Phase 2:** Register grid and template via the new registry (internal refactor, no public API change).
4. **Phase 3:** Move grid and template type definitions to `@fieldnotes/vtt`. Core's `CanvasElement` union shrinks.
5. **Phase 4:** Remove grid and template from core's `ELEMENT_TYPES` array and validation switch.

### Alternative: Incremental Approach (Option C from ADR-1)

If the full registry is too costly upfront, an incremental step:

```typescript
// Add generic metadata to all elements:
interface BaseElement {
  // ... existing fields ...
  metadata?: Record<string, unknown>; // Domain-specific extension data
}

// Grid element keeps its core fields, but VTT-specific fields move to metadata:
interface GridElement extends BaseElement {
  type: 'grid';
  cellSize: number; // Core: needed for rendering
  strokeColor: string; // Core: needed for rendering
  // VTT-specific fields move to metadata:
  // metadata.feetPerCell, metadata.hexOrientation, etc.
}
```

This is a stepping stone — it doesn't achieve full core purity but reduces VTT-specific surface area.

---

## Render Surface Contract

> **New (Finding 4):** Fog is not a simple canvas overlay. It is a distinct hybrid paint-stack surface rendered at `fogOrder = visibleElements.length + 1` on the `HybridRenderSurface`, in screen/device space (not world space). It also has separate minimap, bitmap-export, and SVG-export paths. The extension contract must model all of these.

### Current Render Surfaces

| Surface             | Technology          | Fog behavior                          | Transform                            |
| ------------------- | ------------------- | ------------------------------------- | ------------------------------------ |
| Viewport (elements) | Canvas 2D           | N/A                                   | World transform (translate + scale)  |
| Viewport (fog)      | Hybrid DOM stratum  | Dedicated stratum above elements      | Screen/device space (dpr scale only) |
| Viewport (overlays) | Canvas 2D           | N/A                                   | World transform                      |
| Minimap             | Canvas 2D           | `minimap.setFogRenderer(fogRenderer)` | Minimap transform                    |
| Image export        | Offscreen Canvas 2D | `withFogDefaults()` merges fog style  | Export transform                     |
| SVG export          | SVG DOM             | Fog rendered as SVG rect/group        | Export transform                     |

### Required Extension Contract

Each surface must be independently extensible:

```typescript
// Viewport surface: fog needs hybrid DOM stratum positioning
interface ViewportRenderExtension {
  // Where in the paint stack does this extension render?
  stratum: 'before-elements' | 'after-elements' | 'after-overlays';
  // Is this a hybrid DOM surface or a canvas overlay?
  surface: 'canvas' | 'hybrid';
  // The render function
  render(ctx: CanvasRenderingContext2D, camera: Camera, bounds: Bounds): void;
}

// Minimap surface: fog needs privacy-aware rendering
interface MinimapRenderExtension {
  // Should fog be rendered on minimap? (privacy: player view may hide fog)
  shouldRender(ctx: MinimapContext): boolean;
  render(ctx: CanvasRenderingContext2D, minimap: Minimap): void;
}

// Image export surface
interface ImageExportExtension {
  render(ctx: CanvasRenderingContext2D, exportOptions: ExportOptions): void;
}

// SVG export surface
interface SvgExportExtension {
  render(svg: SVGDocument, exportOptions: ExportOptions): void;
}
```

### RollKeeper-Specific Requirements

RollKeeper exports player-mode fog while composing its own marker HTML painters. The export extension must support:

- Selective fog rendering (DM sees all fog, player sees only revealed areas)
- Composition with custom HTML/SVG overlays
- Stable z-ordering between fog and custom markers

---

## Package Communication

### Communication Patterns

1. **Core → Domain:** Extension points (hooks, plugins, overlays, element-type registry)
   - Core provides interfaces
   - Domain packages implement and register

2. **Domain → Core:** Public API
   - Domain packages use `Viewport`, `ElementStore`, `ToolManager`, `PointConstraintService`, etc.
   - No internal imports (enforced by package boundaries)

3. **Domain → Domain:** Direct imports
   - `@fieldnotes/vtt` can import from `@fieldnotes/diagramming` if needed
   - Peer dependencies, not hierarchical

4. **Sync → Domain:** Sync plugins (client, server, backend)
   - Domain packages register sync plugins at each layer
   - Sync client/server/backend dispatch to plugins

### Dependency Rules

- **Core depends on nothing** (framework-free, domain-agnostic)
- **Domain packages depend on core** (use extension points)
- **Sync packages depend on core types** (protocol types, element types)
- **React package depends on core** (bindings)
- **No circular dependencies** (enforced by package boundaries)

---

## Dependency Flow

```
@fieldnotes/core (pure canvas engine)
    ↑
    ├── @fieldnotes/vtt (VTT features)
    │       ├── Uses: rendering hooks, element-type registry, constraint service,
    │       │       serialization plugins, sync plugins
    │       ├── Provides: fog, grid, measure, templates
    │       └── Depends on: core
    │
    ├── @fieldnotes/diagramming (future)
    │       ├── Uses: rendering hooks, element-type registry
    │       ├── Provides: connectors, shapes, auto-layout
    │       └── Depends on: core
    │
    └── @fieldnotes/react (React bindings)
            ├── Uses: core public API
            └── Depends on: core

@fieldnotes/sync (extensible sync client)
    ↑
    ├── @fieldnotes/vtt (registers fog sync client plugin)
    │       └── Depends on: sync, core
    │
    └── @fieldnotes/sync-server (extensible relay server)
            ↑
            ├── @fieldnotes/vtt (registers fog sync server plugin)
            │       └── Depends on: sync-server, sync
            │
            └── @fieldnotes/sync-redis (extensible Redis backend)
                    ↑
                    └── @fieldnotes/vtt (registers fog backend plugin)
                            └── Depends on: sync-redis, sync-server, sync
```

### Import Rules

- **Core** imports nothing from domain packages
- **Domain packages** import from core (public API only)
- **Sync** imports types from core (no implementation)
- **Consumers** (RollKeeper) import from core + domain packages
- **Server packages** import from their generic counterpart + core types

---

## Serialization Strategy

> **Corrected (Finding 3):** The original design bumped to v4 and claimed old clients would "ignore" the extensions field. In reality, `state-serializer.ts` rejects `version > 3` with `"Invalid state: unsupported version"`. The corrected strategy stays on v3 during the transition.

### Transition Strategy: Dual-Write on v3

```
Phase 0-2 (mixed-version window):
  WRITE: version 3, both `fog` (legacy) AND `extensions.fog` (new)
  READ:  `extensions.fog` first, fall back to `fog`

Phase 3 (after all clients upgraded):
  WRITE: version 3, only `extensions.fog`
  READ:  `extensions.fog` first, fall back to `fog`

Phase 4 (after soak period):
  WRITE: version 4, only `extensions.fog`
  READ:  version 4 with migration from v3 (automatic)
```

### Why Not Bump to v4 Immediately?

1. **Persisted state:** RollKeeper has existing battlemaps saved as v3. Old clients reject v4.
2. **Sync protocol:** Mixed-version rooms need a common format. v3 is the common denominator.
3. **RollKeeper deployment:** Web and relay deploy independently. Both must handle the transition.
4. **npm consumers:** Even at 173 weekly downloads, some may be on older versions.

### Migration Logic (Phase 4, future)

```typescript
function migrateState(state: CanvasState): CanvasState {
  if (state.version === 3) {
    const v4 = { ...state, version: 4 };
    // Migrate legacy fog to extensions
    if (state.fog && !state.extensions?.fog) {
      v4.extensions = { ...v4.extensions, fog: state.fog };
    }
    delete v4.fog;
    return v4;
  }
  return state;
}
```

### Compatibility Matrix

| Writer \ Reader | v3 (no extensions)   | v3 (dual-write)      | v4 (extensions only) |
| --------------- | -------------------- | -------------------- | -------------------- |
| v3 (no ext)     | ✅ Works             | ✅ Works             | ✅ Migrates v3→v4    |
| v3 (dual-write) | ✅ Reads legacy      | ✅ Reads ext         | ✅ Migrates v3→v4    |
| v4 (ext only)   | ❌ Rejects (version) | ❌ Rejects (version) | ✅ Works             |

### Grid Serialization

Grid currently serializes as a `CanvasElement` with `type: 'grid'`. After element-type registry implementation (ADR-1), grid serializes as an `ExtensionElementEnvelope` with `extensionType: 'vtt:grid'` and type-specific data in the `data` field, handled by the VTT package's registered type definition via `wrap()`/`unwrap()`. During the transition, grid remains a core element type (no serialization change).

### PluginSnapshot Envelope

Each plugin's serialized state is wrapped in a versioned envelope:

```typescript
interface PluginSnapshot {
  pluginName: string;
  version: number;
  data: unknown;
}

interface SyncSnapshot {
  elements: CanvasElement[];
  layers?: LayerRecord[];
  extensions: Record<string, PluginSnapshot>; // Keyed by pluginName
}
```

This enables per-plugin versioning and migration without affecting other plugins or the core schema.

---

## Sync Protocol Strategy

> **Corrected (Findings 2, 3):** The original design replaced `fog-meta`/`fog-patch` with a generic `extension` op kind and claimed old clients would "ignore" unknown ops. In reality, `isValidEnvelope()` returns `false` for unknown op kinds, and `parseEnvelope()` returns `null` (silently dropped). The corrected strategy preserves wire kinds during the transition.

### Transition Strategy: Preserve Wire Kinds

```
Phase 0-2 (mixed-version window):
  WIRE: fog-meta and fog-patch kinds are preserved exactly as-is
  CLIENT: FogSyncManager continues to handle fog ops directly
  SERVER: SyncHub continues to route fog ops to fog backend methods
  REDIS: No changes to Lua scripts or key schemas

Phase 3 (after all clients upgraded):
  WIRE: Introduce generic `extension` envelope alongside fog kinds
  CLIENT: Plugins can handle both generic and domain-specific kinds
  SERVER: Plugin system can route both generic and domain-specific ops
  REDIS: Backend plugins begin owning their key schemas

Phase 4 (after soak period):
  WIRE: fog-meta/fog-patch deprecated, generic extension envelope only
  CLIENT: FogSyncPlugin handles ops via generic envelope
  SERVER: FogServerPlugin handles ops via generic envelope
  REDIS: Fog backend plugin owns all fog persistence
```

### Why Preserve Wire Kinds?

1. **RollKeeper relay:** Already wraps fog backend methods in a cost-optimized buffered backend with DM-only fog authorization. Changing wire kinds breaks the relay.
2. **Mixed-version rooms:** Old clients drop unknown ops. Fog ops must remain recognizable.
3. **Independent deployment:** Web and relay deploy on different schedules. Both must handle fog ops during transition.
4. **Redis Lua scripts:** ~180 lines of fog-specific Lua. These don't change until the backend plugin is ready.

### Capability Negotiation (Future)

When all clients support the plugin system, introduce capability negotiation:

```typescript
// On sync connection, exchange supported plugin capabilities:
interface SyncCapabilities {
  plugins: string[]; // ['fog', 'movement-paths', ...]
  protocolVersion: number;
}

// If both sides support 'fog', use generic extension envelope
// If one side doesn't, fall back to legacy fog-meta/fog-patch
```

### Sync Protocol Compatibility

During the mixed-version transition window, the sync protocol must handle both legacy and new clients:

1. **Legacy wire kinds preserved:** Continue using `fog-meta` and `fog-patch` op kinds during the mixed-version window. Old clients recognize these; new clients handle them via the plugin system's backward-compatible path.

2. **Capability exchange protocol:** After the v4 version bump, introduce a capability exchange on sync connection handshake. Each side advertises supported plugin kinds and protocol version. This replaces the implicit "unknown kinds are silently dropped" behavior.

3. **Translation layer for mixed-version rooms:** When a new client shares a room with an old client, the sync layer translates between legacy wire kinds and the plugin envelope. The translation is stateless and happens at the wire boundary — plugin code only sees the canonical internal representation.

---

## Server & Redis Extraction

> **New (Finding 2):** The original plan labeled sync-redis "unchanged" and treated server extraction as trivial. In reality, sync-redis contains extensive fog-specific code that must be explicitly extracted.

### Current Server-Side Fog Coupling

**sync-server** (`packages/sync-server/src/`):

- `authorize.ts`: `AuthorizeFog` type, `AuthorizeFogContext` interface
- `hub-backend.ts`: `HubBackend` fog methods (`fogSnapshot`, `applyFogMeta`, `applyFogTile`, `applyFogPatch`), `FogApplyResult`, `FogPatchApplyResult`
- `sync-hub.ts`: `processFogOp()`, fog authorization, fog backend binding, `FogLedger` in-memory fallback
- `memory-hub-backend.ts`: `MemoryHubBackend` implements all fog methods
- `create-sync-server.ts`: `CreateSyncServerOptions.authorizeFog`

**sync-redis** (`packages/sync-redis/src/`):

- `redis-hub-backend.ts`: ~300+ lines of fog-specific code
  - `FOG_META_LWW_SCRIPT` (~80 lines): Last-writer-wins Lua for fog metadata
  - `FOG_PATCH_LWW_SCRIPT` (~100 lines): Last-writer-wins Lua for fog tile patches
  - `fogMetaKey(room)`, `fogTilesKey(room)`: Dedicated Redis key schemas
  - `isValidFogMetaRecord`, `isValidFogTileRecord`, `isValidFogSnapshot`: Fog validation
  - `canonicalizeFogTile`: Tile canonicalization on definition change
  - `evalFog()`, `tileIntersectsDefinition()`, `parseApplyResult()`: Fog-specific helpers

**RollKeeper relay** (`~/Projects/RollKeeper/relay/src/`):

- `backend.ts`: Wraps fog backend methods in cost-optimized buffered backend
- `policies.ts`: DM-only fog authorization

### Extraction Plan

The server-side fog extraction is a **separate workstream** from the client-side extraction. It must be deployed first (relay before clients).

#### Step 1: Server Plugin Contracts

Define plugin interfaces for server and backend layers (see [Sync Plugins](#4-sync-plugins-client--server) above).

#### Step 2: Extract Fog Server Plugin

Move fog authorization, application, and snapshot logic from sync-server to `@fieldnotes/vtt`:

```typescript
// @fieldnotes/vtt exports:
export function createFogServerPlugin(options: FogServerOptions): ServerSyncPlugin;
```

sync-server gains plugin registration:

```typescript
const server = createSyncServer({
  plugins: [createFogServerPlugin({ authorizeFog: ... })],
  backend: redisBackend,
});
```

#### Step 3: Extract Fog Backend Plugin

Move fog Lua scripts, key schemas, and persistence from sync-redis to `@fieldnotes/vtt`:

```typescript
// @fieldnotes/vtt exports:
export function createFogBackendPlugin(): BackendSyncPlugin;
```

sync-redis gains plugin registration:

```typescript
const backend = new RedisHubBackend({
  plugins: [createFogBackendPlugin()],
  // ...
});
```

#### Step 4: Migrate RollKeeper Relay

RollKeeper's relay wraps fog backend methods. After extraction, it uses the VTT backend plugin:

```typescript
// Before:
class RollKeeperBackend implements HubBackend {
  async applyFogMeta(...) { /* buffered fog logic */ }
  // ...
}

// After:
const backend = new RedisHubBackend({
  plugins: [
    createFogBackendPlugin(),
    createRollKeeperFogBufferPlugin(), // RollKeeper-specific buffering
  ],
});
```

#### Deployment Order

1. Deploy plugin-capable sync-server + sync-redis (backward compatible — fog methods still work)
2. Deploy RollKeeper relay with plugin registration
3. Deploy RollKeeper web/client with client-side plugin registration
4. After soak: remove legacy fog methods from sync-server/sync-redis

---

## Phased Migration

> **Restructured:** Phase 0 added (compatibility/design slice). MeasureTool extracted first as canary. Fog extracted last. Server extraction is a parallel workstream deployed before client extraction.

### Phase 0: Compatibility & Design (4-6 weeks)

**Goal:** Lay the groundwork without moving any VTT code.

**Tasks:**

1. Write ADRs for all six open architectural decisions (see [Open Architectural Decisions](#open-architectural-decisions))
2. Create RollKeeper compatibility fixtures — old/new state and protocol matrices
3. Publish `@fieldnotes/vtt` as a **compatibility facade** — re-exports existing VTT APIs from core
4. Migrate RollKeeper imports to `@fieldnotes/vtt` (behavior unchanged, only import paths change)
5. Add constructor-time plugin installation to Viewport (deterministic ordering, idempotent disposal)
6. Complete the audit: templates, export surfaces, React bindings, tool lifecycle, RollKeeper privacy-sensitive ordering

**Deliverables:**

- ADR documents for all six decisions
- `@fieldnotes/vtt` facade package (re-exports from core)
- RollKeeper imports migrated to facade
- Plugin installation API in core
- Completed audit

**Risk:** Low. No behavioral changes. RollKeeper works identically.

**Validation:**

- All RollKeeper tests pass with facade imports
- Plugin installation API works (register a no-op plugin, verify lifecycle)
- Compatibility fixtures pass (old state loads, new state loads, mixed-version sync works)

### Phase 1: Extension Point Interfaces (3-4 weeks)

**Goal:** Add extension point interfaces to core. No code moves yet.

**Tasks:**

1. Implement element-type registry (ADR-1 decision)
2. Implement per-surface render hooks (ADR-2 decision)
3. Implement point constraint service on ToolContext (ADR-6 decision)
4. Implement serialization plugin interface with dual-write (ADR-4 decision)
5. Implement client sync plugin interface
6. Implement server sync plugin interface
7. Implement backend sync plugin interface
8. Enhance overlay registry with z-ordering
9. Add tests for all extension points

**Deliverables:**

- All extension point interfaces in core
- Documentation for extension API
- Tests for each extension point

**Risk:** Low. No breaking changes. Additive only.

**Validation:** Write a test that registers a custom element type, a custom render hook, and a custom sync plugin — verify all work.

### Phase 2: Internal Refactor — VTT Uses Extension Points (3-4 weeks)

**Goal:** Refactor fog, grid, measure, templates to use extension points internally. Keep them in core.

**Tasks:**

1. Refactor fog rendering to use per-surface render hooks
2. Refactor grid snapping to use PointConstraintService (tools call it explicitly)
3. Refactor fog serialization to use SerializationPlugin (dual-write)
4. Refactor fog sync to use client/server/backend sync plugins
5. Register grid and template via element-type registry
6. Update tests to verify extension points work

**Deliverables:**

- VTT features in core use extension points internally
- No public API changes (backward compatible)
- Extension API validated by real usage

**Risk:** Medium. Internal refactoring, but no public API changes.

**Validation:** All existing tests pass. Fog/grid/measure/templates work identically.

### Phase 3: Extract MeasureTool (Canary) (2-3 weeks)

**Goal:** Extract the least-coupled VTT feature to validate the pattern.

**Tasks:**

1. Move measure tool code to `packages/vtt/src/measure/`
2. Move measure rendering to VTT package
3. Move remote measure overlay to VTT package
4. VTT package exports `MeasureTool` (registered via tool system)
5. Remove measure code from core
6. Update RollKeeper to import MeasureTool from `@fieldnotes/vtt`

**Deliverables:**

- MeasureTool lives in `@fieldnotes/vtt`
- Core has no measure-specific code
- RollKeeper uses VTT package for measure

**Risk:** Low. Measure is shallow-coupled (~307 refs, self-contained tool).

**Validation:**

- Core tests pass (no measure code)
- VTT tests pass (measure works)
- RollKeeper measure tool works (distance calculation, shared ruler)

### Phase 4: Extract Grid + Templates (4-6 weeks)

**Goal:** Extract grid and template element types together (they share element-type registry).

**Tasks:**

1. Move grid code to `packages/vtt/src/grid/`
2. Move template code to `packages/vtt/src/template/`
3. VTT package registers 'grid' and 'template' element types via registry
4. Move grid-specific validation, rendering, metrics to VTT package
5. Move template-specific validation, rendering to VTT package
6. Remove grid and template from core's `ELEMENT_TYPES` and validation
7. Update RollKeeper imports

**Deliverables:**

- Grid and template live in `@fieldnotes/vtt`
- Core's CanvasElement union no longer includes grid/template
- RollKeeper uses VTT package for grid and templates

**Risk:** High. Grid is deeply coupled (~1154 refs). Element-type registry must be solid.

**Validation:**

- Core tests pass (no grid/template code)
- VTT tests pass (grid and templates work)
- RollKeeper grid/templates work (hex/square, snapping, AoE)
- Serialization: old state with grid/template elements loads correctly

### Phase 5: Extract Fog (Last) (4-6 weeks)

**Goal:** Extract the most-coupled VTT feature after all extension points are proven.

**Tasks:**

1. Move fog code to `packages/vtt/src/fog/`
2. Move fog sync client plugin to `packages/vtt/src/sync/`
3. Move fog sync server plugin to `packages/vtt/src/sync-server/`
4. Move fog sync backend plugin to `packages/vtt/src/sync-redis/`
5. Remove fog from core (Viewport fields, serialization, sync protocol)
6. Remove fog from sync-server (AuthorizeFog, HubBackend fog methods)
7. Remove fog from sync-redis (Lua scripts, key schemas, validation)
8. Update RollKeeper imports and relay configuration

**Deliverables:**

- Fog lives entirely in `@fieldnotes/vtt`
- Core, sync, sync-server, sync-redis have no fog-specific code
- RollKeeper uses VTT package for fog (client + relay)

**Risk:** High. Fog is the most cross-cutting feature (~508 refs in core, ~459 in sync, ~161 in sync-server, plus sync-redis Lua scripts and RollKeeper relay).

**Validation:**

- All core tests pass (no fog code)
- All VTT tests pass (fog works)
- RollKeeper fog works (initialize, reveal, conceal, sync, export)
- Mixed-version sync: old client + new client in same room
- Persisted state: v3 with legacy fog field loads correctly

### Phase 6: Deploy & Soak (2-4 weeks)

**Goal:** Deploy plugin-capable infrastructure, verify in production, remove legacy code.

**Tasks:**

1. Deploy plugin-capable sync-server + sync-redis
2. Deploy RollKeeper relay with plugin registration
3. Deploy RollKeeper web/client with VTT package
4. Monitor for issues (2-4 week soak period)
5. Remove legacy fog fields from serialization (after soak)
6. Remove legacy fog-meta/fog-patch wire kinds (after soak)
7. Bump to CanvasState v4 (after soak)

**Deliverables:**

- Production deployment with new architecture
- Legacy code removed after verification
- Migration guide for external consumers

**Validation:**

- Zero fog-related incidents during soak
- All RollKeeper production features work
- External consumers (if any) have migration path

### Phase 7: Document Extension API (2-3 weeks)

**Goal:** Document the extension API as the contract for building domain packages.

**Tasks:**

1. Write extension API documentation
2. Write tutorial: how to build a domain package
3. Write examples: custom tool, custom overlay, custom element type
4. Write migration guide for consumers
5. Create template repository for domain packages

**Deliverables:**

- Extension API docs
- Tutorials and examples
- Migration guide
- Template repository

---

## RollKeeper Migration Path

> **Expanded (Finding 6):** The original plan allocated 2-3 weeks for RollKeeper migration. The review identified 318 Field Notes references across 166 files, with 61 files directly mentioning VTT-adjacent symbols. This section documents the full scope.

### Scale of Integration

| Surface            | Files | Key Dependencies                      |
| ------------------ | ----- | ------------------------------------- |
| DM location editor | ~20   | Fog, grid, export                     |
| DM VTT studio      | ~40   | Fog, grid, tools, sync, camera        |
| Player canvas      | ~30   | Fog (player view), grid, tools        |
| TV display         | ~15   | Fog (display mode), camera            |
| Relay server       | ~20   | Fog backend, authorization, buffering |
| Shared utilities   | ~41   | Snap, sync, viewport                  |

### Subtle Ordering Dependencies

These are not visible from import analysis alone:

1. **Store subscription ordering:** RollKeeper marks elements private before sync observes them. Plugin installation order affects when sync plugins see store mutations.
2. **Fog event origins:** `attachFogPersistence.ts` uses fog event origins to prevent persistence loops. The VTT package must preserve this mechanism.
3. **Snapshot/bootstrap ordering:** `battlemapSync.ts` relies on snapshot arriving before first render to avoid displaying an unmasked frame. Fog plugin must install before first render.
4. **Tool registration ordering:** RollKeeper depends on stable first-registered tool instances and mutable refs. Plugin-installed tools must have deterministic registration order.
5. **`viewport.toolContext` for external drag:** `useRosterDrag.ts` reads `viewport.toolContext` for external drag placement. The constraint service must be available on toolContext.
6. **React `snapToGrid` prop:** `FieldNotesCanvas` exposes `snapToGrid` as a reactive prop. After migration, this delegates to the constraint service (not a global rewrite). The React binding must be updated.
7. **Relay-first protocol gate:** RollKeeper's relay deploys independently and gates protocol changes. Server-side plugin extraction must deploy before client-side changes.
8. **Fog persistence loop prevention:** RollKeeper's fog persistence listens to fog change events and writes to the database. It must not re-trigger sync. The VTT package's fog change events must carry origin metadata.

### Migration Strategy: Facade First

**Step 1: Facade package (Phase 0)**

```typescript
// @fieldnotes/vtt (facade — re-exports from core)
export { FogManager, FogTool, MeasureTool, TemplateTool } from '@fieldnotes/core';
export type { FogStateV1, GridElement, TemplateElement } from '@fieldnotes/core';
```

RollKeeper updates imports only. No behavioral change.

**Step 2: Gradual extraction (Phases 3-5)**

As each feature is extracted from core to the VTT package, the facade updates:

```typescript
// @fieldnotes/vtt (after Phase 3 — measure extracted)
export { MeasureTool } from './measure'; // Now from VTT package
export { FogManager, FogTool, TemplateTool } from '@fieldnotes/core'; // Still from core
```

RollKeeper imports don't change again. The facade absorbs the transition.

**Step 3: Direct imports (Phase 6+)**

After soak, RollKeeper can optionally import directly from VTT subpaths:

```typescript
import { MeasureTool } from '@fieldnotes/vtt/measure';
import { FogManager } from '@fieldnotes/vtt/fog';
```

### RollKeeper-Specific Checklist

- [ ] **Phase 0:** Update all imports to `@fieldnotes/vtt` facade
- [ ] **Phase 0:** Verify fog persistence loop prevention works through facade
- [ ] **Phase 0:** Verify snapshot/bootstrap ordering with plugin installation
- [ ] **Phase 0:** Verify store subscription ordering with plugin lifecycle
- [ ] **Phase 0:** Verify `viewport.toolContext` exposes constraint service
- [ ] **Phase 0:** Update React `snapToGrid` prop to delegate to constraint service
- [ ] **Phase 3:** Verify MeasureTool works from VTT package
- [ ] **Phase 3:** Verify shared ruler (remote measure overlay) works
- [ ] **Phase 4:** Verify grid (hex/square, snapping, metrics) works from VTT package
- [ ] **Phase 4:** Verify templates (AoE, grid snapping, render styles) work
- [ ] **Phase 5:** Verify fog (initialize, reveal, conceal, procedural styling) works
- [ ] **Phase 5:** Verify fog sync (DM fog ops, player view, corrections)
- [ ] **Phase 5:** Verify fog export (image, SVG, player-mode fog)
- [ ] **Phase 5:** Verify fog minimap (privacy-aware rendering)
- [ ] **Phase 5:** Update relay to use VTT fog backend plugin
- [ ] **Phase 5:** Verify DM-only fog authorization through plugin
- [ ] **Phase 5:** Verify cost-optimized buffered fog backend still works
- [ ] **Phase 6:** Mixed-version sync test (old client + new client)
- [ ] **Phase 6:** Production soak (2-4 weeks monitoring)

---

## Risk Mitigation

### Performance Risk

**Risk:** Extension points add indirection to hot paths (rendering, input).

**Mitigation:**

- Profile before/after each phase
- Use direct function calls, not event emitters
- Allow batching (e.g., single `afterElements` call, not per-element hooks)
- Benchmark: 10,000 elements, 60fps target

**Acceptance criteria:** No more than 5% performance degradation.

### API Surface Risk

**Risk:** Extension points increase core's API surface, making it harder to learn.

**Mitigation:**

- Clear documentation with progressive disclosure
- Basic API first (Viewport, ElementStore, ToolManager)
- Extension API for advanced use (hooks, plugins)
- Examples and templates

**Acceptance criteria:** A developer can use core without learning extension API.

### Refactor Cost Risk

**Risk:** Significant upfront work to extract VTT features.

**Mitigation:**

- Phased approach (7 phases over 24-34 weeks)
- Each phase is independently valuable
- Start with facade (zero-risk import migration)
- Extract MeasureTool first as canary
- Core remains usable throughout (no "big bang" rewrite)

**Acceptance criteria:** Each phase delivers working software.

### Breaking Changes Risk

**Risk:** External consumers must migrate.

**Mitigation:**

- Facade package absorbs the transition (RollKeeper imports don't change during extraction)
- Dual-write serialization (no version bump until soak complete)
- Wire kind preservation (no protocol break until soak complete)
- Major version bump only after soak (0.68.0 → 1.0.0)
- Migration guide with before/after examples

**Acceptance criteria:** RollKeeper migrates successfully. External consumers have 3+ months to migrate.

### Backward Compatibility Risk

**Risk:** Serialization format change breaks existing persisted state.

**Mitigation:**

- Dual-write on v3 (no version bump during transition)
- Read extension-first, legacy fallback
- Automatic migration only after soak period
- Test migration with real RollKeeper data

**Acceptance criteria:** All existing RollKeeper battlemaps load correctly after migration.

### Server Deployment Risk

**Risk:** Sync-server and sync-redis changes require coordinated deployment.

**Mitigation:**

- Plugin-capable server is backward compatible (fog methods still work)
- RollKeeper relay deploys independently (relay-first protocol gate)
- Deployment order: server → relay → client
- Soak period between each deployment

**Acceptance criteria:** Zero-downtime deployment. No fog sync incidents during transition.

---

## Success Criteria

### Functional Criteria

- [ ] Core has no VTT-specific code (fog, grid, ruler, templates)
- [ ] `@fieldnotes/vtt` package exists and provides all VTT features
- [ ] RollKeeper works with the new architecture (no functionality loss)
- [ ] Extension API is documented with examples
- [ ] A developer can build a custom domain package using extension API
- [ ] Server-side fog extraction is complete (sync-server, sync-redis)

### Performance Criteria

- [ ] 60fps rendering with 10,000 elements (no more than 5% degradation)
- [ ] Sub-100ms sync latency (no change)
- [ ] Bundle size of core is reduced (measure before/after)

### Quality Criteria

- [ ] All core tests pass (no VTT code)
- [ ] All VTT tests pass (all features work)
- [ ] All RollKeeper tests pass
- [ ] No TypeScript errors
- [ ] No lint errors
- [ ] Documentation is complete
- [ ] Mixed-version sync works during transition
- [ ] Persisted state migration works (v3 → v4)

### Ecosystem Criteria

- [ ] Template repository for building domain packages
- [ ] Example: VTT package (reference implementation)
- [ ] Example: diagramming package (future)
- [ ] Community can discover and install domain packages via npm

---

## Appendix: Extension API Reference (Draft)

> **Revised 2026-09-06:** Aligned with fourth ADR review (ADR-0001 through ADR-0006).

### Element-Type Registry

```typescript
// Core's runtime union — includes extension envelope
type CanvasElement =
  | StrokeElement | NoteElement | ArrowElement | ImageElement
  | HtmlElement | TextElement | ShapeElement
  | ExtensionElementEnvelope; // Core-owned extension type

interface ExtensionElementEnvelope extends BaseElement {
  readonly type: 'extension';
  readonly extensionType: string; // 'vtt:grid', 'vtt:template'
  readonly data: Record<string, unknown>;
}

interface ElementTypeDefinition<T extends BaseElement> {
  readonly type: string;
  validate(el: unknown): el is T;
  unwrap(el: ExtensionElementEnvelope): T;
  wrap(el: T): ExtensionElementEnvelope;
  bounds(el: T): Bounds | null;
  hitTest(el: T, point: Point): boolean;
  renderMode: 'canvas' | 'dom' | 'hybrid' | 'none';
  render?(el: T, renderCtx: ElementRenderContext): void;
  interaction?: ElementInteractionAdapter<T>;
  renderPass?: RenderPassDescriptor;
}

viewport.elementTypes.register(definition: ElementTypeDefinition): () => void;
```

### Render Hooks (Per-Surface)

```typescript
type ViewportSlot = 'afterSceneBeforeOverlay' | 'afterOverlay' | 'afterToolOverlay';

interface ViewportHookOptions {
  slot: ViewportSlot;
  priority?: number; // Within slot only
  required?: boolean;
  satisfies?: string[];
}

interface SurfaceRenderHooks {
  beforeElements?(ctx: RenderContext, camera: Camera): void;
  afterElements?(ctx: RenderContext, camera: Camera): void;
  afterAll?(ctx: RenderContext, camera: Camera): void;
}

viewport.renderHooks.viewport.register(hooks: SurfaceRenderHooks, options?: ViewportHookOptions): () => void;
viewport.renderHooks.minimap.register(hooks: SurfaceRenderHooks, options?: ViewportHookOptions): () => void;
viewport.renderHooks.imageExport.register(hooks: SurfaceRenderHooks): () => void;
viewport.renderHooks.svgExport.register(hooks: SurfaceRenderHooks): () => void;
```

### Point Constraint Service

```typescript
// Core provides a domain-neutral constraint service — no VTT concepts
interface PointConstraintService {
  constrainPoint(point: Point, options?: ConstraintOptions): Point;
  getConstraintInfo(): ConstraintInfo | null;
  readonly isActive: boolean;
  setActive(active: boolean): void;
  hasCapability(capability: string): boolean;
}

interface ConstraintOptions {
  mode?: string; // 'cell-center', 'smart', 'footprint'
  footprint?: { width: number; height: number };
}

// Core owns a stable proxy — activation survives service replacement
class ConstraintServiceProxy implements PointConstraintService {
  /* ... */
}

// Available on ToolContext (never undefined once initialized):
ctx.constraintService.constrainPoint(worldPoint, { mode: 'cell-center' });

// Domain-specific access:
viewport.getService<GridConstraintService>('grid');
```

### Serialization Plugins

```typescript
interface SerializationPlugin<T = unknown> {
  readonly key: string;
  serialize(): T;
  deserialize(data: T): void;
  validate(data: unknown): data is T;
}

// Constructor-time installation:
new Viewport({ plugins: [fogSerializationPlugin] });
```

### Sync Plugins (Client)

```typescript
interface ClientSyncPlugin {
  readonly name: string;
  produceOps?(): SyncOp[];
  handleOp?(op: SyncOp, meta: { sender: string; isLocal: boolean; phase: 'live' | 'reconnect' | 'snapshot' }): void;
  registerExtensionKinds?(registry: ClientExtensionRegistry): void;
  extendSnapshot?(snapshot: SyncSnapshot): void;
  applySnapshot?(snapshot: PluginSnapshot, meta: { phase: 'initial' | 'reconnect' | 'offline-replay' }): void;
  validateSnapshot?(data: unknown): boolean;
  migrateSnapshot?(data: unknown, fromVersion: number): unknown;
  handleCorrection?(op: SyncOp): void;
}

syncClient.registerPlugin(plugin: ClientSyncPlugin): () => void;
```

### Sync Plugins (Server)

```typescript
interface ServerSyncPlugin {
  readonly name: string;
  process?(op: SyncOp, ctx: ServerOpContext): Promise<ApplyResult>;
  registerExtensionKinds?(registry: ServerExtensionRegistry): void;
  snapshot?(room: string, backend: HubBackend): Promise<PluginSnapshot>;
  filterSnapshot?(snapshot: PluginSnapshot, viewer: { userId: string; role: string }): PluginSnapshot | null;
}

syncServer.registerPlugin(plugin: ServerSyncPlugin): () => void;
```

### Sync Plugins (Backend/Redis)

```typescript
interface BackendSyncPlugin {
  readonly name: string;
  readonly sharedAcrossInstances: boolean;
  keyPrefix: string;
  scripts?: Record<string, string>;
  snapshot?(room: string): Promise<PluginSnapshot>;
  apply?(room: string, op: SyncOp, next: BackendNext): Promise<ApplyResult>;
  dispose?(): void;
}

redisBackend.registerPlugin(plugin: BackendSyncPlugin): () => void;
```

### PluginSnapshot Envelope

```typescript
interface PluginSnapshot {
  pluginName: string;
  version: number;
  data: unknown;
}

interface SyncSnapshot {
  elements: CanvasElement[];
  layers?: LayerRecord[];
  extensions: Record<string, PluginSnapshot>; // Keyed by pluginName
}
```

### Camera Modifiers (Viewport Constraints Only)

```typescript
interface CameraModifier {
  constrainZoom?(zoom: number, camera: Camera): number;
  constrainPosition?(position: Point, camera: Camera): Point;
}

viewport.camera.registerModifier(modifier: CameraModifier): () => void;
```

### Overlay Registry

```typescript
interface OverlayOptions {
  zOrder: number;
  lifecycle?: 'persistent' | 'linger';
  lingerDuration?: number;
}

viewport.overlays.register(renderer: OverlayRenderer, options: OverlayOptions): () => void;
```

### Service Registry

```typescript
// During plugin start():
ctx.registerService<T>(key: string, service: T): void;

// Typed retrieval:
viewport.getService<T>(key: string): T;

// Plugin state stored at extensions[plugin.name] — one opaque value per plugin
```

---

_This is a living document. Updated 2026-09-06 with fourth ADR review alignment. Update as the migration progresses._
