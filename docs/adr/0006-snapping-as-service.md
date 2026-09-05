# ADR-0006: Snapping as Opt-In Service

- **Status:** Proposed
- **Deciders:** Project maintainer
- **Date:** 2026-09-05
- **Supersedes:** —
- **Related:** [ADR-0001](0001-element-extensibility.md) (element types), [ADR-0005](0005-plugin-lifecycle.md) (plugin lifecycle)

## Context

Grid snapping is currently a **scattered concern** across the codebase. Each tool independently decides whether and how to snap:

### Core snap functions

`packages/core/src/core/snap.ts` exports pure, stateless functions:

| Function              | Signature                                | Behavior                                                            |
| --------------------- | ---------------------------------------- | ------------------------------------------------------------------- |
| `snapPoint`           | `(point, gridSize) → Point`              | Rounds to nearest grid intersection                                 |
| `snapToHexCenter`     | `(point, cellSize, orientation) → Point` | Snaps to hex cell center                                            |
| `smartSnap`           | `(point, ctx) → Point`                   | Identity if `!snapToGrid`; hex center if hex; `snapPoint` otherwise |
| `snapToCellCenter`    | `(point, gridSize, footprint) → Point`   | Snaps so footprint fills whole cells                                |
| `snapFootprintCenter` | `(point, footprint, ctx) → Point`        | `smartSnap` for centers with footprint                              |
| `footprintFromSize`   | `(size, gridSize) → Footprint`           | Computes N×N cell footprint from element size                       |

### How core tools use snapping

Tools that call `smartSnap` directly:

- `shape-tool.ts:183` — `return smartSnap(point, ctx);`
- `select-tool.ts:139` — `return smartSnap(point, ctx);`
- `note-tool.ts:64` — `world = smartSnap(world, ctx);`
- `text-tool.ts:62` — `world = smartSnap(world, ctx);`
- `image-tool.ts:35` — `const snapped = smartSnap(world, ctx);`
- `arrow-tool.ts:79,99` — `this.start = smartSnap(world, ctx);` / `this.end = smartSnap(world, ctx);`

Tools with their own private snap method:

- `template-tool.ts:349` — private `snapToGrid()` checks `ctx.snapToGrid`, delegates to `snapPoint`
- `measure-tool.ts:146` — private `snapToGrid()` same pattern

Tools using `snapFootprintCenter`:

- `select-tool.ts:648` — for resize operations
- `select-resize.ts` — three snap branches (lines 173, 196, 218) gated on `opts.snapToGrid && opts.gridSize`

### ToolContext snap configuration

```typescript
// packages/core/src/tools/types.ts
export interface ToolContext {
  snapToGrid?: boolean;
  gridSize?: number;
  gridType?: 'square' | 'hex';
  hexOrientation?: HexOrientation;
  // ...
}
```

All four are optional. Set by the viewport constructor (`snapToGrid: false`, `gridSize` from options). `GridController.syncContext()` dynamically updates `gridType` and `hexOrientation` when grid elements change in the store.

### RollKeeper tools: mixed snapping strategies

RollKeeper deliberately mixes snapped and unsnapped tools within the same session:

**DmMarkerTool** — explicitly does NOT snap:

```typescript
// ~/Projects/RollKeeper/src/components/ui/campaign/location-map/DmMarkerTool.ts
// "No grid snapping: markers are annotations pinned to where the DM clicked,
//  not tokens that need to align to a cell. Do not 'fix' this to snap."
// Uses exact downWorld position. No snap call.
```

**SpellTemplateTool** — uses `smartSnap`:

```typescript
// ~/Projects/RollKeeper/src/components/ui/campaign/player-vtt/SpellTemplateTool.ts
import { createTemplate, smartSnap } from '@fieldnotes/core';
const origin = smartSnap(world, ctx);
```

**DmTokenTool** — uses footprint-centered snapping:

```typescript
// ~/Projects/RollKeeper/src/components/ui/campaign/dm-vtt/combatantToken.ts
// Tokens snap to cell centers based on their footprint size (e.g., 2×2 creature
// snaps so it fills 4 cells exactly). Uses snapToCellCenter with footprint.
```

