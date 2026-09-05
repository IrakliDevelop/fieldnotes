# ADR-0002: Render Surface Model

- **Status:** Decided
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

**Per-surface hook registration** (Option A).

Each render surface has its own independent hook registry. Extensions register separately for each surface they participate in.

```typescript
interface SurfaceRenderHooks {
  beforeElements?(ctx: RenderContext, camera: Camera): void;
  afterElements?(ctx: RenderContext, camera: Camera): void;
  afterAll?(ctx: RenderContext, camera: Camera): void;
}

interface SurfaceHookRegistry {
  register(hooks: SurfaceRenderHooks, options?: { zOrder?: number }): () => void;
}

// Each surface is independently extensible:
interface RenderHooks {
  viewport: SurfaceHookRegistry;
  minimap: SurfaceHookRegistry;
  imageExport: SurfaceHookRegistry;
  svgExport: SurfaceHookRegistry;
}
```

### Viewport surface

Fog registers on the viewport surface with a specific z-order that maps to its hybrid surface stratum position:

```typescript
viewport.renderHooks.viewport.register(
  {
    afterElements: (ctx, camera) => {
      // Fog rendering — receives screen-space context (no world transform)
      fogRenderer.render(ctx, camera, width, height, dpr);
    },
  },
  { zOrder: FOG_Z_ORDER },
); // Maps to fogOrder in hybrid surface
```

The render loop translates `zOrder` into hybrid surface stratum positions, preserving the current paint stack ordering.

### Minimap surface

Fog registers on the minimap surface with privacy awareness:

```typescript
viewport.renderHooks.minimap.register(
  {
    afterElements: (ctx, camera) => {
      // Minimap fog — respects view mode (DM sees all, player sees revealed only)
      if (fogRenderer.shouldRenderOnMinimap()) {
        fogRenderer.renderForExport(ctx, fogState, fogMode);
      }
    },
  },
  { zOrder: 100 },
);
```

The `shouldRenderOnMinimap()` check allows the VTT package to implement privacy logic (e.g., player view hides fog on minimap).

### Export surfaces

Image and SVG export hooks receive the appropriate context type:

```typescript
// Image export — receives OffscreenCanvas context
viewport.renderHooks.imageExport.register({
  afterElements: (ctx, options) => {
    fogRenderer.renderForExport(ctx, fogState, fogMode);
  },
});

// SVG export — receives SVG document
viewport.renderHooks.svgExport.register({
  afterElements: (svgDoc, options) => {
    fogRenderer.renderAsSvg(svgDoc, fogState, fogMode);
  },
});
```

### Fail-closed behavior

Extensions that are privacy-critical (fog masking) default to **fail-closed**: if the extension is not registered, the surface renders without fog (which may reveal hidden information). The extension must be installed before the first render to prevent unmasked frames.

This is enforced by the plugin lifecycle (see [ADR-0005](0005-plugin-lifecycle.md)): fog plugins install at construction time, before `renderLoop.start()`.

## Options Considered

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
- **Privacy-aware:** Each surface can implement its own privacy logic (minimap hides fog for players).
- **Export composition:** RollKeeper can compose fog with custom markers in export.
- **Clean separation:** Viewport rendering (screen-space, hybrid) is separate from minimap (bounds-mapped) and export (offline).

### Negative

- **More registration boilerplate:** Extensions must register separately for each surface. A fog extension needs 4 registrations (viewport, minimap, image, SVG).
- **API surface:** 4 registries instead of 1. More concepts to learn.
- **Z-ordering complexity:** Each surface has its own z-order space. Extensions must understand the paint stack for each surface.

### Risks

- The viewport surface's z-order must correctly map to hybrid surface strata. Getting this wrong breaks the paint stack (fog renders above/below elements incorrectly).
- Export hooks must receive the correct context type. A canvas hook receiving an SVG context (or vice versa) causes runtime errors.
- RollKeeper's custom export composition may need additional hooks beyond `afterElements` (e.g., `beforeElements` for background markers).

## References

- `packages/core/src/canvas/render-loop.ts` — render order, fog stratum, overlay ordering
- `packages/core/src/canvas/hybrid-render-surface.ts` — HybridRenderSurface, stratum management
- `packages/core/src/canvas/minimap-controller.ts:311-324` — minimap fog rendering
- `packages/core/src/canvas/viewport.ts:612` — `withFogDefaults()` for export
- `packages/core/src/canvas/export-image.ts` — image export pipeline
- `packages/core/src/canvas/export-svg.ts:571` — SVG export `emitElement()` switch
- `MIGRATION_VTT_EXTRACTION.md` §Render Surface Contract
