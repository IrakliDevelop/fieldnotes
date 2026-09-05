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
  constraintService?: PointConstraintService; // Domain-neutral
}

interface PointConstraintService {
  // Generic point constraint — no grid/hex/cell concepts
  constrainPoint(point: Point, options?: ConstraintOptions): Point;
  // Get info about the current constraint (opaque to core)
  getConstraintInfo(): ConstraintInfo | null;

  // Activation control — core toggles constraining on/off
  readonly isActive: boolean;
  setActive(active: boolean): void;

  // Typed capability query — no casting needed
  hasCapability(capability: string): boolean;
  getCapability<T>(capability: string): T | undefined;
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
  private _active = false;

  constrainPoint(point: Point, options?: ConstraintOptions): Point {
    if (!this._active) return point; // Inactive → return unchanged
    // Interprets options.mode and options.footprint using grid-specific logic
    // (smartSnap, snapToCellCenter, etc.)
  }
  getConstraintInfo(): GridConstraintInfo {
    return { type: 'grid', gridType: this.gridType, cellSize: this.cellSize, ... };
  }
  readonly isActive: boolean;
  setActive(active: boolean): void { this._active = active; }

  hasCapability(capability: string): boolean {
    // e.g., 'grid:cell-center', 'grid:smart-snap'
  }
  getCapability<T>(capability: string): T | undefined {
    // Return typed capability object if supported
  }
}
```

### Tool migration

Each tool migrates from scattered snap calls to explicit service calls:

```typescript
// Before (VTT-specific import from core):
import { smartSnap } from '@fieldnotes/core';
const snapped = smartSnap(world, ctx);

// After (domain-neutral via constraint service):
// Tools always call the service — it handles active/inactive internally:
const snapped = ctx.constraintService?.constrainPoint(world) ?? world;
// If service is inactive (setSnapToGrid(false)), constrainPoint returns world unchanged.
// If no service is registered, ?? world provides the unconstrained fallback.
```

```typescript
// Before (private method):
private snapToGrid(point: Point, ctx: ToolContext): Point {
  if (ctx.snapToGrid && ctx.gridSize) return snapPoint(point, ctx.gridSize);
  return point;
}

// After (explicit service):
const snapped = ctx.constraintService?.constrainPoint(point) ?? point;
```

Tools that need grid-specific behavior (e.g., cell-center snapping with a footprint) express their placement intent through domain-neutral `ConstraintOptions`. The `GridConstraintService` implementation interprets these options using its grid-specific logic. No cast needed. No VTT import in core. The service is the abstraction boundary.

```typescript
// Core tools use domain-neutral options — no cast, no VTT import:
const snapped =
  ctx.constraintService?.constrainPoint(world, {
    mode: 'cell-center',
    footprint: { width: 2, height: 2 },
  }) ?? world;

// The GridConstraintService interprets these options using its grid-specific logic.
```

For cases where a tool genuinely needs grid-specific behavior that can't be expressed through options, the `hasCapability()` / `getCapability()` pattern provides a safe typed query without casting:

```typescript
// Typed capability query — no unsafe cast:
const snapped = ctx.constraintService?.hasCapability('grid:cell-center')
  ? ctx.constraintService
      .getCapability<GridSnapCapability>('grid:cell-center')!
      .snapToCellCenter(world, footprint)
  : world;
```

Tools that don't snap (DmMarkerTool, MovementPathTool) simply don't call the service. No change needed.

### Explicit opt-out for missing service

Silent fallback to raw coordinates (`?? world`) risks unnoticed behavior changes when no constraint service is registered. Tools that **require** constraining must declare it and handle the missing-service case explicitly:

```typescript
// Instead of silent fallback:
const snapped = ctx.constraintService?.constrainPoint(world) ?? world;