**MovementPathTool** — unsnapped pan/select with world-coordinate aiming:

```typescript
// Uses screen-to-world conversion but no grid snapping.
// Path waypoints are at exact world coordinates.
```

### The problem

The original migration plan proposed global `InputHooks` that rewrite `PointerState` coordinates before tools see them:

```typescript
// REJECTED — original design
interface InputHooks {
  beforePointerDown?(state: PointerState, ctx: ToolContext): PointerState | void;
}
// Hook returns modified PointerState with snapped coordinates.
// All tools receive snapped coordinates when snapping is active.
```

This breaks RollKeeper's mixed-snapping tools. If `PointerState` is globally snapped:

- DmMarkerTool receives snapped coordinates (but wants raw world coordinates)
- MovementPathTool receives snapped coordinates (but wants exact world coordinates)
- Screen-pixel drag thresholds break (snapping modifies world coordinates, not screen coordinates)
- A single gesture that needs both snapped (token placement) and unsnapped (marker drop) coordinates cannot work

## Decision

**Domain-neutral point-constraint service on ToolContext** (Option B, revised).

Core exposes a generic point-constraint service slot. Tools call it when they want coordinate constraining. Different tools can use different constraint strategies in the same gesture. The core interface carries zero VTT concepts — grid, hex, cell-center, and footprint types live in `@fieldnotes/vtt`.

```typescript
// Core provides a generic service slot — no VTT concepts
interface ToolContext {
  // ... existing fields ...
  constraintService: ConstraintServiceAccess; // Public proxy — includes activation
}

// Public interface — exposed on ToolContext and Viewport
// Includes activation control (proxy-owned)
interface ConstraintServiceAccess {
  readonly isActive: boolean;
  setActive(active: boolean): void;
  constrainPoint(point: Point, options?: ConstraintOptions): Point;
  getConstraintInfo(): ConstraintInfo | null;
  hasCapability(capability: string): boolean;
}

// Implementation interface — NO activation control
// Implementations provide constraint logic only
interface PointConstraintService {
  // Generic point constraint — no grid/hex/cell concepts
  constrainPoint(point: Point, options?: ConstraintOptions): Point;
  // Get info about the current constraint (opaque to core)
  getConstraintInfo(): ConstraintInfo | null;

  // Capability query — string-based, no unsafe generics
  hasCapability(capability: string): boolean;
}

interface ConstraintOptions {
  mode?: string; // e.g., 'cell-center', 'smart', 'footprint'
  footprint?: { width: number; height: number }; // Domain-neutral shape
  overrides?: Record<string, unknown>;
}

interface ConstraintInfo {
  type: string; // Domain-specific type identifier (e.g., 'grid', 'hex')
  // Domain-specific fields as opaque data
  [key: string]: unknown;
}
```

`@fieldnotes/vtt` provides the typed grid implementation:

```typescript
// @fieldnotes/vtt provides the typed grid service
class GridConstraintService implements PointConstraintService {
  // No _active field — activation is the proxy's concern

  constrainPoint(point: Point, options?: ConstraintOptions): Point {
    // Always ready to constrain when called
    // The proxy gates calls — this is only called when active
    // Interprets options.mode and options.footprint using grid-specific logic
    // (smartSnap, snapToCellCenter, etc.)
  }
  getConstraintInfo(): GridConstraintInfo {
    return { type: 'grid', gridType: this.gridType, cellSize: this.cellSize, ... };
  }

  hasCapability(capability: string): boolean {
    // e.g., 'grid:cell-center', 'grid:smart-snap'
  }

  // Domain-specific methods available via typed service registry (ADR-0005):
  // viewport.getService(GridControllerKey) // ServiceKey<GridController>
  snapToCellCenter(point: Point, footprint: Footprint): Point { ... }
}
```

### Tool migration

Each tool migrates from scattered snap calls to explicit service calls:

```typescript
// Before (VTT-specific import from core):
import { smartSnap } from '@fieldnotes/core';
const snapped = smartSnap(world, ctx);

// After (domain-neutral via constraint service):
// The proxy is always present — tools call it directly:
const snapped = ctx.constraintService.constrainPoint(world);
// If proxy is inactive (setSnapToGrid(false)) or has no implementation,
// constrainPoint returns world unchanged.
```

```typescript
// Before (private method):
private snapToGrid(point: Point, ctx: ToolContext): Point {
  if (ctx.snapToGrid && ctx.gridSize) return snapPoint(point, ctx.gridSize);
  return point;
}

// After (explicit service via stable proxy):
const snapped = ctx.constraintService.constrainPoint(point);
```

Tools that need grid-specific behavior (e.g., cell-center snapping with a footprint) express their placement intent through domain-neutral `ConstraintOptions`. The `GridConstraintService` implementation interprets these options using its grid-specific logic. No cast needed. No VTT import in core. The service is the abstraction boundary.

```typescript
// Core tools use domain-neutral options — no cast, no VTT import:
const snapped = ctx.constraintService.constrainPoint(world, {
  mode: 'cell-center',
  footprint: { width: 2, height: 2 },
});

// The GridConstraintService interprets these options using its grid-specific logic.
```

For cases where a tool genuinely needs grid-specific behavior that can't be expressed through `ConstraintOptions`, tools should use the service registry (ADR-0005) to obtain the typed implementation directly, rather than using an unsafe generic query on the constraint service:

```typescript
// Before (unsafe — prohibited):
const snapped = ctx.constraintService
  ?.getCapability<GridSnapCapability>('grid:cell-center')!
  .snapToCellCenter(world, footprint);

// After (safe — use service registry):
const gridService = viewport.getService(GridControllerKey); // ServiceKey<GridController>
const snapped = gridService?.snapToCellCenter(world, footprint) ?? world;
```

Tools that need domain-specific constraint behavior (e.g., template resizing that recalculates `radiusFeet`) should use the service registry (`viewport.getService(GridControllerKey)` — `ServiceKey<GridController>`) to obtain the typed implementation directly, rather than using an unsafe generic query on the constraint service.

Tools that don't snap (DmMarkerTool, MovementPathTool) simply don't call the service. No change needed.

### Explicit opt-out for inactive service

The stable proxy is always present on `ToolContext` once initialized, but it may have no implementation (no grid plugin installed). When the proxy has no implementation, or when the proxy is inactive, `constrainPoint()` returns the point unchanged. The proxy's `isActive` getter is the single source of truth for whether constraining is active — implementations have no activation state of their own. Tools that **require** constraining should check the proxy's `isActive` and warn if it is not active:

```typescript
// Instead of silent fallback:
const snapped = ctx.constraintService.constrainPoint(world);

// Require explicit handling for tools that need constraining:
// ConstraintServiceAccess — isActive is part of the public interface
if (!ctx.constraintService.isActive) {
  // Proxy is inactive — isActive is solely the proxy's concern
  // Log warning in development, throw in tests
  if (process.env.NODE_ENV === 'development') {
    console.warn(`Tool ${toolName} requires constraintService but it is not active`);
  }
}
const snapped = ctx.constraintService.constrainPoint(world);
```

Better: tools that require constraining declare it in their registration, and the tool manager warns if the constraint service proxy is not active when the tool is active.

### RollKeeper tool compatibility

| Tool                  | Current behavior                        | After migration                                                                   |
| --------------------- | --------------------------------------- | --------------------------------------------------------------------------------- |
| DmMarkerTool          | No snap (explicit comment)              | No snap — doesn't call constraintService                                          |
| SpellTemplateTool     | `smartSnap(world, ctx)`                 | `ctx.constraintService.constrainPoint(world)`                                     |
| DmTokenTool           | `snapToCellCenter(world, footprint)`    | `ctx.constraintService.constrainPoint(world, { mode: 'cell-center', footprint })` |
| MovementPathTool      | No snap                                 | No snap — doesn't call constraintService                                          |
| SelectTool (resize)   | `snapFootprintCenter(...)`              | `ctx.constraintService.constrainPoint(point, { mode: 'cell-center', footprint })` |
| TemplateTool (resize) | Private `snapToGrid()` for radius/width | Uses interaction adapter (ADR-0001) — not constraint service (see below)          |

