# ADR-0001: Element Extensibility Model

- **Status:** Decided
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

```typescript
interface ElementTypeDefinition {
  readonly type: string;
  validate(el: unknown): boolean;
  bounds(el: CanvasElement): Bounds;
  hitTest(el: CanvasElement, point: Point): boolean;
  render(el: CanvasElement, ctx: CanvasRenderingContext2D, camera: Camera): void;
  serialize?(el: CanvasElement): unknown;
  deserialize?(data: unknown): CanvasElement;
  migrate?(el: Record<string, unknown>, fromVersion: number): void;
}

// Core API:
viewport.elementTypes.register(definition: ElementTypeDefinition): () => void;
```

The `CanvasElement` union gains a `RegisteredElement` escape hatch:

```typescript
type CanvasElement =
  | StrokeElement
  | NoteElement
  | ArrowElement
  | ImageElement
  | HtmlElement
  | TextElement
  | ShapeElement
  | RegisteredElement; // type: string, data: unknown (validated by registered definition)

interface RegisteredElement extends BaseElement {
  type: string;
  [key: string]: unknown; // Domain-specific fields, validated by the registered type
}
```

### Implementation approach

**Phase 1 — Add the registry alongside existing types.** The 7 core element types (stroke, note, arrow, image, html, text, shape) remain as closed union members with their existing switch-statement paths. The registry is additive — it doesn't replace anything yet.

**Phase 2 — Register grid and template via the registry.** Internally refactor grid and template to go through the registry path instead of the hardcoded switches. The `ELEMENT_TYPES` array in `state-serializer.ts` still includes `'grid'` and `'template'` for validation, but the actual validation/rendering/serialization logic is delegated to the registered definitions.

**Phase 3 — Move definitions to @fieldnotes/vtt.** The `GridElementTypeDefinition` and `TemplateElementTypeDefinition` implementations move to the VTT package. Core's switch statements shrink to 7 cases. Grid and template elements serialize as `RegisteredElement` with `type: 'grid'` / `type: 'template'`.

**Phase 4 — Remove from core.** After soak, remove `'grid'` and `'template'` from `ELEMENT_TYPES` in core. Core's `CanvasElement` union has 7 members + `RegisteredElement`. VTT package registers the types at construction time.

### Backward compatibility

Existing persisted state with `type: 'grid'` and `type: 'template'` elements continues to work because:

1. The registry recognizes the type strings `'grid'` and `'template'`
2. The registered definitions handle validation and deserialization
3. The `CanvasState` format doesn't change (elements array still contains these types)

The sync protocol's `isValidElement()` must also handle `RegisteredElement` — it validates base fields and delegates type-specific validation to the registry.

## Options Considered

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
- **Backward compatible:** Existing state and sync protocols continue to work.

### Negative

- **Upfront cost:** The registry is a significant new API surface in core. Must be designed carefully.
- **Type safety tradeoff:** `RegisteredElement` is less type-safe than the closed union. Domain packages must provide their own type guards.
- **Performance:** Registry lookup adds indirection to rendering and validation hot paths. Must be implemented with direct function calls, not event emitters.
- **Sync complexity:** The sync protocol's element validation must accommodate registered types. The compile-time exhaustiveness check becomes a runtime check for registered types.
- **Migration complexity:** 4-phase migration instead of a simple move. Each phase must be validated independently.

### Risks

- The registry API becomes the most critical contract in the system. If it's wrong, every domain package is affected.
- Existing consumers that pattern-match on `element.type` string literals will break when grid/template become `RegisteredElement`. RollKeeper likely has such code.

## References

- `packages/core/src/elements/types.ts` — CanvasElement union, GridElement, TemplateElement
- `packages/core/src/elements/element-renderer.ts:103` — renderCanvasElement switch
- `packages/core/src/elements/element-factory.ts` — createGrid, createTemplate
- `packages/core/src/core/state-serializer.ts` — validateTypeFields, ELEMENT_TYPES
- `packages/sync/src/protocol.ts` — isValidElement exhaustiveness check
- `packages/core/src/canvas/render-loop.ts:423,436,585` — inline grid type guards
- `MIGRATION_VTT_EXTRACTION.md` §Element-Type Registry
