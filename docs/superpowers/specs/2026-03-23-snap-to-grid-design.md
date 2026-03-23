# Snap-to-Grid Design Spec

## Goal

Add toggle-able snap-to-grid that aligns element positions to the background grid during creation and dragging. Off by default.

## Core Utility

New file: `packages/core/src/core/snap.ts`

```typescript
import type { Point } from './types';

export function snapPoint(point: Point, gridSize: number): Point {
  return {
    x: Math.round(point.x / gridSize) * gridSize,
    y: Math.round(point.y / gridSize) * gridSize,
  };
}
```

Named `snapPoint` (not `snapToGrid`) to avoid collision with the `snapToGrid` boolean field on `ToolContext`.

## Helper in Tools

Each tool that needs snapping uses a local helper to conditionally snap:

```typescript
function snap(point: Point, ctx: ToolContext): Point {
  return ctx.snapToGrid && ctx.gridSize ? snapPoint(point, ctx.gridSize) : point;
}
```

This guards against `gridSize` being `undefined` — if either `snapToGrid` is false or `gridSize` is missing, the point passes through unchanged.

## ToolContext Changes

Add to `ToolContext` in `packages/core/src/tools/types.ts`:

```typescript
snapToGrid?: boolean;
gridSize?: number;
```

Both optional for backwards compatibility.

## Viewport Changes

- Add private `_snapToGrid: boolean` state (default `false`)
- Add `setSnapToGrid(enabled: boolean)` public method — updates `_snapToGrid` and rebuilds `toolContext`
- Add `get snapToGrid(): boolean` public getter
- Store `gridSize` from `background.spacing` at construction time (the spacing is passed in `ViewportOptions.background.spacing`, default 24)
- Rebuild `toolContext` when snap state changes so tools always see current values

## Tool Changes — Position-Only Snapping

### Select Tool
- Snap `lastWorld` in `onPointerDown` — critical so the first drag delta is correct
- Snap `world` in `onPointerMove` before computing `dx`/`dy`
- Both must be snapped so deltas are always between snapped positions

### Shape Tool
- Snap `start` in `onPointerDown`
- Snap `end` in `onPointerMove`

### Note Tool
- Snap placement position in `onPointerUp`

### Text Tool
- Snap placement position in `onPointerUp`

### Arrow Tool
- Snap start point in `onPointerDown` (when not binding to element)
- Snap end point in `onPointerMove` (when not binding to element)
- Skip snapping when binding — arrow binding already snaps to element centers

## What Does NOT Snap

- Element resize/handle drag
- Arrow binding points (they snap to element centers, not grid)
- Canvas pan/zoom
- Multi-element drag: cursor movement is snapped, so all elements move by the same snapped delta. Elements that started off-grid stay off-grid relative to each other. This is intentional — it preserves relative positioning.

## Notes

- Snap operates in world coordinates, so zoom level does not affect correctness
- If `background.pattern` is `'none'`, snap still works against the configured spacing — there's just no visible grid

## API Surface

```typescript
// Viewport
viewport.setSnapToGrid(enabled: boolean): void;
viewport.snapToGrid: boolean; // read-only getter

// Utility export
export { snapPoint } from './core/snap';
```

## Version

Bump to `0.5.0` (minor — new feature with API addition).

## Files

### New
- `packages/core/src/core/snap.ts` — snap utility
- `packages/core/src/core/snap.test.ts` — tests

### Modified
- `packages/core/src/tools/types.ts` — add snap fields to ToolContext
- `packages/core/src/canvas/viewport.ts` — snap state, setter, toolContext integration
- `packages/core/src/tools/select-tool.ts` — snap during drag
- `packages/core/src/tools/select-tool.test.ts` — snap drag tests
- `packages/core/src/tools/shape-tool.ts` — snap creation points
- `packages/core/src/tools/shape-tool.test.ts` — snap tests
- `packages/core/src/tools/note-tool.ts` — snap placement
- `packages/core/src/tools/note-tool.test.ts` — snap test
- `packages/core/src/tools/text-tool.ts` — snap placement
- `packages/core/src/tools/text-tool.test.ts` — snap test
- `packages/core/src/tools/arrow-tool.ts` — snap endpoints
- `packages/core/src/tools/arrow-tool.test.ts` — snap test
- `packages/core/src/index.ts` — export snapPoint, version bump
- `packages/core/src/index.test.ts` — version test
- `packages/core/package.json` — version bump
- `demo/index.html` — snap toggle button
- `demo/main.ts` — wire up toggle