**Note on template resizing:** Template resizing involves snapping scalar values (radius, width) and recalculating derived fields (e.g., `radiusFeet`). This is not reducible to `constrainPoint()` — it requires domain-specific logic that understands template geometry. This logic belongs in the template element type's interaction adapter (see [ADR-0001](0001-element-extensibility.md), `ElementInteractionAdapter.dragUpdate()`). The interaction adapter receives the element, drag delta, and context, and returns the updated element. Template-specific snapping and recalculation happens inside the adapter, not in the constraint service.

```typescript
// Template resizing — NOT handled by constraint service
// This logic lives in the template's interaction adapter (ADR-0001):
// TemplateElementTypeDefinition.interaction.dragUpdate(el, delta, ctx)
// The adapter handles snapping radius/width and recalculating radiusFeet.
```

### ConstraintService ownership

The `ConstraintServiceProxy` slot on `ToolContext` is a stable proxy owned by core that implements `ConstraintServiceAccess` (the public interface). The grid plugin provides the implementation via `_setImpl()`, which accepts a `PointConstraintService` (the implementation interface). Activation is solely the proxy's concern — the proxy owns activation state (`_active`) and gates calls. Implementations are stateless with respect to activation: they constrain points when asked, and the proxy decides when to ask.

The two-interface design separates concerns: `ConstraintServiceAccess` is the public API exposed to tools and the viewport — it includes activation control (`isActive`, `setActive`). `PointConstraintService` is the implementation interface provided by domain packages — it has no activation state. The `ConstraintServiceProxy` implements `ConstraintServiceAccess` publicly and delegates to a `PointConstraintService` implementation internally. This prevents implementations from silently bypassing the global snap toggle.

Core provides a `ConstraintServiceProxy` that delegates to the current implementation. The proxy is always present on `ToolContext` once the constraint service system is initialized — it is never `undefined`. This ensures that activation state (the snap-to-grid toggle) survives service replacement when grids are added, removed, or changed. Since implementations have no activation state, `_setImpl()` simply swaps the implementation — no activation forwarding is needed.

```typescript
// Core provides a stable proxy — implements ConstraintServiceAccess (public)
// Delegates constraint logic to PointConstraintService (implementation)
class ConstraintServiceProxy implements ConstraintServiceAccess {
  private _impl: PointConstraintService | null = null;
  private _active = false;

  // Proxy's public API — includes activation control
  get isActive(): boolean {
    return this._active;
  }

  setActive(active: boolean): void {
    this._active = active;
    // No forwarding to implementation — activation is proxy-only
  }

  constrainPoint(point: Point, options?: ConstraintOptions): Point {
    if (!this._active || !this._impl) return point;
    return this._impl.constrainPoint(point, options);
  }

  _setImpl(impl: PointConstraintService | null): void {
    this._impl = impl;
    // No activation forwarding — implementations don't have activation state
  }

  getConstraintInfo(): ConstraintInfo | null {
    return this._impl?.getConstraintInfo() ?? null;
  }

  hasCapability(capability: string): boolean {
    return this._impl?.hasCapability(capability) ?? false;
  }
}
```

When the grid plugin replaces the service implementation, the proxy's `_setImpl()` method simply swaps the implementation — no activation forwarding is needed because implementations have no activation state. The proxy continues to gate calls based on its own `_active` state. This prevents the bug where `_setImpl()` only forwarded `true` and the implementation could remain active after `setSnapToGrid(false)`.

`GridController.syncContext()` becomes the grid plugin's responsibility.

### Preserving existing APIs

#### `Viewport.setSnapToGrid(enabled: boolean)`

This public API toggles snapping on/off. It remains in core as a simple boolean toggle. The method does **not** take grid parameters — those come from the constraint service itself.

`Viewport.setSnapToGrid()` delegates to the constraint service proxy's `setActive()` method:

```typescript
setSnapToGrid(enabled: boolean): void {
  this._snapToGrid = enabled;
  this.constraintService.setActive(enabled); // ConstraintServiceAccess — has setActive
}
```

The proxy's `setActive()` method gives core explicit control over whether constraining is active. When `setSnapToGrid(false)` is called, the proxy deactivates — tools that call `constrainPoint()` while the proxy is inactive get back the original point unchanged (the proxy checks `_active` before delegating to the implementation). Activation is solely the proxy's concern — implementations are always ready to constrain when called, and have no activation state of their own. This preserves the existing toggle behavior without requiring tools to check `isActive` themselves.

#### React `snapToGrid` prop

The reactive prop at `packages/react/src/field-notes-canvas.tsx:104` continues to call `viewport.setSnapToGrid(snapToGrid)`. No change needed for this prop.

### Backward compatibility

During the transition:

- `smartSnap`, `snapPoint`, etc. remain exported from `@fieldnotes/core`
- `GridController.syncContext()` continues to work as before
- The `ConstraintServiceProxy` is added to ToolContext (always present once initialized)
- VTT plugin installs the `GridConstraintService` via `proxy._setImpl()`

After extraction:

- Snap functions move to `@fieldnotes/vtt`
- Core only has the `constraintService` proxy
- Tools use `ctx.constraintService.constrainPoint()` or import from `@fieldnotes/vtt`

## Options Considered

### Option A: Global input hook (rejected)

`InputHooks.beforePointerDown` rewrites `PointerState` coordinates before tools see them. All tools receive snapped coordinates when snapping is active.

**Pros:** Simple for tools — they always receive snapped coordinates. No tool changes needed.
**Cons:** Breaks tools that need unsnapped coordinates (DmMarkerTool, MovementPathTool). Breaks screen-pixel drag thresholds. Cannot mix snapped and unsnapped in the same gesture. Fundamentally incompatible with RollKeeper's tool design.

**Why rejected:** RollKeeper deliberately mixes snapped and unsnapped tools. Global rewriting destroys the distinction. The review (Finding 5) specifically called this out as a breaking change.

### Option C: Per-tool snap configuration

Each tool declares its snap behavior in its registration:

```typescript
toolManager.register({
  name: 'token',
  snapMode: 'cell-center', // Tool declares snap behavior
  // ...
});
```

The tool system applies snapping based on the declaration.

**Pros:** Declarative. Tool system manages snap behavior centrally.
**Cons:** Inflexible. Some tools need different snap modes for different phases (e.g., select tool: snap for placement, no snap for free-form selection). The snap mode may depend on runtime state (shift key, modifier keys). A static declaration can't express this.

**Why rejected:** Too rigid. Tools need runtime control over snapping (e.g., snap only when shift is held, or snap to different targets based on the current operation). An explicit service call gives tools full control.

### Option B (original): VTT-specific SnapService (superseded)

The original Option B proposed a `SnapService` with VTT-specific methods like `snapToCellCenter`, `getGridInfo`, and types like `'square' | 'hex'` directly on `ToolContext` in `@fieldnotes/core`.

**Why superseded:** This embedded VTT concepts (grid, hex, cell-center, footprint) into core's `ToolContext`, contradicting the zero-VTT-core objective. The revised Option B replaces it with a domain-neutral `PointConstraintService` that carries no VTT concepts. VTT-specific behavior lives in `@fieldnotes/vtt`'s `GridConstraintService` implementation.

## Consequences

### Positive

- **Tool autonomy:** Each tool decides independently whether and how to constrain coordinates.
- **Mixed strategies:** Different tools can use different constraint modes in the same gesture.
- **RollKeeper compatible:** DmMarkerTool stays unsnapped. SpellTemplateTool snaps. No conflicts.
- **Testable:** `PointConstraintService` is a pure service that can be tested independently of tools.
- **Zero VTT in core:** Core's `constraintService` slot is domain-neutral. Grid, hex, cell-center, and footprint concepts live entirely in `@fieldnotes/vtt`.
- **No unsafe casts or generics:** Tools express placement intent through domain-neutral `ConstraintOptions`. The service implementation interprets options using domain-specific logic. Core tools never import VTT types. Domain-specific access uses the typed service registry (ADR-0005), not unsafe generic queries.
- **Stable activation state:** The `ConstraintServiceProxy` ensures the snap toggle survives service replacement. `setSnapToGrid(true)` called before the grid service is ready is preserved when the service becomes available.
- **Existing APIs preserved:** `Viewport.setSnapToGrid()` and the React `snapToGrid` prop continue to work unchanged.

