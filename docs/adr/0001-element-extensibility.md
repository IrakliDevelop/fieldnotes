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

The `CanvasElement` type becomes generic, parameterized over an optional extension type. Core code uses the closed union (no extensions); consumers that need extensions compose their own union:

```typescript
type CanvasElement<TExtension extends BaseElement = never> =
  | StrokeElement
  | NoteElement
  | ArrowElement
  | ImageElement
  | HtmlElement
  | TextElement
  | ShapeElement
  | TExtension;
```

This preserves TypeScript's discriminated union. A `switch` on `element.type` narrows exhaustively over the known members. Extension types are added by the consumer, not smuggled in through a `type: string` escape hatch. There is no `RegisteredElement` — extensions are concrete, typed interfaces (e.g., `GridElement`, `TemplateElement`) that the consumer unions into `CanvasElement`.

### Type propagation strategy

The generic `CanvasElement<TExtension>` parameter does not propagate through core internals. Instead, we use an erased registry adapter approach:

1. **Core operates on an erased type.** Within `@fieldnotes/core`, all elements are treated as `CanvasElement` (the closed union with `TExtension = never`). Core code never needs to know about extension types — it dispatches through the registry for type-specific behavior. `ElementStore`, `Viewport`, `ToolContext`, history commands, exports, serializers, and `SyncOp` all operate on `CanvasElement` (erased).

2. **The registry uses a safe erased adapter.** `ElementRegistry.getDefinition()` returns `ElementTypeDefinition<BaseElement>` (not `any`). The registry's internal type erasure is safe because:
   - `validate()` uses a type guard (`el is T`) that performs runtime checks
   - All other methods receive elements that have already passed validation
   - The generic parameter `T` on `ElementTypeDefinition<T>` is a compile-time contract for domain packages, not a runtime check

3. **Consumers compose their own typed union.** RollKeeper (or VTT) uses `CanvasElement<GridElement | TemplateElement>` for full type safety at the application boundary. The generic parameter flows through application-level code, not through core internals.

4. **Explicit choice:** We choose the "erased registry adapter" approach. Core operates on `CanvasElement` (no extension parameter). The registry safely erases generics behind runtime validation. Application code (RollKeeper, VTT) uses the full generic for type safety. This avoids propagating `TExtension` through `ElementStore`, `Viewport`, `ToolContext`, history, exports, serializers, and `SyncOp` — all of which operate on `CanvasElement` (erased) and delegate type-specific behavior to the registry.

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

interface ElementTypeDefinition<T extends BaseElement> {
  readonly type: string;

  // Validation & serialization
  validate(el: unknown): el is T;
  serialize?(el: T): unknown;
  deserialize?(data: unknown): T;
  migrate?(el: Record<string, unknown>, fromVersion: number): void;

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

