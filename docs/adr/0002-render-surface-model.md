# ADR-0002: Render Surface Model

- **Status:** Proposed
- **Deciders:** Project maintainer
- **Date:** 2026-09-05
- **Supersedes:** —
- **Related:** [ADR-0001](0001-element-extensibility.md) (element types), [ADR-0005](0005-plugin-lifecycle.md) (plugin lifecycle)

## Context

Fog of war does not render as a simple canvas overlay. It occupies a **dedicated hybrid surface stratum** in the render pipeline:

```
Render order (packages/core/src/canvas/render-loop.ts):
1. Background
2. Camera transform (translate + scale)
3. Layer cache (per-layer offscreen canvases with opacity)
4. Grid cache (separate offscreen canvas for grid elements)
5. Hybrid surface runs (canvas elements interleaved with DOM elements)
6. FOG ← dedicated stratum at fogOrder = visibleElements.length + 1
7. Registered overlays ← at overlayOrder = fogOrder + 1
8. Tool overlay ← activeTool.renderOverlay()
```

Fog renders in **screen/device space** (not world space):

```typescript
const fogCtx = this.hybridSurface.getContext(fogOrder);
fogCtx.scale(dpr, dpr); // No camera transform — screen space
this.fogRenderer.render(fogCtx, this.camera, cssWidth, cssHeight, dpr);
```

Fog also has **separate rendering paths** for other surfaces:

| Surface      | Technology            | Fog mechanism                                                                     | Transform                      |
| ------------ | --------------------- | --------------------------------------------------------------------------------- | ------------------------------ |
| Viewport     | Hybrid canvas stratum | `fogRenderer.render()` at fogOrder                                                | Screen/device space (dpr only) |
| Minimap      | Canvas 2D             | `minimap.setFogRenderer(fogRenderer)` → `renderForExport(ctx, fogState, fogMode)` | Minimap bounds mapping         |
| Image export | OffscreenCanvas       | `withFogDefaults()` merges fog style into export options                          | Export transform               |
| SVG export   | SVG markup string     | `withFogDefaults()` merges fog style into export options                          | Export transform               |

The `HybridRenderSurface` (`hybrid-render-surface.ts`) manages a pool of absolutely-positioned `<canvas>` elements inside a `<div>`, keyed by z-order number. `beginFrame(activeOrders, w, h)` creates/removes canvases to match the active set.

RollKeeper has its own export composition: it exports player-mode fog while composing custom marker HTML painters (`battleMapExport.ts`). The extension contract must support this kind of selective, composable rendering.

### The problem

The original migration plan proposed a single `afterElements(ctx)` callback. This covers only the live viewport canvas and does not preserve:

- Hybrid DOM ordering (fog's stratum position in the paint stack)
- Minimap privacy (player view may hide fog)
- Export behavior (fog style must flow through to image/SVG export)
- RollKeeper's custom export composition

## Decision

**Per-surface hook registration with typed interfaces** (Option A, revised).

Each render surface has its own independent, **typed** hook registry. Extensions register separately for each surface they participate in, and each surface's hooks receive the correct context type for that surface.

### Typed per-surface hook interfaces

Rather than a single generic `SurfaceRenderHooks` interface (which cannot express the different context types each surface provides), each surface defines its own hook shape:

```typescript
// Viewport: canvas 2D context with camera and viewport dimensions
interface ViewportRenderHooks {
  beforeElements?(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    dimensions: { width: number; height: number; dpr: number },
  ): void;
  afterElements?(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    dimensions: { width: number; height: number; dpr: number },
  ): void;
  afterAll?(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    dimensions: { width: number; height: number; dpr: number },
  ): void;
}

// Minimap: canvas 2D context with minimap-specific mapping
interface MinimapRenderHooks {
  afterElements?(ctx: CanvasRenderingContext2D, mapping: MinimapMapping): void;
}

// Image export: OffscreenCanvas context with export options
interface ImageExportHooks {
  afterElements?(ctx: CanvasRenderingContext2D, options: ImageExportOptions): void;
}

// SVG export: string builder (matching actual implementation)
interface SvgExportHooks {
  afterElements?(svg: SvgStringBuilder, options: SvgExportOptions): void;
}

interface RenderHooks {
  viewport: TypedHookRegistry<ViewportRenderHooks>;
  minimap: TypedHookRegistry<MinimapRenderHooks>;
  imageExport: TypedHookRegistry<ImageExportHooks>;
  svgExport: TypedHookRegistry<SvgExportHooks>;
}
```

### Semantic slot ordering (viewport)

Rather than arbitrary numeric `zOrder`, viewport hooks are placed into **typed semantic slots** that correspond to the hybrid surface strata. Priority is scoped within a slot, not global:

```typescript
type ViewportSlot =
  | 'afterSceneBeforeOverlay' // fog goes here
  | 'afterOverlay'
  | 'afterToolOverlay';

// Priority only within a slot, not global z-order
interface ViewportHookOptions {
  slot: ViewportSlot;
  priority?: number; // Default 0. Higher = later within slot.
  required?: boolean; // Privacy-critical hooks
  satisfies?: string[]; // Capabilities this hook satisfies (e.g., ['vtt:fog'])
}
```

The render loop translates slots into hybrid surface stratum positions, preserving the current paint stack ordering.

### Required hooks and fail-closed behavior

The fail-closed mechanism operates at **two enforcement points** — construction time and render time — and on **two layers** within each, ensuring that missing plugins are detected even when no registration carries `required: true`.

#### Two enforcement points

These two enforcement points are complementary, not contradictory:

- **Construction time (see [ADR-0005](0005-plugin-lifecycle.md)).** After ALL plugin phases complete — including Phase 3 (Start) where optional plugins may fail and have their registrations rolled back — the viewport re-checks that all `requiredCapabilities` are satisfied by the remaining registered hooks. If any capability is unsatisfied after all rollbacks, the constructor **throws**. This prevents creating a viewport that cannot render safely.

- **Render time (this ADR).** If a hook marked `required: true` throws during rendering, the surface falls back to masked rendering. This handles runtime failures — e.g., a hook that works during construction but fails during rendering due to state changes, resource exhaustion, or corrupted plugin state.

Construction-time enforcement catches missing or rolled-back plugins before the viewport is usable. Render-time enforcement catches runtime failures that cannot be predicted at construction time.

#### Layer 1: Host-declared required capabilities

The Viewport constructor (or export function) accepts a `requiredCapabilities` declaration:

```typescript
interface ViewportOptions {
  // ... existing options ...
  requiredCapabilities?:
    | string[]
    | {
        viewport?: string[];
        minimap?: string[];
        imageExport?: string[];
        svgExport?: string[];
      };
}
```

When `requiredCapabilities` is an **array**, it applies to ALL surfaces (backward compatible). When it is an **object**, each surface can declare its own capability requirements independently — e.g., the viewport may require `vtt:fog` while the minimap does not.

These are capability identifiers, not plugin names. The host declares what each surface needs to render safely.

#### Layer 2: Hook-level `required` flag

Individual hook registrations can also be marked `required: true`. This is a secondary signal — it means "this specific hook is privacy-critical." If a hook marked `required` throws during rendering, the surface falls back to the masked state.

#### Capability satisfaction

When a hook is registered, it can declare which capabilities it satisfies:

```typescript
interface ViewportHookOptions {
  slot: ViewportSlot;
  priority?: number;
  required?: boolean; // This hook is privacy-critical (throws → mask)
  satisfies?: string[]; // Capabilities this hook satisfies (e.g., ['vtt:fog'])
}
```

**Slot constraint.** `afterElements` hooks are only valid in the `afterSceneBeforeOverlay` and `afterOverlay` slots. The `afterToolOverlay` slot only accepts `afterAll` hooks (tool overlay is the final paint step).

After all plugin phases complete — including Phase 3 (Start) where optional plugins may fail and have their registrations rolled back — the viewport checks that each surface's required capabilities are satisfied by hooks registered on **that** surface. If any surface has unsatisfied requirements, the constructor throws.

| Surface      | Behavior when required capability is unsatisfied (at render time) |
| ------------ | ----------------------------------------------------------------- |
| Viewport     | Renders an opaque mask over the content area                      |
| Minimap      | Renders blank (no map content visible)                            |
| Image export | Throws or returns a masked image                                  |
| SVG export   | Emits an opaque `<rect>` covering the content                     |

Hook exceptions follow the same policy — if a required hook's render function throws, the surface falls back to the masked state, not to unmasked rendering.

This is enforced by the plugin lifecycle (see [ADR-0005](0005-plugin-lifecycle.md)): fog plugins install at construction time with `satisfies: ['vtt:fog']`, before `renderLoop.start()`.

### Viewport surface

Fog registers on the viewport surface in the correct semantic slot:

```typescript
viewport.renderHooks.viewport.register(
  {
    afterElements: (ctx, camera, { width, height, dpr }) => {
      // Fog rendering — receives screen-space context (no world transform)
      fogRenderer.render(ctx, camera, width, height, dpr);
    },
  },
  { slot: 'afterSceneBeforeOverlay', required: true, satisfies: ['vtt:fog'] },
);
```

If the `vtt:fog` capability is not satisfied (e.g., the fog plugin is omitted entirely), the viewport renders an opaque mask instead of unmasked content.

### Minimap surface

Fog registers on the minimap surface with privacy awareness:

```typescript
viewport.renderHooks.minimap.register(
  {
    afterElements: (ctx, mapping) => {
      // Minimap fog — respects view mode (DM sees all, player sees revealed only)
      if (fogRenderer.shouldRenderOnMinimap()) {
        fogRenderer.renderForExport(ctx, fogState, fogMode);
      }
    },
  },
  { required: true, satisfies: ['vtt:fog'] },
);
```

If the `vtt:fog` capability is not satisfied, the minimap renders blank — no map content is visible.

### Export surfaces

Image and SVG export hooks receive the correct context type for each surface:

```typescript
// Image export — receives OffscreenCanvas 2D context + export options
viewport.renderHooks.imageExport.register(
  {
    afterElements: (ctx, options) => {
      fogRenderer.renderForExport(ctx, fogState, fogMode);
    },
  },
  { required: true, satisfies: ['vtt:fog'] },
);

// SVG export — receives string builder + export options
viewport.renderHooks.svgExport.register(
  {
    afterElements: (svg, options) => {
      fogRenderer.renderAsSvg(svg, fogState, fogMode);
    },
  },
  { required: true, satisfies: ['vtt:fog'] },
);
```

If a required export hook is not registered, image export throws (or returns a masked image) and SVG export emits an opaque `<rect>` covering the content area.

Standalone export functions (`exportImage()`, `exportSvg()`) accept the same `RenderHooks` registry — not viewport-only hooks. They also accept `requiredCapabilities`. If a required capability is not satisfied at export time, the export throws or returns a masked result. This solves the "standalone export" problem — the export function doesn't need to know which plugins exist; it checks capabilities.

## Options Considered

### Option A: Per-surface hook registration with typed interfaces (chosen)

Each render surface has its own typed hook registry. Hooks receive the correct context type for their surface (canvas 2D for viewport/minimap, OffscreenCanvas for image export, string builder for SVG export). Privacy-critical hooks can be marked `required`, causing the surface to render an opaque mask if the hook is absent.

**Pros:** Type-safe context parameters prevent runtime errors. Fail-closed behavior protects privacy by default. Semantic slots replace fragile numeric z-ordering.
**Cons:** More registration boilerplate (4 typed registries). Extensions must understand each surface's hook shape.

### Option B: Unified render pass

Extensions declare render passes with a `surface` filter:

```typescript
viewport.renderHooks.register({
  surfaces: ['viewport', 'minimap'],
  afterElements: (ctx, camera) => {
    /* same logic for both */
  },
});
```

**Pros:** Single registration for multiple surfaces. Less boilerplate.
**Cons:** Fog needs _different_ rendering logic for viewport (screen-space hybrid stratum) vs. minimap (bounds-mapped canvas). Conflating them hides real complexity. Export surfaces need different context types (canvas vs. SVG). A unified API forces awkward abstractions.

**Why rejected:** The surfaces are too different. Fog rendering on the viewport (screen-space, hybrid DOM stratum) is fundamentally different from minimap (bounds-mapped, privacy-aware) and SVG export (markup generation). A unified API would either be too restrictive or too leaky.

### Option C: Surface-agnostic callbacks

Extensions provide a single render function; core routes it to the appropriate surfaces automatically:

```typescript
viewport.renderHooks.register({
  render: (ctx, camera) => {
    /* core decides where this goes */
  },
});
```

**Pros:** Simplest API. Extensions don't need to know about surfaces.
**Cons:** Core must guess which surfaces the extension wants. Privacy logic is hidden from the extension. Export composition (RollKeeper's custom markers) can't be expressed.

**Why rejected:** Removes too much control from the extension. Fog needs to opt in to each surface independently because each surface has different privacy and rendering requirements.

## Consequences

### Positive

- **Explicit surface participation:** Extensions declare exactly which surfaces they render on. No ambiguity.
- **Type-safe context parameters:** Each surface's hooks receive the correct context type (`CanvasRenderingContext2D`, `SvgStringBuilder`, etc.). No runtime type mismatches between canvas and SVG contexts.
- **Fail-closed privacy:** Required hooks that are absent or throw cause the surface to render an opaque mask, not unmasked content. Privacy is protected by default, not by convention.
- **Semantic slot ordering:** Viewport hooks use named slots (`afterSceneBeforeOverlay`, `afterOverlay`, `afterToolOverlay`) instead of arbitrary numeric z-order. Priority is scoped within a slot, eliminating ambiguity about dynamic stratum positions.
- **Export composition:** RollKeeper can compose fog with custom markers in export.
- **Clean separation:** Viewport rendering (screen-space, hybrid) is separate from minimap (bounds-mapped) and export (offline).
- **Host-declared capabilities:** The `requiredCapabilities` mechanism ensures that missing plugins are detected even when no registration carries `required: true`. The host declares what it needs; the system enforces it.

### Negative

- **More registration boilerplate:** Extensions must register separately for each surface. A fog extension needs 4 registrations (viewport, minimap, image, SVG).
- **Typed API surface:** 4 typed registries with different hook shapes instead of 1 generic registry. More concepts to learn.
- **Fail-closed strictness:** Missing required plugins cause masked output rather than graceful degradation. This is intentional for privacy but may surprise developers during testing.

### Risks

- The viewport surface's semantic slots must correctly map to hybrid surface strata. Getting this wrong breaks the paint stack (fog renders above/below elements incorrectly).
- RollKeeper's custom export composition may need additional hooks beyond `afterElements` (e.g., `beforeElements` for background markers).
- The `required` flag must be applied consistently to all privacy-critical hooks. A missing `required` flag on a fog hook silently degrades to fail-open behavior.
- Capability identifiers (`vtt:fog`, etc.) become part of the public contract. Renaming a capability identifier is a breaking change for host configurations.

## References

- `packages/core/src/canvas/render-loop.ts` — render order, fog stratum, overlay ordering
- `packages/core/src/canvas/hybrid-render-surface.ts` — HybridRenderSurface, stratum management
- `packages/core/src/canvas/minimap-controller.ts:311-324` — minimap fog rendering
- `packages/core/src/canvas/viewport.ts:612` — `withFogDefaults()` for export
- `packages/core/src/canvas/export-image.ts` — image export pipeline
- `packages/core/src/canvas/export-svg.ts:571` — SVG export `emitElement()` switch
- `MIGRATION_VTT_EXTRACTION.md` §Render Surface Contract

## Review Response

This revision addresses two findings from peer review:

**F1 — "Fail-closed" was defined as fail-open.** The previous version stated that missing fog extensions caused the surface to "render without fog (which may reveal hidden information)" — this is literally fail-open. The revised design introduces a `required` flag on hook registration. When a required hook is absent or throws, the surface renders an opaque mask (viewport), blank content (minimap), throws or returns a masked image (image export), or emits an opaque `<rect>` (SVG export). Privacy is protected by default, not by convention.

**F5 — Render-hook API was internally inconsistent.** The previous version defined a single `SurfaceRenderHooks` interface with `(ctx: RenderContext, camera: Camera)` but then showed different parameter shapes for different surfaces (viewport: `(ctx, camera)`, image export: `(ctx, options)`, SVG export: `(svgDoc, options)`). The revised design replaces the generic interface with typed per-surface hook interfaces: `ViewportRenderHooks`, `MinimapRenderHooks`, `ImageExportHooks`, and `SvgExportHooks`. Each receives the correct context type for its surface. The SVG export hook receives a `SvgStringBuilder` (matching the actual string-based implementation) instead of a non-existent `SVGDocument`. Arbitrary numeric `zOrder` is replaced with typed semantic slots (`ViewportSlot`) scoped to the hybrid surface strata.

**Third review — F1 (Missing "required" hooks cannot be detected):** The `required: true` flag on hook registration only works if the hook is actually registered. If the fog plugin is omitted entirely, no registration carries `required: true`, and the registry cannot detect the gap. Resolved by introducing host-declared `requiredCapabilities` (e.g., `['vtt:fog']`) on the Viewport constructor and export functions. Hooks declare which capabilities they `satisfy`. After plugin installation, the viewport checks that all required capabilities are satisfied; unsatisfied capabilities trigger opaque-mask rendering. This decouples capability requirements from plugin registration — the host declares what it needs, independent of which plugins are provided.

**Fourth review — F4 (The render hook and fail-closed contracts contradict each other):**

1. **Contradictory enforcement points.** ADR-0002 said missing capabilities produce masked surfaces, while ADR-0005 said the constructor throws. These appeared contradictory. Resolved by clarifying that there are two complementary enforcement points: construction time (after all plugin phases complete, the constructor throws if any `requiredCapabilities` are unsatisfied) and render time (if a `required: true` hook throws during rendering, the surface falls back to masked rendering). Construction-time enforcement catches missing or rolled-back plugins; render-time enforcement catches runtime failures.

2. **Post-rollback re-validation.** Capability validation previously occurred after Phase 2 (Construct), but optional plugins may fail during Phase 3 (Start) and have their registrations rolled back — potentially unsatisfying a capability that was valid after Phase 2. Resolved by specifying that the viewport re-checks all `requiredCapabilities` after ALL plugin phases complete, including Phase 3 rollbacks. If any capability is unsatisfied after all rollbacks, the constructor throws.

3. **Surface-qualified requirements.** All surfaces used the same `vtt:fog` identifier without clearly requiring it independently on each surface. Resolved by extending `requiredCapabilities` to accept either an array (applies to all surfaces, backward compatible) or an object with per-surface keys (`viewport`, `minimap`, `imageExport`, `svgExport`). Each surface's capabilities are checked against hooks registered on that surface specifically.

4. **Slot/hook pairing and viewport dimensions.** `afterElements` could be paired with the `afterToolOverlay` slot, which doesn't make semantic sense (tool overlay is the final paint step). Resolved by adding a constraint: `afterElements` hooks are only valid in `afterSceneBeforeOverlay` and `afterOverlay` slots; `afterToolOverlay` only accepts `afterAll` hooks. Additionally, the viewport hook callback now receives a `dimensions` parameter (`{ width, height, dpr }`) instead of just `dpr`, so hooks have access to viewport dimensions without referencing undefined variables.