### Negative

- **Tool migration:** Every tool that currently calls `smartSnap` must be updated to use `ctx.constraintService`. ~8 core tools + RollKeeper tools.
- **Proxy indirection:** The stable proxy adds a layer of indirection. Tools call the proxy, which delegates to the current implementation. Debugging requires understanding the proxy→impl chain.
- **API change:** `smartSnap(point, ctx)` becomes `ctx.constraintService.constrainPoint(point)`. Different signature. RollKeeper's `import { smartSnap } from '@fieldnotes/core'` breaks after extraction.
- **Grid state access:** `GridConstraintService` needs access to grid state (grid size, type, orientation). It reads from the store, which adds a dependency.
- **Template resizing not covered:** Template resizing (snapping scalar radius/width and recalculating `radiusFeet`) cannot be expressed through `constrainPoint()`. This logic must live in the template element type's interaction adapter (ADR-0001), adding complexity to the migration path.

### Risks

- Tools that currently use `smartSnap` may silently stop snapping if the constraint service proxy has no implementation (no grid plugin installed). The proxy returns the point unchanged when no implementation is set. The explicit opt-out pattern (development warnings, tool registration declarations) mitigates this.
- RollKeeper imports `smartSnap` directly from `@fieldnotes/core`. After extraction, this import breaks. RollKeeper must either use `ctx.constraintService` or import from `@fieldnotes/vtt`.
- The `GridController.syncContext()` logic (syncing grid type/orientation into ToolContext) must move to the grid plugin. If the plugin doesn't sync correctly, snap behavior changes unexpectedly.

## Review Response

### Finding 10 (F10): SnapService still embeds VTT concepts in core

The original proposal placed a VTT-specific `SnapService` (with methods like `snapToCellCenter`, `getGridInfo`, and types like `'square' | 'hex'`) directly on `ToolContext` in `@fieldnotes/core`. This contradicted the zero-VTT-core objective.

**Changes made:**

1. **Replaced `SnapService` with domain-neutral `PointConstraintService`.** Core's `constraintService` slot carries no grid/hex/cell concepts. The generic interface (`constrainPoint`, `getConstraintInfo`, `hasCapability`) is domain-agnostic.

2. **Moved VTT-specific behavior to `@fieldnotes/vtt`.** The `GridConstraintService` class implements `PointConstraintService` and interprets domain-neutral `ConstraintOptions` using grid-specific logic. Core tools never need VTT-specific imports or casts.

3. **Added explicit opt-out pattern for missing service.** Instead of silent fallback (`?? world`), tools that require constraining must handle the missing-service case with development warnings or tool registration declarations.

4. **Documented preservation of existing APIs.** `Viewport.setSnapToGrid(enabled: boolean)` remains in core as a boolean toggle. The React `snapToGrid` prop at `field-notes-canvas.tsx:104` continues to work unchanged.

5. **Updated backward compatibility section.** Clarified the transition path: snap functions remain in core during transition, move to `@fieldnotes/vtt` after extraction.

6. **Added Option B (original) to Options Considered.** Documented why the original VTT-specific `SnapService` was superseded by the domain-neutral approach.

7. **Updated Consequences and Risks.** Added "Zero VTT in core" and "No unsafe casts" as positive consequences. Updated risks to reflect the explicit opt-out pattern.

### Finding 9 (F9): Constraint service cannot preserve setSnapToGrid() as specified

**Part A — Missing activation control:** `PointConstraintService.isActive` was read-only with no activation method, but the ADR said `Viewport.setSnapToGrid()` activates/deactivates it. Tools calling the service directly could constrain even when snapping was disabled.

