# ADR-0001: Element Extensibility Model

- **Status:** Proposed
- **Deciders:** Project maintainer
- **Date:** 2026-09-05
- **Supersedes:** —
- **Related:** [ADR-0002](0002-render-surface-model.md) (render surface), [ADR-0004](0004-serialization-compatibility.md) (serialization)

## Context

`CanvasElement` is a closed, exhaustive union of 9 types:

```typescript
// packages/core/src/elements/types.ts
export type CanvasElement =
  | StrokeElement
  | NoteElement
  | ArrowElement
  | ImageElement
  | HtmlElement
  | TextElement
  | ShapeElement
  | GridElement // VTT-specific
  | TemplateElement; // VTT-specific
```

`GridElement` carries VTT-specific fields: `gridType`, `hexOrientation`, `cellSize`. `TemplateElement` carries: `templateShape`, `feetPerCell`, `radiusFeet`, `renderStyle`.

The migration plan promises "zero VTT code in core." But grid and template are first-class element types with deep integration:

- **5 exhaustive switch statements** across core: `element-renderer.ts` (rendering), `element-style.ts` (styling, 2 switches), `export-svg.ts` (SVG export), `export-image.ts` (image export bounds)
- **Serializer validation**: `state-serializer.ts` `validateTypeFields()` has a 9-case switch
- **Sync validation**: `protocol.ts` `isValidElement()` has a 9-case switch with compile-time exhaustiveness check
- **Factory**: `element-factory.ts` has `createGrid()` and `createTemplate()`
- **Render loop**: `render-loop.ts` has inline `element.type === 'grid'` checks at lines 423, 436, 585
- **Grid controller**: `grid-controller.ts` uses `store.getElementsByType('grid')` extensively

Adding a new element type today requires touching all 5 switches, the factory, the sync validator, the serializer, and the render loop. This is a closed architecture — domain packages cannot add element types without modifying core.

The migration plan needs grid and template to leave core. Without an extensibility mechanism, they cannot.

## Decision

**Option A: Full element-type registry** (chosen).

Core provides a generic registration API. Domain packages register their own element types with their own validation, bounds, hit-testing, rendering, and serialization logic.

### Generic element model

Core's `CanvasElement` union includes a core-owned `ExtensionElementEnvelope` that allows extension elements to flow through core in a type-erased form:

```typescript
// Core's runtime union — includes extension envelope for type-erased flow
type CanvasElement =
  | StrokeElement
  | NoteElement
  | ArrowElement
  | ImageElement
  | HtmlElement
  | TextElement
  | ShapeElement
  | ExtensionElementEnvelope; // Core-owned extension type

// Core-owned envelope that allows extension elements to flow through core
interface ExtensionElementEnvelope extends BaseElement {
  readonly type: 'extension';
  readonly extensionType: string; // Namespaced: 'vtt:grid', 'vtt:template'
  // Extension-specific fields stored as opaque data
  readonly data: Record<string, unknown>;
}
```

This preserves TypeScript's discriminated union. A `switch` on `element.type` narrows exhaustively over the known members. Extension types are wrapped in the core-owned `ExtensionElementEnvelope`, not added directly to the union. Application code (RollKeeper, VTT) uses the registry's typed guards and `unwrap()` to narrow from `ExtensionElementEnvelope` to specific extension types:

```typescript
// Application-level typed access via ElementTypeKey<T>
const gridKey = registry.getKey<GridElement>('vtt:grid');
if (gridKey?.validate(element.data)) {
  const grid = gridKey.unwrap(element); // GridElement (typed)
  // Later, wrap back to envelope:
  const envelope = gridKey.wrap(grid); // ExtensionElementEnvelope
}
```

### Type propagation strategy

The registry uses a two-level design to solve the variance problem: `ElementTypeDefinition<T>` has methods that consume `T` (contravariant, e.g., `wrap(el: T)`, `bounds(el: T)`) and methods that produce `T` (covariant, e.g., `unwrap()`), making the interface invariant in `T`. This means `ElementTypeDefinition<GridElement>` cannot be subsumed to `ElementTypeDefinition<BaseElement>`. The solution is to separate the typed consumer-facing handle from the internal erased adapter.

