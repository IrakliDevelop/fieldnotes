# ADR-0006: Snapping as Opt-In Service

- **Status:** Decided
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

**Explicit snap service on ToolContext** (Option B).

Core exposes snapping as an opt-in service. Tools call it when they want snapping. Different tools can use different snap strategies in the same gesture.

```typescript
// SnapService is provided by the VTT package, registered on ToolContext:
interface ToolContext {
  // ... existing fields ...
  snapService?: SnapService; // Provided by @fieldnotes/vtt when grid is active
}

interface SnapService {
  // Snap a world-space point to the nearest grid intersection
  snapWorld(point: Point, options?: SnapOptions): Point;
  // Snap to cell center (accounting for footprint)
  snapToCellCenter(point: Point, footprint?: Footprint): Point;
  // Smart snap — uses current grid type (square/hex) automatically
  smartSnap(point: Point): Point;
  // Get current grid info
  getGridInfo(): GridInfo | null;
  // Check if snapping is currently active
  get isSnappingEnabled(): boolean;
}

interface SnapOptions {
  mode?: 'center' | 'edge' | 'corner' | 'nearest';
  gridSize?: number; // Override current grid size
  gridType?: 'square' | 'hex'; // Override current grid type
}
```

### Tool migration

Each tool migrates from scattered snap calls to explicit service calls:

```typescript
// Before (scattered):
import { smartSnap } from '@fieldnotes/core';
const snapped = smartSnap(world, ctx);

// After (explicit service):
const snapped = ctx.snapService?.smartSnap(world) ?? world;
```

```typescript
// Before (private method):
private snapToGrid(point: Point, ctx: ToolContext): Point {
  if (ctx.snapToGrid && ctx.gridSize) return snapPoint(point, ctx.gridSize);
  return point;
}

// After (explicit service):
const snapped = ctx.snapService?.snapWorld(point) ?? point;
```

Tools that don't snap (DmMarkerTool, MovementPathTool) simply don't call the service. No change needed.

### RollKeeper tool compatibility

| Tool                | Current behavior                     | After migration                                       |
| ------------------- | ------------------------------------ | ----------------------------------------------------- |
| DmMarkerTool        | No snap (explicit comment)           | No snap — doesn't call snapService                    |
| SpellTemplateTool   | `smartSnap(world, ctx)`              | `ctx.snapService?.smartSnap(world)`                   |
| DmTokenTool         | `snapToCellCenter(world, footprint)` | `ctx.snapService?.snapToCellCenter(world, footprint)` |
| MovementPathTool    | No snap                              | No snap — doesn't call snapService                    |
| SelectTool (resize) | `snapFootprintCenter(...)`           | `ctx.snapService?.snapToCellCenter(point, footprint)` |

### SnapService ownership

The `SnapService` is created and owned by the VTT package's grid plugin. It reads grid state from the `ElementStore` (via `store.getElementsByType('grid')`) and provides snap functions.

When no grid is active, `snapService` is `undefined` on `ToolContext`. Tools that call it must handle the `undefined` case (fall back to unsnapped coordinates).

When a grid is added/removed/changed, the grid plugin updates the `SnapService` instance (or replaces it). `GridController.syncContext()` becomes the grid plugin's responsibility.

### Backward compatibility

The existing snap functions (`smartSnap`, `snapPoint`, etc.) remain exported from `@fieldnotes/core` during the transition. Tools that import them directly continue to work. The `SnapService` is a new, preferred API that wraps these functions with grid-aware state.

After the VTT extraction, the snap functions move to `@fieldnotes/vtt`. Core no longer exports them. Tools must use `ctx.snapService` (provided by the VTT plugin) or import from `@fieldnotes/vtt` directly.

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

## Consequences

### Positive

- **Tool autonomy:** Each tool decides independently whether and how to snap.
- **Mixed strategies:** Different tools can use different snap modes in the same gesture.
- **RollKeeper compatible:** DmMarkerTool stays unsnapped. SpellTemplateTool snaps. No conflicts.
- **Testable:** SnapService is a pure service that can be tested independently of tools.
- **Clean ownership:** SnapService is owned by the VTT grid plugin. Core doesn't know about grid snapping.

### Negative

- **Tool migration:** Every tool that currently calls `smartSnap` must be updated to use `ctx.snapService`. ~8 core tools + RollKeeper tools.
- **Undefined handling:** Tools must handle `snapService` being `undefined` (no grid active). Adds a null check at every call site.
- **API change:** `smartSnap(point, ctx)` becomes `ctx.snapService?.smartSnap(point)`. Different signature. RollKeeper's `import { smartSnap } from '@fieldnotes/core'` breaks after extraction.
- **Grid state access:** SnapService needs access to grid state (grid size, type, orientation). It reads from the store, which adds a dependency.

### Risks

- Tools that currently use `smartSnap` may silently stop snapping if `snapService` is `undefined` and the fallback is `?? world` (raw coordinates). Must ensure the VTT plugin installs the snap service before tools need it.
- RollKeeper imports `smartSnap` directly from `@fieldnotes/core`. After extraction, this import breaks. RollKeeper must either use `ctx.snapService` or import from `@fieldnotes/vtt`.
- The `GridController.syncContext()` logic (syncing grid type/orientation into ToolContext) must move to the grid plugin. If the plugin doesn't sync correctly, snap behavior changes unexpectedly.

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
