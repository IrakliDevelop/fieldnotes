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

### Element definition interface

The `ElementTypeDefinition` is generic over the element type it handles, and covers all the capabilities the current codebase requires (grid's null bounds, viewport-sized DPR-sensitive cache, DOM/canvas routing, export, styling, handles):

```typescript
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

  // Rendering
  renderMode: 'canvas' | 'dom' | 'hybrid' | 'none';
  render?(el: T, ctx: CanvasRenderingContext2D, camera: Camera): void;
  renderDom?(el: T, container: HTMLElement): DOMElement;

  // Export
  exportRaster?(el: T, ctx: CanvasRenderingContext2D, options: ExportOptions): void;
  exportSvg?(el: T, store: ElementStore): string;

  // Interaction
  styling?(el: T): ElementStyle;
  resizeHandles?(el: T): ResizeHandle[];
  movementHandles?(el: T): MovementHandle[];

  // Special rendering (grid cache, etc.)
  requiresDedicatedCache?: boolean; // Grid needs viewport-sized cache
  renderCache?(el: T, ctx: CanvasRenderingContext2D, bounds: Bounds, dpr: number): void;
}
```

Key design points:

- `bounds()` returns `Bounds | null` — grid has no finite bounds (`element-bounds.ts:11`: `if (element.type === 'grid') return null`).
- `visualBounds()` is separate from `bounds()` — spatial indexing may need a different extent than layout.
- `renderMode` routes elements to canvas, DOM, hybrid, or no rendering — some elements (grid) need a dedicated viewport-sized DPR-sensitive cache (`render-loop.ts` has `gridCacheCanvas`).
- `renderCache()` supports the dedicated-cache path; `requiresDedicatedCache` signals that the render loop must allocate one.
- `exportRaster()` and `exportSvg()` let each type define its own export implementation.
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

The `type: 'extension'` discriminator keeps the top-level union safe. The `extensionType` field is namespaced (e.g., `vtt:grid`, `vtt:template`) to avoid collisions between domain packages. This changes the serialized shape for extension elements compared to the current format, but the migration handles this (see Backward compatibility below).

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
  getDefinition(type: string): ElementTypeDefinition<any> | undefined;
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

**Phase 1 — Add the registry and generic model alongside existing types.** The 7 core element types (stroke, note, arrow, image, html, text, shape) remain as closed union members with their existing switch-statement paths. Introduce `ElementRegistry`, `ElementTypeDefinition<T>`, and the generic `CanvasElement<TExtension>`. The registry is additive — it doesn't replace anything yet.

**Phase 2 — Register grid and template via the registry.** Internally refactor grid and template to go through the registry path instead of the hardcoded switches. The `ELEMENT_TYPES` array in `state-serializer.ts` still includes `'grid'` and `'template'` for validation, but the actual validation/rendering/serialization logic is delegated to the registered definitions. Extension elements begin serializing with the `type: 'extension'` envelope.

**Phase 3 — Move definitions to @fieldnotes/vtt.** The `GridElementTypeDefinition` and `TemplateElementTypeDefinition` implementations move to the VTT package. Core's switch statements shrink to 7 cases. VTT code uses `CanvasElement<GridElement | TemplateElement>` for full type safety. Grid and template elements serialize with the `type: 'extension'` envelope and namespaced `extensionType`.

**Phase 4 — Remove from core.** After soak, remove `'grid'` and `'template'` from `ELEMENT_TYPES` in core. Core's `CanvasElement` union has 7 members and is fully closed (no extension type parameter used). VTT package registers the types at construction time and uses `CanvasElement<GridElement | TemplateElement>` throughout.

### Backward compatibility

The `type: 'extension'` envelope changes the serialized shape for extension elements. Migration handles this:

1. **Reading old state:** `parseState()` detects elements with `type: 'grid'` or `type: 'template'` (the old format) and transparently upgrades them to the `type: 'extension'` envelope before deserialization. The registered definitions handle the actual field validation.
2. **Writing new state:** Extension elements are always written with the `type: 'extension'` envelope. Once a canvas is saved in the new format, old core versions will not recognize the elements (acceptable — this is a forward migration).
3. **Sync protocol:** `isValidElement()` validates base fields and delegates type-specific validation to the registry. It handles both old and new envelope formats during the migration window.

## Options Considered

### Option A: Full element-type registry with generic union (chosen)

Core provides a standalone `ElementRegistry` and a generic `CanvasElement<TExtension>` type. Domain packages register element type definitions that cover validation, geometry, rendering (canvas/DOM/hybrid), export (raster/SVG), interaction (styling, handles), and special rendering (dedicated caches). Extension elements serialize with a `type: 'extension'` discriminated envelope and a namespaced `extensionType` field. The registry is passed explicitly to every boundary (Viewport, parseState, exportImage, exportSvg, sync, server/Redis).

**Pros:** Preserves discriminated-union type safety. Core stays closed by default; consumers opt into extensions. Full coverage of grid/template capabilities (null bounds, dedicated cache, DOM routing, export, handles). Testable via explicit registry passing.
**Cons:** Significant new API surface. Requires plumbing the registry through every boundary. Serialization format change for extension elements (forward migration needed). The `ElementTypeDefinition` interface is large and must be designed carefully.

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
- **Serialization format change:** Extension elements now serialize with `type: 'extension'` plus namespaced `extensionType`. This is a forward migration — old core versions won't read new format.
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

This revision addresses findings from the second Codex review:

- **F2 — RegisteredElement destroys the discriminated union:** Replaced `RegisteredElement` (with `type: string` and `[key: string]: unknown`) with a generic `CanvasElement<TExtension>` model. Extension types are concrete typed interfaces unioned by the consumer, preserving exhaustive narrowing. Serialization uses a `type: 'extension'` discriminated envelope with namespaced `extensionType`.

- **F3 — Element definition interface is too narrow:** Expanded `ElementTypeDefinition` to cover all capabilities the current codebase requires: null bounds (grid), visual bounds (spatial indexing), `renderMode` (canvas/DOM/hybrid/none), dedicated cache support (grid's viewport-sized DPR-sensitive cache), raster and SVG export, styling, resize/movement handles.

- **F4 — Registry ownership unresolved across standalone APIs:** Replaced `viewport.elementTypes` with a standalone `ElementRegistry` object passed explicitly to every boundary: Viewport, parseState, exportImage, exportSvg, sync, server/Redis. Documented the global-vs-per-instance trade-off and recommended a single shared registry with explicit passing.