1. **Core operates on `ExtensionElementEnvelope` via `ElementTypeAdapter` (erased).** The `CanvasElement` union includes `ExtensionElementEnvelope` as a core-owned type. `ElementStore`, `Viewport`, `ToolContext`, history commands, exports, serializers, and `SyncOp` all operate on this union. Core code never sees extension-specific types — only the envelope with its opaque `data: Record<string, unknown>`. The registry stores each definition as a non-generic `ElementTypeAdapter` that operates exclusively on `ExtensionElementEnvelope`.

2. **Consumers use `ElementTypeKey<T>` for typed access (unwrap/wrap/validateData).** `ElementTypeKey<T>` is a typed registration handle returned to consumers by `register()`. It preserves the type parameter `T` so that `unwrap()` returns `T`, `wrap()` accepts `T`, and `validate()` checks the envelope's `data` field. The key is a thin wrapper around the definition that provides type-safe access at the application boundary.

3. **The registry wraps each `ElementTypeDefinition<T>` in an erased `ElementTypeAdapter` at registration time.** The adapter converts envelope↔typed at the boundary: `validateEnvelope(el)` checks `el.extensionType === def.type && def.validateData(el.data)`, `bounds(el)` calls `def.bounds(def.unwrap(el))`, etc. This erasure is safe because the adapter only operates on envelopes and delegates to the typed definition internally.

### Element definition interface