  // Dedicated cache — receives full context including viewport dimensions
  requiresDedicatedCache?: boolean; // Grid needs viewport-sized cache
  renderCache?(el: T, renderCtx: ElementRenderContext): void;
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
- `requiresDedicatedCache` is preserved as a boolean signal to the render loop that this type needs a dedicated cache. The actual cache lifecycle (allocation, invalidation, composition) is managed by the render loop using information from the `ElementRenderContext` passed to `renderCache()`.
- `exportRaster()` and `exportSvg()` receive `store` for cross-element queries needed during export (e.g., hex-template rendering needs the active grid).
- `styling()`, `resizeHandles()`, `movementHandles()` cover interaction overlays.

### Serialization envelope for extension elements

Core elements serialize as today (their type string plus fields). Extension elements serialize with a discriminated envelope:

```json
{
  "type": "extension",
  "extensionType": "vtt:grid",
  ...extensionFields
}
```

The `type: 'extension'` discriminator keeps the top-level union safe. The `extensionType` field is namespaced (e.g., `vtt:grid`, `vtt:template`) to avoid collisions between domain packages. This envelope is introduced at Phase 4 (v4 serialization boundary), coordinated with [ADR-0004](0004-serialization-compatibility.md). During Phases 2–3, extension elements retain their legacy wire shape (`type: 'grid'`, `type: 'template'`). See Backward compatibility below.

### Registry ownership

The registry is a standalone `ElementRegistry` object — not attached to `Viewport`. Validation, geometry, and serialization happen in many places that have no viewport:

- `ElementStore` (`getElementsByType`)
- `parseState()` / `exportState()` (`state-serializer.ts`)
- `exportImage()` / `exportSvg()` (standalone functions)
- `@fieldnotes/sync` protocol parsing (`isValidElement`)
- Server and Redis processes (no viewport exists)

```typescript
class ElementRegistry {
  register<T extends BaseElement>(def: ElementTypeDefinition<T>): () => void;
  validate(type: string, el: unknown): boolean;
  getDefinition(type: string): ElementTypeDefinition<BaseElement> | undefined; // NOT any
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

**Phase 1 — Add the registry and generic model alongside existing types.** The 7 core element types (stroke, note, arrow, image, html, text, shape) remain as closed union members with their existing switch-statement paths. Introduce `ElementRegistry`, `ElementTypeDefinition<T>`, and the generic `CanvasElement<TExtension>`. The registry is additive — it doesn't replace anything yet. No wire format changes.

**Phase 2 — Register grid and template via the registry (internal refactor only).** Internally refactor grid and template so that the actual validation, rendering, and serialization logic is delegated to registered definitions. However, the wire format stays unchanged — grid and template still serialize as `type: 'grid'` and `type: 'template'` (their legacy shape). The `type: 'extension'` envelope is NOT used yet. This phase is an internal refactor only; no external behavior changes.

**Phase 3 — Move definitions to @fieldnotes/vtt.** The `GridElementTypeDefinition` and `TemplateElementTypeDefinition` implementations move to the VTT package. Core's switch statements shrink to 7 cases. VTT code uses `CanvasElement<GridElement | TemplateElement>` for full type safety. Grid and template elements still serialize with their legacy wire format (`type: 'grid'`, `type: 'template'`).

**Phase 4 — Adopt the extension envelope at the v4 boundary.** Coordinated with [ADR-0004 Phase 3](0004-serialization-compatibility.md), extension elements begin using the `type: 'extension'` envelope with namespaced `extensionType`. This only happens when ALL clients support the new format (v4 serialization boundary). After this transition, `'grid'` and `'template'` can be removed from `ELEMENT_TYPES` in core. Core's `CanvasElement` union has 7 members and is fully closed. VTT package registers the types at construction time and uses `CanvasElement<GridElement | TemplateElement>` throughout.

### Backward compatibility

During Phases 2–3, extension elements (grid, template) retain their legacy wire shape (`type: 'grid'`, `type: 'template'`). The `type: 'extension'` envelope is only introduced at Phase 4, coordinated with [ADR-0004](0004-serialization-compatibility.md)'s v4 serialization boundary. This ensures backward compatibility throughout the rollout:

1. **Phases 2–3 (legacy wire format):** Grid and template elements continue to serialize as `type: 'grid'` and `type: 'template'`. Old clients can still read and write these elements. The internal registry refactor is invisible on the wire.
2. **Phase 4 (v4 boundary — extension envelope):** Once all clients support the v4 format, extension elements begin using the `type: 'extension'` envelope with namespaced `extensionType`. `parseState()` detects elements with `type: 'grid'` or `type: 'template'` (the old format) and transparently upgrades them to the `type: 'extension'` envelope before deserialization. The registered definitions handle the actual field validation.
3. **Writing new state (post-v4):** Extension elements are written with the `type: 'extension'` envelope. Once a canvas is saved in the new format, old core versions will not recognize the elements (acceptable — this is a forward migration, gated on all clients supporting v4).
4. **Sync protocol:** `isValidElement()` validates base fields and delegates type-specific validation to the registry. During Phases 2–3, it accepts the legacy `type: 'grid'` and `type: 'template'` formats. At Phase 4, it handles both old and new envelope formats during the transition window.

See [ADR-0004 §Shared rollout state machine](0004-serialization-compatibility.md) for the coordinated rollout timeline across all serialization changes.

## Options Considered

### Option A: Full element-type registry with generic union (chosen)

Core provides a standalone `ElementRegistry` and a generic `CanvasElement<TExtension>` type. Domain packages register element type definitions that cover validation, geometry, rendering (canvas/DOM/hybrid), export (raster/SVG), interaction (styling, handles), and special rendering (dedicated caches). Extension elements retain their legacy wire shape during Phases 2–3 and adopt a `type: 'extension'` discriminated envelope with a namespaced `extensionType` field at Phase 4 (v4 boundary, coordinated with ADR-0004). The registry is passed explicitly to every boundary (Viewport, parseState, exportImage, exportSvg, sync, server/Redis).

**Pros:** Preserves discriminated-union type safety. Core stays closed by default; consumers opt into extensions. Full coverage of grid/template capabilities (null bounds, dedicated cache, DOM routing, export, handles). Testable via explicit registry passing. Backward-compatible rollout — legacy wire format preserved until all clients support v4.
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
- **Type safety preserved:** The generic `CanvasElement<TExtension>` model preserves discriminated-union narrowing. No `RegisteredElement` escape hatch — extensions are concrete typed interfaces.
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

- **F2 — RegisteredElement destroys the discriminated union:** Replaced `RegisteredElement` (with `type: string` and `[key: string]: unknown`) with a generic `CanvasElement<TExtension>` model. Extension types are concrete typed interfaces unioned by the consumer, preserving exhaustive narrowing. Serialization uses a `type: 'extension'` discriminated envelope with namespaced `extensionType`.

- **F3 — Element definition interface is too narrow:** Expanded `ElementTypeDefinition` to cover all capabilities the current codebase requires: null bounds (grid), visual bounds (spatial indexing), `renderMode` (canvas/DOM/hybrid/none), dedicated cache support (grid's viewport-sized DPR-sensitive cache), raster and SVG export, styling, resize/movement handles.

- **F4 — Registry ownership unresolved across standalone APIs:** Replaced `viewport.elementTypes` with a standalone `ElementRegistry` object passed explicitly to every boundary: Viewport, parseState, exportImage, exportSvg, sync, server/Redis. Documented the global-vs-per-instance trade-off and recommended a single shared registry with explicit passing.

### Third review

- **F3 — ADR-0001 and ADR-0004 specify incompatible rollout sequences:** Aligned ADR-0001's phases with ADR-0004's shared rollout state machine. Grid and template retain their legacy wire shape (`type: 'grid'`, `type: 'template'`) through Phases 2–3. The `type: 'extension'` envelope is only introduced at Phase 4, coordinated with ADR-0004 Phase 3 (v4 serialization boundary). Updated the Backward compatibility section to reflect the phased wire format transition. Added cross-references to ADR-0004.

- **F4 — Generic element type is not propagated through the runtime:** Added a "Type propagation strategy" section documenting the erased registry adapter approach. Core operates on `CanvasElement` (erased, `TExtension = never`). `ElementRegistry.getDefinition()` returns `ElementTypeDefinition<BaseElement>` (not `any`) — the type erasure is safe because `validate()` uses a runtime type guard and all other methods receive pre-validated elements. Application code (RollKeeper, VTT) uses the full generic for type safety. This avoids propagating `TExtension` through ElementStore, Viewport, ToolContext, history, exports, serializers, and SyncOp.

- **F5 — ElementTypeDefinition cannot reproduce grid/template behavior:** Introduced `ElementRenderContext` providing `ctx`, `camera`, `store`, `viewport` dimensions, `marginViewport` transform, `dpr`, and `cacheInvalidation` signal to `render()`, `renderDom()`, and `renderCache()`. `exportRaster()` and `exportSvg()` receive `store` for cross-element queries (e.g., template rendering reads the active grid). `requiresDedicatedCache` is preserved as a boolean signal to the render loop; the actual cache lifecycle is managed by the render loop using the render context.