// Require explicit handling:
if (!ctx.constraintService) {
  // Tool knows it needs constraining but no service available
  // Log warning in development, throw in tests
  if (process.env.NODE_ENV === 'development') {
    console.warn(`Tool ${toolName} requires constraintService but none is registered`);
  }
}
const snapped = ctx.constraintService?.constrainPoint(world) ?? world;
```

Better: tools that require constraining declare it in their registration, and the tool manager warns if no service is available when the tool is active.

### RollKeeper tool compatibility

| Tool                | Current behavior                     | After migration                                                                    |
| ------------------- | ------------------------------------ | ---------------------------------------------------------------------------------- |
| DmMarkerTool        | No snap (explicit comment)           | No snap — doesn't call constraintService                                           |
| SpellTemplateTool   | `smartSnap(world, ctx)`              | `ctx.constraintService?.constrainPoint(world)`                                     |
| DmTokenTool         | `snapToCellCenter(world, footprint)` | `ctx.constraintService?.constrainPoint(world, { mode: 'cell-center', footprint })` |
| MovementPathTool    | No snap                              | No snap — doesn't call constraintService                                           |
| SelectTool (resize) | `snapFootprintCenter(...)`           | `ctx.constraintService?.constrainPoint(point, { mode: 'cell-center', footprint })` |

### ConstraintService ownership

The `PointConstraintService` slot lives on `ToolContext` in `@fieldnotes/core`. The concrete implementation (`GridConstraintService`) is created and owned by the VTT package's grid plugin. It reads grid state from the `ElementStore` (via `store.getElementsByType('grid')`) and provides constraint functions.

When no grid is active, `constraintService` is `undefined` on `ToolContext`. Tools that call it must handle the `undefined` case (fall back to unconstrained coordinates, with explicit warnings as described above).

When a grid is added/removed/changed, the grid plugin updates the `PointConstraintService` instance (or replaces it). `GridController.syncContext()` becomes the grid plugin's responsibility.

### Preserving existing APIs

#### `Viewport.setSnapToGrid(enabled: boolean)`

This public API toggles snapping on/off. It remains in core as a simple boolean toggle. The method does **not** take grid parameters — those come from the constraint service itself.

`Viewport.setSnapToGrid()` delegates to the constraint service's `setActive()` method:

```typescript
// Viewport.setSnapToGrid() delegates to the constraint service:
setSnapToGrid(enabled: boolean): void {
  this._snapToGrid = enabled;
  this.constraintService?.setActive(enabled);
}
```

The `setActive()` method gives core explicit control over whether constraining is active. When `setSnapToGrid(false)` is called, the service deactivates — tools that call `constrainPoint()` while the service is inactive get back the original point unchanged (the service itself checks `isActive` before constraining). This preserves the existing toggle behavior without requiring tools to check `isActive` themselves.

#### React `snapToGrid` prop

The reactive prop at `packages/react/src/field-notes-canvas.tsx:104` continues to call `viewport.setSnapToGrid(snapToGrid)`. No change needed for this prop.

### Backward compatibility

During the transition:

- `smartSnap`, `snapPoint`, etc. remain exported from `@fieldnotes/core`
- `GridController.syncContext()` continues to work as before
- The `constraintService` slot is added to ToolContext as optional
- VTT plugin installs the `GridConstraintService` into the slot

After extraction:

- Snap functions move to `@fieldnotes/vtt`
- Core only has the `constraintService` slot
- Tools use `ctx.constraintService?.constrainPoint()` or import from `@fieldnotes/vtt`

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
- **No unsafe casts:** Tools express placement intent through domain-neutral `ConstraintOptions`. The service implementation interprets options using domain-specific logic. Core tools never import VTT types.
- **Existing APIs preserved:** `Viewport.setSnapToGrid()` and the React `snapToGrid` prop continue to work unchanged.

### Negative

- **Tool migration:** Every tool that currently calls `smartSnap` must be updated to use `ctx.constraintService`. ~8 core tools + RollKeeper tools.
- **Undefined handling:** Tools must handle `constraintService` being `undefined` (no constraint service active). Adds a null check at every call site, with explicit warnings for tools that require constraining.
- **API change:** `smartSnap(point, ctx)` becomes `ctx.constraintService?.constrainPoint(point)`. Different signature. RollKeeper's `import { smartSnap } from '@fieldnotes/core'` breaks after extraction.
- **Grid state access:** `GridConstraintService` needs access to grid state (grid size, type, orientation). It reads from the store, which adds a dependency.

### Risks

- Tools that currently use `smartSnap` may silently stop snapping if `constraintService` is `undefined` and the fallback is `?? world` (raw coordinates). Must ensure the VTT plugin installs the constraint service before tools need it. The explicit opt-out pattern (development warnings, tool registration declarations) mitigates this.
- RollKeeper imports `smartSnap` directly from `@fieldnotes/core`. After extraction, this import breaks. RollKeeper must either use `ctx.constraintService` or import from `@fieldnotes/vtt`.
- The `GridController.syncContext()` logic (syncing grid type/orientation into ToolContext) must move to the grid plugin. If the plugin doesn't sync correctly, snap behavior changes unexpectedly.

## Review Response

### Finding 10 (F10): SnapService still embeds VTT concepts in core

The original proposal placed a VTT-specific `SnapService` (with methods like `snapToCellCenter`, `getGridInfo`, and types like `'square' | 'hex'`) directly on `ToolContext` in `@fieldnotes/core`. This contradicted the zero-VTT-core objective.

**Changes made:**

1. **Replaced `SnapService` with domain-neutral `PointConstraintService`.** Core's `constraintService` slot carries no grid/hex/cell concepts. The generic interface (`constrainPoint`, `getConstraintInfo`, `isActive`) is domain-agnostic.

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