The `ElementTypeDefinition` is generic over the element type it handles, and covers all the capabilities the current codebase requires (grid's null bounds, viewport-sized DPR-sensitive cache, DOM/canvas routing, export, styling, handles):

```typescript
// Render context provided by the render loop
interface ElementRenderContext {
  ctx: CanvasRenderingContext2D;
  camera: Camera;
  store: ElementStore; // Read access for cross-element queries (e.g., template reads grid)
  viewport: { width: number; height: number }; // CSS pixel dimensions
  marginViewport?: MarginViewportTransform; // For cache composition offsets
  dpr: number;
  cacheInvalidation?: CacheInvalidationSignal; // When dedicated cache needs rebuild
}

interface ElementInteractionAdapter<T extends BaseElement = BaseElement> {
  // Handle hit-testing — which handle (if any) is at this point?
  hitTestHandle?(el: T, point: Point): ResizeHandle | MovementHandle | null;
  // Cursor for this element at a given point (e.g., 'move', 'nwse-resize', null)
  cursor?(el: T, point: Point): string | null;
  // Drag update — called during drag operations, returns updated element
  dragUpdate?(el: T, delta: Point, ctx: DragContext): Partial<T>;
  // Style-to-patch — convert style changes to element field patches
  styleToPatch?(el: T, style: Partial<ElementStyle>): Partial<T>;
  // Rotation behavior — rotate element around a center point
  rotate?(el: T, angle: number, center: Point): T;
}

interface RenderPassDescriptor {
  cacheIdentity: string; // Unique cache identifier (e.g., 'grid-cache', 'template-cache')
  stratum: number; // Render stratum position in the paint stack
  invalidationDependencies?: string[]; // Other cache identities this depends on
  compositionMode?: 'normal' | 'multiply' | 'screen' | 'overlay';
}

interface ElementTypeDefinition<T extends BaseElement> {
  readonly type: string;

  // Validation & serialization
  validateData(data: Record<string, unknown>): boolean; // Validates envelope.data contents
  serialize?(el: T): unknown;
  deserialize?(data: unknown): T;
  migrate?(el: Record<string, unknown>, fromVersion: number): void;

  // Envelope conversion — convert between typed extension and core-owned envelope
  unwrap(el: ExtensionElementEnvelope): T; // Convert envelope to typed element
  wrap(el: T): ExtensionElementEnvelope; // Convert typed element to envelope

  // Geometry
  bounds(el: T): Bounds | null; // null = no finite bounds (e.g., grid)
  visualBounds?(el: T): Bounds | null; // for spatial indexing, may differ from bounds
  hitTest(el: T, point: Point): boolean;

  // Rendering — receives full context
  renderMode: 'canvas' | 'dom' | 'hybrid' | 'none';
  render?(el: T, renderCtx: ElementRenderContext): void;
  renderDom?(el: T, container: HTMLElement, renderCtx: ElementRenderContext): DOMElement;

  // Export — receives store for cross-element queries
  exportRaster?(
    el: T,
    ctx: CanvasRenderingContext2D,
    options: ExportOptions & { store: ElementStore },
  ): void;
  exportSvg?(el: T, store: ElementStore): string;

  // Interaction
  styling?(el: T): ElementStyle;
  resizeHandles?(el: T): ResizeHandle[];
  movementHandles?(el: T): MovementHandle[];

  // Interaction adapter — covers SelectTool's template-specific modes and mutations
  interaction?: ElementInteractionAdapter<T>;

  // Dedicated cache — receives full context including viewport dimensions
  requiresDedicatedCache?: boolean; // When true, MUST also provide a renderPass descriptor
  renderCache?(el: T, renderCtx: ElementRenderContext): void;

  // Render pass — declares cache lifecycle for dedicated-cache elements
  renderPass?: RenderPassDescriptor;
}
```

Key design points:

- `bounds()` returns `Bounds | null` — grid has no finite bounds (`element-bounds.ts:11`: `if (element.type === 'grid') return null`).
- `visualBounds()` is separate from `bounds()` — spatial indexing may need a different extent than layout.
- `renderMode` routes elements to canvas, DOM, hybrid, or no rendering — some elements (grid) need a dedicated viewport-sized DPR-sensitive cache (`render-loop.ts` has `gridCacheCanvas`).
- `ElementRenderContext` replaces the problem of composing individual parameters for `render()`, `renderDom()`, `renderCache()`, and export methods. The render context provides all the information needed for grid's viewport-sized DPR-sensitive cache, template's store-dependent rendering, and any future extension type's rendering needs. Specifically:
  - `store` gives read access for cross-element queries (template rendering reads the active grid).
  - `viewport` provides CSS pixel dimensions needed for viewport-sized cache allocation.
  - `marginViewport` provides the transform needed for cache composition offsets.
  - `cacheInvalidation` signals when a dedicated cache needs rebuild.
  - `dpr` provides device pixel ratio for DPR-sensitive rendering.
- `requiresDedicatedCache`: When `true`, the element type MUST also provide a `renderPass` descriptor declaring cache identity, stratum, invalidation dependencies, and composition mode. The render loop uses the `renderPass` descriptor to manage the cache lifecycle.
- `renderPass` declares the cache identity, render stratum position in the paint stack, invalidation dependencies (other cache identities this depends on), and composition mode. This gives the render loop all the information needed to manage dedicated caches without hard-coded knowledge of specific element types.
- `unwrap()` and `wrap()` convert between `ExtensionElementEnvelope` (core's type-erased form) and the typed extension type `T`. Domain packages call `wrap()` when creating elements and `unwrap()` when accessing extension data from the envelope.
- `interaction` covers the behaviors that SelectTool currently implements with template-specific code (select-tool.ts:286): handle hit-testing, cursor changes, drag updates, style-to-patch conversion, and rotation. When grid and template move to the VTT package, their interaction adapters move with them.
- `exportRaster()` and `exportSvg()` receive `store` for cross-element queries needed during export (e.g., hex-template rendering needs the active grid).
- `styling()`, `resizeHandles()`, `movementHandles()` cover interaction overlays.

### Serialization envelope for extension elements

Core elements serialize as today (their type string plus fields). Extension elements serialize with a discriminated envelope using a `data` field for extension-specific fields:

```json
{
  "type": "extension",
  "extensionType": "vtt:grid",
  "data": { "gridType": "hex", "hexOrientation": "pointy", "cellSize": 50 }
}
```

The `type: 'extension'` discriminator keeps the top-level union safe. The `extensionType` field is namespaced (e.g., `vtt:grid`, `vtt:template`) to avoid collisions between domain packages. The `data` field contains all extension-specific fields — this matches the in-memory `ExtensionElementEnvelope` exactly. This envelope is introduced at Phase 4 (v4 serialization boundary), coordinated with [ADR-0004](0004-serialization-compatibility.md). During Phases 2–3, extension elements retain their legacy wire shape (`type: 'grid'`, `type: 'template'`). At Phase 4, legacy elements are converted by collecting all extension-specific fields into a `data` object. `parseState()` reads the legacy format, collects extension fields into `data`, and creates `ExtensionElementEnvelope`. `serializeState()` writes the envelope as-is (no conversion needed at Phase 4). See Backward compatibility below.

### In-memory vs. serialized representation

The in-memory representation (what lives in `ElementStore`) and the serialized representation (what goes on the wire) differ during Phases 2–3. This section defines where each representation lives and where lossless conversion occurs.

1. **In-memory representation (ElementStore):** Extension elements are stored as `ExtensionElementEnvelope` in `ElementStore`. The envelope has `type: 'extension'`, `extensionType: string`, and `data: Record<string, unknown>`. This is the canonical in-memory form.

2. **Conversion boundary:** The registry's `wrap()` and `unwrap()` methods convert between typed extension types (e.g., `GridElement`) and `ExtensionElementEnvelope`. Domain packages call `wrap()` when creating elements and `unwrap()` when accessing extension data.

3. **Serialized representation (wire format):** The serialized format uses the same `data` field as the in-memory format — both use `ExtensionElementEnvelope` with `data: Record<string, unknown>`. During Phases 2–3, extension elements retain their legacy wire shape (`type: 'grid'`, `type: 'template'`). The serializer converts between legacy wire format and envelope: `parseState()` reads legacy fields into `data` via `wrap()`, `serializeState()` extracts from `data` via `unwrap()` then serializes in legacy format. At Phase 4 (v4 boundary), extension elements use the `type: 'extension'` envelope on the wire too.

4. **Phase 2–3 detail:** During Phases 2–3, grid and template elements are stored in `ElementStore` as `ExtensionElementEnvelope` (in-memory, with `data` field), but serialize with their legacy wire shape. The serializer handles the conversion: `serializeState()` calls `registry.getAdapter()` to get the erased adapter, calls `unwrap()` to get the typed element, then serializes using the legacy format. `parseState()` reads the legacy format, collects extension-specific fields into a `data` object, and calls `wrap()` to create the envelope.

5. **Phase 4 detail:** At Phase 4, wire format matches in-memory format — both use `ExtensionElementEnvelope` with `data` field. No conversion needed. `parseState()` reads the envelope as-is. `serializeState()` writes the envelope as-is.

| Phase | In-memory (ElementStore)                      | Wire format (serialized)                      |
| ----- | --------------------------------------------- | --------------------------------------------- |
| 1     | Legacy (`type: 'grid'`)                       | Legacy (`type: 'grid'`)                       |
| 2-3   | Envelope (`type: 'extension'`, `data: {...}`) | Legacy (`type: 'grid'`)                       |
| 4     | Envelope (`type: 'extension'`, `data: {...}`) | Envelope (`type: 'extension'`, `data: {...}`) |

### Registry ownership

The registry is a standalone `ElementRegistry` object — not attached to `Viewport`. Validation, geometry, and serialization happen in many places that have no viewport:

- `ElementStore` (`getElementsByType`)
- `parseState()` / `exportState()` (`state-serializer.ts`)
- `exportImage()` / `exportSvg()` (standalone functions)
- `@fieldnotes/sync` protocol parsing (`isValidElement`)
- Server and Redis processes (no viewport exists)

```typescript
// Typed handle returned to consumers — preserves T
interface ElementTypeKey<T extends BaseElement> {
  readonly type: string;
  validate(data: Record<string, unknown>): boolean; // Validates envelope.data contents
  unwrap(el: ExtensionElementEnvelope): T;
  wrap(el: T): ExtensionElementEnvelope;
}

// Internal erased adapter — non-generic, used by core
interface ElementTypeAdapter {
  readonly type: string;
  validateEnvelope(el: ExtensionElementEnvelope): boolean;
  bounds(el: ExtensionElementEnvelope): Bounds | null;
  hitTest(el: ExtensionElementEnvelope, point: Point): boolean;
  renderMode: 'canvas' | 'dom' | 'hybrid' | 'none';
  render?(el: ExtensionElementEnvelope, ctx: ElementRenderContext): void;
  // ... all other methods operate on ExtensionElementEnvelope
}

class ElementRegistry {
  register<T extends BaseElement>(def: ElementTypeDefinition<T>): ElementTypeKey<T>;
  unregister(key: ElementTypeKey<unknown>): void;
  validate(type: string, el: ExtensionElementEnvelope): boolean;
  getAdapter(type: string): ElementTypeAdapter | undefined; // Internal use — erased
  getKey<T>(type: string): ElementTypeKey<T> | undefined; // Consumer use — typed
  getTypes(): string[];
}
```

The registry is created once and passed explicitly to every boundary:

- `new Viewport({ ..., elementRegistry })`
- `parseState(json, elementRegistry)`
- `exportImage(elements, ..., elementRegistry)`
- `exportSvg(elements, ..., elementRegistry)`
- Sync: `isValidElement(el, elementRegistry)`
- Server/Redis: receive registry at construction

**Trade-offs:** A global singleton registry is simpler (no plumbing) but harder to test and prevents multiple independent configurations. A per-instance registry is isolatable and testable but requires explicit passing through every API boundary. We recommend a single shared registry with explicit passing — the plumbing cost is small and one-time, and the testability and clarity benefits are significant.

### Implementation approach

These phases are aligned with [ADR-0004](0004-serialization-compatibility.md)'s shared rollout state machine. The key constraint: grid and template retain their legacy wire shape (`type: 'grid'`, `type: 'template'`) until the v4 serialization boundary, even if they internally use the registry earlier.

**Phase 1 — Add the registry and envelope model alongside existing types.** The 7 core element types (stroke, note, arrow, image, html, text, shape) remain as closed union members with their existing switch-statement paths. Introduce `ElementRegistry`, `ElementTypeDefinition<T>`, and the `ExtensionElementEnvelope` as a new member of the `CanvasElement` union. The registry is additive — it doesn't replace anything yet. No wire format changes.

**Phase 2 — Register grid and template via the registry (internal refactor only).** Internally refactor grid and template so that the actual validation, rendering, and serialization logic is delegated to registered definitions. The `ExtensionElementEnvelope` IS used in-memory (in `ElementStore`) starting from this phase. However, the wire format stays unchanged — grid and template still serialize as `type: 'grid'` and `type: 'template'` (their legacy shape). The `type: 'extension'` envelope is NOT used on the wire yet. This phase is an internal refactor only; no external behavior changes.

**Phase 3 — Move definitions to @fieldnotes/vtt.** The `GridElementTypeDefinition` and `TemplateElementTypeDefinition` implementations move to the VTT package. Core's switch statements shrink to 7 cases. VTT code uses the registry's `unwrap()` for typed access to extension elements. Grid and template elements still serialize with their legacy wire format (`type: 'grid'`, `type: 'template'`).

**Phase 4 — Adopt the extension envelope at the v4 boundary.** Coordinated with [ADR-0004 Phase 4](0004-serialization-compatibility.md), extension elements begin using the `type: 'extension'` envelope with namespaced `extensionType`. This only happens when ALL clients support the new format (v4 serialization boundary). After this transition, `'grid'` and `'template'` can be removed from `ELEMENT_TYPES` in core. Core's `CanvasElement` union has 8 members (7 core types + `ExtensionElementEnvelope`) and is fully closed. VTT package registers the types at construction time and uses the registry's `unwrap()` for typed access throughout.

### Backward compatibility

During Phases 2–3, extension elements (grid, template) retain their legacy wire shape (`type: 'grid'`, `type: 'template'`). The `type: 'extension'` envelope is only introduced at Phase 4, coordinated with [ADR-0004](0004-serialization-compatibility.md)'s v4 serialization boundary. This ensures backward compatibility throughout the rollout:

1. **Phases 2–3 (legacy wire format):** Grid and template elements continue to serialize as `type: 'grid'` and `type: 'template'`. Old clients can still read and write these elements. The internal registry refactor is invisible on the wire.
2. **Phase 4 (v4 boundary — extension envelope):** Once all clients support the v4 format, extension elements begin using the `type: 'extension'` envelope with namespaced `extensionType` and extension-specific fields collected into a `data` object. `parseState()` detects elements with `type: 'grid'` or `type: 'template'` (the old format) and transparently upgrades them to the `type: 'extension'` envelope by collecting all extension-specific fields into `data`. The registered definitions handle the actual field validation via `validateData()`.
3. **Writing new state (post-v4):** Extension elements are written with the `type: 'extension'` envelope. Once a canvas is saved in the new format, old core versions will not recognize the elements (acceptable — this is a forward migration, gated on all clients supporting v4).
4. **Sync protocol:** `isValidElement()` validates base fields and delegates type-specific validation to the registry. During Phases 2–3, it accepts the legacy `type: 'grid'` and `type: 'template'` formats. At Phase 4, it handles both old and new envelope formats during the transition window.

See [ADR-0004 §Shared rollout state machine](0004-serialization-compatibility.md) for the coordinated rollout timeline across all serialization changes.

## Options Considered

### Option A: Full element-type registry with extension envelope (chosen)

Core provides a standalone `ElementRegistry` and a `CanvasElement` union that includes a core-owned `ExtensionElementEnvelope`. Domain packages register element type definitions that cover validation, geometry, rendering (canvas/DOM/hybrid), export (raster/SVG), interaction (styling, handles, interaction adapter), special rendering (dedicated caches with render pass descriptors), and envelope conversion (`wrap()`/`unwrap()`). Extension elements retain their legacy wire shape during Phases 2–3 and adopt a `type: 'extension'` discriminated envelope with a namespaced `extensionType` field at Phase 4 (v4 boundary, coordinated with ADR-0004). The registry is passed explicitly to every boundary (Viewport, parseState, exportImage, exportSvg, sync, server/Redis).

**Pros:** Preserves discriminated-union type safety. Core stays closed by default; extension elements flow through as `ExtensionElementEnvelope`. Full coverage of grid/template capabilities (null bounds, dedicated cache, DOM routing, export, handles, interaction adapter, render pass). Testable via explicit registry passing. Backward-compatible rollout — legacy wire format preserved until all clients support v4.
**Cons:** Significant new API surface. Requires plumbing the registry through every boundary. Serialization format change for extension elements deferred to v4 boundary (forward migration needed at Phase 4). The `ElementTypeDefinition` interface is large and must be designed carefully.

### Option B: Generic primitives

Reclassify grid and template as "intentionally generic" core primitives (like `shape` or `html`). They stay in the `CanvasElement` union. Their VTT-specific _behavior_ (snapping, AoE calculations) moves to the VTT package, but the element types themselves remain in core.

**Pros:** Minimal core changes. No registry needed. Low risk.
**Cons:** Core still knows about grid and template types. Not truly domain-agnostic. The VTT-specific fields (`feetPerCell`, `hexOrientation`) remain in core's validation. Only half-measure toward core purity.

**Why rejected:** Violates the core-purity goal. If we accept grid/template as "generic," we must also accept any future domain's element types as generic — the principle doesn't hold.

### Option C: Metadata escape hatch

Add a generic `metadata?: Record<string, unknown>` field to `BaseElement`. Move VTT-specific fields from `GridElement` and `TemplateElement` into metadata. Core validates only base fields; domain packages validate their own metadata.

**Pros:** Incremental. Reduces VTT surface area without a full registry. Core element types remain but with fewer domain-specific fields.
**Cons:** Still a closed union. Adding new domain element types still requires modifying core. Metadata is untyped at the core level (loses type safety).

**Why rejected:** A stepping stone, not a destination. Useful as a Phase 1 incremental step if the full registry is too costly upfront, but doesn't achieve the long-term goal.

## Consequences

### Positive

- **True core purity:** Domain packages can define their own element types without modifying core.
- **Extensibility:** Any consumer can add custom element types (not just VTT — diagramming, mind-mapping, etc.).
- **Clean separation:** Each domain owns its validation, rendering, and serialization.
- **Type safety preserved:** The `ExtensionElementEnvelope` model preserves discriminated-union narrowing in core. Application code uses the registry's `unwrap()` for typed access to extension data. No `RegisteredElement` escape hatch — extensions are concrete typed interfaces accessed through the envelope.
- **Full capability coverage:** The expanded `ElementTypeDefinition` covers all current grid/template needs: null bounds, dedicated caches, DOM/canvas routing, export, styling, handles.
- **Testable:** Explicit registry passing means tests can construct isolated registries without global state.

### Negative

- **Upfront cost:** The registry and expanded `ElementTypeDefinition` are a significant new API surface in core. Must be designed carefully.
- **Serialization format change (deferred to v4):** Extension elements retain their legacy wire shape through Phases 2–3. At Phase 4 (v4 boundary), they adopt `type: 'extension'` plus namespaced `extensionType`. This is a forward migration — old core versions won't read new format — but it is gated on all clients supporting v4.
- **Plumbing cost:** The registry must be passed to Viewport, parseState, exportImage, exportSvg, sync, and server/Redis. One-time cost but touches many call sites.
- **Performance:** Registry lookup adds indirection to rendering and validation hot paths. Must be implemented with direct function calls, not event emitters.
- **Sync complexity:** The sync protocol's element validation must accommodate registered types. The compile-time exhaustiveness check becomes a runtime check for registered types.
- **Migration complexity:** 4-phase migration instead of a simple move. Each phase must be validated independently.

### Risks

- The registry API and `ElementTypeDefinition` interface become the most critical contracts in the system. If they're wrong, every domain package is affected.
- Existing consumers that pattern-match on `element.type` string literals will need updating when grid/template move to extension elements. RollKeeper likely has such code.
- The `ElementTypeDefinition` interface is large. Getting the capability set right (renderMode, dedicated cache, export, handles) is essential — missing a capability means domain packages can't express their needs.

## References

- `packages/core/src/elements/types.ts` — CanvasElement union, GridElement, TemplateElement
- `packages/core/src/elements/element-renderer.ts:103` — renderCanvasElement switch
- `packages/core/src/elements/element-factory.ts` — createGrid, createTemplate
- `packages/core/src/core/state-serializer.ts` — validateTypeFields, ELEMENT_TYPES
- `packages/sync/src/protocol.ts` — isValidElement exhaustiveness check
- `packages/core/src/canvas/render-loop.ts:423,436,585` — inline grid type guards
- `MIGRATION_VTT_EXTRACTION.md` §Element-Type Registry

## Review Response

### Second review

- **F2 — RegisteredElement destroys the discriminated union:** Replaced `RegisteredElement` (with `type: string` and `[key: string]: unknown`) with a typed model. Extension types are concrete typed interfaces, preserving exhaustive narrowing. Serialization uses a `type: 'extension'` discriminated envelope with namespaced `extensionType`. (Superseded by fourth review F1 — now uses `ExtensionElementEnvelope` instead of generic parameter.)

- **F3 — Element definition interface is too narrow:** Expanded `ElementTypeDefinition` to cover all capabilities the current codebase requires: null bounds (grid), visual bounds (spatial indexing), `renderMode` (canvas/DOM/hybrid/none), dedicated cache support (grid's viewport-sized DPR-sensitive cache), raster and SVG export, styling, resize/movement handles.

- **F4 — Registry ownership unresolved across standalone APIs:** Replaced `viewport.elementTypes` with a standalone `ElementRegistry` object passed explicitly to every boundary: Viewport, parseState, exportImage, exportSvg, sync, server/Redis. Documented the global-vs-per-instance trade-off and recommended a single shared registry with explicit passing.

### Third review

- **F3 — ADR-0001 and ADR-0004 specify incompatible rollout sequences:** Aligned ADR-0001's phases with ADR-0004's shared rollout state machine. Grid and template retain their legacy wire shape (`type: 'grid'`, `type: 'template'`) through Phases 2–3. The `type: 'extension'` envelope is only introduced at Phase 4, coordinated with ADR-0004 Phase 4 (v4 serialization boundary). Updated the Backward compatibility section to reflect the phased wire format transition. Added cross-references to ADR-0004.

- **F4 — Generic element type is not propagated through the runtime:** Added a "Type propagation strategy" section documenting the erased registry adapter approach. Core operates on `CanvasElement` (erased). `ElementRegistry.getDefinition()` returns `ElementTypeDefinition<BaseElement>` (not `any`) — the type erasure is safe because `validate()` uses a runtime type guard and all other methods receive pre-validated elements. Application code (RollKeeper, VTT) uses the registry's `unwrap()` for typed access. (Superseded by fourth review F1 — generic parameter removed entirely; replaced by `ExtensionElementEnvelope` in the union.)

- **F5 — ElementTypeDefinition cannot reproduce grid/template behavior:** Introduced `ElementRenderContext` providing `ctx`, `camera`, `store`, `viewport` dimensions, `marginViewport` transform, `dpr`, and `cacheInvalidation` signal to `render()`, `renderDom()`, and `renderCache()`. `exportRaster()` and `exportSvg()` receive `store` for cross-element queries (e.g., template rendering reads the active grid). `requiresDedicatedCache` is preserved as a boolean signal to the render loop; the actual cache lifecycle is managed by the render loop using the render context.

### Fourth review

- **F1 — The erased element model cannot pass extension elements through core:** Replaced the generic `CanvasElement<TExtension>` with a core-owned `ExtensionElementEnvelope` included directly in the `CanvasElement` runtime union. Core's `ElementStore`, history, exports, and sync operate on `CanvasElement` which includes the envelope — extension elements flow through core without core seeing extension-specific types. The generic parameter is removed entirely. Application code uses the registry's `unwrap()`/`wrap()` methods to convert between `ExtensionElementEnvelope` and typed extension types. `ElementTypeDefinition<T>` gains `unwrap()` and `wrap()` methods for this conversion. Updated the "Generic element model", "Type propagation strategy", and all phase descriptions to reflect the envelope-based model.

- **F2 — In-memory and serialized extension representations are unresolved:** Added a new "In-memory vs. serialized representation" section that explicitly defines: (1) extension elements are stored as `ExtensionElementEnvelope` in `ElementStore` (canonical in-memory form), (2) the registry's `wrap()`/`unwrap()` are the conversion boundary between typed extensions and envelopes, (3) during Phases 2–3 the wire format retains legacy shapes while in-memory uses envelopes, (4) at Phase 4 the wire format matches in-memory. Added a summary table showing the representation at each phase.

- **F3 — ElementTypeDefinition does not cover template interaction or grid render-pass behavior:** Added `ElementInteractionAdapter<T>` interface covering handle hit-testing, cursor, drag/update, style-to-patch, and rotation — the behaviors SelectTool currently implements with template-specific code (select-tool.ts:286). Added `RenderPassDescriptor` interface covering cache identity, render stratum, invalidation dependencies, and composition mode. Added both as optional fields on `ElementTypeDefinition`. Updated `requiresDedicatedCache` description to require a `renderPass` descriptor when `true`.

### Fifth review — F1, F2, F3 (partial)

- **F1 (Type safety):** Replaced `getDefinition(): ElementTypeDefinition<BaseElement>` with two-level design: `ElementTypeKey<T>` (typed handle for consumers) and `ElementTypeAdapter` (erased adapter for core internals). `register()` returns `ElementTypeKey<T>`. Core uses `getAdapter()` for rendering/bounds/hit-testing (all operate on `ExtensionElementEnvelope`). Consumers use `getKey()` for typed unwrap/wrap/validateData. `ElementTypeDefinition<T>.validate()` renamed to `validateData()` — it validates the envelope's `data` field, not the envelope itself.

- **F2 (Two envelope schemas):** Chose `data` field as canonical for both in-memory and serialized formats. The serialized JSON now uses `{ type: 'extension', extensionType: 'vtt:grid', data: { ... } }` — matching the in-memory envelope. Phase 4 requires no conversion because wire and memory are identical. Phase 2-3 serializer converts between legacy wire format and envelope by collecting/scattering extension fields into/from `data`.

- **F3 (Phase references):** Updated cross-references from "ADR-0004 Phase 3" to "ADR-0004 Phase 4" to match the unified 4-phase rollout state machine.