**Part B — Unsafe cast:** The tool migration showed `ctx.constraintService as GridConstraintService`, an unchecked cast that introduces a core→VTT dependency if used by core's SelectTool.

**Changes made:**

1. **Added `setActive(active: boolean)` to `PointConstraintService`.** Core now has explicit control over whether constraining is active. `Viewport.setSnapToGrid()` delegates to `constraintService.setActive(enabled)`. When inactive, `constrainPoint()` returns the original point unchanged — tools don't need to check `isActive` themselves.

2. **Replaced unsafe cast with domain-neutral `ConstraintOptions`.** Tools express placement intent through `ConstraintOptions` (e.g., `mode: 'cell-center'`, `footprint: { width, height }`). The `GridConstraintService` implementation interprets these options using its grid-specific logic. Core tools never import VTT types or cast.

3. **Added typed capability query.** For cases where domain-neutral options aren't sufficient, `hasCapability()` / `getCapability<T>()` provides a safe typed query without casting.

4. **Updated `ConstraintOptions` to include `footprint`.** Added `footprint?: { width: number; height: number }` as a domain-neutral shape descriptor, enabling tools to pass footprint information without VTT-specific types.

5. **Updated tool migration code.** Shows tools always calling the service (which handles active/inactive internally) and using `ConstraintOptions` for grid-specific behavior. Removed the `as GridConstraintService` cast pattern.

6. **Updated RollKeeper tool compatibility table.** DmTokenTool and SelectTool now use `constrainPoint(world, { mode: 'cell-center', footprint })` instead of casting.

7. **Updated Consequences.** Removed "Casting for VTT-specific behavior" from negatives. Added "No unsafe casts" to positives. Removed casting risk from risks section.

### Fourth review — Finding 11 (F11): Point-constraint service still cannot preserve snapping behavior

**Part A — Service can disappear or be replaced when grid state changes:** The ADR said "When a grid is added/removed/changed, the grid plugin updates the `PointConstraintService` instance (or replaces it)." If `setSnapToGrid(true)` runs while no service exists, a later service starts inactive and loses the toggle.

**Part B — `getCapability<T>()` lets the caller assert any type:** The generic `getCapability<T>()` was unsafe — the caller could assert any type. The example used a prohibited non-null assertion (`!`).

**Part C — Template resizing snaps scalar radius/width and recalculates radiusFeet:** This logic is not reducible to `constrainPoint()`. It needs the missing template interaction adapter from ADR-0001's F3.

**Changes made:**

1. **Added stable `ConstraintServiceProxy`.** Core owns a proxy that is always present on `ToolContext` once initialized. The proxy delegates to the current implementation via `_setImpl()`. Activation state (`_active`) is owned solely by the proxy and survives service replacement. Since implementations have no activation state, `_setImpl()` simply swaps the implementation — the proxy continues gating based on its own `_active` state.

2. **Removed `getCapability<T>()`.** The unsafe generic method was removed from `PointConstraintService`. Domain-specific access now uses the typed service registry (ADR-0005): `viewport.getService<GridConstraintService>('grid')`. This eliminates the possibility of callers asserting arbitrary types.

3. **Replaced non-null assertion example.** The `getCapability<GridSnapCapability>(...)!.snapToCellCenter(...)` pattern was replaced with the safe service registry pattern: `viewport.getService<GridConstraintService>('grid')?.snapToCellCenter(world, footprint) ?? world`.

4. **Acknowledged template resizing limitation.** Template resizing involves snapping scalar values (radius, width) and recalculating derived fields (`radiusFeet`). This is not reducible to `constrainPoint()` — it requires domain-specific logic that understands template geometry. This logic belongs in the template element type's interaction adapter (ADR-0001, `ElementInteractionAdapter.dragUpdate()`).

5. **Updated RollKeeper tool compatibility table.** Added TemplateTool (resize) row noting it uses the interaction adapter, not the constraint service. Added explanatory note with code comment showing where the logic lives.

6. **Updated `ToolContext` interface.** Changed `constraintService?: PointConstraintService` to `constraintService: PointConstraintService` — the proxy is always present once initialized. Updated all tool migration examples to remove optional chaining (`?.`) and null-coalescing (`?? world`).

7. **Updated ConstraintService ownership section.** Replaced the "service can be `undefined`" model with the stable proxy pattern. Documented `_setImpl()`, activation state persistence, and re-application on service replacement.

8. **Updated Consequences.** Added "Stable activation state" and "No unsafe casts or generics" to positives. Added "Proxy indirection" and "Template resizing not covered" to negatives. Updated risks to reflect proxy behavior.

### Fifth review — F10

- **F10 (Constraint proxy activation):** Redesigned so activation is solely a proxy concern. Removed `isActive` and `setActive()` from the `PointConstraintService` implementation interface. The `ConstraintServiceProxy` owns activation state (`_active`) and gates calls — implementations are always ready, they just constrain points when the proxy delegates. `_setImpl()` no longer forwards activation state (there's nothing to forward). `isActive` is a proper getter on the proxy. This eliminates the bug where `_setImpl()` only forwarded `true` and the implementation could remain active after `setSnapToGrid(false)`.

### Sixth review — Finding 7 (P1): Point-constraint public type does not expose activation API

**Problem:** `ToolContext.constraintService` was declared as `PointConstraintService` which intentionally has no `isActive` or `setActive()`. But examples accessed `.isActive` and `.setActive()` — these wouldn't compile.

**Changes made:**

1. **Defined `ConstraintServiceAccess` public interface.** Includes activation control (`isActive`, `setActive`) alongside constraint methods. This is the interface exposed on `ToolContext` and `Viewport`.

2. **Updated `ToolContext` to use `ConstraintServiceAccess`.** Changed `constraintService: PointConstraintService` to `constraintService: ConstraintServiceAccess` so the public type matches the actual API.

3. **Updated `ConstraintServiceProxy` to implement `ConstraintServiceAccess`.** The proxy now explicitly implements the public interface while delegating constraint logic to a `PointConstraintService` implementation internally.

4. **Fixed string-generic `getService` examples.** Replaced `getService<GridConstraintService>('grid')` (unsafe string-keyed) with `getService(GridControllerKey)` (typed `ServiceKey<GridController>` pattern).

5. **Added two-interface design note.** Documented that `ConstraintServiceAccess` is the public API (includes activation) while `PointConstraintService` is the implementation interface (no activation). The proxy implements the former and delegates to the latter, preventing implementations from bypassing the global snap toggle.

6. **Updated `Viewport.setSnapToGrid()` section.** Clarified that `constraintService.setActive()` is available because the type is `ConstraintServiceAccess`.

7. **Updated "Explicit opt-out for inactive service" section.** Added comment noting that `isActive` is part of the `ConstraintServiceAccess` public interface.

8. **Updated tool migration examples.** All examples now use `ConstraintServiceAccess` consistently.

## References

- `packages/core/src/core/snap.ts` — snapPoint, smartSnap, snapToCellCenter, snapFootprintCenter
- `packages/core/src/tools/types.ts` — ToolContext snap fields
- `packages/core/src/canvas/grid-controller.ts` — syncContext(), grid state management
- `packages/core/src/tools/shape-tool.ts:183` — smartSnap usage
- `packages/core/src/tools/select-tool.ts:139,648` — smartSnap and snapFootprintCenter usage
- `packages/core/src/tools/template-tool.ts:349` — private snapToGrid method
- `~/Projects/RollKeeper/src/components/ui/campaign/location-map/DmMarkerTool.ts:38` — explicit no-snap
- `~/Projects/RollKeeper/src/components/ui/campaign/player-vtt/SpellTemplateTool.ts:41` — smartSnap usage
- `~/Projects/RollKeeper/src/components/ui/campaign/dm-vtt/combatantToken.ts:93` — footprint-centered snapping
- `MIGRATION_VTT_EXTRACTION.md` §Extension Point Design → Input Hooks → Snap Service
